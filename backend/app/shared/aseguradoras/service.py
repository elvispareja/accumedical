from __future__ import annotations

import uuid
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import Select, func, or_, select
from sqlalchemy.orm import Session as DbSession

from app.shared.aseguradoras.models import (
    Aseguradora,
    AseguradoraCobertura,
    AseguradoraContacto,
    AseguradoraModulo,
    AseguradoraPrestador,
    AseguradoraSla,
)
from app.shared.catalogos.models import Ciudad, Module, Provincia, TipoPrestador
from app.shared.central import redes as redes_central
from app.shared.contactos import service as contactos
from app.shared.geo import prohibir_vaciar
from app.shared.prestadores.models import Prestador

MAX_PAGE_SIZE = 100


def _base_select() -> Select:
    """Listado y detalle comparten el mismo join a los catálogos de ubicación."""
    return (
        select(Aseguradora, Provincia.nombre, Ciudad.nombre)
        .select_from(Aseguradora)
        .outerjoin(Provincia, Provincia.codigo == Aseguradora.provincia_codigo)
        .outerjoin(Ciudad, Ciudad.codigo == Aseguradora.ciudad_codigo)
        .where(Aseguradora.deleted_at.is_(None))
    )


def puntos_del_mapa(db: DbSession) -> list[dict[str, Any]]:
    """
    Cada compañía con su punto en el mapa. A diferencia de un prestador, una
    aseguradora tiene UN solo sitio —su domicilio— porque no lleva sedes: aquí
    no hay que desdoblar nada.

    La ficha propia de Accumedical queda fuera, como en el listado: no es una
    aseguradora más.
    """
    filas = db.execute(
        _base_select()
        .where(Aseguradora.es_propia.is_(False))
        .order_by(Provincia.nombre, Ciudad.nombre, Aseguradora.razon_social)
    ).all()
    return [
        {
            "id": str(a.id),
            "codigo_interno": a.codigo_interno,
            "razon_social": a.razon_social,
            "nombre_comercial": a.nombre_comercial,
            "ruc": a.ruc,
            "estado": a.estado,
            "direccion_fiscal": a.direccion_fiscal,
            "provincia_codigo": a.provincia_codigo,
            "provincia_nombre": provincia,
            "ciudad_codigo": a.ciudad_codigo,
            "ciudad_nombre": ciudad,
            "latitud": float(a.latitud),
            "longitud": float(a.longitud),
        }
        for a, provincia, ciudad in filas
    ]


def listar(
    db: DbSession,
    *,
    search: str | None = None,
    estado: str | None = None,
    provincia_codigo: str | None = None,
    page: int = 1,
    page_size: int = 20,
) -> tuple[list[tuple[Aseguradora, str | None, str | None]], int]:
    # La ficha propia de Accumedical (Red convenio) no es una aseguradora más:
    # jamás se lista ni se elige.
    consulta = _base_select().where(Aseguradora.es_propia.is_(False))

    if search:
        # ILIKE parametrizado, jamás interpolación de cadenas. Los índices GIN
        # trigram sobre razón social y nombre comercial evitan el seq scan.
        patron = f"%{search.strip()}%"
        consulta = consulta.where(
            or_(
                Aseguradora.razon_social.ilike(patron),
                Aseguradora.nombre_comercial.ilike(patron),
                Aseguradora.ruc.ilike(patron),
                Aseguradora.codigo_interno.ilike(patron),
            )
        )
    if estado:
        consulta = consulta.where(Aseguradora.estado == estado)
    if provincia_codigo:
        consulta = consulta.where(Aseguradora.provincia_codigo == provincia_codigo)

    sub = consulta.subquery()
    total = db.scalar(select(func.count()).select_from(sub)) or 0

    page = max(1, page)
    page_size = min(max(1, page_size), MAX_PAGE_SIZE)
    filas = db.execute(
        consulta.order_by(Aseguradora.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()
    return [(f[0], f[1], f[2]) for f in filas], total


def obtener(db: DbSession, aseguradora_id: uuid.UUID):
    fila = db.execute(_base_select().where(Aseguradora.id == aseguradora_id)).first()
    if fila is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Aseguradora no encontrada")
    return fila[0], fila[1], fila[2]


def _validar_ubicacion(db: DbSession, provincia: str | None, ciudad: str | None) -> None:
    """
    La base ya impide guardar una ciudad de otra provincia mediante una FK
    compuesta, pero esa violación llegaría como un error de integridad feo. Aquí
    se comprueba antes para devolver un mensaje que el usuario entienda.
    """
    if ciudad is None:
        return
    if provincia is None:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Para elegir una ciudad hay que elegir primero la provincia",
        )
    existe = db.scalar(
        select(func.count())
        .select_from(Ciudad)
        .where(Ciudad.codigo == ciudad, Ciudad.provincia_codigo == provincia)
    )
    if not existe:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="La ciudad seleccionada no pertenece a esa provincia",
        )


