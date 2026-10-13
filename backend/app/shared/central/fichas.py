"""
Fichas de aseguradoras y prestadores (con contactos y sedes) y lo contratado
por cada aseguradora (módulos, SLA, coberturas): la central es la DUEÑA y esta
base guarda un ESPEJO (pasos 5b y 5c, `FICHAS_EN_CENTRAL`).

Por qué un espejo y no borrar las tablas: los usuarios, los casos de
Concurrencia, las pólizas, el SLA… tienen llaves foráneas a estas filas y las
leen en cientos de consultas. Se quedan, pero ya no mandan:

1. CENTRAL PRIMERO. Cualquier cambio a esas tablas, venga de la pantalla
   que venga, se publica en la central (`PUT /api/fichas/{entidad}`) justo antes
   de confirmar la transacción local (evento `before_commit` de la sesión). Si
   la central no responde o lo rechaza, la transacción local NO se confirma:
   503 / 409 / 422 al usuario y nada cambió en ningún lado.
2. La réplica periódica deja de enviar estas tablas.
3. `verificar` compara el espejo con la central y, con `reparar`, trae la
   versión de la central (gana la central). Corre cada pocos minutos y con
   `python -m app.cli verificar-fichas [--reparar]`.

El evento cubre TODAS las escrituras por el ORM (ninguna pantalla hace UPDATE
masivo a estas tablas). Las filas se leen con las mismas consultas de la
réplica, ya dentro de la transacción: la central recibe exactamente lo que se
va a confirmar aquí.
"""

from __future__ import annotations

import json
import uuid
from itertools import chain
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import event, inspect, text
from sqlalchemy.orm import Session

from app.core.central import CentralError, ClienteCentral, cliente_plataforma
from app.core.config import settings
from app.core.logging import log
from app.shared.aseguradoras.models import (
    Aseguradora,
    AseguradoraCobertura,
    AseguradoraContacto,
    AseguradoraModulo,
    AseguradoraSla,
)
from app.shared.catalogos.models import TipoPrestador
from app.shared.central import replicacion
from app.shared.prestadores.models import Prestador, PrestadorContacto, PrestadorSede
from app.shared.users.models import (
    User,
    UserAseguradoraCoordinador,
    UserGrupoAccess,
    UserModuleAccess,
)


class _Ficha:
    """Cómo se publica y se repara cada tabla."""

    def __init__(self, tabla: str, filtro: str, llave: tuple[str, ...],
                 renombres: dict[str, str] | None = None, *,
                 perfil: frozenset[str] | None = None, ignorar: tuple[str, ...] = (),
                 solo_actualizar: bool = False, actualizar_sql: str | None = None) -> None:
        self.tabla = tabla  # tabla local
        self.filtro = filtro  # columna por la que se eligen las filas a publicar
        self.llave = llave  # llave primaria, con los nombres de la CENTRAL
        self.renombres = renombres or {}  # nombre en la central → columna local
        # Solo estos atributos (del modelo local) obligan a publicar una fila MODIFICADA;
        # None = cualquiera. Así un login (último acceso, intentos) no pasa por la central.
        self.perfil = perfil
        self.ignorar = ignorar  # columnas (de la central) que no cuentan al comparar
        # Reparar solo actualiza filas existentes: la central no guarda todo lo que
        # una fila local necesita (contraseña, quién otorgó un acceso…).
        self.solo_actualizar = solo_actualizar
        self.actualizar_sql = actualizar_sql  # UPDATE a medida (p. ej. traducir el rol)


