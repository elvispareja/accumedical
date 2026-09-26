from __future__ import annotations

import datetime as dt
import uuid
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import Select, func, or_, select, update
from sqlalchemy.orm import Session as DbSession
from sqlalchemy.orm import aliased

from app.modules.concurrencia.models import (
    TIPOS_NOTA,
    Visita,
    VisitaCorreo,
    VisitaFoto,
    VisitaNota,
)
from app.shared import personas
from app.shared.aseguradoras.models import Aseguradora, AseguradoraModulo, AseguradoraPrestador
from app.shared.catalogos.models import Ciudad, Provincia, TipoPrestador
from app.shared.contactos.service import validar_documento
from app.shared.prestadores.models import Prestador, PrestadorContacto, PrestadorSede
from app.shared.users.models import Role, User, UserModuleAccess

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
) -> list[Aseguradora]:
    """
    Las compañías activas con el módulo Concurrencia habilitado: sobre ellas
    puede programar el coordinador de plataforma. Con `aseguradora_id` valida
    una en concreto (lista vacía = no existe, está inactiva o sin el módulo).
    """
    consulta = (
        select(Aseguradora)
        .join(AseguradoraModulo, AseguradoraModulo.aseguradora_id == Aseguradora.id)
        .where(
            AseguradoraModulo.module_code == "concurrencia",
            AseguradoraModulo.activo.is_(True),
            Aseguradora.deleted_at.is_(None),
            Aseguradora.estado == "activo",
        )
        .order_by(Aseguradora.razon_social)
    )
    if aseguradora_id is not None:
        consulta = consulta.where(Aseguradora.id == aseguradora_id)
    return list(db.scalars(consulta).all())


def prestadores_de_la_red(
    db: DbSession, aseguradora_id: uuid.UUID, *, search: str | None = None
) -> list[dict[str, Any]]:
    """
    Los prestadores con convenio VIVO con esta aseguradora, cada uno con sus
    sedes. Es la única lista sobre la que se puede programar una visita: no se
    ofrece —ni se acepta— un prestador que no esté en la red.
    """
    consulta = (
        select(Prestador, TipoPrestador.nombre, Ciudad.nombre, Provincia.nombre)
        .select_from(AseguradoraPrestador)
        .join(Prestador, Prestador.id == AseguradoraPrestador.prestador_id)
        .join(TipoPrestador, TipoPrestador.codigo == Prestador.tipo_codigo)
        .outerjoin(Ciudad, Ciudad.codigo == Prestador.ciudad_codigo)
        .outerjoin(Provincia, Provincia.codigo == Prestador.provincia_codigo)
        .where(
            AseguradoraPrestador.aseguradora_id == aseguradora_id,
            AseguradoraPrestador.deleted_at.is_(None),
            # Un convenio terminado ya no habilita visitas nuevas.
            AseguradoraPrestador.estado == "vigente",
            Prestador.deleted_at.is_(None),
            Prestador.estado == "activo",
        )
    )
    if search:
        patron = f"%{search.strip()}%"
        consulta = consulta.where(
            or_(Prestador.nombre.ilike(patron), Prestador.ruc.ilike(patron))
        )

    filas = db.execute(consulta.order_by(Prestador.nombre)).all()
    if not filas:
        return []

    ids = [p.id for p, *_ in filas]
    sedes = _sedes_por_prestador(db, ids)
    contactos = _contactos_por_prestador(db, ids)
    return [
        {
            "prestador": p,
            "tipo_nombre": tipo,
            "ciudad_nombre": ciudad,
            "provincia_nombre": provincia,
            "sedes": sedes.get(p.id, []),
            "contactos": contactos.get(p.id, []),
        }
        for p, tipo, ciudad, provincia in filas
    ]


def _sedes_por_prestador(
    db: DbSession, prestador_ids: list[uuid.UUID]
) -> dict[uuid.UUID, list[tuple[Any, ...]]]:
    """Un solo viaje para todas las sedes, no uno por prestador."""
    filas = db.execute(
        select(PrestadorSede, Ciudad.nombre, Provincia.nombre)
        .outerjoin(Ciudad, Ciudad.codigo == PrestadorSede.ciudad_codigo)
        .outerjoin(Provincia, Provincia.codigo == PrestadorSede.provincia_codigo)
        .where(
            PrestadorSede.prestador_id.in_(prestador_ids),
            PrestadorSede.deleted_at.is_(None),
            # Una sede inactiva no es sitio al que mandar a nadie.
            PrestadorSede.estado == "activa",
        )
        .order_by(PrestadorSede.nombre)
    ).all()

    por_prestador: dict[uuid.UUID, list[tuple[Any, ...]]] = {}
    for sede, ciudad, provincia in filas:
        por_prestador.setdefault(sede.prestador_id, []).append((sede, ciudad, provincia))
    return por_prestador