def _ruc_disponible(db: DbSession, ruc: str, excluir: uuid.UUID | None = None) -> bool:
    consulta = select(func.count()).select_from(Aseguradora).where(
        Aseguradora.ruc == ruc, Aseguradora.deleted_at.is_(None)
    )
    if excluir is not None:
        consulta = consulta.where(Aseguradora.id != excluir)
    return not db.scalar(consulta)


def crear(db: DbSession, datos: dict[str, Any], autor: uuid.UUID) -> Aseguradora:
    _validar_ubicacion(db, datos.get("provincia_codigo"), datos.get("ciudad_codigo"))
    if not _ruc_disponible(db, datos["ruc"]):
        raise HTTPException(
            status.HTTP_409_CONFLICT, detail="Ya existe una aseguradora con ese RUC"
        )

    aseguradora = Aseguradora(**datos, created_by=autor, updated_by=autor)
    db.add(aseguradora)
    db.flush()
    # El código interno lo genera la secuencia de la base: hay que releerlo.
    db.refresh(aseguradora)
    return aseguradora


def actualizar(
    db: DbSession, aseguradora: Aseguradora, cambios: dict[str, Any], autor: uuid.UUID
) -> dict[str, Any]:
    prohibir_vaciar(cambios)
    provincia = cambios.get("provincia_codigo", aseguradora.provincia_codigo)
    ciudad = cambios.get("ciudad_codigo", aseguradora.ciudad_codigo)
    # Cambiar de provincia sin cambiar de ciudad dejaría una ciudad huérfana de
    # otra provincia: se valida el par resultante, no cada campo por separado.
    _validar_ubicacion(db, provincia, ciudad)

    if "ruc" in cambios and not _ruc_disponible(db, cambios["ruc"], excluir=aseguradora.id):
        raise HTTPException(
            status.HTTP_409_CONFLICT, detail="Ya existe una aseguradora con ese RUC"
        )

    diff: dict[str, Any] = {"antes": {}, "despues": {}}
    for campo, valor in cambios.items():
        anterior = getattr(aseguradora, campo)
        if anterior != valor:
            diff["antes"][campo] = anterior
            diff["despues"][campo] = valor
            setattr(aseguradora, campo, valor)

    if diff["despues"]:
        aseguradora.updated_by = autor
    return diff


# No hay `eliminar()`: una aseguradora se desactiva (`estado='inactivo'`), no se
# borra. Las columnas `deleted_at`/`deleted_by` siguen ahí porque vienen del mixin
# común, pero ningún camino de la aplicación las escribe para esta tabla.


# ─────────────────────── Módulos habilitados por aseguradora ─────────────────


def modulos_de(db: DbSession, aseguradora_id: uuid.UUID) -> list[dict[str, Any]]:
    """
    Devuelve TODOS los módulos vivos de la plataforma con una marca de si esta
    aseguradora los tiene habilitados. Se parte del catálogo `modules` y no de las
    filas existentes para que un módulo nuevo aparezca solo como casilla sin marcar,
    sin tener que sembrar nada.
    """
    filas = db.execute(
        select(
            Module.code,
            Module.slug,
            Module.nombre,
            Module.color_acento,
            Module.orden,
            AseguradoraModulo.activo,
        )
        .select_from(Module)
        .outerjoin(
            AseguradoraModulo,
            (AseguradoraModulo.module_code == Module.code)
            & (AseguradoraModulo.aseguradora_id == aseguradora_id),
        )
        .where(Module.activo.is_(True))
        .order_by(Module.orden, Module.nombre)
    ).all()

    return [
        {
            "codigo": f[0],
            "slug": f[1],
            "nombre": f[2],
            "color_acento": f[3],
            "orden": f[4],
            "activo": bool(f[5]),
        }
        for f in filas
    ]


