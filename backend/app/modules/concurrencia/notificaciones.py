from __future__ import annotations

import datetime as dt
import uuid
from collections.abc import Callable

from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from app.core import mail
from app.core.logging import log
from app.modules.concurrencia import nucleo, service
from app.shared import personas
from app.shared.auth import service as auth_service
from app.shared.catalogos.models import Module
from app.shared.notificaciones import service as notificaciones
from app.shared.users.models import User

# Ecuador continental no tiene horario de verano: el desfase es fijo, y con un
# offset explícito no dependemos de que la imagen slim traiga la base de zonas.
ZONA_EC = dt.timezone(dt.timedelta(hours=-5))

ETIQUETA_ESTADO = {
    "programada": "Programada",
    "cancelada": "Cancelada",
    "asignada": "Asignada",
    "auditando": "Auditando",
    "culminada": "Culminada",
    "no_auditado": "No auditado",
}


def en_fondo(funcion: Callable[..., None], *args: object) -> None:
    """
    Corre un aviso como tarea de fondo de FastAPI, DESPUÉS de responder. La
    respuesta no puede quedarse rehén del correo: un SMTP inalcanzable espera
    su timeout por cada dirección resuelta y por cada destinatario, y eso ya
    dejó a nginx cortando con 504 un caso perfectamente creado. FastAPI cierra
    la sesión del request antes de ejecutar estas tareas, así que el aviso abre
    la suya; y como ya no hay respuesta que proteger, cualquier fallo aquí solo
    se registra.
    """
    from app.core.db import SessionLocal

    try:
        with SessionLocal() as db:
            funcion(db, *args)
    except Exception:  # noqa: BLE001 - el aviso jamás tumba nada
        log.exception("aviso_en_fondo_fallo")


def _cuando(momento: dt.datetime) -> str:
    return momento.astimezone(ZONA_EC).strftime("%d/%m/%Y %H:%M")


def avisar_en_campana(db: DbSession, visita) -> int:
    """
    El aviso de la campana del armazón cuando una COMPAÑÍA programa un caso: a
    quien coordina Concurrencia en Accumedical —que es quien lo va a derivar—,
    al administrador global, y a **quien coordina la propia aseguradora**, que
    responde por lo que pide su compañía.

    Se escribe DENTRO de la transacción del caso —no como el correo, que va
    después de responder—: un aviso de un caso que no llegó a guardarse sería
    mentira, y aquí no hay nada irreversible que proteger.

    El texto queda congelado tal como se lee al crearse: el módulo, la compañía y
    el estado con el que nace. Si mañana el caso se cancela, el aviso sigue
    contando lo que pasó ese día, que es lo que la persona recuerda.
    """
    modulo = db.get(Module, "concurrencia")
    aseguradora = nucleo.aseguradora(db, visita.aseguradora_id)

    # Cada uno a SU pantalla del caso, que no es la misma para los tres —y por
    # eso la URL se guarda por notificación y no se deduce del módulo—:
    #
    #   · la coordinación de Accumedical entra por su panel de supervisión;
    #   · el administrador global supervisa desde `/admin/auditorias`, y
    #     `/concurrencia` ni siquiera lo deja pasar, porque no tiene módulos;
    #   · la coordinación de la COMPAÑÍA abre el caso de su propia empresa, en
    #     solo lectura: las visitas las gestiona su equipo operador, y las dos
    #     rutas de arriba le responderían 403.
    #
    # La dirección es la del CASO, que es una página propia: abre directamente
    # ahí, sin pasar por la lista.
    destinos: list[tuple[User, str]] = [
        (quien, f"/concurrencia/supervision/{visita.id}")
        for quien in auth_service.coordinadores_de_modulo(db, "concurrencia")
    ]
    destinos += [
        (admin, f"/admin/auditorias/concurrencia/{visita.id}")
        for admin in db.scalars(
            select(User).where(
                User.is_superadmin.is_(True),
                User.is_active.is_(True),
                User.deleted_at.is_(None),
            )
        )
    ]
    # Por las MISMAS dos puertas que el correo: la fila del módulo o la
    # coordinación de la compañía. Mirar solo una dejaba sin campana justo a
    # quien responde por el caso dentro de la aseguradora.
    destinos += [
        (quien, f"/concurrencia/{visita.id}/ver")
        for quien in auth_service.coordinadores_de_aseguradora(
            db, visita.aseguradora_id, "concurrencia"
        )
    ]

    for quien, url in destinos:
        notificaciones.crear(
            db,
            user_id=quien.id,
            module_code="concurrencia",
            titulo=modulo.nombre if modulo else "Auditoría de Concurrencia",
            subtitulo=(aseguradora.nombre_comercial or aseguradora.razon_social)
            if aseguradora
            else "",
            detalle=ETIQUETA_ESTADO.get(visita.estado, visita.estado),
            url=url,
            entidad="conc_visitas",
            entidad_id=visita.id,
        )
    return len(destinos)


