from __future__ import annotations

import uuid
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import Select, func, or_, select
from sqlalchemy.orm import Session as DbSession

from app.shared.aseguradoras.models import AseguradoraPrestador
from app.shared.catalogos.models import Ciudad, Provincia, TipoPrestador
from app.shared.central import redes as redes_central
from app.shared.contactos import service as contactos
from app.shared.geo import prohibir_vaciar
from app.shared.prestadores import convenios as convenios_service
from app.shared.prestadores import sedes as sedes_service
from app.shared.prestadores.models import Prestador, PrestadorContacto, PrestadorSede

MAX_PAGE_SIZE = 100


def _base_select() -> Select:
    """Listado y detalle comparten el mismo join a los catálogos."""
    return (
        select(Prestador, Provincia.nombre, Ciudad.nombre, TipoPrestador.nombre)
        .select_from(Prestador)
        .outerjoin(Provincia, Provincia.codigo == Prestador.provincia_codigo)
        .outerjoin(Ciudad, Ciudad.codigo == Prestador.ciudad_codigo)
        .join(TipoPrestador, TipoPrestador.codigo == Prestador.tipo_codigo)
        .where(Prestador.deleted_at.is_(None))
    )


def listar(
    db: DbSession,
    *,
    search: str | None = None,
    estado: str | None = None,
    tipo_codigo: str | None = None,
    provincia_codigo: str | None = None,
    page: int = 1,
    page_size: int = 20,
) -> tuple[list[tuple[Any, ...]], int]:
    consulta = _base_select()

    if search:
        # ILIKE parametrizado, jamás interpolación. El índice GIN trigram sobre
        # `nombre` evita el seq scan.
        patron = f"%{search.strip()}%"
        consulta = consulta.where(
            or_(
                Prestador.nombre.ilike(patron),
                Prestador.ruc.ilike(patron),
                Prestador.codigo_interno.ilike(patron),
            )
        )
    if estado:
        consulta = consulta.where(Prestador.estado == estado)
    if tipo_codigo:
        consulta = consulta.where(Prestador.tipo_codigo == tipo_codigo)
    if provincia_codigo:
        consulta = consulta.where(Prestador.provincia_codigo == provincia_codigo)

    sub = consulta.subquery()
    total = db.scalar(select(func.count()).select_from(sub)) or 0

    page = max(1, page)
    page_size = min(max(1, page_size), MAX_PAGE_SIZE)
    filas = db.execute(
        consulta.order_by(Prestador.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()
    return [tuple(f) for f in filas], total


def puntos_del_mapa(
    db: DbSession, *, aseguradora_id: uuid.UUID | None = None
) -> list[dict[str, Any]]:
    """
    Cada sitio donde se atiende, con su punto en el mapa: **la sede principal del
    prestador y además cada una de sus sedes**, que pueden estar en otra ciudad e
    incluso en otra provincia. Por eso el mapa no pinta un punto por prestador
    sino uno por sitio: un hospital con tres sucursales son cuatro puntos.

    Con `aseguradora_id` solo salen los prestadores que tienen convenio VIVO con
    esa compañía —es lo que pide «Red convenio»—; sin él, todo el catálogo.

    Va en una consulta por tabla y no en una unión: son dos formas distintas
    —una sede tiene nombre propio y provincia obligatoria— y juntarlas en SQL
    obligaría a rellenar columnas de mentira en cada lado.
    """
    en_red: set[uuid.UUID] | None = None
    if aseguradora_id is not None and redes_central.aplica(db, aseguradora_id):
        en_red = redes_central.prestadores_en_red(aseguradora_id)
        if not en_red:
            return []
    elif aseguradora_id is not None:
        en_red = set(
            db.scalars(
                select(AseguradoraPrestador.prestador_id).where(
                    AseguradoraPrestador.aseguradora_id == aseguradora_id,
                    AseguradoraPrestador.deleted_at.is_(None),
                )
            ).all()
        )
        # Sin convenios no hay nada que pintar, y sin este corte el `in_()` de
        # abajo con lista vacía devolvería igualmente todo el catálogo.
        if not en_red:
            return []

    def punto(
        *,
        prestador: Prestador,
        sede: PrestadorSede | None,
        provincia: str | None,
        ciudad: str | None,
        tipo: str,
    ) -> dict[str, Any]:
        origen = sede or prestador
        return {
            "prestador_id": str(prestador.id),
            "codigo_interno": prestador.codigo_interno,
            "nombre": prestador.nombre,
            "tipo_nombre": tipo,
            "estado": prestador.estado,
            # El nombre de la sede, o None cuando el punto es el del prestador.
            "sede_nombre": sede.nombre if sede else None,
            "direccion": origen.direccion,
            "provincia_codigo": origen.provincia_codigo,
            "provincia_nombre": provincia,
            "ciudad_codigo": origen.ciudad_codigo,
            "ciudad_nombre": ciudad,
            "latitud": float(origen.latitud),
            "longitud": float(origen.longitud),
        }

    consulta = _base_select()
    if en_red is not None:
        consulta = consulta.where(Prestador.id.in_(en_red))
    puntos = [
        punto(prestador=p, sede=None, provincia=provincia, ciudad=ciudad, tipo=tipo)
        for p, provincia, ciudad, tipo in db.execute(consulta).all()
    ]

    tipos = {p["prestador_id"]: p["tipo_nombre"] for p in puntos}
    sedes = (
        select(PrestadorSede, Prestador, Provincia.nombre, Ciudad.nombre)
        .select_from(PrestadorSede)
        .join(Prestador, Prestador.id == PrestadorSede.prestador_id)
        .outerjoin(Provincia, Provincia.codigo == PrestadorSede.provincia_codigo)
        .outerjoin(Ciudad, Ciudad.codigo == PrestadorSede.ciudad_codigo)
        .where(
            PrestadorSede.deleted_at.is_(None),
            Prestador.deleted_at.is_(None),
            # Una sede apagada no se pinta: el mapa enseña dónde se atiende.
            PrestadorSede.estado == "activa",
        )
    )
    if en_red is not None:
        sedes = sedes.where(Prestador.id.in_(en_red))
    puntos.extend(
        punto(
            prestador=prestador,
            sede=sede,
            provincia=provincia,
            ciudad=ciudad,
            tipo=tipos.get(str(prestador.id), ""),
        )
        for sede, prestador, provincia, ciudad in db.execute(sedes).all()
    )
    # Por provincia, ciudad y nombre: es el orden en que se leen en el panel.
    puntos.sort(
        key=lambda p: (
            p["provincia_nombre"] or "",
            p["ciudad_nombre"] or "",
            p["nombre"],
            p["sede_nombre"] or "",
        )
    )
    return puntos


def obtener(db: DbSession, prestador_id: uuid.UUID) -> tuple[Any, ...]:
    fila = db.execute(_base_select().where(Prestador.id == prestador_id)).first()
    if fila is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Prestador no encontrado")
    return tuple(fila)


def _validar_ubicacion(db: DbSession, provincia: str | None, ciudad: str | None) -> None:
    """
    La FK compuesta ya lo impide en la base, pero esa violación llegaría como un
    error de integridad ilegible. Aquí se comprueba antes para dar un mensaje útil.
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


def _tipo_valido(db: DbSession, tipo: str | None) -> None:
    """El tipo sigue viniendo del catálogo, aunque ya no gobierne campos."""
    if not tipo:
        return
    existe = db.scalar(
        select(func.count())
        .select_from(TipoPrestador)
        .where(TipoPrestador.codigo == tipo, TipoPrestador.activo.is_(True))
    )
    if not existe:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"Tipo de prestador desconocido: {tipo}"
        )


def _ruc_disponible(db: DbSession, ruc: str, excluir: uuid.UUID | None = None) -> bool:
    consulta = (
        select(func.count())
        .select_from(Prestador)
        .where(Prestador.ruc == ruc, Prestador.deleted_at.is_(None))
    )
    if excluir is not None:
        consulta = consulta.where(Prestador.id != excluir)
    return not db.scalar(consulta)


def crear(db: DbSession, datos: dict[str, Any], autor: uuid.UUID) -> Prestador:
    _validar_ubicacion(db, datos.get("provincia_codigo"), datos.get("ciudad_codigo"))
    _tipo_valido(db, datos.get("tipo_codigo"))
    if not _ruc_disponible(db, datos["ruc"]):
        raise HTTPException(status.HTTP_409_CONFLICT, detail="Ya existe un prestador con ese RUC")

    prestador = Prestador(**datos, created_by=autor, updated_by=autor)
    db.add(prestador)
    db.flush()
    # El código interno lo genera la secuencia de la base: hay que releerlo.
    db.refresh(prestador)
    return prestador


def actualizar(
    db: DbSession, prestador: Prestador, cambios: dict[str, Any], autor: uuid.UUID
) -> dict[str, Any]:
    prohibir_vaciar(cambios)
    resultante = {
        campo: cambios.get(campo, getattr(prestador, campo))
        for campo in ("tipo_codigo", "provincia_codigo", "ciudad_codigo", "ruc")
    }
    # Se valida el estado RESULTANTE, no cada campo suelto: cambiar de provincia
    # sin cambiar de ciudad dejaría una ciudad huérfana de otra provincia.
    _validar_ubicacion(db, resultante["provincia_codigo"], resultante["ciudad_codigo"])
    _tipo_valido(db, resultante["tipo_codigo"])
    if "ruc" in cambios and not _ruc_disponible(db, resultante["ruc"], excluir=prestador.id):
        raise HTTPException(
            status.HTTP_409_CONFLICT, detail="Ya existe un prestador con ese RUC"
        )

    diff: dict[str, Any] = {"antes": {}, "despues": {}}
    for campo, valor in cambios.items():
        anterior = getattr(prestador, campo)
        if anterior != valor:
            diff["antes"][campo] = anterior
            diff["despues"][campo] = valor
            setattr(prestador, campo, valor)

    if diff["despues"]:
        prestador.updated_by = autor
    return diff


def eliminar(db: DbSession, prestador: Prestador, autor: uuid.UUID) -> None:
    """Borrado lógico. Jamás DELETE físico."""
    prestador.deleted_at = func.now()
    prestador.deleted_by = autor


# ──────────────────────────────── Contactos ──────────────────────────────────


def contactos_de(db: DbSession, prestador_id: uuid.UUID) -> list[PrestadorContacto]:
    return contactos.listar(db, PrestadorContacto, "prestador_id", prestador_id)


def nombres_tipos_documento(db: DbSession) -> dict[str, str]:
    return contactos.nombres_tipos_documento(db)


def fijar_contactos(
    db: DbSession, prestador_id: uuid.UUID, entrantes: list[dict[str, Any]], autor: uuid.UUID
) -> dict[str, int] | None:
    return contactos.fijar(db, PrestadorContacto, "prestador_id", prestador_id, entrantes, autor)


# ────────────────────────────────── Sedes ────────────────────────────────────


def sedes_de(db: DbSession, prestador_id: uuid.UUID) -> list[PrestadorSede]:
    return sedes_service.listar(db, prestador_id)


def nombres_de_ubicacion(
    db: DbSession, pares: list[tuple[str, str]]
) -> tuple[dict[str, str], dict[str, str]]:
    """
    Nombres de provincia y ciudad para pintar las sedes. Dos consultas en total,
    no dos por sede: el detalle de un prestador con diez sedes haría veintiuna.
    """
    if not pares:
        return {}, {}
    provincias = {p for p, _ in pares}
    ciudades = {c for _, c in pares}
    nombres_provincia = dict(
        db.execute(
            select(Provincia.codigo, Provincia.nombre).where(Provincia.codigo.in_(provincias))
        ).all()
    )
    nombres_ciudad = dict(
        db.execute(select(Ciudad.codigo, Ciudad.nombre).where(Ciudad.codigo.in_(ciudades))).all()
    )
    return nombres_provincia, nombres_ciudad


def fijar_sedes(
    db: DbSession, prestador_id: uuid.UUID, entrantes: list[dict[str, Any]], autor: uuid.UUID
) -> dict[str, int] | None:
    return sedes_service.fijar(db, prestador_id, entrantes, autor)


# ──────────────────────────── Convenios ──────────────────────────────────────


def aseguradoras_de(db: DbSession, prestador_id: uuid.UUID) -> list[tuple[Any, ...]]:
    return convenios_service.listar(db, prestador_id)


def convenios_de_prestador(db: DbSession, prestador_id: uuid.UUID) -> list[dict[str, Any]]:
    return convenios_service.convenios_de_prestador(db, prestador_id)


def fijar_convenios_de_prestador(
    db: DbSession, prestador_id: uuid.UUID, seleccion: list[dict[str, Any]], autor: uuid.UUID
) -> dict[str, list[str]] | None:
    return convenios_service.fijar_convenios_de_prestador(db, prestador_id, seleccion, autor)
