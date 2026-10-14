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

from fastapi import HTTPException, status
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
from app.shared.central import redes as redes_central
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
def _usar[T](
    operacion: str, local: Callable[[], T], central: Callable[[], T], *, respaldo: bool = True
) -> T:
    # Sin respaldo, la central es la DUEÑA (p. ej. la red con el paso 5a): la
    # copia local ya no vale, ni siquiera en modo «local».
    usa_central = settings.concurrencia_nucleo == "central" and settings.central_configurada
    if not usa_central and respaldo:
        return local()
    try:
        return central()
    except (CentralError, KeyError, ValueError) as error:
        if not respaldo:
            log.warning("nucleo_central_sin_respaldo", operacion=operacion,
                        estado=getattr(error, "estado", None), error=type(error).__name__)
            raise HTTPException(
                status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="La central no respondió: la red de convenios no está disponible",
            ) from error
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
        respaldo=not redes_central.todas(),
    )


def prestador_en_red(db: DbSession, aseguradora_id: uuid.UUID, prestador_id: uuid.UUID) -> bool:
    return _usar(
        "en_red",
        lambda: _Local.en_red(db, aseguradora_id, prestador_id),
        lambda: _Central.en_red(db, aseguradora_id, prestador_id),
        respaldo=not redes_central.todas(),
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


# ═══════════════════ Usuarios, bandeja y mapa (paso 4d) ══════════════════════
#
# Lo que Concurrencia necesita saber de PERSONAS de la plataforma (operadores,
# auditores, coordinadores, el creador del caso) y los NOMBRES con que pinta su
# bandeja. En modo central sale del directorio de la central (sin credenciales:
# la autenticación sigue en la plataforma).


def modo_central() -> bool:
    """La forma de las consultas de la bandeja depende de esto (sin JOIN al núcleo)."""
    return settings.concurrencia_nucleo == "central" and settings.central_configurada


def _usuario_ns(u: dict[str, Any]) -> Any:
    """Un usuario de la central con los mismos atributos que una fila de `users`."""
    return SimpleNamespace(
        id=uuid.UUID(u["id"]),
        email=u["email"],
        nombre_principal=u["nombre_principal"],
        nombre_secundario=u["nombre_secundario"],
        apellido_paterno=u["apellido_paterno"],
        apellido_materno=u["apellido_materno"],
        telefono=u["telefono"],
        provincia_codigo=u["provincia_codigo"],
        ciudad_codigo=u["ciudad_codigo"],
        is_superadmin=u["es_superadmin"],
        aseguradora_id=_uuid(u["aseguradora_id"]),
        is_active=u["activo"],
        deleted_at=u["deleted_at"],
    )


def _post(ruta: str, cuerpo: Any) -> Any:
    estado, r = cliente().llamar("POST", ruta, cuerpo)
    if estado != 200:
        raise CentralError(estado, f"POST {ruta}")
    return r


def _usuarios(ruta: str) -> list[Any]:
    return [_usuario_ns(u) for u in _get(ruta)]


def usuario(db: DbSession, usuario_id: uuid.UUID | None) -> Any | None:
    """Una persona de la plataforma por id (también dada de baja), o None."""
    if usuario_id is None:
        return None
    from app.shared.users.models import User

    def central() -> Any | None:
        estado, r = cliente().llamar("GET", f"/api/usuarios/{usuario_id}")
        if estado == 404:
            return None
        if estado != 200:
            raise CentralError(estado, "GET /api/usuarios/{id}")
        return _usuario_ns(r)

    return _usar("usuario", lambda: db.get(User, usuario_id), central)


def usuarios_por_ids(db: DbSession, ids: list[uuid.UUID]) -> list[Any]:
    """Varias personas por id, TAMBIÉN las desactivadas o dadas de baja (historiales)."""
    if not ids:
        return []
    from app.shared.users.models import User

    def local() -> list[Any]:
        return list(db.scalars(select(User).where(User.id.in_(ids))))

    def central() -> list[Any]:
        filas = _post("/api/usuarios/lote", {"ids": sorted(str(i) for i in ids)})
        return [_usuario_ns(u) for u in filas]

    return _usar("usuarios_lote", local, central)


def operadores_de_la_compania(db: DbSession, aseguradora_id: uuid.UUID) -> list[Any]:
    """Operadores de Concurrencia de esa compañía, también los inactivos (sus casos siguen)."""
    from app.shared.users.models import Role, User, UserModuleAccess

    def local() -> list[Any]:
        return list(
            db.scalars(
                select(User)
                .join(UserModuleAccess, UserModuleAccess.user_id == User.id)
                .join(Role, Role.id == UserModuleAccess.role_id)
                .where(
                    UserModuleAccess.module_code == MODULO,
                    UserModuleAccess.activo.is_(True),
                    Role.code == "operador",
                    User.aseguradora_id == aseguradora_id,
                    User.deleted_at.is_(None),
                )
                .order_by(personas.sql_completo(User))
            )
        )

    def central() -> list[Any]:
        filas = _usuarios(
            f"/api/usuarios?aplicacion={MODULO}&rol=operador&aseguradora_id={aseguradora_id}"
        )
        return sorted(filas, key=lambda u: (personas.de_fila(u), str(u.id)))

    return _usar("operadores", local, central)


def auditores_disponibles(db: DbSession) -> list[tuple[Any, ...]]:
    """Auditores de Concurrencia de Accumedical, activos, con su ciudad y provincia."""
    from sqlalchemy.orm import aliased

    from app.shared.users.models import Role, User, UserModuleAccess

    def local() -> list[tuple[Any, ...]]:
        ciudad = aliased(Ciudad)
        provincia = aliased(Provincia)
        return [
            tuple(f)
            for f in db.execute(
                select(User, ciudad.nombre, provincia.nombre)
                .join(UserModuleAccess, UserModuleAccess.user_id == User.id)
                .join(Role, Role.id == UserModuleAccess.role_id)
                .outerjoin(ciudad, ciudad.codigo == User.ciudad_codigo)
                .outerjoin(provincia, provincia.codigo == User.provincia_codigo)
                .where(
                    UserModuleAccess.module_code == MODULO,
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

    def central() -> list[tuple[Any, ...]]:
        ciudades = _catalogo("ciudades")
        provincias = _catalogo("provincias")
        filas = _usuarios(
            f"/api/usuarios?aplicacion={MODULO}&rol=auditor&plataforma=true"
            "&superadmin=false&activo=true"
        )
        return [
            (u, ciudades.get(u.ciudad_codigo or ""), provincias.get(u.provincia_codigo or ""))
            for u in filas
        ]

    return _usar("auditores", local, central)


def coordinadores_de_plataforma(db: DbSession) -> list[Any]:
    """Quién coordina Concurrencia en Accumedical (por el módulo o por la familia)."""
    from app.shared.auth import service as auth_service

    return _usar(
        "coordinadores_plataforma",
        lambda: auth_service.coordinadores_de_modulo(db, MODULO),
        lambda: _usuarios(f"/api/aplicaciones/{MODULO}/coordinadores"),
    )


def coordinadores_de_la_compania(db: DbSession, aseguradora_id: uuid.UUID) -> list[Any]:
    """Quién coordina esa compañía en Concurrencia (por el módulo o por la compañía)."""
    from app.shared.auth import service as auth_service

    return _usar(
        "coordinadores_compania",
        lambda: auth_service.coordinadores_de_aseguradora(db, aseguradora_id, MODULO),
        lambda: _usuarios(f"/api/aseguradoras/{aseguradora_id}/coordinadores?aplicacion={MODULO}"),
    )


def superadmins(db: DbSession) -> list[Any]:
    """Administradores globales activos y vivos."""
    from app.shared.users.models import User

    return _usar(
        "superadmins",
        lambda: list(
            db.scalars(
                select(User).where(
                    User.is_superadmin.is_(True),
                    User.is_active.is_(True),
                    User.deleted_at.is_(None),
                )
            )
        ),
        lambda: _usuarios("/api/usuarios?superadmin=true&activo=true"),
    )


# ── La bandeja: nombres de cada caso ────────────────────────────────────────
def prestadores_que_coinciden(db: DbSession, texto: str) -> list[uuid.UUID]:
    """Ids de prestadores cuyo nombre contiene el texto (para buscar en la bandeja)."""

    def central() -> list[uuid.UUID]:
        ids: list[uuid.UUID] = []
        offset = 0
        while offset < 1000:
            pagina = _get(_con_q("/api/prestadores?limit=100&todos=true", texto, offset))
            ids += [uuid.UUID(p["id"]) for p in pagina["items"]]
            offset += len(pagina["items"])
            if not pagina["items"] or offset >= pagina["total"]:
                break
        return ids

    return _usar(
        "buscar_prestadores",
        lambda: list(db.scalars(select(Prestador.id).where(Prestador.nombre.ilike(f"%{texto}%")))),
        central,
    )


def aseguradoras_que_coinciden(db: DbSession, texto: str) -> list[uuid.UUID]:
    """Ids de aseguradoras cuya razón social o nombre comercial contiene el texto."""

    def central() -> list[uuid.UUID]:
        pagina = _get(_con_q("/api/aseguradoras?limit=100&todas=true", texto, 0))
        return [uuid.UUID(a["id"]) for a in pagina["items"]]

    return _usar(
        "buscar_aseguradoras",
        lambda: list(
            db.scalars(
                select(Aseguradora.id).where(
                    or_(
                        Aseguradora.razon_social.ilike(f"%{texto}%"),
                        Aseguradora.nombre_comercial.ilike(f"%{texto}%"),
                    )
                )
            )
        ),
        central,
    )


def _con_q(ruta: str, texto: str, offset: int) -> str:
    from urllib.parse import quote

    return f"{ruta}&offset={offset}&q={quote(texto.strip()[:100])}"


def datos_de_casos(db: DbSession, visitas: list[Any]) -> dict[uuid.UUID, tuple[Any, ...]]:
    """
    Para cada caso, en el MISMO orden que tenían las columnas de la bandeja:
    (prestador, dirección, ciudad, provincia, sede, dirección de la sede, su
    ciudad, su provincia, razón social, nombre comercial, auditor).
    Tres llamadas en lote, no una por caso.
    """
    if not visitas:
        return {}
    from app.shared.users.models import User

    def local() -> dict[uuid.UUID, tuple[Any, ...]]:
        prest = {
            p.id: p
            for p in db.scalars(
                select(Prestador).where(Prestador.id.in_({v.prestador_id for v in visitas}))
            )
        }
        sedes = {
            s.id: s
            for s in db.scalars(
                select(PrestadorSede).where(
                    PrestadorSede.id.in_({v.sede_id for v in visitas if v.sede_id})
                )
            )
        }
        asegs = {
            a.id: a
            for a in db.scalars(
                select(Aseguradora).where(Aseguradora.id.in_({v.aseguradora_id for v in visitas}))
            )
        }
        auditores = {
            u.id: u
            for u in db.scalars(
                select(User).where(User.id.in_({v.auditor_id for v in visitas if v.auditor_id}))
            )
        }
        ciudades = dict(db.execute(select(Ciudad.codigo, Ciudad.nombre)).all())
        provincias = dict(db.execute(select(Provincia.codigo, Provincia.nombre)).all())
        return _armar(visitas, prest, sedes, asegs, auditores, ciudades, provincias)

    def central() -> dict[uuid.UUID, tuple[Any, ...]]:
        prest: dict[uuid.UUID, Any] = {}
        sedes: dict[uuid.UUID, Any] = {}
        for p in _post(
            "/api/prestadores/lote", {"ids": sorted({str(v.prestador_id) for v in visitas})}
        ):
            prest[uuid.UUID(p["id"])] = SimpleNamespace(
                **{
                    k: p[k]
                    for k in (
                        "nombre",
                        "direccion",
                        "ciudad_codigo",
                        "provincia_codigo",
                        "latitud",
                        "longitud",
                    )
                }
            )
            for s in p["sedes"]:
                sedes[uuid.UUID(s["id"])] = SimpleNamespace(
                    **{
                        k: s[k]
                        for k in (
                            "nombre",
                            "direccion",
                            "ciudad_codigo",
                            "provincia_codigo",
                            "latitud",
                            "longitud",
                        )
                    }
                )
        asegs = {
            uuid.UUID(a["id"]): SimpleNamespace(
                razon_social=a["razon_social"], nombre_comercial=a["nombre_comercial"]
            )
            for a in _post(
                "/api/aseguradoras/lote", {"ids": sorted({str(v.aseguradora_id) for v in visitas})}
            )
        }
        ids_auditores = sorted({str(v.auditor_id) for v in visitas if v.auditor_id})
        auditores = {
            u.id: u
            for u in (
                [_usuario_ns(x) for x in _post("/api/usuarios/lote", {"ids": ids_auditores})]
                if ids_auditores
                else []
            )
        }
        return _armar(
            visitas, prest, sedes, asegs, auditores, _catalogo("ciudades"), _catalogo("provincias")
        )

    return _usar("datos_de_casos", local, central)


def _armar(visitas, prest, sedes, asegs, auditores, ciudades, provincias):  # noqa: ANN001, ANN202
    salida: dict[uuid.UUID, tuple[Any, ...]] = {}
    for v in visitas:
        p = prest.get(v.prestador_id)
        s = sedes.get(v.sede_id) if v.sede_id else None
        a = asegs.get(v.aseguradora_id)
        u = auditores.get(v.auditor_id) if v.auditor_id else None
        salida[v.id] = (
            p.nombre if p else None,
            p.direccion if p else None,
            ciudades.get(p.ciudad_codigo) if p and p.ciudad_codigo else None,
            provincias.get(p.provincia_codigo) if p and p.provincia_codigo else None,
            s.nombre if s else None,
            s.direccion if s else None,
            ciudades.get(s.ciudad_codigo) if s and s.ciudad_codigo else None,
            provincias.get(s.provincia_codigo) if s and s.provincia_codigo else None,
            a.razon_social if a else None,
            a.nombre_comercial if a else None,
            # Sin auditor: cadena vacía, igual que el CONCAT de la consulta SQL original.
            personas.de_fila(u) if u else "",
        )
    return salida


def coordenadas(db: DbSession, visitas: list[Any]) -> dict[uuid.UUID, tuple[float, float]]:
    """El punto al que va el auditor: la sede si la hay, la casa matriz si no."""

    def local() -> dict[uuid.UUID, tuple[float, float]]:
        prest = dict(
            (i, (float(a), float(b)))
            for i, a, b in db.execute(
                select(Prestador.id, Prestador.latitud, Prestador.longitud).where(
                    Prestador.id.in_({v.prestador_id for v in visitas if v.sede_id is None})
                )
            )
        )
        sedes = dict(
            (i, (float(a), float(b)))
            for i, a, b in db.execute(
                select(PrestadorSede.id, PrestadorSede.latitud, PrestadorSede.longitud).where(
                    PrestadorSede.id.in_({v.sede_id for v in visitas if v.sede_id})
                )
            )
        )
        return _punto(visitas, prest, sedes)

    def central() -> dict[uuid.UUID, tuple[float, float]]:
        prest: dict[uuid.UUID, tuple[float, float]] = {}
        sedes: dict[uuid.UUID, tuple[float, float]] = {}
        for p in _post(
            "/api/prestadores/lote", {"ids": sorted({str(v.prestador_id) for v in visitas})}
        ):
            prest[uuid.UUID(p["id"])] = (float(p["latitud"]), float(p["longitud"]))
            for s in p["sedes"]:
                sedes[uuid.UUID(s["id"])] = (float(s["latitud"]), float(s["longitud"]))
        return _punto(visitas, prest, sedes)

    if not visitas:
        return {}
    return _usar("coordenadas", local, central)


def _punto(visitas, prest, sedes):  # noqa: ANN001, ANN202
    salida: dict[uuid.UUID, tuple[float, float]] = {}
    for v in visitas:
        punto = sedes.get(v.sede_id) if v.sede_id else prest.get(v.prestador_id)
        if punto:
            salida[v.id] = punto
    return salida