def _destinos_del_aviso(
    db: DbSession, visita, *, incluir_plataforma: bool
) -> list[tuple[User, str]]:
    """
    Quién se entera de lo que le pasa a un caso, **cada uno por SU puerta**: la
    URL se guarda en cada notificación porque las tres pantallas son distintas y
    la de uno le responde 403 a los demás.

      · el operador que lo programó → su ficha del caso, la de su bandeja;
      · la coordinación de la aseguradora → el caso en solo lectura;
      · la coordinación de Accumedical → su panel de supervisión.

    Al operador solo si es de esta compañía: un caso que programó la propia
    coordinación de plataforma no tiene operador al que avisar. Y la plataforma
    entra o no según el aviso: de una derivación no se avisa a quien acaba de
    derivar, pero de la llegada del auditor sí, que es novedad para todos.
    """
    destinos: list[tuple[User, str]] = []

    creador = db.get(User, visita.created_by) if visita.created_by else None
    if (
        creador is not None
        and creador.aseguradora_id == visita.aseguradora_id
        and creador.is_active
        and creador.deleted_at is None
    ):
        destinos.append((creador, f"/concurrencia/{visita.id}"))

    destinos += [
        (quien, f"/concurrencia/{visita.id}/ver")
        for quien in auth_service.coordinadores_de_aseguradora(
            db, visita.aseguradora_id, "concurrencia"
        )
    ]
    if incluir_plataforma:
        destinos += [
            (quien, f"/concurrencia/supervision/{visita.id}")
            for quien in _coordinadores_de_plataforma(db)
        ]
    return destinos


def _escribir_aviso(db: DbSession, visita, destinos: list[tuple[User, str]], estado: str) -> int:
    """
    Escribe el mismo aviso para cada destino, sin repetir a nadie. El texto es
    el de siempre —módulo, de qué caso, qué pasó—; lo único que cambia entre
    personas es a dónde lleva.
    """
    modulo = db.get(Module, "concurrencia")
    prestador_nombre = nucleo.nombre_prestador(db, visita.prestador_id)
    # La compañía la sabe todo el mundo aquí: lo que identifica el aviso es el
    # caso y a dónde va.
    de_que_caso = visita.codigo_interno
    if prestador_nombre is not None:
        de_que_caso = f"{visita.codigo_interno} · {prestador_nombre}"

    avisados = 0
    ya_avisados: set[uuid.UUID] = set()
    for quien, url in destinos:
        if quien.id in ya_avisados:
            continue
        ya_avisados.add(quien.id)
        notificaciones.crear(
            db,
            user_id=quien.id,
            module_code="concurrencia",
            titulo=modulo.nombre if modulo else "Auditoría de Concurrencia",
            subtitulo=de_que_caso,
            detalle=ETIQUETA_ESTADO.get(estado, estado),
            url=url,
            entidad="conc_visitas",
            entidad_id=visita.id,
        )
        avisados += 1
    return avisados


def avisar_derivacion_en_campana(db: DbSession, visita) -> int:
    """
    El aviso de la campana cuando Accumedical deriva el caso a un médico auditor,
    **a los dos lados de la compañía**: a quien la coordina, que responde por lo
    que pidió su empresa, y al **operador que programó el caso**, que es quien
    lo está esperando. A quien deriva no se le avisa, claro: acaba de hacerlo.

    **No dice QUIÉN es el auditor.** A quién manda Accumedical es asunto de
    Accumedical —por eso el caso se ve «Asignada» y no «Asignada a Fulano»—;
    lo que la compañía necesita saber es que ya tiene médico.

    Se escribe DENTRO de la transacción de la derivación, como todos los avisos
    de campana: o se guardan los dos o no se guarda ninguno.
    """
    return _escribir_aviso(
        db, visita, _destinos_del_aviso(db, visita, incluir_plataforma=False), "asignada"
    )


