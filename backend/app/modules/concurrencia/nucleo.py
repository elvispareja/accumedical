"""
De dónde saca Concurrencia lo que no es suyo: compañías, red de prestadores,
sedes, contactos y SLA (paso 4c de la separación).

Dos fuentes con el MISMO contrato, elegidas con `CONCURRENCIA_NUCLEO`:

  local    las tablas del núcleo de esta base (el comportamiento de siempre).
  central  la API central (accumedical-central), que hoy es réplica fiel del
           núcleo (paso 4b) y mañana será la fuente.

Con `central`, si la central falla (caída, error, o un dato recién creado que
la réplica aún no llevó) se usa `local` y queda un aviso en el log: durante la
transición Concurrencia nunca se queda sin poder programar.

Lo que devuelve imita las filas de antes (atributos con los mismos nombres)
para que router y servicio no cambien.
"""

from __future__ import annotations

import threading
import time
import uuid
from collections.abc import Callable
from decimal import Decimal
from types import SimpleNamespace
from typing import Any

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session as DbSession

from app.core.central import CentralError, cliente
from app.core.config import settings
from app.core.logging import log
from app.shared import personas
from app.shared.aseguradoras.models import (
    Aseguradora,
    AseguradoraModulo,
    AseguradoraPrestador,
    AseguradoraSla,
)
from app.shared.catalogos.models import Ciudad, Provincia, TipoPrestador
from app.shared.prestadores.models import Prestador, PrestadorContacto, PrestadorSede

MODULO = "concurrencia"


# ═════════════════════════════ Fuente local ═════════════════════════════════
class _Local:
    @staticmethod
    def aseguradoras(db: DbSession, aseguradora_id: uuid.UUID | None) -> list[Any]:
        consulta = (
            select(Aseguradora)
            .join(AseguradoraModulo, AseguradoraModulo.aseguradora_id == Aseguradora.id)
            .where(
                AseguradoraModulo.module_code == MODULO,
                AseguradoraModulo.activo.is_(True),
                Aseguradora.deleted_at.is_(None),
                Aseguradora.estado == "activo",
            )
            .order_by(Aseguradora.razon_social)
        )
        if aseguradora_id is not None:
            consulta = consulta.where(Aseguradora.id == aseguradora_id)
        return list(db.scalars(consulta).all())

    @staticmethod
    def red(db: DbSession, aseguradora_id: uuid.UUID, search: str | None) -> list[dict[str, Any]]:
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
        sedes = _Local._sedes(db, ids)
        contactos = _Local._contactos(db, ids)
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

    @staticmethod
    def _sedes(db: DbSession, ids: list[uuid.UUID]) -> dict[uuid.UUID, list[tuple[Any, ...]]]:
        """Un solo viaje para todas las sedes, no uno por prestador."""
        filas = db.execute(
            select(PrestadorSede, Ciudad.nombre, Provincia.nombre)
            .outerjoin(Ciudad, Ciudad.codigo == PrestadorSede.ciudad_codigo)
            .outerjoin(Provincia, Provincia.codigo == PrestadorSede.provincia_codigo)
            .where(
                PrestadorSede.prestador_id.in_(ids),
                PrestadorSede.deleted_at.is_(None),
                # Una sede inactiva no es sitio al que mandar a nadie.
                PrestadorSede.estado == "activa",
            )
            .order_by(PrestadorSede.nombre)
        ).all()
        por: dict[uuid.UUID, list[tuple[Any, ...]]] = {}
        for sede, ciudad, provincia in filas:
            por.setdefault(sede.prestador_id, []).append((sede, ciudad, provincia))
        return por

    @staticmethod
    def _contactos(db: DbSession, ids: list[uuid.UUID]) -> dict[uuid.UUID, list[Any]]:
        """Por nombre y no por antigüedad: se busca a una persona entre veinte."""
        filas = db.scalars(
            select(PrestadorContacto)
            .where(PrestadorContacto.prestador_id.in_(ids), PrestadorContacto.deleted_at.is_(None))
            .order_by(personas.sql_completo(PrestadorContacto), PrestadorContacto.id)
        ).all()
        por: dict[uuid.UUID, list[Any]] = {}
        for c in filas:
            por.setdefault(c.prestador_id, []).append(c)
        return por

    @staticmethod
    def en_red(db: DbSession, aseguradora_id: uuid.UUID, prestador_id: uuid.UUID) -> bool:
        return bool(
            db.scalar(
                select(func.count())
                .select_from(AseguradoraPrestador)
                .where(
                    AseguradoraPrestador.aseguradora_id == aseguradora_id,
                    AseguradoraPrestador.prestador_id == prestador_id,
                    AseguradoraPrestador.deleted_at.is_(None),
                    AseguradoraPrestador.estado == "vigente",
                )
            )
        )

    @staticmethod
    def sedes_activas(db: DbSession, prestador_id: uuid.UUID) -> list[uuid.UUID]:
        return list(
            db.scalars(
                select(PrestadorSede.id).where(
                    PrestadorSede.prestador_id == prestador_id,
                    PrestadorSede.deleted_at.is_(None),
                    PrestadorSede.estado == "activa",
                )
            ).all()
        )

    @staticmethod
    def horas_sla(db: DbSession, aseguradora_id: uuid.UUID) -> Decimal | None:
        return db.scalar(
            select(AseguradoraSla.horas).where(
                AseguradoraSla.aseguradora_id == aseguradora_id,
                AseguradoraSla.module_code == MODULO,
            )
        )

    @staticmethod
    def nombre_prestador(db: DbSession, prestador_id: uuid.UUID) -> str | None:
        return db.scalar(select(Prestador.nombre).where(Prestador.id == prestador_id))