def fijar_modulos(
    db: DbSession, aseguradora_id: uuid.UUID, codigos: list[str], autor: uuid.UUID
) -> dict[str, list[str]] | None:
    """
    Reconcilia las casillas contra lo guardado. Destildar NO borra la fila: la
    marca inactiva y anota quién y cuándo, para que quede rastro.

    Devuelve qué se habilitó y qué se revocó, o None si nada cambió, para que la
    auditoría registre solo los cambios reales.
    """
    validos = set(
        db.scalars(select(Module.code).where(Module.activo.is_(True))).all()
    )
    pedidos = {c for c in codigos if c in validos}
    if len(pedidos) != len(set(codigos)):
        desconocidos = sorted(set(codigos) - validos)
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Módulos desconocidos o inactivos: {', '.join(desconocidos)}",
        )

    existentes = {
        fila.module_code: fila
        for fila in db.scalars(
            select(AseguradoraModulo).where(AseguradoraModulo.aseguradora_id == aseguradora_id)
        ).all()
    }

    habilitados: list[str] = []
    revocados: list[str] = []
    momento = func.now()

    for code in sorted(validos):
        quiere = code in pedidos
        fila = existentes.get(code)

        if fila is None:
            if quiere:
                db.add(
                    AseguradoraModulo(
                        aseguradora_id=aseguradora_id,
                        module_code=code,
                        activo=True,
                        granted_by=autor,
                    )
                )
                habilitados.append(code)
            continue

        if quiere and not fila.activo:
            fila.activo = True
            fila.granted_by = autor
            fila.granted_at = momento
            fila.revoked_at = None
            fila.revoked_by = None
            habilitados.append(code)
        elif not quiere and fila.activo:
            fila.activo = False
            fila.revoked_at = momento
            fila.revoked_by = autor
            revocados.append(code)

    if not habilitados and not revocados:
        return None
    return {"habilitados": habilitados, "revocados": revocados}


# ─────────────────────────── Coberturas (subramas) ───────────────────────────

# Sin tabla de catálogo, por decisión explícita: esta constante y el CHECK de la
# migración son la única fuente. Añadir una cobertura, o dárselas a otro módulo,
# exige tocar ambas y migrar.
COBERTURAS: dict[str, tuple[tuple[str, str], ...]] = {
    "calificacion": (
        ("vida", "Vida"),
        ("asistencia_medica", "Asistencia médica"),
        ("vida_desgravamen", "Vida desgravamen"),
    ),
}


def coberturas_de(db: DbSession, aseguradora_id: uuid.UUID) -> dict[str, list[dict[str, Any]]]:
    """
    Coberturas por módulo, con la marca de cuáles tiene la aseguradora. Se
    devuelven SIEMPRE, tenga o no el módulo activo: al destildar un módulo sus
    coberturas se conservan y deben reaparecer tal cual si se vuelve a marcar.
    """
    guardadas = {
        (fila.module_code, fila.cobertura_codigo): fila.activo
        for fila in db.scalars(
            select(AseguradoraCobertura).where(
                AseguradoraCobertura.aseguradora_id == aseguradora_id
            )
        ).all()
    }
    return {
        module_code: [
            {
                "codigo": codigo,
                "nombre": nombre,
                "activo": bool(guardadas.get((module_code, codigo), False)),
            }
            for codigo, nombre in coberturas
        ]
        for module_code, coberturas in COBERTURAS.items()
    }