def avisar_llegada_en_campana(db: DbSession, visita) -> int:
    """
    El aviso cuando el médico auditor marca «Ya llegué» en la app: **a los
    tres** —el operador que programó el caso y las dos coordinaciones—, porque
    es la novedad que todos estaban esperando: la visita está ocurriendo.

    Aquí sí entra la coordinación de Accumedical: no lo hizo ella, lo hizo el
    auditor desde el hospital, así que para ella también es noticia.

    Dentro de la transacción de la llegada, como todos los avisos de campana.
    """
    return _escribir_aviso(
        db, visita, _destinos_del_aviso(db, visita, incluir_plataforma=True), "auditando"
    )


def avisar_culminacion_en_campana(db: DbSession, visita) -> int:
    """
    El aviso cuando el auditor envía su informe y el caso culmina: **a los
    tres** —el operador que lo programó y las dos coordinaciones—, que es
    justamente el final que todos esperaban.

    El correo con el PDF sale aparte, y a más gente: a los correos anotados del
    caso. Esto es la campana, que es de quien trabaja en la plataforma.
    """
    return _escribir_aviso(
        db, visita, _destinos_del_aviso(db, visita, incluir_plataforma=True), "culminada"
    )


def avisar_vencimiento_en_campana(db: DbSession, visita) -> int:
    """
    El aviso cuando un caso vence sin que el auditor llegara. **Solo a la
    coordinación de Accumedical**: `no_auditado` es interno —la compañía sigue
    viendo su caso como pendiente— y es Accumedical quien tiene que resolverlo,
    prorrogando el plazo o buscando otro auditor.

    Avisar a la compañía de esto sería contarle un problema de casa ajena que
    probablemente se arregle en un par de horas, y encima contradiría lo que su
    propia pantalla le enseña.

    Dentro de la transacción de la tarea que vence los casos.
    """
    destinos = [
        (quien, f"/concurrencia/supervision/{visita.id}")
        for quien in _coordinadores_de_plataforma(db)
    ]
    return _escribir_aviso(db, visita, destinos, "no_auditado")


def _coordinadores_de_plataforma(db: DbSession) -> list[User]:
    """
    Quién coordina Concurrencia en Accumedical: es quien va a derivar el caso, y
    por eso se le copia todo aviso desde el primer momento.

    Se pregunta por **las dos puertas** —la fila del módulo y la familia—, la
    misma función que usa la campana (`auth_service.coordinadores_de_modulo`).
    Mirar solo `user_module_access`, como se hacía aquí, dejaba fuera al
    coordinador de familia: le llegaba el aviso a la campana pero no el correo.
    """
    return auth_service.coordinadores_de_modulo(db, "concurrencia")


def _supervisores_de_la_compania(db: DbSession, aseguradora_id: uuid.UUID) -> list[User]:
    """
    Quién coordina la PROPIA aseguradora del caso: su trabajo es mirar y
    supervisar, así que se le copia el aviso desde el primer momento. Pueden ser
    varios y se avisa a todos, por **las dos puertas**: la fila del módulo y
    `user_aseguradora_coordinador`, que es por donde entra el coordinador de
    compañía de hoy —y al que este aviso no llegaba—.
    """
    return auth_service.coordinadores_de_aseguradora(db, aseguradora_id, "concurrencia")


def _datos_del_caso(fila: tuple) -> list[str]:
    """Las líneas con los datos exactos del caso, las mismas en todos los avisos."""
    (
        visita,
        prestador_nombre,
        prestador_direccion,
        prestador_ciudad,
        prestador_provincia,
        sede_nombre,
        sede_direccion,
        sede_ciudad,
        sede_provincia,
        razon_social,
        nombre_comercial,
        _auditor_nombre,
        _total_correos,
    ) = fila

    # El destino, resuelto entero: la sede si la hay, la casa matriz si no.
    if visita.sede_id:
        destino, direccion, ciudad, provincia = (
            sede_nombre, sede_direccion, sede_ciudad, sede_provincia,
        )
    else:
        destino, direccion, ciudad, provincia = (
            "Casa matriz", prestador_direccion, prestador_ciudad, prestador_provincia,
        )
    donde = ", ".join(p for p in (ciudad, provincia) if p)
    lugar = " — ".join(p for p in (destino, direccion) if p) + (f" ({donde})" if donde else "")

    lineas = [
        f"  Código:       {visita.codigo_interno}",
        f"  Paciente:     {personas.de_fila(visita, 'paciente_')} "
        f"({visita.paciente_numero_documento})",
        f"  Aseguradora:  {nombre_comercial or razon_social}",
        f"  Prestador:    {prestador_nombre}",
        f"  Destino:      {lugar}",
        f"  Desde:        {_cuando(visita.desde)}",
        f"  Hasta:        {_cuando(visita.hasta)} (hora de Ecuador)",
        f"  Estado:       {ETIQUETA_ESTADO.get(visita.estado, visita.estado)}",
    ]
    if visita.observaciones:
        lineas.append(f"  Observaciones: {visita.observaciones}")
    return lineas


