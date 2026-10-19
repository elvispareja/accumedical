from __future__ import annotations

import datetime as dt
import uuid
from decimal import Decimal
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import Select, String, and_, cast, func, or_, select, union, update
from sqlalchemy import false as sa_false
from sqlalchemy.orm import Session as DbSession
from sqlalchemy.orm import aliased

from app.modules.concurrencia import nucleo
from app.modules.concurrencia.models import (
    TIPOS_NOTA,
    Visita,
    VisitaCorreo,
    VisitaFoto,
    VisitaNota,
)
from app.shared import personas
from app.shared.aseguradoras.models import (
    Aseguradora,
)
from app.shared.catalogos.models import Ciudad, Provincia
from app.shared.contactos.service import validar_documento
from app.shared.prestadores.models import Prestador, PrestadorSede
from app.shared.users import pendientes
from app.shared.users.models import User

MAX_PAGE_SIZE = 100

# Los estados en los que el caso está CERRADO: se lee, no se toca. Vive aquí y
# no repartido por los endpoints, para que la pantalla y el servidor no puedan
# discrepar sobre qué se puede editar.
MOTIVOS_SIN_EDICION = {
    "culminada": "Este caso ya culminó: el auditor envió su informe y no se puede editar",
    "cancelada": "Este caso está cancelado: no se puede editar",
}


# ─────────────────────── A dónde se puede ir ─────────────────────────────────


def aseguradoras_con_concurrencia(
    db: DbSession, aseguradora_id: uuid.UUID | None = None
) -> list[Any]:
    """
    Las compañías activas con el módulo Concurrencia habilitado: sobre ellas
    puede programar el coordinador de plataforma. Con `aseguradora_id` valida
    una en concreto (lista vacía = no existe, está inactiva o sin el módulo).
    Fuente: `nucleo` (local o API central, según CONCURRENCIA_NUCLEO).
    """
    return nucleo.aseguradoras_con_concurrencia(db, aseguradora_id)


def prestadores_de_la_red(
    db: DbSession, aseguradora_id: uuid.UUID, *, search: str | None = None
) -> list[dict[str, Any]]:
    """
    Los prestadores con convenio VIVO con esta aseguradora, cada uno con sus
    sedes y contactos. Es la única lista sobre la que se puede programar una
    visita: no se ofrece —ni se acepta— un prestador que no esté en la red.
    Fuente: `nucleo` (local o API central).
    """
    return nucleo.prestadores_de_la_red(db, aseguradora_id, search)


def _validar_destino(
    db: DbSession, aseguradora_id: uuid.UUID, prestador_id: uuid.UUID, sede_id: uuid.UUID | None
) -> None:
    """
    Comprueba contra la base que el prestador esté en la red y que la sede sea
    suya. No se confía en lo que mande el navegador: si el convenio se terminó
    mientras el formulario estaba abierto, el guardado se rechaza.
    """
    if not nucleo.prestador_en_red(db, aseguradora_id, prestador_id):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Ese prestador no tiene convenio vigente con tu aseguradora",
        )

    suyas = nucleo.sedes_activas(db, prestador_id)

    if sede_id is None:
        # La casa matriz es un destino más: tener sedes no significa que el
        # auditor no pueda ir a la dirección principal. `sede_id` nulo es
        # exactamente eso, y es lo mismo que ya guardan los prestadores sin sedes.
        return

    if sede_id not in suyas:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Esa sede no es de ese prestador, o ya no está activa",
        )


def estado_visible(estado: str, auditor_id: uuid.UUID | None, *, interno: bool) -> str:
    """
    **`no_auditado` es interno de Accumedical.** A la compañía se le sigue
    enseñando el estado que el caso tenía al vencer —`asignada` si ya había
    auditor, `programada` si no—, porque para ella el caso sigue pendiente y
    porque el vencimiento suele resolverse con una prórroga en un par de horas.

    Lo que sí ve es el final: si acaba cancelándose o culminando, eso no se
    traduce. Y el filtro de su bandeja usa esta misma equivalencia, para que
    filtrar «Asignada» encuentre lo que la lista enseña como asignada.
    """
    if interno or estado != "no_auditado":
        return estado
    return "asignada" if auditor_id is not None else "programada"


def condicion_de_estado(estado: str, *, interno: bool):
    """El filtro de estado, con la misma equivalencia que `estado_visible`."""
    if interno:
        return Visita.estado == estado
    if estado == "asignada":
        return or_(
            Visita.estado == "asignada",
            and_(Visita.estado == "no_auditado", Visita.auditor_id.is_not(None)),
        )
    if estado == "programada":
        return or_(
            Visita.estado == "programada",
            and_(Visita.estado == "no_auditado", Visita.auditor_id.is_(None)),
        )
    # Un filtro por el estado interno, desde fuera, no encuentra nada: ese
    # estado no existe para quien pregunta.
    if estado == "no_auditado":
        return sa_false()
    return Visita.estado == estado


def horas_de_sla(db: DbSession, aseguradora_id: uuid.UUID) -> Decimal:
    """
    Las horas que esta compañía tiene pactadas para Concurrencia. **De aquí sale
    el plazo de entrega del informe**, así que sin SLA no se puede abrir un
    caso: no se sabría para cuándo es.

    Es obligatorio desde `c3f7b8e1d952`, de modo que faltar solo puede
    significar que a la compañía le falta contratar el módulo o pactarlo.
    """
    horas = nucleo.horas_sla(db, aseguradora_id)
    if horas is None or horas <= 0:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                "Esta compañía no tiene horas de SLA pactadas para Concurrencia, "
                "así que no se puede fijar la entrega del informe"
            ),
        )
    return horas


def entrega_por_sla(db: DbSession, aseguradora_id: uuid.UUID, desde: dt.datetime) -> dt.datetime:
    """
    Cuándo vence el informe: la hora de llegada más las horas del SLA, **reloj
    corrido**. Con 23 h pactadas, llegar el 27 a las 15:00 entrega el 28 a las
    14:00.
    """
    return desde + dt.timedelta(hours=float(horas_de_sla(db, aseguradora_id)))


# ──────────────────────────── La bandeja ─────────────────────────────────────


def _select_bandeja() -> Select:
    """
    La consulta común de las dos bandejas: la de compañía y la de supervisión.
    Trae también la aseguradora y el auditor asignado; a la vista de compañía le
    sobran y los ignora. SIN filtro de ownership: eso lo pone quien la usa, y por
    eso esta función es privada.
    """
    # Dos ubicaciones distintas en la misma consulta —la del prestador y la de la
    # sede—, así que cada una necesita sus alias o el segundo join pisaría al primero.
    if nucleo.modo_central():
        # Sin JOIN al núcleo: los nombres los completa `_completar` desde la central,
        # con la misma forma de fila (ver nucleo.datos_de_casos).
        return select(Visita).where(Visita.deleted_at.is_(None))
    ciudad_prestador = aliased(Ciudad)
    provincia_prestador = aliased(Provincia)
    ciudad_sede = aliased(Ciudad)
    provincia_sede = aliased(Provincia)
    auditor = aliased(User)

    return (
        select(
            Visita,
            Prestador.nombre,
            # La ubicación del prestador viaja siempre: cuando la visita es a la
            # casa matriz —`sede_id` nulo— es la única que hay que enseñar. Y la
            # ciudad va aparte de la dirección porque la dirección es opcional:
            # sin ella, la ciudad sigue diciendo a dónde hay que ir.
            Prestador.direccion,
            ciudad_prestador.nombre,
            provincia_prestador.nombre,
            PrestadorSede.nombre,
            PrestadorSede.direccion,
            ciudad_sede.nombre,
            provincia_sede.nombre,
            Aseguradora.razon_social,
            Aseguradora.nombre_comercial,
            # Ya compuesto por Postgres, con el orden de app/shared/personas.py.
            personas.sql_completo(auditor),
        )
        .select_from(Visita)
        .join(Prestador, Prestador.id == Visita.prestador_id)
        .join(Aseguradora, Aseguradora.id == Visita.aseguradora_id)
        .outerjoin(auditor, auditor.id == Visita.auditor_id)
        .outerjoin(ciudad_prestador, ciudad_prestador.codigo == Prestador.ciudad_codigo)
        .outerjoin(provincia_prestador, provincia_prestador.codigo == Prestador.provincia_codigo)
        .outerjoin(PrestadorSede, PrestadorSede.id == Visita.sede_id)
        .outerjoin(ciudad_sede, ciudad_sede.codigo == PrestadorSede.ciudad_codigo)
        .outerjoin(provincia_sede, provincia_sede.codigo == PrestadorSede.provincia_codigo)
        .where(Visita.deleted_at.is_(None))
    )