# ════════════════════════════ Fuente central ════════════════════════════════
_cache: dict[str, tuple[float, Any]] = {}
_cache_candado = threading.Lock()
_CACHE_SEG = 600  # catálogos: cambian poco


def _get(ruta: str) -> Any:
    estado, r = cliente().llamar("GET", ruta)
    if estado != 200:
        raise CentralError(estado, f"GET {ruta.split('?')[0]}")
    return r


def _catalogo(nombre: str) -> dict[str, str]:
    """codigo → nombre de un catálogo de la central, con caché de 10 minutos."""
    with _cache_candado:
        hit = _cache.get(nombre)
        if hit and time.monotonic() - hit[0] < _CACHE_SEG:
            return hit[1]
    valor = {f["codigo"]: f["nombre"] for f in _get(f"/api/catalogos/{nombre}")}
    with _cache_candado:
        _cache[nombre] = (time.monotonic(), valor)
    return valor


def _uuid(valor: str | None) -> uuid.UUID | None:
    return uuid.UUID(valor) if valor else None


class _Central:
    @staticmethod
    def aseguradoras(db: DbSession, aseguradora_id: uuid.UUID | None) -> list[Any]:
        filas: list[dict[str, Any]] = []
        offset = 0
        while True:
            pagina = _get(
                f"/api/aseguradoras?aplicacion={MODULO}&estado=activo&limit=100&offset={offset}"
            )
            filas += pagina["items"]
            offset += len(pagina["items"])
            if not pagina["items"] or offset >= pagina["total"]:
                break
        filas.sort(key=lambda a: a["razon_social"])
        return [
            SimpleNamespace(
                id=uuid.UUID(a["id"]),
                codigo_interno=a["codigo_interno"],
                razon_social=a["razon_social"],
                nombre_comercial=a["nombre_comercial"],
                estado=a["estado"],
            )
            for a in filas
            if aseguradora_id is None or uuid.UUID(a["id"]) == aseguradora_id
        ]

    @staticmethod
    def red(db: DbSession, aseguradora_id: uuid.UUID, search: str | None) -> list[dict[str, Any]]:
        tipos = _catalogo("tipos-prestador")
        provincias = _catalogo("provincias")
        ciudades = _catalogo("ciudades")
        texto = (search or "").strip().casefold()
        salida = []
        for conv in _get(f"/api/aseguradoras/{aseguradora_id}/convenios?estado=vigente"):
            p = _get(f"/api/prestadores/{conv['prestador_id']}")
            if texto and texto not in p["nombre"].casefold() and texto not in p["ruc"].casefold():
                continue
            prestador = SimpleNamespace(
                id=uuid.UUID(p["id"]),
                codigo_interno=p["codigo_interno"],
                nombre=p["nombre"],
                ruc=p["ruc"],
                direccion=p["direccion"],
            )
            sedes = [
                (
                    SimpleNamespace(
                        id=uuid.UUID(s["id"]),
                        prestador_id=prestador.id,
                        nombre=s["nombre"],
                        direccion=s["direccion"],
                        estado=s["estado"],
                    ),
                    ciudades.get(s["ciudad_codigo"]),
                    provincias.get(s["provincia_codigo"]),
                )
                for s in p["sedes"]
                if s["estado"] == "activa"
            ]
            contactos = sorted(
                (SimpleNamespace(prestador_id=prestador.id, **c) for c in p["contactos"]),
                key=lambda c: (personas.de_fila(c), str(c.id)),
            )
            for c in contactos:
                c.id = uuid.UUID(str(c.id))
            salida.append(
                {
                    "prestador": prestador,
                    "tipo_nombre": tipos.get(p["tipo_codigo"]),
                    "ciudad_nombre": ciudades.get(p["ciudad_codigo"])
                    if p["ciudad_codigo"]
                    else None,
                    "provincia_nombre": provincias.get(p["provincia_codigo"])
                    if p["provincia_codigo"]
                    else None,
                    "sedes": sorted(sedes, key=lambda t: t[0].nombre),
                    "contactos": contactos,
                }
            )
        salida.sort(key=lambda f: f["prestador"].nombre)
        return salida

    @staticmethod
    def en_red(db: DbSession, aseguradora_id: uuid.UUID, prestador_id: uuid.UUID) -> bool:
        # Igual que la fuente local: basta un convenio vivo y vigente (no se mira el
        # estado del prestador, para no cambiar la regla de guardado).
        return any(
            _uuid(c["aseguradora_id"]) == aseguradora_id and c["estado"] == "vigente"
            for c in _get(f"/api/prestadores/{prestador_id}/convenios")
        )

    @staticmethod
    def sedes_activas(db: DbSession, prestador_id: uuid.UUID) -> list[uuid.UUID]:
        p = _get(f"/api/prestadores/{prestador_id}")
        return [uuid.UUID(s["id"]) for s in p["sedes"] if s["estado"] == "activa"]

    @staticmethod
    def horas_sla(db: DbSession, aseguradora_id: uuid.UUID) -> Decimal | None:
        for a in _get(f"/api/aseguradoras/{aseguradora_id}/aplicaciones"):
            if a["aplicacion_codigo"] == MODULO and a["sla"]:
                return Decimal(str(a["sla"]["horas"]))
        return None

    @staticmethod
    def nombre_prestador(db: DbSession, prestador_id: uuid.UUID) -> str | None:
        return _get(f"/api/prestadores/{prestador_id}")["nombre"]