def _firma_del_creador(
    db: DbSession, visita, nombre_aseguradora: str
) -> tuple[str, str, str] | None:
    """
    La firma del membrete para el alta: quien creó el caso `(nombre, cargo,
    correo de login)`. Un operador de compañía firma «Operador · {su
    aseguradora}»; nuestro personal de plataforma (coordinador o admin),
    «Supervisor · Accumedical». Sin creador rastreable devuelve None y el
    correo firma la gerencia, como todos los demás.
    """
    creador = db.get(User, visita.created_by) if visita.created_by else None
    if creador is None:
        return None
    if creador.aseguradora_id is None:
        cargo = "Supervisor · Accumedical"
    else:
        cargo = f"Operador · {nombre_aseguradora}"
    return personas.de_fila(creador), cargo, creador.email


def correos_por_defecto(
    db: DbSession, aseguradora_id: uuid.UUID, creador: User | None
) -> list[tuple[str, str]]:
    """
    Quiénes reciben el aviso **siempre**, se anote a quien se anote: quien crea
    el caso, la coordinación de Concurrencia en Accumedical y la coordinación de
    la propia aseguradora. `(correo, quién es)`, sin repetidos y en ese orden.

    Existe para que el formulario pueda ENSEÑARLOS al programar —deshabilitados,
    porque no se quitan— sin duplicar la regla: el alta, el informe y la pantalla
    salen todos de aquí, y por eso no pueden discrepar.
    """
    fijos: list[tuple[str, str]] = []
    vistos: set[str] = set()

    def anotar(correo: str, quien: str) -> None:
        if correo.upper() in vistos:
            return
        vistos.add(correo.upper())
        fijos.append((correo, quien))

    if creador is not None and creador.deleted_at is None and creador.is_active:
        # Neutro a propósito: el caso lo crea un operador de compañía o el
        # coordinador de plataforma, y la etiqueta vale para ambos.
        anotar(creador.email, "creó el caso")
    for coordinador in _coordinadores_de_plataforma(db):
        anotar(coordinador.email, "coordinador de Concurrencia")
    for usuario in _supervisores_de_la_compania(db, aseguradora_id):
        anotar(usuario.email, "coordinador de la aseguradora")
    return fijos


def _destinatarios_del_caso(db: DbSession, visita) -> tuple[dict[str, str], dict[str, str]]:
    """
    Quiénes reciben los avisos del caso, sin repetir a nadie: los correos
    anotados en la visita y, encima, los **fijos** —quien la creó y las dos
    coordinaciones—, que salen de `correos_por_defecto`. La lista vive en UN
    solo sitio para que el alta, el informe y lo que enseña el formulario jamás
    diverjan. Devuelve también la etiqueta de rol de cada correo, para que el
    mensaje enumere a la vista de todos quién es quién.
    """
    destinatarios: dict[str, str] = {}
    etiquetas: dict[str, str] = {}
    for anotado in service.correos_detallados_de(db, visita.id):
        destinatarios.setdefault(anotado.email.upper(), anotado.email)
        # Quién es, tal como se anotó al programar: la ficha del contacto
        # marcado o lo que el operador escribió a mano.
        if anotado.etiqueta:
            etiquetas.setdefault(anotado.email.upper(), f" ({anotado.etiqueta})")
    creador = db.get(User, visita.created_by) if visita.created_by else None
    for correo, quien in correos_por_defecto(db, visita.aseguradora_id, creador):
        destinatarios.setdefault(correo.upper(), correo)
        etiquetas.setdefault(correo.upper(), f" ({quien})")
    return destinatarios, etiquetas