def _completar(db: DbSession, filas: list[Any]) -> list[tuple[Any, ...]]:
    """
    Las filas de la bandeja con la forma de siempre: (visita, prestador, …,
    auditor, [columnas extra]). En modo local ya vienen así del JOIN; en modo
    central se completan con los nombres que da la central, en lote.
    """
    if not nucleo.modo_central():
        return [tuple(f) for f in filas]
    datos = nucleo.datos_de_casos(db, [f[0] for f in filas])
    return [(f[0], *datos[f[0].id], *tuple(f)[1:]) for f in filas]


def _coincide_prestador(db: DbSession, texto: str):  # noqa: ANN202
    if nucleo.modo_central():
        return Visita.prestador_id.in_(nucleo.prestadores_que_coinciden(db, texto))
    return Prestador.nombre.ilike(f"%{texto}%")


def _coincide_aseguradora(db: DbSession, texto: str):  # noqa: ANN202
    if nucleo.modo_central():
        return Visita.aseguradora_id.in_(nucleo.aseguradoras_que_coinciden(db, texto))
    patron = f"%{texto}%"
    return or_(Aseguradora.razon_social.ilike(patron), Aseguradora.nombre_comercial.ilike(patron))


def _base_select(aseguradora_id: uuid.UUID) -> Select:
    """
    Toda consulta de la bandeja de compañía arranca acotada por la aseguradora
    del usuario. Es la garantía de ownership: no existe un camino que devuelva
    la visita de otra compañía.
    """
    return _select_bandeja().where(Visita.aseguradora_id == aseguradora_id)