def fijar_coberturas(
    db: DbSession,
    aseguradora_id: uuid.UUID,
    module_code: str,
    codigos: list[str],
    autor: uuid.UUID,
) -> dict[str, list[str]] | None:
    """
    Reconcilia las coberturas de UN módulo. Solo debe llamarse cuando ese módulo
    queda habilitado: si está destildado, sus coberturas se dejan intactas.

    Como en los módulos, destildar no borra la fila: la marca inactiva y anota
    quién y cuándo.
    """
    validas = {codigo for codigo, _ in COBERTURAS.get(module_code, ())}
    pedidas = {c for c in codigos if c in validas}
    desconocidas = sorted(set(codigos) - validas)
    if desconocidas:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Coberturas desconocidas para {module_code}: {', '.join(desconocidas)}",
        )

    existentes = {
        fila.cobertura_codigo: fila
        for fila in db.scalars(
            select(AseguradoraCobertura).where(
                AseguradoraCobertura.aseguradora_id == aseguradora_id,
                AseguradoraCobertura.module_code == module_code,
            )
        ).all()
    }

    habilitadas: list[str] = []
    revocadas: list[str] = []
    momento = func.now()

    for codigo in sorted(validas):
        quiere = codigo in pedidas
        fila = existentes.get(codigo)

        if fila is None:
            if quiere:
                db.add(
                    AseguradoraCobertura(
                        aseguradora_id=aseguradora_id,
                        module_code=module_code,
                        cobertura_codigo=codigo,
                        activo=True,
                        granted_by=autor,
                    )
                )
                habilitadas.append(codigo)
            continue

        if quiere and not fila.activo:
            fila.activo = True
            fila.granted_by = autor
            fila.granted_at = momento
            fila.revoked_at = None
            fila.revoked_by = None
            habilitadas.append(codigo)
        elif not quiere and fila.activo:
            fila.activo = False
            fila.revoked_at = momento
            fila.revoked_by = autor
            revocadas.append(codigo)

    if not habilitadas and not revocadas:
        return None
    return {"habilitadas": habilitadas, "revocadas": revocadas}


# ───────────────────── Accesos: módulos directos + derivados ─────────────────
#
# Un módulo con coberturas NO se marca por sí mismo: es el encabezado de sus
# subramas. Su acceso se DERIVA de ellas — la aseguradora entra a calificación si
# tiene al menos una cobertura activa. Los módulos sin coberturas sí se marcan
# directamente.
#
# La derivación vive aquí, en el servicio, y no en la pantalla: así el invariante
# se cumple venga la petición de donde venga.


def _asegurar_fila_modulo(
    db: DbSession, aseguradora_id: uuid.UUID, module_code: str, autor: uuid.UUID
) -> None:
    """
    Las coberturas tienen FK compuesta a `aseguradora_modulos`, así que la fila del
    módulo debe existir antes de insertarlas. Se crea inactiva: el estado real lo
    fija después la derivación.
    """
    existe = db.scalar(
        select(func.count())
        .select_from(AseguradoraModulo)
        .where(
            AseguradoraModulo.aseguradora_id == aseguradora_id,
            AseguradoraModulo.module_code == module_code,
        )
    )
    if not existe:
        db.add(
            AseguradoraModulo(
                aseguradora_id=aseguradora_id,
                module_code=module_code,
                activo=False,
                granted_by=autor,
            )
        )


def _modulos_directos_activos(db: DbSession, aseguradora_id: uuid.UUID) -> list[str]:
    """Módulos sin coberturas que la aseguradora tiene activos ahora mismo."""
    codigos = db.scalars(
        select(AseguradoraModulo.module_code).where(
            AseguradoraModulo.aseguradora_id == aseguradora_id,
            AseguradoraModulo.activo.is_(True),
        )
    ).all()
    return [c for c in codigos if c not in COBERTURAS]


def _modulos_derivados(db: DbSession, aseguradora_id: uuid.UUID) -> list[str]:
    """Módulos con coberturas que tienen al menos una activa."""
    codigos = db.scalars(
        select(AseguradoraCobertura.module_code)
        .where(
            AseguradoraCobertura.aseguradora_id == aseguradora_id,
            AseguradoraCobertura.activo.is_(True),
        )
        .distinct()
    ).all()
    return list(codigos)