def _contactos_por_prestador(
    db: DbSession, prestador_ids: list[uuid.UUID]
) -> dict[uuid.UUID, list[PrestadorContacto]]:
    """
    Los contactos vivos de cada prestador, para marcar a quién se avisa. Un solo
    viaje, como las sedes. Por nombre y no por antigüedad: aquí se busca a una
    persona entre veinte, no se repasa el expediente.
    """
    filas = db.scalars(
        select(PrestadorContacto)
        .where(
            PrestadorContacto.prestador_id.in_(prestador_ids),
            PrestadorContacto.deleted_at.is_(None),
        )
        .order_by(personas.sql_completo(PrestadorContacto), PrestadorContacto.id)
    ).all()

    por_prestador: dict[uuid.UUID, list[PrestadorContacto]] = {}
    for contacto in filas:
        por_prestador.setdefault(contacto.prestador_id, []).append(contacto)
    return por_prestador


def _validar_destino(
    db: DbSession, aseguradora_id: uuid.UUID, prestador_id: uuid.UUID, sede_id: uuid.UUID | None
) -> None:
    """
    Comprueba contra la base que el prestador esté en la red y que la sede sea
    suya. No se confía en lo que mande el navegador: si el convenio se terminó
    mientras el formulario estaba abierto, el guardado se rechaza.
    """
    en_red = db.scalar(
        select(func.count())
        .select_from(AseguradoraPrestador)
        .where(
            AseguradoraPrestador.aseguradora_id == aseguradora_id,
            AseguradoraPrestador.prestador_id == prestador_id,
            AseguradoraPrestador.deleted_at.is_(None),
            AseguradoraPrestador.estado == "vigente",
        )
    )
    if not en_red:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Ese prestador no tiene convenio vigente con tu aseguradora",
        )

    suyas = db.scalars(
        select(PrestadorSede.id).where(
            PrestadorSede.prestador_id == prestador_id,
            PrestadorSede.deleted_at.is_(None),
            PrestadorSede.estado == "activa",
        )
    ).all()

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