_APP = {"aplicacion_codigo": "module_code"}
# Orden de dependencias: la ficha antes que sus contactos, sedes y lo contratado.
FICHAS: dict[str, _Ficha] = {
    # El catálogo de tipos de prestador (Parámetros en admin) va PRIMERO: los
    # prestadores lo referencian.
    "tipos_prestador": _Ficha("tipos_prestador", "codigo", ("codigo",)),
    "aseguradoras": _Ficha("aseguradoras", "id", ("id",)),
    "aseguradora_contactos": _Ficha("aseguradora_contactos", "id", ("id",)),
    "prestadores": _Ficha("prestadores", "id", ("id",)),
    "prestador_contactos": _Ficha("prestador_contactos", "id", ("id",)),
    "prestador_sedes": _Ficha("prestador_sedes", "id", ("id",)),
    # Paso 5c: lo contratado. Sin `id`: se publica TODO lo de esa aseguradora.
    "aseguradora_aplicaciones": _Ficha(
        "aseguradora_modulos", "aseguradora_id", ("aseguradora_id", "aplicacion_codigo"), _APP),
    "aseguradora_sla": _Ficha(
        "aseguradora_sla", "aseguradora_id", ("aseguradora_id", "aplicacion_codigo"), _APP),
    "aseguradora_coberturas": _Ficha(
        "aseguradora_coberturas", "aseguradora_id",
        ("aseguradora_id", "aplicacion_codigo", "cobertura_codigo"), _APP),
}
# Paso 5d: el directorio de usuarios y sus accesos. NUNCA credenciales: las
# consultas de la réplica no leen contraseña, MFA ni bloqueos, y un login (que
# toca último acceso, intentos, `updated_at`) no se publica: entrar a la
# plataforma no depende de la central.
_PERFIL_USUARIO = frozenset({
    "email", "nombre_principal", "nombre_secundario", "apellido_paterno", "apellido_materno",
    "telefono", "provincia_codigo", "ciudad_codigo", "is_superadmin", "aseguradora_id",
    "is_active", "deleted_at",
})
_USUARIO = {"usuario_id": "user_id"}
FICHAS.update({
    "usuarios": _Ficha(
        "users", "id", ("id",), {"es_superadmin": "is_superadmin", "activo": "is_active"},
        perfil=_PERFIL_USUARIO, ignorar=("updated_at",), solo_actualizar=True),
    "usuario_aplicaciones": _Ficha(
        "user_module_access", "user_id", ("id",), {**_USUARIO, **_APP},
        ignorar=("rol_activo",), solo_actualizar=True,
        # La central guarda el CÓDIGO del rol; aquí es el id de `roles` de ese módulo.
        actualizar_sql=(
            "UPDATE user_module_access SET user_id = CAST(:usuario_id AS uuid),"
            " module_code = CAST(:aplicacion_codigo AS varchar),"
            " role_id = COALESCE((SELECT r.id FROM roles r"
            " WHERE r.module_code = CAST(:aplicacion_codigo AS varchar)"
            " AND r.code = CAST(:rol_codigo AS varchar)), role_id),"
            " activo = CAST(:activo AS boolean), updated_at = CAST(:updated_at AS timestamptz)"
            " WHERE id = CAST(:id AS uuid)"
        )),
    "usuario_grupos": _Ficha("user_grupo_access", "user_id", ("id",), _USUARIO,
                             solo_actualizar=True),
    "usuario_coordinaciones": _Ficha("user_aseguradora_coordinador", "user_id", ("id",),
                                     _USUARIO, solo_actualizar=True),
})
ORDEN = tuple(FICHAS)
_POR_MODELO = {
    TipoPrestador: "tipos_prestador",
    Aseguradora: "aseguradoras",
    AseguradoraContacto: "aseguradora_contactos",
    Prestador: "prestadores",
    PrestadorContacto: "prestador_contactos",
    PrestadorSede: "prestador_sedes",
    AseguradoraModulo: "aseguradora_aplicaciones",
    AseguradoraSla: "aseguradora_sla",
    AseguradoraCobertura: "aseguradora_coberturas",
    User: "usuarios",
    UserModuleAccess: "usuario_aplicaciones",
    UserGrupoAccess: "usuario_grupos",
    UserAseguradoraCoordinador: "usuario_coordinaciones",
}
_CONSULTA = {nombre: consulta for nombre, consulta in replicacion.ENTIDADES if nombre in ORDEN}
_TOCADAS = "fichas_tocadas"
SIN_PUBLICAR = "fichas_sin_publicar"  # session.info: lo escribe la reparación (viene de la central)
_LOTE = 500
_NO_DISPONIBLE = "La central no respondió: no se pudo guardar la ficha en este momento"


def activo() -> bool:
    return settings.fichas_en_central and settings.replicacion_central_configurada


# ── 1. Central primero ───────────────────────────────────────────────────────
@event.listens_for(Session, "after_flush")
def _anotar(sesion: Session, _contexto: Any) -> None:
    """Anota qué filas de las fichas se escribieron (nuevas, modificadas o borradas)."""
    if not activo():
        return
    for obj in chain(sesion.new, sesion.dirty, sesion.deleted):
        nombre = _POR_MODELO.get(type(obj))
        if nombre is None:
            continue
        if obj in sesion.dirty and obj not in sesion.new:
            perfil = FICHAS[nombre].perfil
            estado = inspect(obj)
            cambio = (
                sesion.is_modified(obj)
                if perfil is None
                else any(estado.attrs[a].history.has_changes() for a in perfil)
            )
            if not cambio:
                continue
        valor = getattr(obj, FICHAS[nombre].filtro)
        sesion.info.setdefault(_TOCADAS, set()).add((nombre, valor))


@event.listens_for(Session, "before_commit")
def _publicar_antes_de_confirmar(sesion: Session) -> None:
    if not activo() or sesion.info.get(SIN_PUBLICAR):
        return
    sesion.flush()  # que lo pendiente pase por `_anotar`
    tocadas = sesion.info.pop(_TOCADAS, None)
    if tocadas:
        publicar(sesion, cliente_plataforma(), tocadas)


@event.listens_for(Session, "after_rollback")
def _olvidar(sesion: Session) -> None:
    sesion.info.pop(_TOCADAS, None)


def _filas(sesion: Session, entidad: str, ids: list[uuid.UUID] | None) -> list[dict[str, Any]]:
    """Las filas tal como las ve la transacción, en el formato de la réplica."""
    consulta = _CONSULTA[entidad]
    parametros: dict[str, Any] = {}
    if ids is not None:
        consulta += f" WHERE {FICHAS[entidad].filtro} = ANY(:ids)"
        parametros["ids"] = ids
    filas = [dict(f) for f in sesion.execute(text(consulta), parametros).mappings()]
    return json.loads(json.dumps(filas, default=replicacion._json))  # noqa: SLF001