# ═════════════════════════════ Selector ═════════════════════════════════════
def _usar[T](operacion: str, local: Callable[[], T], central: Callable[[], T]) -> T:
    if settings.concurrencia_nucleo != "central" or not settings.central_configurada:
        return local()
    try:
        return central()
    except (CentralError, KeyError, ValueError) as error:
        # Sin datos personales: la operación y el código de error, nada más.
        log.warning(
            "nucleo_central_respaldo_local",
            operacion=operacion,
            estado=getattr(error, "estado", None),
            error=type(error).__name__,
        )
        return local()


def aseguradoras_con_concurrencia(
    db: DbSession, aseguradora_id: uuid.UUID | None = None
) -> list[Any]:
    return _usar(
        "aseguradoras",
        lambda: _Local.aseguradoras(db, aseguradora_id),
        lambda: _Central.aseguradoras(db, aseguradora_id),
    )


def prestadores_de_la_red(
    db: DbSession, aseguradora_id: uuid.UUID, search: str | None = None
) -> list[dict[str, Any]]:
    return _usar(
        "red",
        lambda: _Local.red(db, aseguradora_id, search),
        lambda: _Central.red(db, aseguradora_id, search),
    )


def prestador_en_red(db: DbSession, aseguradora_id: uuid.UUID, prestador_id: uuid.UUID) -> bool:
    return _usar(
        "en_red",
        lambda: _Local.en_red(db, aseguradora_id, prestador_id),
        lambda: _Central.en_red(db, aseguradora_id, prestador_id),
    )


def sedes_activas(db: DbSession, prestador_id: uuid.UUID) -> list[uuid.UUID]:
    return _usar(
        "sedes",
        lambda: _Local.sedes_activas(db, prestador_id),
        lambda: _Central.sedes_activas(db, prestador_id),
    )


def horas_sla(db: DbSession, aseguradora_id: uuid.UUID) -> Decimal | None:
    return _usar(
        "sla",
        lambda: _Local.horas_sla(db, aseguradora_id),
        lambda: _Central.horas_sla(db, aseguradora_id),
    )


def nombre_prestador(db: DbSession, prestador_id: uuid.UUID) -> str | None:
    return _usar(
        "nombre_prestador",
        lambda: _Local.nombre_prestador(db, prestador_id),
        lambda: _Central.nombre_prestador(db, prestador_id),
    )


def aseguradora(db: DbSession, aseguradora_id: uuid.UUID) -> Any | None:
    """La compañía (razón social y nombre comercial) para textos y avisos."""

    def central() -> Any:
        a = _get(f"/api/aseguradoras/{aseguradora_id}")
        return SimpleNamespace(
            id=aseguradora_id,
            razon_social=a["razon_social"],
            nombre_comercial=a["nombre_comercial"],
        )

    return _usar("aseguradora", lambda: db.get(Aseguradora, aseguradora_id), central)