def fijar_accesos(
    db: DbSession,
    aseguradora_id: uuid.UUID,
    modulos: list[str] | None,
    coberturas: dict[str, list[str]] | None,
    autor: uuid.UUID,
) -> dict[str, Any]:
    """
    Punto único por el que pasan módulos y coberturas.

    `modulos` gobierna solo los módulos SIN coberturas; los que las tienen se
    derivan. `None` en cualquiera de los dos significa "no lo toques".
    """
    cambios: dict[str, Any] = {}

    if coberturas is not None:
        desconocidos = sorted(set(coberturas) - set(COBERTURAS))
        if desconocidos:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Estos módulos no tienen coberturas: {', '.join(desconocidos)}",
            )
        for module_code in coberturas:
            _asegurar_fila_modulo(db, aseguradora_id, module_code, autor)
        db.flush()

        por_modulo: dict[str, Any] = {}
        for module_code, codigos in coberturas.items():
            cambio = fijar_coberturas(db, aseguradora_id, module_code, codigos, autor)
            if cambio:
                por_modulo[module_code] = cambio
        if por_modulo:
            cambios["coberturas"] = por_modulo
        db.flush()

    # El estado de los módulos se recalcula si se tocó cualquiera de los dos lados:
    # cambiar coberturas puede dar o quitar el acceso al módulo que las agrupa.
    if modulos is not None or coberturas is not None:
        directos = (
            [c for c in modulos if c not in COBERTURAS]
            if modulos is not None
            else _modulos_directos_activos(db, aseguradora_id)
        )
        efectivos = sorted(set(directos) | set(_modulos_derivados(db, aseguradora_id)))
        cambio = fijar_modulos(db, aseguradora_id, efectivos, autor)
        if cambio:
            cambios["modulos"] = cambio

    return cambios


# ──────────────────────────────── Contactos ──────────────────────────────────
#
# La lógica vive en `app.shared.contactos.service`, compartida con prestadores:
# es idéntica y no tiene sentido duplicarla. Lo que NO se comparte es la tabla:
# cada dueño tiene la suya, con su FK real, porque van a divergir.


def contactos_de(db: DbSession, aseguradora_id: uuid.UUID) -> list[AseguradoraContacto]:
    return contactos.listar(db, AseguradoraContacto, "aseguradora_id", aseguradora_id)


def nombres_tipos_documento(db: DbSession) -> dict[str, str]:
    return contactos.nombres_tipos_documento(db)


def _proteger_contactos_con_usuario(
    db: DbSession, aseguradora_id: uuid.UUID, entrantes: list[dict[str, Any]]
) -> None:
    """
    Un contacto que ya tiene usuario no se puede quitar de la lista. El usuario
    hereda de él nombre y correo, así que borrarlo lo dejaría huérfano; y la FK
    RESTRICT lo impediría igual, pero con un error de integridad ilegible.
    """
    # Import local: `usuarios` importa este módulo para leer COBERTURAS, y al
    # revés en el arranque sería un ciclo.
    from app.shared.aseguradoras import usuarios as usuarios_service

    guardados = contactos.listar(db, AseguradoraContacto, "aseguradora_id", aseguradora_id)
    vivos = {c.id for c in guardados}
    conservados: set[uuid.UUID] = set()
    for datos in entrantes:
        crudo = datos.get("id")
        if not crudo:
            continue
        try:
            conservados.add(uuid.UUID(str(crudo)))
        except ValueError:
            continue

    se_van = list(vivos - conservados)
    con_usuario = usuarios_service.tiene_usuario(db, se_van)
    if con_usuario:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail=(
                "No se puede quitar un contacto que ya tiene usuario. "
                "Desactiva primero su usuario en la pestaña Usuarios."
            ),
        )


def fijar_contactos(
    db: DbSession,
    aseguradora_id: uuid.UUID,
    entrantes: list[dict[str, Any]],
    autor: uuid.UUID,
) -> dict[str, int] | None:
    _proteger_contactos_con_usuario(db, aseguradora_id, entrantes)
    return contactos.fijar(
        db, AseguradoraContacto, "aseguradora_id", aseguradora_id, entrantes, autor
    )


# ──────────────── Convenios: la red, elegida DESDE la aseguradora ────────────