def listar(
    db: DbSession,
    aseguradora_id: uuid.UUID,
    *,
    search: str | None = None,
    estado: str | None = None,
    desde: dt.date | None = None,
    hasta: dt.date | None = None,
    creado_por: uuid.UUID | None = None,
    page: int = 1,
    page_size: int = 20,
) -> tuple[list[tuple[Any, ...]], int]:
    consulta = _base_select(aseguradora_id)

    # Quien creo el caso: el operador. El scope por aseguradora ya esta puesto,
    # asi que un id ajeno simplemente no encuentra nada.
    if creado_por:
        consulta = consulta.where(Visita.created_by == creado_por)

    if search:
        patron = f"%{search.strip()}%"
        consulta = consulta.where(
            or_(
                _coincide_prestador(db, search.strip()),
                Visita.codigo_interno.ilike(patron),
                # Las cuatro partes concatenadas: así «MARIA LOPEZ» entera
                # también encuentra, no solo cada palabra por separado.
                personas.sql_completo(Visita, "paciente_").ilike(patron),
                Visita.paciente_numero_documento.ilike(patron),
            )
        )
    if estado:
        consulta = consulta.where(condicion_de_estado(estado, interno=False))
    if desde:
        consulta = consulta.where(Visita.hasta >= desde)
    if hasta:
        # Hasta el final de ese día: una visita que empieza a las 16:00 del día
        # filtrado tiene que salir.
        consulta = consulta.where(Visita.desde < hasta + dt.timedelta(days=1))

    sub = consulta.subquery()
    total = db.scalar(select(func.count()).select_from(sub)) or 0

    page = max(1, page)
    page_size = min(max(1, page_size), MAX_PAGE_SIZE)
    filas = db.execute(
        consulta.add_columns(_conteo_correos())
        .order_by(Visita.desde.desc(), Visita.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()
    return _completar(db, filas), total


def _conteo_correos():
    return (
        select(func.count())
        .select_from(VisitaCorreo)
        .where(VisitaCorreo.visita_id == Visita.id, VisitaCorreo.deleted_at.is_(None))
        .correlate(Visita)
        .scalar_subquery()
    )


def obtener(
    db: DbSession,
    aseguradora_id: uuid.UUID,
    visita_id: uuid.UUID,
    *,
    creado_por: uuid.UUID | None = None,
) -> tuple[Any, ...]:
    consulta = (
        _base_select(aseguradora_id).add_columns(_conteo_correos()).where(Visita.id == visita_id)
    )
    # El operador solo alcanza SUS casos: el de un compañero responde el mismo
    # 404 que uno de otra compañía, sin confirmar que exista.
    if creado_por:
        consulta = consulta.where(Visita.created_by == creado_por)
    fila = db.execute(consulta).first()
    if fila is None:
        # Mismo 404 exista o no: no se confirma la existencia de una visita ajena.
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Visita no encontrada")
    return _completar(db, [fila])[0]


def paciente_conocido(
    db: DbSession, aseguradora_id: uuid.UUID, tipo: str, numero: str
) -> Visita | None:
    """
    El caso MÁS RECIENTE de esta aseguradora con ese documento, para
    autocompletar nombres y apellidos al programar. Acotado por
    `aseguradora_id` a propósito: un paciente de otra compañía no existe para
    quien pregunta — sería filtrar dato clínico entre aseguradoras.
    """
    return db.scalar(
        select(Visita)
        .where(
            Visita.aseguradora_id == aseguradora_id,
            Visita.deleted_at.is_(None),
            Visita.paciente_tipo_documento_codigo == tipo,
            Visita.paciente_numero_documento == numero.strip(),
        )
        .order_by(Visita.created_at.desc())
        .limit(1)
    )


def correos_de(db: DbSession, visita_id: uuid.UUID) -> list[str]:
    return [c.email for c in correos_detallados_de(db, visita_id)]


def correos_detallados_de(db: DbSession, visita_id: uuid.UUID) -> list[VisitaCorreo]:
    """Los correos vivos con su etiqueta de quién es, en orden de captura."""
    return list(
        db.scalars(
            select(VisitaCorreo)
            .where(VisitaCorreo.visita_id == visita_id, VisitaCorreo.deleted_at.is_(None))
            .order_by(VisitaCorreo.created_at, VisitaCorreo.id)
        ).all()
    )


def fijar_correos(
    db: DbSession,
    visita_id: uuid.UUID,
    entrantes: list[tuple[str, str | None]],
    autor: uuid.UUID,
) -> dict[str, int] | None:
    """
    Reconcilia la lista completa `(email, etiqueta)`, como el resto de listas
    de la plataforma. Las bajas se vuelcan antes que las altas: si se quita un
    correo y se vuelve a añadir en el mismo guardado, el índice único parcial
    vería los dos vivos. La etiqueta —quién es esa persona— se actualiza sobre
    la fila viva si cambió.
    """
    existentes = {
        c.email.upper(): c
        for c in db.scalars(
            select(VisitaCorreo).where(
                VisitaCorreo.visita_id == visita_id, VisitaCorreo.deleted_at.is_(None)
            )
        ).all()
    }
    deseados: dict[str, str | None] = {}
    for correo, etiqueta in entrantes:
        normalizado = correo.strip().upper()
        limpia = (etiqueta or "").strip()[:120] or None
        if normalizado and normalizado not in deseados:
            deseados[normalizado] = limpia

    eliminados = 0
    for clave, fila in existentes.items():
        if clave not in deseados:
            fila.deleted_at = func.now()
            fila.deleted_by = autor
            eliminados += 1
    if eliminados:
        db.flush()

    creados = 0
    reetiquetados = 0
    for correo, etiqueta in deseados.items():
        fila = existentes.get(correo)
        if fila is not None and fila.deleted_at is None:
            if fila.etiqueta != etiqueta:
                fila.etiqueta = etiqueta
                fila.updated_by = autor
                reetiquetados += 1
            continue
        db.add(
            VisitaCorreo(
                visita_id=visita_id,
                email=correo,
                etiqueta=etiqueta,
                created_by=autor,
                updated_by=autor,
            )
        )
        creados += 1

    if not (creados or eliminados or reetiquetados):
        return None
    return {"creados": creados, "eliminados": eliminados, "reetiquetados": reetiquetados}


def crear(
    db: DbSession, aseguradora_id: uuid.UUID, datos: dict[str, Any], autor: uuid.UUID
) -> Visita:
    prestador_id = _a_uuid(datos["prestador_id"], "prestador")
    sede_id = _a_uuid(datos.get("sede_id"), "sede") if datos.get("sede_id") else None
    _validar_destino(db, aseguradora_id, prestador_id, sede_id)
    # `hasta` ya no se teclea: sale del SLA de la compañía.
    hasta = entrega_por_sla(db, aseguradora_id, datos["desde"])
    # El documento del paciente, contra el catálogo y su regex (una cédula de 9
    # dígitos se corta aquí con mensaje claro, no con un error de integridad).
    validar_documento(
        db, datos["paciente_tipo_documento_codigo"], datos["paciente_numero_documento"].strip()
    )

    visita = Visita(
        aseguradora_id=aseguradora_id,
        prestador_id=prestador_id,
        # Las cuatro partes ya llegan normalizadas por el validador de `personas`.
        paciente_nombre_principal=datos["paciente_nombre_principal"],
        paciente_nombre_secundario=datos.get("paciente_nombre_secundario"),
        paciente_apellido_paterno=datos["paciente_apellido_paterno"],
        paciente_apellido_materno=datos.get("paciente_apellido_materno"),
        paciente_tipo_documento_codigo=datos["paciente_tipo_documento_codigo"],
        paciente_numero_documento=datos["paciente_numero_documento"].strip(),
        sede_id=sede_id,
        desde=datos["desde"],
        hasta=hasta,
        # El plazo de llegada nace en la hora tecleada; lo mueve la prórroga.
        llegada_limite=datos["desde"],
        # Nace programada SIEMPRE: el estado no es un campo del formulario.
        estado="programada",
        observaciones=(datos.get("observaciones") or "").strip() or None,
        created_by=autor,
        updated_by=autor,
    )
    db.add(visita)
    db.flush()
    db.refresh(visita)
    return visita


def actualizar(
    db: DbSession, visita: Visita, cambios: dict[str, Any], autor: uuid.UUID
) -> dict[str, Any]:
    """
    Edita el caso. **Un caso cerrado ya no se edita**: culminado, el auditor
    hizo su visita y mandó su informe, y cambiarle después el paciente, el
    prestador o la ventana convertiría ese informe en mentira; cancelado, no hay
    visita que preparar. La pantalla tampoco lo ofrece —el menú de la fila se
    queda solo con «Ver»—, pero la regla vive aquí, que es donde manda.

    `no_auditado` **sí se edita**: la ventana venció sin que nadie llegara, y
    corregir el caso antes de reprogramarlo es lo que se quiere poder hacer.
    """
    motivo = MOTIVOS_SIN_EDICION.get(visita.estado)
    if motivo is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, detail=motivo)

    prestador_id = (
        _a_uuid(cambios["prestador_id"], "prestador")
        if cambios.get("prestador_id")
        else visita.prestador_id
    )
    sede_id = (
        _a_uuid(cambios["sede_id"], "sede")
        if cambios.get("sede_id")
        else (visita.sede_id if "sede_id" not in cambios else None)
    )
    # Se valida el estado RESULTANTE: cambiar de prestador sin cambiar la sede
    # dejaría una sede que no es suya. Con el documento del paciente, igual.
    _validar_destino(db, visita.aseguradora_id, prestador_id, sede_id)
    if "paciente_tipo_documento_codigo" in cambios or "paciente_numero_documento" in cambios:
        validar_documento(
            db,
            cambios.get("paciente_tipo_documento_codigo") or visita.paciente_tipo_documento_codigo,
            (cambios.get("paciente_numero_documento") or visita.paciente_numero_documento).strip(),
        )
    resultante = dict(cambios)
    # Reprogramar es mover la hora de llegada, y de ahí salen los otros dos
    # plazos: la entrega se recalcula con el SLA vigente y el límite de llegada
    # vuelve a ser la hora nueva —las prórrogas de la cita anterior no siguen
    # valiendo para una cita distinta—.
    if resultante.get("desde") is not None and resultante["desde"] != visita.desde:
        resultante["hasta"] = entrega_por_sla(db, visita.aseguradora_id, resultante["desde"])
        resultante["llegada_limite"] = resultante["desde"]
    resultante.pop("correos", None)
    if "prestador_id" in resultante:
        resultante["prestador_id"] = prestador_id
    if "sede_id" in resultante:
        resultante["sede_id"] = sede_id
    if "observaciones" in resultante:
        resultante["observaciones"] = (resultante["observaciones"] or "").strip() or None

    diff: dict[str, Any] = {"antes": {}, "despues": {}}
    for campo, valor in resultante.items():
        anterior = getattr(visita, campo)
        if anterior != valor:
            diff["antes"][campo] = anterior
            diff["despues"][campo] = valor
            setattr(visita, campo, valor)

    # Guardar una ventana futura sobre un caso vencido ES reprogramarlo.
    revivido = revivir_al_reprogramar(visita)
    if revivido is not None:
        diff["antes"]["estado"] = "no_auditado"
        diff["despues"]["estado"] = revivido

    if diff["despues"]:
        visita.updated_by = autor
    return diff


def revivir_al_reprogramar(visita: Visita) -> str | None:
    """
    **Reprogramar es lo que devuelve a la agenda un caso NO AUDITADO.**

    Ese estado dice que el plazo de llegada venció sin que el auditor llegara; el auditor
    ya no puede marcar nada, porque el caso desapareció de su trabajo por
    delante. Así que darle una ventana FUTURA —lo haga el operador editando o el
    coordinador con «Nueva fecha»— lo revive:

      · con auditor todavía asignado → `asignada`, y le reaparece en su app;
      · sin auditor                  → `programada`, para que lo deriven otra vez.

    Solo con la ventana en el futuro: corregirle el nombre al paciente de un
    caso vencido no resucita nada. Devuelve el estado nuevo, o `None` si no
    tocaba mover nada.
    """
    if visita.estado != "no_auditado" or visita.llegada_limite <= dt.datetime.now(dt.UTC):
        return None
    visita.estado = "asignada" if visita.auditor_id is not None else "programada"
    return visita.estado


def pacientes_registrados(
    db: DbSession,
    *,
    search: str | None = None,
    documento: tuple[str, str] | None = None,
    page: int = 1,
    page_size: int = 20,
) -> tuple[list[dict[str, Any]], int]:
    """
    Las personas que ESTE módulo ha registrado, una por documento: sus cuatro
    partes del nombre, su identificación, cuántos casos tiene y cuándo fue el
    último, con la compañía por la que entró.

    **Una persona, una fila.** Se agrupa por tipo y número de documento, que es
    lo que la identifica; el nombre se toma del caso MÁS RECIENTE, porque un
    apellido corregido después es el bueno.

    **Sin compañía a propósito**: un mismo paciente puede entrar por varias
    aseguradoras, así que poner una sola sería mentir. El paciente es la persona.

    Esto es lo que el módulo aporta al listado de pacientes de la plataforma. La
    lista común la compone `app/`, que es quien puede mirar a varios módulos a
    la vez: el núcleo no puede depender de las tablas de ninguno.
    """
    tipo = Visita.paciente_tipo_documento_codigo
    numero = Visita.paciente_numero_documento
    particion = (tipo, numero)

    base = (
        select(
            tipo.label("tipo"),
            numero.label("numero"),
            Visita.paciente_nombre_principal.label("nombre_principal"),
            Visita.paciente_nombre_secundario.label("nombre_secundario"),
            Visita.paciente_apellido_paterno.label("apellido_paterno"),
            Visita.paciente_apellido_materno.label("apellido_materno"),
            personas.sql_completo(Visita, "paciente_").label("nombre_completo"),
            func.count().over(partition_by=particion).label("casos"),
            func.min(Visita.desde).over(partition_by=particion).label("primer_caso"),
            func.max(Visita.desde).over(partition_by=particion).label("ultimo_caso"),
            func.row_number()
            .over(partition_by=particion, order_by=Visita.desde.desc())
            .label("fila"),
        )
        .select_from(Visita)
        .where(Visita.deleted_at.is_(None))
    )
    if search:
        patron = f"%{search.strip()}%"
        base = base.where(
            or_(
                personas.sql_completo(Visita, "paciente_").ilike(patron),
                numero.ilike(patron),
            )
        )
    # Una persona en concreto: su documento es lo que la identifica.
    if documento is not None:
        base = base.where(tipo == documento[0], numero == documento[1])

    sub = base.subquery()
    # Una fila por persona: la del caso más reciente.
    unicos = select(sub).where(sub.c.fila == 1).subquery()

    total = db.scalar(select(func.count()).select_from(unicos)) or 0
    page = max(1, page)
    page_size = min(max(1, page_size), MAX_PAGE_SIZE)
    filas = db.execute(
        select(unicos)
        # Por nombre, de la A a la Z: es un listado de personas, y se busca un
        # nombre. `collate` no hace falta: el nombre va en mayúsculas.
        .order_by(unicos.c.nombre_completo)
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()

    return [
        {
            "tipo_documento_codigo": f.tipo,
            "numero_documento": f.numero,
            "nombre_principal": f.nombre_principal,
            "nombre_secundario": f.nombre_secundario,
            "apellido_paterno": f.apellido_paterno,
            "apellido_materno": f.apellido_materno,
            "nombre_completo": f.nombre_completo,
            "casos": int(f.casos),
            "primer_caso": f.primer_caso,
            "ultimo_caso": f.ultimo_caso,
        }
        for f in filas
    ], total


def operadores_de_la_compania(db: DbSession, aseguradora_id: uuid.UUID) -> list[tuple[Any, bool]]:
    """
    Para el filtro «Operador» del supervisor de MI aseguradora: `(usuario,
    vigente)` de los operadores de hoy, de quien lo fue alguna vez (historial de
    accesos, D57) y de todo aquel que creó algún caso de la compañía, aunque ya
    no opere, lo hayan desactivado o haya cambiado de rol (14/10/2026: en
    medicina no se borra nada y lo que hizo cada persona sigue a su nombre).
    `vigente` = activo y operador de Concurrencia hoy.
    """
    from app.shared.users.models import HistorialAcceso

    actuales = {u.id: u for u in nucleo.operadores_de_la_compania(db, aseguradora_id)}
    autores = set(
        db.scalars(
            select(Visita.created_by).where(
                Visita.aseguradora_id == aseguradora_id, Visita.created_by.is_not(None)
            )
        )
    )
    otros = autores | set(
        db.scalars(
            select(HistorialAcceso.user_id).where(
                HistorialAcceso.module_code == nucleo.MODULO,
                HistorialAcceso.rol == "operador",
            )
        )
    )
    activados = cuentas_activadas(db, otros | set(actuales))
    todos = {i: u for i, u in actuales.items() if i in activados}
    for u in nucleo.usuarios_por_ids(db, sorted((otros - set(actuales)) & activados)):
        # Del historial salen operadores de todas las compañías: solo los suyos.
        # Las cuentas dadas de baja (las de pruebas) solo si crearon algún caso.
        if u.aseguradora_id == aseguradora_id and (u.deleted_at is None or u.id in autores):
            todos[u.id] = u
    filas = [
        (u, bool(u.is_active) and u.deleted_at is None and u.id in actuales)
        for u in todos.values()
    ]
    return sorted(filas, key=lambda f: (not f[1], personas.de_fila(f[0]), str(f[0].id)))


def coordenadas_de_destinos(
    db: DbSession, visitas: list[Visita]
) -> dict[uuid.UUID, tuple[float, float]]:
    """
    El punto exacto al que va el auditor —la sede si la hay, la casa matriz si
    no—, para abrir el mapa desde la app. Dos viajes en lote, no uno por caso.
    """
    return nucleo.coordenadas(db, visitas)


def marcar_no_auditadas(db: DbSession) -> list[str]:
    """
    La regla del NO AUDITADO: toda visita **pendiente** —programada o ya
    derivada a un auditor— cuyo PLAZO DE LLEGADA venció sin que nadie registrara
    la llegada pasa a `no_auditado`, de una sola vez. El plazo es `desde` más
    las prórrogas que haya dado el coordinador, no la entrega del informe: así
    un auditor que nunca fue se detecta el mismo día y no al vencer el SLA.

    Mira los dos estados a propósito: si solo mirara `programada`, un caso
    derivado que nadie llegó a visitar no vencería nunca. Los `auditando` quedan
    fuera porque ahí el médico SÍ llegó; ese caso termina cuando envía el
    informe, y mientras tanto se ve tal cual en el panel.

    Cada transición queda en AuditLog como acción del SISTEMA (sin usuario) y
    avisa por la campana **a la coordinación de Accumedical**, que es quien
    puede prorrogar. No hace commit; lo hace quien llama.
    """
    from app.modules.concurrencia import notificaciones
    from app.shared.audit import service as audit

    filas = db.execute(
        update(Visita)
        .where(
            Visita.deleted_at.is_(None),
            Visita.estado.in_(("programada", "asignada")),
            Visita.llegada_limite < func.now(),
            Visita.llegada_at.is_(None),
        )
        .values(estado="no_auditado", updated_at=func.now())
        .returning(Visita.id, Visita.codigo_interno)
    ).all()
    for visita_id, codigo in filas:
        audit.registrar(
            db,
            accion="visita_no_auditada",
            module_code="concurrencia",
            entidad="conc_visitas",
            entidad_id=str(visita_id),
            detalle={"visita": codigo, "motivo": "plazo de llegada vencido sin el auditor"},
        )
        # Solo a la coordinación de Accumedical: es quien lo resuelve, con una
        # prórroga o buscando otro auditor, y la compañía ni se entera porque
        # para ella el caso sigue pendiente.
        visita = db.get(Visita, visita_id)
        if visita is not None:
            notificaciones.avisar_vencimiento_en_campana(db, visita)
    return [codigo for _id, codigo in filas]


# ────────────── Las notas dictadas del auditor y su informe ──────────────────


def visita_del_auditor(db: DbSession, visita_id: uuid.UUID, auditor_id: uuid.UUID) -> Visita:
    """
    El caso solo si está derivado A ESTE auditor: el de otro responde el mismo
    404 que uno inexistente, igual que el resto de ownership del módulo.
    """
    visita = db.scalar(
        select(Visita).where(
            Visita.id == visita_id,
            Visita.deleted_at.is_(None),
            Visita.auditor_id == auditor_id,
        )
    )
    if visita is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Visita no encontrada")
    return visita


def notas_de(db: DbSession, visita_id: uuid.UUID) -> list[VisitaNota]:
    """Las notas vivas del caso, en el orden en que se dictaron."""
    return list(
        db.scalars(
            select(VisitaNota)
            .where(VisitaNota.visita_id == visita_id, VisitaNota.deleted_at.is_(None))
            .order_by(VisitaNota.created_at, VisitaNota.id)
        ).all()
    )


def crear_nota(
    db: DbSession, visita_id: uuid.UUID, tipo: str, texto: str, autor: uuid.UUID
) -> VisitaNota:
    if tipo not in TIPOS_NOTA:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Tipo de nota desconocido")
    limpio = texto.strip()
    if not limpio:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="La nota está vacía")
    nota = VisitaNota(
        visita_id=visita_id, tipo=tipo, texto=limpio, created_by=autor, updated_by=autor
    )
    db.add(nota)
    db.flush()
    db.refresh(nota)
    return nota


def eliminar_nota(
    db: DbSession, visita_id: uuid.UUID, nota_id: uuid.UUID, autor: uuid.UUID
) -> VisitaNota:
    """Borrado lógico, como todo: un dictado equivocado se retira, no se pierde."""
    nota = db.scalar(
        select(VisitaNota).where(
            VisitaNota.id == nota_id,
            VisitaNota.visita_id == visita_id,
            VisitaNota.deleted_at.is_(None),
        )
    )
    if nota is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Nota no encontrada")
    nota.deleted_at = func.now()
    nota.deleted_by = autor
    return nota


def fotos_de(db: DbSession, visita_id: uuid.UUID) -> list[VisitaFoto]:
    """Las fotos vivas del caso, en el orden en que se tomaron."""
    return list(
        db.scalars(
            select(VisitaFoto)
            .where(VisitaFoto.visita_id == visita_id, VisitaFoto.deleted_at.is_(None))
            .order_by(VisitaFoto.created_at, VisitaFoto.id)
        ).all()
    )


def crear_foto(db: DbSession, visita_id: uuid.UUID, ruta: str, autor: uuid.UUID) -> VisitaFoto:
    foto = VisitaFoto(visita_id=visita_id, ruta=ruta, created_by=autor, updated_by=autor)
    db.add(foto)
    db.flush()
    db.refresh(foto)
    return foto


def eliminar_foto(
    db: DbSession, visita_id: uuid.UUID, foto_id: uuid.UUID, autor: uuid.UUID
) -> VisitaFoto:
    """Borrado lógico; el archivo se queda en el volumen, como toda evidencia."""
    foto = db.scalar(
        select(VisitaFoto).where(
            VisitaFoto.id == foto_id,
            VisitaFoto.visita_id == visita_id,
            VisitaFoto.deleted_at.is_(None),
        )
    )
    if foto is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Foto no encontrada")
    foto.deleted_at = func.now()
    foto.deleted_by = autor
    return foto


# ─────────────── El panel del supervisor de la aseguradora ───────────────────

# Ecuador continental no tiene horario de verano: el desfase es fijo.
_ZONA_EC = dt.timezone(dt.timedelta(hours=-5))


def cifras_de_visitas(
    db: DbSession, aseguradora_id: uuid.UUID | None = None, *, interno: bool = True
) -> dict[str, int]:
    """
    Las cifras de los cuadros: cuántas visitas hay en cada estado y cuántas
    tocan el día de HOY (hora de Ecuador).

    Con `aseguradora_id` son las de ESA compañía —el panel de su supervisor—; sin
    él, las de todas —el panel de supervisión de plataforma, que es quien deriva
    los casos de cualquiera—. Es la misma cuenta y se escribe **una vez**: dos
    copias de esto acabarían discrepando en el primer estado nuevo.

    Las cifras no llevan filtro de fechas a propósito: son el total de lo que
    hay, y pulsar una acota la lista de abajo. Si siguieran al rango, el cuadro
    y su filtro dirían lo mismo y el panel dejaría de dar la foto completa.

    Sin `interno`, los vencidos **no se cuentan aparte**: se suman al cubo del
    estado que la compañía sigue viendo, y la cifra de no auditadas viaja en
    cero. La cuenta cuadra con su lista porque usa la misma equivalencia
    (`estado_visible`).
    """
    condiciones = [Visita.deleted_at.is_(None)]
    if aseguradora_id is not None:
        condiciones.append(Visita.aseguradora_id == aseguradora_id)

    totales: dict[str, int] = {}
    for estado, auditor_id, cuantas in db.execute(
        select(Visita.estado, Visita.auditor_id.is_not(None), func.count())
        .where(*condiciones)
        .group_by(Visita.estado, Visita.auditor_id.is_not(None))
    ).all():
        clave = estado_visible(estado, True if auditor_id else None, interno=interno)
        totales[clave] = totales.get(clave, 0) + cuantas

    hoy_ec = dt.datetime.now(dt.UTC).astimezone(_ZONA_EC).date()
    inicio_hoy = dt.datetime.combine(hoy_ec, dt.time.min, tzinfo=_ZONA_EC)
    fin_hoy = inicio_hoy + dt.timedelta(days=1)
    # Las que TOCAN hoy: las que siguen pendientes —programada, ya derivada o
    # vencida a la espera de prórroga— y las que se están auditando ahora
    # mismo. Una cancelada de hoy no «toca».
    hoy = db.scalar(
        select(func.count()).where(
            *condiciones,
            Visita.estado.in_(("programada", "asignada", "auditando", "no_auditado")),
            Visita.desde < fin_hoy,
            Visita.hasta > inicio_hoy,
        )
    ) or 0

    # Lo interno no viaja a la compañía: a quién se deriva es cosa de Accumedical.
    sin_asignar = (
        db.scalar(select(func.count()).where(*condiciones, Visita.auditor_id.is_(None))) or 0
        if interno
        else 0
    )

    return {
        "sin_asignar": sin_asignar,
        "programadas": totales.get("programada", 0),
        "asignadas": totales.get("asignada", 0),
        "auditando": totales.get("auditando", 0),
        "canceladas": totales.get("cancelada", 0),
        "culminadas": totales.get("culminada", 0),
        "no_auditadas": totales.get("no_auditado", 0),
        "hoy": hoy,
    }


def resumen_dashboard(db: DbSession, aseguradora_id: uuid.UUID) -> dict[str, Any]:
    """
    El panel del supervisor de la compañía: las cifras acotadas a su aseguradora
    y, además, las próximas cinco visitas programadas.

    Las cifras van con `interno=False`: la compañía no cuenta los vencidos
    aparte, los ve dentro del estado que tenían.
    """
    ahora = dt.datetime.now(dt.UTC)
    proximas = db.execute(
        _base_select(aseguradora_id)
        .add_columns(_conteo_correos())
        .where(Visita.estado == "programada", Visita.hasta >= ahora)
        .order_by(Visita.desde.asc(), Visita.id.asc())
        .limit(5)
    ).all()

    return {
        **cifras_de_visitas(db, aseguradora_id, interno=False),
        "proximas": _completar(db, proximas),
    }


# ────────────────── Supervisión de plataforma: derivar casos ─────────────────
#
# El supervisor de plataforma no pertenece a ninguna aseguradora: ve los casos
# de TODAS y deriva cada uno a un médico auditor. Quién puede llamar a esto lo
# corta el router (personal de plataforma con rol supervisor); aquí, la consulta
# y las reglas de a quién se puede asignar.


def listar_supervision(
    db: DbSession,
    *,
    search: str | None = None,
    estado: str | None = None,
    sin_asignar: bool = False,
    desde: dt.date | None = None,
    hasta: dt.date | None = None,
    documento: tuple[str, str] | None = None,
    aseguradora_id: uuid.UUID | None = None,
    persona_id: uuid.UUID | None = None,
    usuario_id: uuid.UUID | None = None,
    page: int = 1,
    page_size: int = 20,
) -> tuple[list[tuple[Any, ...]], int]:
    consulta = _select_bandeja()

    if search:
        patron = f"%{search.strip()}%"
        consulta = consulta.where(
            or_(
                _coincide_prestador(db, search.strip()),
                Visita.codigo_interno.ilike(patron),
                _coincide_aseguradora(db, search.strip()),
            )
        )
    if estado:
        consulta = consulta.where(Visita.estado == estado)
    if sin_asignar:
        consulta = consulta.where(Visita.auditor_id.is_(None))
    # El rango se compara contra la VENTANA de la visita, igual que en la
    # bandeja de la compañía: entra la que toque cualquier día del rango, no
    # solo la que empiece dentro. Un caso del lunes al miércoles sale al filtrar
    # el martes.
    if desde:
        consulta = consulta.where(Visita.hasta >= desde)
    if hasta:
        # Hasta el final de ese día: una visita que empieza a las 16:00 del día
        # filtrado tiene que salir.
        consulta = consulta.where(Visita.desde < hasta + dt.timedelta(days=1))
    if aseguradora_id is not None:
        consulta = consulta.where(Visita.aseguradora_id == aseguradora_id)
    # Los casos en los que intervino alguien del personal, esté o no todavía.
    if persona_id is not None:
        consulta = consulta.where(Visita.id.in_(_visitas_de_la_persona(persona_id)))
    # Y la de un usuario de la compañía: la misma regla de «intervino».
    if usuario_id is not None:
        consulta = consulta.where(Visita.id.in_(_visitas_de_la_persona(usuario_id)))
    # Los casos de UNA persona: lo que pide la ficha del paciente.
    if documento is not None:
        consulta = consulta.where(
            Visita.paciente_tipo_documento_codigo == documento[0],
            Visita.paciente_numero_documento == documento[1],
        )

    sub = consulta.subquery()
    total = db.scalar(select(func.count()).select_from(sub)) or 0

    page = max(1, page)
    page_size = min(max(1, page_size), MAX_PAGE_SIZE)
    filas = db.execute(
        consulta.add_columns(_conteo_correos())
        .order_by(Visita.desde.desc(), Visita.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()
    return _completar(db, filas), total


def _visitas_de_la_persona(  # noqa: ANN202
    persona_id: uuid.UUID, *, asignaciones_pasadas: bool = True
):
    """
    **La trazabilidad del personal** (14/10/2026): los casos en los que una
    persona intervino de cualquier forma —los creó, los derivó, los auditó, los
    tuvo asignados y se los quitaron, dictó notas o subió fotos—. Sale de las
    propias filas y de `audit_log`, que no se borran: quien ya no está en
    Concurrencia sigue encontrando sus casos.
    """
    from app.shared.audit.models import AuditLog

    texto = str(persona_id)
    quien = [AuditLog.user_id == persona_id]
    # Un auditor al que le quitaron el caso intervino (sale en el filtro), pero
    # ya no tiene nada pendiente en él (no bloquea su desactivación).
    if asignaciones_pasadas:
        quien += [
            AuditLog.detalle["antes"]["auditor_id"].astext == texto,
            AuditLog.detalle["despues"]["auditor_id"].astext == texto,
        ]
    auditados = select(AuditLog.entidad_id).where(
        AuditLog.entidad == "conc_visitas", or_(*quien)
    )
    return union(
        select(Visita.id).where(
            or_(
                Visita.created_by == persona_id,
                Visita.updated_by == persona_id,
                Visita.auditor_id == persona_id,
                cast(Visita.id, String).in_(auditados),
            )
        ),
        select(VisitaNota.visita_id).where(VisitaNota.created_by == persona_id),
        select(VisitaFoto.visita_id).where(VisitaFoto.created_by == persona_id),
    )


def cuentas_activadas(db: DbSession, ids: set[uuid.UUID]) -> set[uuid.UUID]:
    """
    De esas personas, las que ya **activaron su cuenta**: pusieron su
    contraseña por primera vez desde el enlace, o entraron alguna vez
    (14/10/2026, pedido del usuario: en los selectores solo aparece quien ya
    colocó su contraseña; un invitado que nunca la puso no existe todavía para
    filtrar ni para derivarle casos).
    """
    if not ids:
        return set()
    from app.shared.audit.models import AuditLog

    textos = [str(i) for i in ids]
    con_password = {
        uuid.UUID(i)
        for i in db.scalars(
            select(AuditLog.entidad_id).where(
                AuditLog.accion == "password_definida",
                AuditLog.entidad == "users",
                AuditLog.entidad_id.in_(textos),
            )
        )
    }
    entraron = set(
        db.scalars(select(User.id).where(User.id.in_(ids), User.last_login_at.is_not(None)))
    )
    return con_password | entraron


#: Los estados en que un caso sigue abierto: quien participa en uno así no se
#: puede desactivar ni perder Concurrencia (14/10/2026). Cancelado, culminado
#: y no auditado ya no esperan nada de nadie.
ESTADOS_ABIERTOS = ("programada", "asignada", "auditando")


def casos_abiertos_de(db: DbSession, persona_id: uuid.UUID) -> list[str]:
    """
    Los casos abiertos en que participa la persona —los creó, editó, derivó,
    los tiene asignados, dictó notas o subió fotos—, como «CONC-0001
    (asignada)». Es la regla de Concurrencia para `users.pendientes`.
    """
    filas = db.execute(
        select(Visita.codigo_interno, Visita.estado)
        .where(
            Visita.deleted_at.is_(None),
            Visita.estado.in_(ESTADOS_ABIERTOS),
            Visita.id.in_(_visitas_de_la_persona(persona_id, asignaciones_pasadas=False)),
        )
        .order_by(Visita.desde, Visita.codigo_interno)
    ).all()
    nombre = {"programada": "programada", "asignada": "asignada", "auditando": "en auditoría"}
    return [f"{codigo} {nombre[estado]}" for codigo, estado in filas]


pendientes.registrar(nucleo.MODULO, casos_abiertos_de)


def participantes_por_codigo(db: DbSession, codigos: list[str]) -> dict[str, list[tuple[str, str]]]:
    """
    Para la ficha del paciente (15/10/2026): quién AUDITÓ cada caso y qué
    COORDINADOR se lo derivó. `{codigo: [("Auditor", nombre), ("Coordinador",
    nombre)]}`. El coordinador es quien hizo la última derivación hacia el
    auditor que quedó, según `audit_log`. Incluye a quien ya está desvinculado.
    """
    if not codigos:
        return {}
    from app.shared.audit.models import AuditLog

    visitas = list(
        db.scalars(
            select(Visita).where(Visita.codigo_interno.in_(codigos), Visita.deleted_at.is_(None))
        )
    )
    quien_derivo: dict[uuid.UUID, uuid.UUID] = {}
    for v in visitas:
        if v.auditor_id is None:
            continue
        actor = db.scalar(
            select(AuditLog.user_id)
            .where(
                AuditLog.accion == "visita_derivada",
                AuditLog.entidad_id == str(v.id),
                AuditLog.detalle["despues"]["auditor_id"].astext == str(v.auditor_id),
            )
            .order_by(AuditLog.id.desc())
            .limit(1)
        )
        if actor:
            quien_derivo[v.id] = actor
    ids = {v.auditor_id for v in visitas if v.auditor_id} | set(quien_derivo.values())
    nombres = {u.id: personas.de_fila(u) for u in nucleo.usuarios_por_ids(db, sorted(ids))}
    salida: dict[str, list[tuple[str, str]]] = {}
    for v in visitas:
        filas: list[tuple[str, str]] = []
        if v.auditor_id and v.auditor_id in nombres:
            filas.append(("Auditor", nombres[v.auditor_id]))
        if v.id in quien_derivo and quien_derivo[v.id] in nombres:
            filas.append(("Coordinador", nombres[quien_derivo[v.id]]))
        salida[v.codigo_interno] = filas
    return salida


def ids_del_personal(
    db: DbSession, aseguradora_id: uuid.UUID | None = None
) -> tuple[set[uuid.UUID], set[uuid.UUID]]:
    """
    Quién está o estuvo en Concurrencia: `(con_tramo, intervinieron)`. Lo
    primero sale del historial de accesos (D57); lo segundo, de los casos —quien
    los creó, editó, derivó, auditó, tuvo asignados, dictó notas o subió
    fotos—, por si alguno es anterior al historial. Con `aseguradora_id`, solo
    los casos de esa compañía. Quién es de qué compañía lo filtra quien llama.
    """
    from app.shared.audit.models import AuditLog
    from app.shared.users.models import HistorialAcceso

    con_tramo: set[uuid.UUID] = set(
        db.scalars(
            select(HistorialAcceso.user_id).where(
                HistorialAcceso.module_code == nucleo.MODULO,
                HistorialAcceso.ambito == "aplicacion",
            )
        )
    )
    casos = select(Visita.id)
    if aseguradora_id is not None:
        casos = casos.where(Visita.aseguradora_id == aseguradora_id)
    intervinieron: set[uuid.UUID] = set()
    for fila in db.execute(
        select(Visita.created_by, Visita.updated_by, Visita.auditor_id).where(
            Visita.id.in_(casos)
        )
    ):
        intervinieron.update(i for i in fila if i)
    for tabla in (VisitaNota, VisitaFoto):
        intervinieron.update(
            i
            for i in db.scalars(
                select(tabla.created_by).where(tabla.visita_id.in_(casos)).distinct()
            )
            if i
        )
    del_caso = and_(
        AuditLog.entidad == "conc_visitas",
        AuditLog.entidad_id.in_(select(cast(casos.subquery().c.id, String))),
    )
    intervinieron.update(
        i for i in db.scalars(select(AuditLog.user_id).where(del_caso).distinct()) if i
    )
    for detalle in db.scalars(
        select(AuditLog.detalle).where(del_caso, AuditLog.accion == "visita_derivada")
    ):
        for lado in ("antes", "despues"):
            valor = ((detalle or {}).get(lado) or {}).get("auditor_id")
            if valor:
                intervinieron.add(uuid.UUID(valor))
    return con_tramo, intervinieron


def usuarios_de_la_aseguradora(
    db: DbSession, aseguradora_id: uuid.UUID
) -> list[tuple[Any, bool, str]]:
    """
    El tercer filtro de trazabilidad: la gente DE LA COMPAÑÍA que tiene o tuvo
    Concurrencia (operadores, su coordinador) o participó en sus casos, esté o
    no todavía —a ellos tampoco se les borra, solo se les desactiva—.
    `(usuario, vigente, rol)`.
    """
    from app.shared.users.models import HistorialAcceso
    from app.shared.users.service import etiqueta_rol

    tramos: dict[uuid.UUID, list[Any]] = {}
    for t in db.scalars(
        select(HistorialAcceso)
        .where(
            or_(
                HistorialAcceso.module_code == nucleo.MODULO,
                and_(
                    HistorialAcceso.ambito == "compania",
                    HistorialAcceso.aseguradora_id == aseguradora_id,
                ),
            )
        )
        .order_by(HistorialAcceso.desde.desc())
    ):
        tramos.setdefault(t.user_id, []).append(t)
    vigentes = {u.id for u in nucleo.operadores_de_la_compania(db, aseguradora_id)}
    _con_tramo, intervinieron = ids_del_personal(db, aseguradora_id)
    activados = cuentas_activadas(db, set(tramos) | intervinieron | vigentes)
    filas: list[tuple[Any, bool, str]] = []
    for u in nucleo.usuarios_por_ids(db, sorted(activados)):
        if u.aseguradora_id != aseguradora_id:
            continue
        # Las cuentas dadas de baja (las de pruebas) solo si tocaron algún caso.
        if u.deleted_at is not None and u.id not in intervinieron:
            continue
        suyos = tramos.get(u.id, [])
        abiertos = [t for t in suyos if t.hasta is None]
        activo = bool(u.is_active) and u.deleted_at is None
        vigente = activo and (bool(abiertos) or u.id in vigentes)
        # Gente de la compañía: «Supervisor» / «Ejecutivo» (19/10/2026).
        roles = [etiqueta_rol(t.rol, de_aseguradora=True) for t in (abiertos or suyos)]
        rol = " · ".join(dict.fromkeys(roles)) or "Ejecutivo"
        filas.append((u, vigente, rol))
    return sorted(filas, key=lambda f: (not f[1], personas.de_fila(f[0]), str(f[0].id)))


def tramos_en_concurrencia(db: DbSession) -> dict[uuid.UUID, list[Any]]:
    """Los tramos de cada persona en Concurrencia, del más reciente al más viejo."""
    from app.shared.users.models import HistorialAcceso

    tramos: dict[uuid.UUID, list[Any]] = {}
    for t in db.scalars(
        select(HistorialAcceso)
        .where(
            HistorialAcceso.module_code == nucleo.MODULO,
            HistorialAcceso.ambito == "aplicacion",
        )
        .order_by(HistorialAcceso.desde.desc())
    ):
        tramos.setdefault(t.user_id, []).append(t)
    return tramos


def aseguradoras_con_casos(db: DbSession) -> list[uuid.UUID]:
    """
    Las compañías que alguna vez tuvieron un caso o gente en Concurrencia,
    aunque hoy no tengan el módulo: sus ex operadores tienen que poder
    filtrarse igual (en medicina no se borra nada).
    """
    from app.shared.users.models import HistorialAcceso

    con_casos = set(
        db.scalars(select(Visita.aseguradora_id).where(Visita.deleted_at.is_(None)).distinct())
    )
    con_gente = set(
        db.scalars(
            select(User.aseguradora_id)
            .join(HistorialAcceso, HistorialAcceso.user_id == User.id)
            .where(
                HistorialAcceso.module_code == nucleo.MODULO,
                User.aseguradora_id.is_not(None),
                User.deleted_at.is_(None),
            )
            .distinct()
        )
    )
    return sorted(con_casos | con_gente, key=str)


def listar_del_auditor(db: DbSession, user_id: uuid.UUID) -> list[tuple[Any, ...]]:
    """
    Los casos derivados a ESTE auditor, los próximos primero. El ownership es la
    propia columna: `auditor_id = su id`, nada que un parámetro pueda torcer.
    """
    filas = db.execute(
        _select_bandeja()
        .add_columns(_conteo_correos())
        .where(Visita.auditor_id == user_id)
        .order_by(Visita.desde.asc(), Visita.id.asc())
    ).all()
    return _completar(db, filas)


def fila_supervision(db: DbSession, visita_id: uuid.UUID) -> tuple[Any, ...]:
    """Una visita con todos sus joins, en la misma forma que la lista."""
    fila = db.execute(
        _select_bandeja().add_columns(_conteo_correos()).where(Visita.id == visita_id)
    ).first()
    if fila is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Visita no encontrada")
    return _completar(db, [fila])[0]


def obtener_para_supervision(db: DbSession, visita_id: uuid.UUID) -> Visita:
    visita = db.scalar(
        select(Visita).where(Visita.id == visita_id, Visita.deleted_at.is_(None))
    )
    if visita is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Visita no encontrada")
    return visita


def auditores_disponibles(db: DbSession) -> list[tuple[Any, ...]]:
    """
    A quién se puede derivar un caso: personal de plataforma ACTIVO con acceso
    vivo a Concurrencia y rol auditor. Ni operadores de compañía ni supervisores:
    derivar es mandar a alguien a auditar, y ese alguien es un auditor. Viaja
    con su ciudad y provincia: la pantalla ofrece primero a los de la misma
    ciudad del destino, luego a los de la provincia y al final al resto.
    """
    filas = nucleo.auditores_disponibles(db)
    # A quien todavía no activó su cuenta no se le puede derivar: no podría entrar.
    activados = cuentas_activadas(db, {f[0].id for f in filas})
    return [f for f in filas if f[0].id in activados]


#: Solo mientras el caso está en la agenda se deriva, reasigna o desasigna.
ESTADOS_DERIVABLES = ("programada", "asignada")
ETIQUETA_ESTADO = {
    "auditando": "en auditoría",
    "culminada": "culminado",
    "cancelada": "cancelado",
    "no_auditado": "no auditado",
}


def asignar_auditor(
    db: DbSession, visita: Visita, auditor_id: uuid.UUID | None, autor: uuid.UUID
) -> dict[str, Any]:
    """
    Deriva el caso (o lo deja sin asignar, con `None`). El destino se valida
    contra la base en el momento de asignar: si al auditor lo desactivaron con
    el desplegable abierto, el guardado se rechaza.
    """
    # **La asignación queda fija en cuanto el caso sale de la agenda**
    # (14/10/2026, pedido del usuario): en auditoría, culminado, cancelado o no
    # auditado ya no se cambia ni se quita el auditor —es quien llegó, auditó o
    # debía ir, y eso es trazabilidad—. Un no auditado vuelve a «asignada» con
    # la prórroga, y ahí sí se puede reasignar.
    if visita.estado not in ESTADOS_DERIVABLES:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail=(
                f"El caso está {ETIQUETA_ESTADO.get(visita.estado, visita.estado)}: "
                "ya no se puede cambiar ni quitar el auditor"
            ),
        )
    if auditor_id is not None:
        # La lista viaja con ciudad y provincia; aquí solo importa quién es.
        validos = {a.id for a, _ciudad, _provincia in auditores_disponibles(db)}
        if auditor_id not in validos:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Ese usuario no es un auditor activo de Concurrencia",
            )

    diff: dict[str, Any] = {"antes": {}, "despues": {}}
    if visita.auditor_id != auditor_id:
        diff["antes"]["auditor_id"] = str(visita.auditor_id) if visita.auditor_id else None
        diff["despues"]["auditor_id"] = str(auditor_id) if auditor_id else None
        visita.auditor_id = auditor_id
        visita.updated_by = autor

        # Derivar MUEVE el estado, y quitar la asignación lo devuelve: nadie lo
        # teclea. Solo entre esos dos, que son los pendientes: un caso al que el
        # auditor ya llegó, o que terminó, no cambia de estado por reasignarlo.
        if visita.estado in ("programada", "asignada"):
            nuevo_estado = "asignada" if auditor_id is not None else "programada"
            if nuevo_estado != visita.estado:
                diff["antes"]["estado"] = visita.estado
                diff["despues"]["estado"] = nuevo_estado
                visita.estado = nuevo_estado
    return diff


# Cuánto se puede prorrogar de una vez. No es una regla de negocio pactada: es
# el tope que evita que un cero de más convierta «2 horas» en «200».
MAX_HORAS_PRORROGA = 72


def extender(db: DbSession, visita: Visita, horas: Decimal, autor: uuid.UUID) -> dt.datetime:
    """
    **La prórroga del coordinador de Accumedical**: le da al auditor más tiempo
    para llegar, contado DESDE AHORA y no desde la hora original. Si son las
    16:00 y concede 2 horas, el plazo queda en las 18:00, y se puede repetir
    cuantas veces haga falta hasta que el auditor llegue.

    Un caso ya vencido vuelve a la agenda con la prórroga: sin eso, el auditor
    seguiría sin poder marcar su llegada y la prórroga no serviría de nada.

    No toca la entrega del informe: son dos plazos distintos y mezclarlos
    borraría la prueba de si el informe llegó tarde.
    """
    if horas <= 0 or horas > MAX_HORAS_PRORROGA:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"La prórroga va de una hora a {MAX_HORAS_PRORROGA}",
        )
    if visita.estado not in ("programada", "asignada", "no_auditado"):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail=(
                "El auditor ya llegó: este caso no necesita prórroga"
                if visita.estado == "auditando"
                else "Este caso ya terminó: no se puede prorrogar"
            ),
        )
    # Se cuenta desde AHORA, que es lo pedido: a las 16:00, dos horas son las
    # 18:00. Pero **nunca recorta**: sobre un caso que todavía no ha vencido,
    # «ahora + 2 h» puede caer antes del plazo vigente, y prorrogar no puede
    # dejar al auditor con menos tiempo del que ya tenía (el CHECK de la base
    # lo impediría igual, con un error ilegible).
    visita.llegada_limite = max(
        visita.llegada_limite,
        dt.datetime.now(dt.UTC) + dt.timedelta(hours=float(horas)),
    )
    if visita.estado == "no_auditado":
        # Vuelve a la agenda, y al auditor le reaparece en su app.
        visita.estado = "asignada" if visita.auditor_id is not None else "programada"
    visita.updated_by = autor
    db.flush()
    return visita.llegada_limite


def cancelar(db: DbSession, visita: Visita, autor: uuid.UUID) -> None:
    """
    Cancela el caso. Es de la compañía que lo pidió: si ya no hace falta la
    visita, se cancela.

    **Se puede hasta que el caso TERMINA**, con el auditor ya dentro incluido:
    si al asegurado le dan el alta mientras el médico audita, la compañía no
    tiene por qué esperar a un informe que ya no sirve. Lo que no se toca es lo
    acabado: una culminada o una cancelada se quedan como están.

    Un caso vencido —`no_auditado`, que la compañía no ve como tal— también se
    cancela: para ella sigue siendo un caso pendiente.
    """
    if visita.estado in ("culminada", "cancelada"):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail="Este caso ya terminó: no se puede cancelar",
        )
    visita.estado = "cancelada"
    visita.updated_by = autor


def _a_uuid(valor: Any, que: str) -> uuid.UUID:
    try:
        return uuid.UUID(str(valor))
    except (ValueError, TypeError) as error:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"El {que} no es válido"
        ) from error