def publicar(sesion: Session, c: ClienteCentral, tocadas: set[tuple[str, uuid.UUID]]) -> None:
    """Envía a la central las filas tocadas. Si algo falla, lanza y NO se confirma lo local."""
    for entidad in ORDEN:
        ids = sorted({i for n, i in tocadas if n == entidad}, key=str)
        for desde in range(0, len(ids), _LOTE):
            filas = _filas(sesion, entidad, ids[desde : desde + _LOTE])
            if not filas:
                continue
            try:
                estado, r = c.llamar("PUT", f"/api/fichas/{entidad}", {"filas": filas})
            except CentralError as error:
                log.warning("fichas_central_sin_respuesta", entidad=entidad)
                raise HTTPException(
                    status.HTTP_503_SERVICE_UNAVAILABLE, detail=_NO_DISPONIBLE
                ) from error
            if estado in (409, 422):
                detalle = r.get("detalle") if isinstance(r, dict) else None
                log.warning("fichas_central_rechazo", entidad=entidad, estado=estado)
                raise HTTPException(
                    estado,
                    detail=detalle if isinstance(detalle, str) else "La central rechazó la ficha",
                )
            if estado != 200:
                log.warning("fichas_central_error", entidad=entidad, estado=estado)
                raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, detail=_NO_DISPONIBLE)


# ── 3. Verificar (y reparar) el espejo ───────────────────────────────────────
def _canon(fila: dict[str, Any], ignorar: tuple[str, ...] = ()) -> str:
    return json.dumps({k: v for k, v in fila.items() if k not in ignorar},
                      sort_keys=True, ensure_ascii=False)


def verificar(sesion: Session, c: ClienteCentral, *, reparar: bool = False) -> dict[str, str]:
    """
    {entidad: resumen}. Compara fila a fila el espejo con la central. Con
    `reparar`, las filas distintas o que faltan aquí se toman de la central.
    Las que solo existen aquí se informan (no se borran: alguien las tiene
    referenciadas y la central no las conoce; hay que mirarlas a mano).
    """
    resultado: dict[str, str] = {}
    for entidad in ORDEN:
        estado, remotas = c.llamar("GET", f"/api/fichas/{entidad}")
        if estado != 200:
            raise CentralError(estado, f"GET /api/fichas/{entidad}")
        llave = FICHAS[entidad].llave
        locales = {tuple(f[c] for c in llave): f for f in _filas(sesion, entidad, None)}
        centrales = {tuple(f[c] for c in llave): f for f in remotas}
        ignorar = FICHAS[entidad].ignorar
        distintas = [
            i for i in centrales
            if i in locales and _canon(locales[i], ignorar) != _canon(centrales[i], ignorar)
        ]
        faltan = [i for i in centrales if i not in locales]
        sobran = [i for i in locales if i not in centrales]
        traer = distintas if FICHAS[entidad].solo_actualizar else distintas + faltan
        if reparar and traer:
            _traer(sesion, entidad, [centrales[i] for i in traer])
        resultado[entidad] = (
            f"{len(centrales)} en la central · {len(distintas)} distintas · "
            f"{len(faltan)} faltan aquí · {len(sobran)} solo aquí"
            + (" · reparado" if reparar and traer else "")
        )
        if distintas or faltan or sobran:
            log.warning("fichas_espejo_diferente", entidad=entidad, distintas=len(distintas),
                        faltan=len(faltan), solo_aqui=len(sobran), reparado=reparar)
    return resultado


def _traer(sesion: Session, entidad: str, filas: list[dict[str, Any]]) -> None:
    """UPSERT local de filas de la central, SIN volver a publicarlas."""
    ficha = FICHAS[entidad]
    local = {  # columna de la central → columna local (sin las que solo informan)
        c: ficha.renombres.get(c, c) for c in filas[0] if c not in ficha.ignorar
    }
    llave = [ficha.renombres.get(c, c) for c in ficha.llave]
    if ficha.actualizar_sql:
        sql = text(ficha.actualizar_sql)
    elif ficha.solo_actualizar:
        asignar = ", ".join(f"{local[c]} = :{c}" for c in local if local[c] not in llave)
        donde = " AND ".join(f"{ficha.renombres.get(c, c)} = :{c}" for c in ficha.llave)
        sql = text(f"UPDATE {ficha.tabla} SET {asignar} WHERE {donde}")  # noqa: S608
    else:
        asignar = ", ".join(f"{col} = EXCLUDED.{col}" for col in local.values() if col not in llave)
        sql = text(
            f"INSERT INTO {ficha.tabla} ({', '.join(local.values())}) "  # noqa: S608 - nombres fijos
            f"VALUES ({', '.join(':' + c for c in local)}) "
            f"ON CONFLICT ({', '.join(llave)}) DO UPDATE SET {asignar}"
        )
    sesion.info[SIN_PUBLICAR] = True
    try:
        for fila in filas:
            sesion.execute(sql, fila)
        sesion.commit()
    finally:
        sesion.info.pop(SIN_PUBLICAR, None)