def convenios_de_aseguradora(db: DbSession, aseguradora_id: uuid.UUID) -> list[dict[str, Any]]:
    """
    TODOS los prestadores vivos, marcando cuáles tienen convenio vivo con esta
    aseguradora: la pestaña Convenios es elegir y marcar. El detalle del
    convenio (FC, vigencias, código contractual) se captura después.
    Si la red vive en la central (la propia, o todas con REDES_EN_CENTRAL), se
    lee de allá (`central.redes`).
    """
    if redes_central.aplica(db, aseguradora_id):
        return redes_central.convenios_de_aseguradora(aseguradora_id)
    vivos = {
        convenio.prestador_id: convenio
        for convenio in db.scalars(
            select(AseguradoraPrestador).where(
                AseguradoraPrestador.aseguradora_id == aseguradora_id,
                AseguradoraPrestador.deleted_at.is_(None),
            )
        ).all()
    }
    filas = db.execute(
        select(Prestador, TipoPrestador.nombre, Ciudad.nombre)
        .join(TipoPrestador, TipoPrestador.codigo == Prestador.tipo_codigo)
        .outerjoin(Ciudad, Ciudad.codigo == Prestador.ciudad_codigo)
        .where(Prestador.deleted_at.is_(None))
        .order_by(Prestador.nombre)
    ).all()
    return [
        {
            "prestador": prestador,
            "tipo_nombre": tipo,
            "ciudad_nombre": ciudad,
            "marcado": prestador.id in vivos,
            "convenio": vivos.get(prestador.id),
        }
        for prestador, tipo, ciudad in filas
    ]


def sla_de(db: DbSession, aseguradora_id: uuid.UUID) -> list[dict[str, Any]]:
    """
    El SLA de los módulos que esta compañía tiene ACTIVOS, en el orden del
    catálogo. Solo los activos: no se pacta el nivel de servicio de algo que no
    está contratado. Lo ya pactado para un módulo destildado queda guardado y
    reaparece si vuelve a marcarse.
    """
    pactado = {
        fila.module_code: fila
        for fila in db.scalars(
            select(AseguradoraSla).where(AseguradoraSla.aseguradora_id == aseguradora_id)
        ).all()
    }
    filas = db.execute(
        select(Module.code, Module.nombre, Module.grupo)
        .join(
            AseguradoraModulo,
            (AseguradoraModulo.module_code == Module.code)
            & (AseguradoraModulo.aseguradora_id == aseguradora_id),
        )
        .where(AseguradoraModulo.activo.is_(True), Module.activo.is_(True))
        .order_by(Module.orden, Module.nombre)
    ).all()
    def valor(code: str, campo: str) -> float | None:
        fila = pactado.get(code)
        crudo = getattr(fila, campo, None) if fila else None
        return float(crudo) if crudo is not None else None

    return [
        {
            "module_code": code,
            "module_nombre": nombre,
            "grupo": grupo,
            "horas": valor(code, "horas"),
            "precio": valor(code, "precio"),
        }
        for code, nombre, grupo in filas
    ]


def fijar_sla(
    db: DbSession,
    aseguradora_id: uuid.UUID,
    entradas: list[dict[str, Any]],
    autor: uuid.UUID,
) -> dict[str, Any] | None:
    """
    Guarda lo pactado. Solo se admiten módulos que la compañía tenga ACTIVOS: lo
    que llegue de otro se rechaza en vez de crear un acuerdo fantasma.
    """
    activos = {
        fila.module_code
        for fila in db.scalars(
            select(AseguradoraModulo).where(
                AseguradoraModulo.aseguradora_id == aseguradora_id,
                AseguradoraModulo.activo.is_(True),
            )
        ).all()
    }
    pedidos = {e["module_code"] for e in entradas}
    if pedidos - activos:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Esta aseguradora no tiene contratado alguno de los módulos enviados",
        )
    # El SLA es obligatorio para TODO módulo contratado: no se guarda la tabla a
    # medias. Los que falten se nombran, para no mandar a buscarlos.
    faltan = activos - pedidos
    if faltan:
        nombres = db.scalars(
            select(Module.nombre).where(Module.code.in_(faltan)).order_by(Module.orden)
        ).all()
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                f"Falta el SLA de: {', '.join(nombres)}. "
                "Es obligatorio en cada módulo contratado"
            ),
        )

    existentes = {
        fila.module_code: fila
        for fila in db.scalars(
            select(AseguradoraSla).where(AseguradoraSla.aseguradora_id == aseguradora_id)
        ).all()
    }
    cambios: dict[str, Any] = {}
    for entrada in entradas:
        code = entrada["module_code"]
        horas, precio = entrada.get("horas"), entrada.get("precio")
        fila = existentes.get(code)
        if fila is None:
            db.add(
                AseguradoraSla(
                    aseguradora_id=aseguradora_id,
                    module_code=code,
                    horas=horas,
                    precio=precio,
                    created_by=autor,
                    updated_by=autor,
                )
            )
            cambios[code] = {"horas": horas, "precio": precio}
        elif fila.horas != horas or fila.precio != precio:
            fila.horas, fila.precio = horas, precio
            fila.updated_by = autor
            cambios[code] = {"horas": horas, "precio": precio}
    return cambios or None