def notificar_creacion(db: DbSession, visita_id: uuid.UUID) -> None:
    """
    Avisa por correo que el caso se creó, con sus datos exactos: a cada correo de
    la visita —los contactos marcados y los transcritos a mano acaban idénticos
    en `conc_visita_correos`, así que aquí son lo mismo—, al operador que creó
    el caso —su constancia de lo que programó—, al supervisor de plataforma de
    Concurrencia, que es quien lo derivará a un auditor, y a los supervisores de
    la propia aseguradora del caso, que solo miran y deben enterarse de lo que
    programa su equipo.

    Se llama DESPUÉS del commit: un correo enviado no se puede deshacer, así que
    primero se asegura que la visita existe de verdad. Y cada envío va aislado:
    que un buzón rebote no frena a los demás ni rompe la respuesta —el caso ya
    está creado; el reintento es reenviar, no volver a crear—.
    """
    fila = service.fila_supervision(db, visita_id)
    visita, prestador_nombre = fila[0], fila[1]

    # Se calcula ANTES del cuerpo porque el propio mensaje enumera a quiénes
    # llegó; si alguno ya estaba anotado a mano, un solo mensaje.
    destinatarios, etiquetas = _destinatarios_del_caso(db, visita)

    lineas = [
        "Se programó una visita del médico auditor. Estos son los datos exactos:",
        "",
        *_datos_del_caso(fila),
    ]
    # Quién más lo recibió, a la vista de todos: cada quien sabe que el resto ya
    # está enterado y a quién copiar si responde.
    lineas += ["", "Este aviso se envió a:"]
    for correo in destinatarios.values():
        lineas.append(f"  - {correo}{etiquetas.get(correo.upper(), '')}")
    lineas += ["", "Accumedical"]
    texto = "\n".join(lineas)
    asunto = f"Visita {visita.codigo_interno} programada · {prestador_nombre}"
    # El alta la firma quien la creó. El nombre de la compañía sale de la misma
    # fila que pintan los datos del caso (razon_social, nombre_comercial).
    razon_social, nombre_comercial = fila[9], fila[10]
    firma = _firma_del_creador(db, visita, nombre_comercial or razon_social)

    enviados = 0
    for correo in destinatarios.values():
        try:
            mail.enviar(para=correo, asunto=asunto, texto=texto, firma=firma)
            enviados += 1
        except mail.ErrorDeCorreo:
            # Ya quedó en el log como correo_fallido, con destinatario y asunto.
            continue
    log.info(
        "visita_notificada",
        visita=visita.codigo_interno,
        destinatarios=len(destinatarios),
        enviados=enviados,
    )


def enviar_informe(db: DbSession, visita_id: uuid.UUID, pdf: bytes) -> tuple[int, int]:
    """
    Manda el informe redactado, EN PDF adjunto, a los mismos destinatarios de
    todos los avisos del caso: sus correos marcados, el operador que lo creó y
    los supervisores (plataforma y aseguradora). Devuelve (destinatarios,
    enviados). Se llama DESPUÉS del commit de la auditoría, y cada envío va
    aislado: un buzón que rebota no frena al resto.
    """
    fila = service.fila_supervision(db, visita_id)
    visita, prestador_nombre = fila[0], fila[1]

    destinatarios, etiquetas = _destinatarios_del_caso(db, visita)

    lineas = [
        "Adjunto encontrarás el INFORME DE VISITA MÉDICA RECURRENTE del caso, en PDF,",
        "redactado tras la visita del médico auditor. Los datos exactos:",
        "",
        *_datos_del_caso(fila),
        "",
        "Este informe se envió a:",
        *[
            f"  - {correo}{etiquetas.get(correo.upper(), '')}"
            for correo in destinatarios.values()
        ],
        "",
        "Accumedical",
    ]
    texto = "\n".join(lineas)
    asunto = f"Informe de auditoría {visita.codigo_interno} · {prestador_nombre}"
    adjunto = (f"informe-{visita.codigo_interno}.pdf", pdf, "application", "pdf")

    enviados = 0
    for correo in destinatarios.values():
        try:
            mail.enviar(para=correo, asunto=asunto, texto=texto, adjunto=adjunto)
            enviados += 1
        except mail.ErrorDeCorreo:
            continue
    log.info(
        "informe_enviado_correo",
        visita=visita.codigo_interno,
        destinatarios=len(destinatarios),
        enviados=enviados,
    )
    return len(destinatarios), enviados