def _validar_ventana(desde: dt.datetime, hasta: dt.datetime) -> None:
    # El CHECK de la base lo impide igual; aquí sale con un mensaje legible.
    if hasta <= desde:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="La hora de fin tiene que ser posterior a la de inicio",
        )


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
                Prestador.nombre.ilike(patron),
                Visita.codigo_interno.ilike(patron),
                # Las cuatro partes concatenadas: así «MARIA LOPEZ» entera
                # también encuentra, no solo cada palabra por separado.
                personas.sql_completo(Visita, "paciente_").ilike(patron),
                Visita.paciente_numero_documento.ilike(patron),
            )
        )
    if estado:
        consulta = consulta.where(Visita.estado == estado)
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
        .order_by(Visita.desde.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()
    return [tuple(f) for f in filas], total


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
    return tuple(fila)


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
    _validar_ventana(datos["desde"], datos["hasta"])
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
        hasta=datos["hasta"],
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
    _validar_ventana(
        cambios.get("desde") or visita.desde, cambios.get("hasta") or visita.hasta
    )

    resultante = dict(cambios)
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

    Ese estado dice que la ventana venció sin que el auditor llegara; el auditor
    ya no puede marcar nada, porque el caso desapareció de su trabajo por
    delante. Así que darle una ventana FUTURA —lo haga el operador editando o el
    coordinador con «Nueva fecha»— lo revive:

      · con auditor todavía asignado → `asignada`, y le reaparece en su app;
      · sin auditor                  → `programada`, para que lo deriven otra vez.

    Solo con la ventana en el futuro: corregirle el nombre al paciente de un
    caso vencido no resucita nada. Devuelve el estado nuevo, o `None` si no
    tocaba mover nada.
    """
    if visita.estado != "no_auditado" or visita.hasta <= dt.datetime.now(dt.UTC):
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


def operadores_de_la_compania(db: DbSession, aseguradora_id: uuid.UUID) -> list[User]:
    """
    Los operadores de MI aseguradora, para que el supervisor filtre el historial
    por quien creo cada caso. Tambien los inactivos: sus casos viejos siguen
    existiendo y alguien tiene que poder revisarlos.
    """
    return list(
        db.scalars(
            select(User)
            .join(UserModuleAccess, UserModuleAccess.user_id == User.id)
            .join(Role, Role.id == UserModuleAccess.role_id)
            .where(
                UserModuleAccess.module_code == "concurrencia",
                UserModuleAccess.activo.is_(True),
                Role.code == "operador",
                User.aseguradora_id == aseguradora_id,
                User.deleted_at.is_(None),
            )
            .order_by(personas.sql_completo(User))
        )
    )


def coordenadas_de_destinos(
    db: DbSession, visitas: list[Visita]
) -> dict[uuid.UUID, tuple[float, float]]:
    """
    El punto exacto al que va el auditor —la sede si la hay, la casa matriz si
    no—, para abrir el mapa desde la app. Dos viajes en lote, no uno por caso.
    """
    ids_prestador = {v.prestador_id for v in visitas if v.sede_id is None}
    ids_sede = {v.sede_id for v in visitas if v.sede_id is not None}

    de_prestador: dict[uuid.UUID, tuple[float, float]] = {}
    if ids_prestador:
        for pid, lat, lng in db.execute(
            select(Prestador.id, Prestador.latitud, Prestador.longitud).where(
                Prestador.id.in_(ids_prestador)
            )
        ):
            de_prestador[pid] = (float(lat), float(lng))
    de_sede: dict[uuid.UUID, tuple[float, float]] = {}
    if ids_sede:
        for sid, lat, lng in db.execute(
            select(PrestadorSede.id, PrestadorSede.latitud, PrestadorSede.longitud).where(
                PrestadorSede.id.in_(ids_sede)
            )
        ):
            de_sede[sid] = (float(lat), float(lng))

    salida: dict[uuid.UUID, tuple[float, float]] = {}
    for visita in visitas:
        punto = de_sede.get(visita.sede_id) if visita.sede_id else de_prestador.get(
            visita.prestador_id
        )
        if punto:
            salida[visita.id] = punto
    return salida


def marcar_no_auditadas(db: DbSession) -> list[str]:
    """
    La regla del NO AUDITADO: toda visita **pendiente** —programada o ya
    derivada a un auditor— cuya ventana venció sin que nadie registrara la
    llegada pasa a `no_auditado`, de una sola vez.

    Mira los dos estados a propósito: si solo mirara `programada`, un caso
    derivado que nadie llegó a visitar no vencería nunca. Los `auditando` quedan
    fuera porque ahí el médico SÍ llegó; ese caso termina cuando envía el
    informe, y mientras tanto se ve tal cual en el panel.

    Cada transición queda en AuditLog como acción del SISTEMA (sin usuario). No
    hace commit; lo hace quien llama.
    """
    from app.shared.audit import service as audit

    filas = db.execute(
        update(Visita)
        .where(
            Visita.deleted_at.is_(None),
            Visita.estado.in_(("programada", "asignada")),
            Visita.hasta < func.now(),
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
            detalle={"visita": codigo, "motivo": "ventana vencida sin llegada del auditor"},
        )
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
    db: DbSession, aseguradora_id: uuid.UUID | None = None
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
    """
    condiciones = [Visita.deleted_at.is_(None)]
    if aseguradora_id is not None:
        condiciones.append(Visita.aseguradora_id == aseguradora_id)

    totales = dict(
        db.execute(
            select(Visita.estado, func.count()).where(*condiciones).group_by(Visita.estado)
        ).all()
    )

    hoy_ec = dt.datetime.now(dt.UTC).astimezone(_ZONA_EC).date()
    inicio_hoy = dt.datetime.combine(hoy_ec, dt.time.min, tzinfo=_ZONA_EC)
    fin_hoy = inicio_hoy + dt.timedelta(days=1)
    # Las que TOCAN hoy: las que siguen pendientes —programada o ya derivada— y
    # las que se están auditando ahora mismo. Una cancelada de hoy no «toca».
    hoy = db.scalar(
        select(func.count()).where(
            *condiciones,
            Visita.estado.in_(("programada", "asignada", "auditando")),
            Visita.desde < fin_hoy,
            Visita.hasta > inicio_hoy,
        )
    ) or 0

    return {
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
    """
    ahora = dt.datetime.now(dt.UTC)
    proximas = db.execute(
        _base_select(aseguradora_id)
        .add_columns(_conteo_correos())
        .where(Visita.estado == "programada", Visita.hasta >= ahora)
        .order_by(Visita.desde.asc())
        .limit(5)
    ).all()

    return {
        **cifras_de_visitas(db, aseguradora_id),
        "proximas": [tuple(f) for f in proximas],
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
    page: int = 1,
    page_size: int = 20,
) -> tuple[list[tuple[Any, ...]], int]:
    consulta = _select_bandeja()

    if search:
        patron = f"%{search.strip()}%"
        consulta = consulta.where(
            or_(
                Prestador.nombre.ilike(patron),
                Visita.codigo_interno.ilike(patron),
                Aseguradora.razon_social.ilike(patron),
                Aseguradora.nombre_comercial.ilike(patron),
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
        .order_by(Visita.desde.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()
    return [tuple(f) for f in filas], total


def listar_del_auditor(db: DbSession, user_id: uuid.UUID) -> list[tuple[Any, ...]]:
    """
    Los casos derivados a ESTE auditor, los próximos primero. El ownership es la
    propia columna: `auditor_id = su id`, nada que un parámetro pueda torcer.
    """
    filas = db.execute(
        _select_bandeja()
        .add_columns(_conteo_correos())
        .where(Visita.auditor_id == user_id)
        .order_by(Visita.desde.asc())
    ).all()
    return [tuple(f) for f in filas]


def fila_supervision(db: DbSession, visita_id: uuid.UUID) -> tuple[Any, ...]:
    """Una visita con todos sus joins, en la misma forma que la lista."""
    fila = db.execute(
        _select_bandeja().add_columns(_conteo_correos()).where(Visita.id == visita_id)
    ).first()
    if fila is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Visita no encontrada")
    return tuple(fila)


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
    ciudad_auditor = aliased(Ciudad)
    provincia_auditor = aliased(Provincia)
    return [
        tuple(f)
        for f in db.execute(
            select(User, ciudad_auditor.nombre, provincia_auditor.nombre)
            .join(UserModuleAccess, UserModuleAccess.user_id == User.id)
            .join(Role, Role.id == UserModuleAccess.role_id)
            .outerjoin(ciudad_auditor, ciudad_auditor.codigo == User.ciudad_codigo)
            .outerjoin(provincia_auditor, provincia_auditor.codigo == User.provincia_codigo)
            .where(
                UserModuleAccess.module_code == "concurrencia",
                UserModuleAccess.activo.is_(True),
                Role.code == "auditor",
                User.aseguradora_id.is_(None),
                User.is_superadmin.is_(False),
                User.deleted_at.is_(None),
                User.is_active.is_(True),
            )
            .order_by(User.apellido_paterno, User.apellido_materno, User.nombre_principal)
        ).all()
    ]


def asignar_auditor(
    db: DbSession, visita: Visita, auditor_id: uuid.UUID | None, autor: uuid.UUID
) -> dict[str, Any]:
    """
    Deriva el caso (o lo deja sin asignar, con `None`). El destino se valida
    contra la base en el momento de asignar: si al auditor lo desactivaron con
    el desplegable abierto, el guardado se rechaza.
    """
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


def cancelar(db: DbSession, visita: Visita, autor: uuid.UUID) -> None:
    """
    Cancela el caso. Es de la compañía que lo pidió: si ya no hace falta la
    visita, se cancela.

    **Solo mientras nadie haya llegado.** Con el médico ya en el hospital
    —`auditando`— cancelar no cancelaría nada: ese caso termina con su informe o
    se queda sin auditar. Y una culminada o una cancelada no se vuelven a tocar.
    """
    if visita.estado not in ("programada", "asignada"):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail=(
                "Este caso ya no se puede cancelar: el auditor llegó o el caso terminó"
                if visita.estado == "auditando"
                else "Este caso ya no está pendiente: no se puede cancelar"
            ),
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