def propia(db: DbSession) -> Aseguradora:
    """
    La ficha interna de Accumedical, dueña de la «Red convenio». La crea la
    migración f4a7b9d1e263; si no está, algo se rompió y se dice claro.
    """
    fila = db.scalar(
        select(Aseguradora).where(
            Aseguradora.es_propia.is_(True), Aseguradora.deleted_at.is_(None)
        )
    )
    if fila is None:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, detail="La ficha propia de Accumedical no existe"
        )
    return fila


def convenio_del_par(
    db: DbSession, aseguradora_id: uuid.UUID, prestador_id: uuid.UUID
) -> AseguradoraPrestador:
    """
    El convenio vivo entre ESA aseguradora y ESE prestador, o 404. Resolverlo
    por el par —y no por un id suelto— impide abrir el convenio de otra
    compañía con un identificador ajeno.
    """
    if redes_central.aplica(db, aseguradora_id):
        return redes_central.convenio_del_par(aseguradora_id, prestador_id)
    convenio = db.scalar(
        select(AseguradoraPrestador).where(
            AseguradoraPrestador.aseguradora_id == aseguradora_id,
            AseguradoraPrestador.prestador_id == prestador_id,
            AseguradoraPrestador.deleted_at.is_(None),
        )
    )
    if convenio is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Convenio no encontrado")
    return convenio


def fijar_convenios(
    db: DbSession,
    aseguradora_id: uuid.UUID,
    seleccion: list[dict[str, Any]],
    autor: uuid.UUID,
) -> dict[str, list[str]] | None:
    """
    Reconcilia la red completa: marcar crea el convenio (`vigente`); desmarcar
    lo retira con borrado lógico —la fila y sus valores quedan como historia—.
    Misma semántica que la reconciliación que existía del lado del prestador.

    Cada marcado trae además la red que cubre —privada, pública o las dos—, que
    se guarda en el alta y se puede corregir después desde la misma lista.
    Si la red vive en la central (la propia, o todas con REDES_EN_CENTRAL), se
    guarda allá (`central.redes`).
    """
    if redes_central.aplica(db, aseguradora_id):
        return redes_central.fijar(aseguradora_id, seleccion, autor)
    redes = {
        fila["prestador_id"]: (bool(fila["red_privada"]), bool(fila["red_publica"]))
        for fila in seleccion
    }
    deseados = set(redes)
    validos = set(db.scalars(select(Prestador.id).where(Prestador.deleted_at.is_(None))).all())
    if deseados - validos:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Hay prestadores desconocidos en la selección",
        )

    vivos = {
        convenio.prestador_id: convenio
        for convenio in db.scalars(
            select(AseguradoraPrestador).where(
                AseguradoraPrestador.aseguradora_id == aseguradora_id,
                AseguradoraPrestador.deleted_at.is_(None),
            )
        ).all()
    }

    habilitados: list[str] = []
    retirados: list[str] = []
    recolocados: list[str] = []
    for prestador_id, convenio in vivos.items():
        if prestador_id not in deseados:
            convenio.deleted_at = func.now()
            convenio.deleted_by = autor
            retirados.append(str(prestador_id))
            continue
        privada, publica = redes[prestador_id]
        if (convenio.red_privada, convenio.red_publica) != (privada, publica):
            convenio.red_privada = privada
            convenio.red_publica = publica
            convenio.updated_by = autor
            recolocados.append(str(prestador_id))
    for prestador_id in deseados:
        if prestador_id in vivos:
            continue
        privada, publica = redes[prestador_id]
        db.add(
            AseguradoraPrestador(
                aseguradora_id=aseguradora_id,
                prestador_id=prestador_id,
                estado="vigente",
                red_privada=privada,
                red_publica=publica,
                created_by=autor,
                updated_by=autor,
            )
        )
        habilitados.append(str(prestador_id))

    if not (habilitados or retirados or recolocados):
        return None
    return {"habilitados": habilitados, "retirados": retirados, "red_cambiada": recolocados}