def notificar_derivacion(db: DbSession, visita_id: uuid.UUID) -> None:
    """
    Avisa al auditor que el caso ahora es suyo, con los mismos datos exactos.
    Solo cuando hay auditor —desasignar no manda nada— y también DESPUÉS del
    commit, por la misma razón que el alta. La notificación push a su app móvil
    llegará cuando la app tenga build propio (docs/08): Expo Go ya no las admite.
    """
    fila = service.fila_supervision(db, visita_id)
    visita, prestador_nombre = fila[0], fila[1]
    if visita.auditor_id is None:
        return
    auditor = db.get(User, visita.auditor_id)
    if auditor is None or not auditor.is_active or auditor.deleted_at is not None:
        return

    lineas = [
        f"Hola, {auditor.nombre_principal}:",
        "",
        "El supervisor de Concurrencia te derivó este caso. Los datos exactos:",
        "",
        *_datos_del_caso(fila),
        "",
        "Lo verás en tu app móvil de Accumedical con esta misma cuenta.",
        "",
        "Accumedical",
    ]
    try:
        mail.enviar(
            para=auditor.email,
            asunto=f"Caso {visita.codigo_interno} derivado a ti · {prestador_nombre}",
            texto="\n".join(lineas),
        )
        log.info("derivacion_notificada", visita=visita.codigo_interno, para=auditor.email)
    except mail.ErrorDeCorreo:
        # Ya quedó en el log como correo_fallido; la derivación en sí no se toca.
        pass


def notificar_reprogramacion(
    db: DbSession,
    visita_id: uuid.UUID,
    desde_anterior: dt.datetime,
    hasta_anterior: dt.datetime,
) -> None:
    """
    Avisa que la visita cambió de fecha, con la ventana vieja y la nueva, a todos
    los involucrados: los correos del caso, quien coordina y el auditor asignado
    (si lo hay), sin repetir a nadie. También DESPUÉS del commit.
    """
    fila = service.fila_supervision(db, visita_id)
    visita, prestador_nombre = fila[0], fila[1]

    destinatarios: dict[str, str] = {}
    for correo in service.correos_de(db, visita_id):
        destinatarios.setdefault(correo.upper(), correo)
    # La clave en mayúsculas es solo para no repetir a nadie; lo que se manda
    # es el correo tal como está escrito, como en el resto de los avisos.
    coordinadores = set()
    for quien in _coordinadores_de_plataforma(db):
        coordinadores.add(quien.email.upper())
        destinatarios.setdefault(quien.email.upper(), quien.email)
    auditor = db.get(User, visita.auditor_id) if visita.auditor_id else None
    if auditor is not None and auditor.is_active and auditor.deleted_at is None:
        destinatarios.setdefault(auditor.email.upper(), auditor.email)

    lineas = [
        "La visita del médico auditor CAMBIÓ DE FECHA.",
        "",
        f"  Antes:  {_cuando(desde_anterior)} — {_cuando(hasta_anterior)}",
        f"  Ahora:  {_cuando(visita.desde)} — {_cuando(visita.hasta)} (hora de Ecuador)",
        "",
        "Los datos del caso:",
        "",
        *_datos_del_caso(fila),
        "",
        "Este aviso se envió a:",
    ]
    for correo in destinatarios.values():
        etiqueta = ""
        if correo.upper() in coordinadores:
            etiqueta = " (coordinador de Concurrencia)"
        elif auditor is not None and correo.upper() == auditor.email.upper():
            etiqueta = " (médico auditor)"
        lineas.append(f"  - {correo}{etiqueta}")
    lineas += ["", "Accumedical"]

    enviados = 0
    for correo in destinatarios.values():
        try:
            mail.enviar(
                para=correo,
                asunto=f"Visita {visita.codigo_interno} reprogramada · {prestador_nombre}",
                texto="\n".join(lineas),
            )
            enviados += 1
        except mail.ErrorDeCorreo:
            continue
    log.info(
        "reprogramacion_notificada",
        visita=visita.codigo_interno,
        destinatarios=len(destinatarios),
        enviados=enviados,
    )
