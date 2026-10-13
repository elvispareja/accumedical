"""
Fichas de aseguradoras y prestadores (con contactos y sedes): la central es la
DUEÑA y esta base guarda un ESPEJO (paso 5b, `FICHAS_EN_CENTRAL`).

Por qué un espejo y no borrar las tablas: los usuarios, los casos de
Concurrencia, las pólizas, el SLA… tienen llaves foráneas a estas filas y las
leen en cientos de consultas. Se quedan, pero ya no mandan:

1. CENTRAL PRIMERO. Cualquier cambio a esas cinco tablas, venga de la pantalla
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
from sqlalchemy import event, text
from sqlalchemy.orm import Session

from app.core.central import CentralError, ClienteCentral, cliente_plataforma
from app.core.config import settings
from app.core.logging import log
from app.shared.aseguradoras.models import Aseguradora, AseguradoraContacto
from app.shared.central import replicacion
from app.shared.prestadores.models import Prestador, PrestadorContacto, PrestadorSede

# Orden de dependencias: la ficha antes que sus contactos y sedes.
ORDEN = ("aseguradoras", "aseguradora_contactos", "prestadores", "prestador_contactos",
         "prestador_sedes")
_POR_MODELO = {
    Aseguradora: "aseguradoras",
    AseguradoraContacto: "aseguradora_contactos",
    Prestador: "prestadores",
    PrestadorContacto: "prestador_contactos",
    PrestadorSede: "prestador_sedes",
}
_TABLA = {  # tabla local de cada entidad (los nombres de la central coinciden)
    "aseguradoras": "aseguradoras",
    "aseguradora_contactos": "aseguradora_contactos",
    "prestadores": "prestadores",
    "prestador_contactos": "prestador_contactos",
    "prestador_sedes": "prestador_sedes",
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
        if nombre is not None and (obj not in sesion.dirty or sesion.is_modified(obj)):
            sesion.info.setdefault(_TOCADAS, set()).add((nombre, obj.id))


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
        consulta += " WHERE id = ANY(:ids)"
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
def _canon(fila: dict[str, Any]) -> str:
    return json.dumps(fila, sort_keys=True, ensure_ascii=False)


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
        locales = {f["id"]: f for f in _filas(sesion, entidad, None)}
        centrales = {f["id"]: f for f in remotas}
        distintas = [
            i for i in centrales if i in locales and _canon(locales[i]) != _canon(centrales[i])
        ]
        faltan = [i for i in centrales if i not in locales]
        sobran = [i for i in locales if i not in centrales]
        if reparar and (distintas or faltan):
            _traer(sesion, entidad, [centrales[i] for i in distintas + faltan])
        resultado[entidad] = (
            f"{len(centrales)} en la central · {len(distintas)} distintas · "
            f"{len(faltan)} faltan aquí · {len(sobran)} solo aquí"
            + (" · reparado" if reparar and (distintas or faltan) else "")
        )
        if distintas or faltan or sobran:
            log.warning("fichas_espejo_diferente", entidad=entidad, distintas=len(distintas),
                        faltan=len(faltan), solo_aqui=len(sobran), reparado=reparar)
    return resultado


def _traer(sesion: Session, entidad: str, filas: list[dict[str, Any]]) -> None:
    """UPSERT local de filas de la central, SIN volver a publicarlas."""
    columnas = list(filas[0])
    asignar = ", ".join(f"{col} = EXCLUDED.{col}" for col in columnas if col != "id")
    sql = text(
        f"INSERT INTO {_TABLA[entidad]} ({', '.join(columnas)}) "  # noqa: S608 - nombres fijos
        f"VALUES ({', '.join(':' + col for col in columnas)}) "
        f"ON CONFLICT (id) DO UPDATE SET {asignar}"
    )
    sesion.info[SIN_PUBLICAR] = True
    try:
        for fila in filas:
            sesion.execute(sql, fila)
        sesion.commit()
    finally:
        sesion.info.pop(SIN_PUBLICAR, None)
