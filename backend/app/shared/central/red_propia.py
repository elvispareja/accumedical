"""
La «Red convenio» de Accumedical vive en la API central.

La red de la ficha propia (`aseguradoras.es_propia`) ya no se guarda aquí: con
`RED_PROPIA_EN_CENTRAL=true`, la pantalla «Red convenio» y todo lo que lee esa
red (valores FC, listado de precios, mapa, la ficha del prestador) van a la
central, que es su dueña. Las redes de las DEMÁS compañías siguen aquí y se
replican como siempre (la réplica ya no envía la red propia).

Sin respaldo local, a propósito: si la central no responde, la red no se puede
leer ni guardar (503). Escribir aquí «mientras tanto» crearía dos versiones de
la misma red. Las filas antiguas de la red propia en `aseguradora_prestador`
quedan como historia y no se vuelven a leer.

Los archivos de listado de precios siguen en el volumen de subidas de la
plataforma: la central guarda su ruta y su nombre.
"""

from __future__ import annotations

import datetime as dt
import uuid
from decimal import Decimal
from types import SimpleNamespace
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from app.core.central import CentralError, cliente_plataforma
from app.core.config import settings
from app.shared.aseguradoras.models import Aseguradora, AseguradoraPrestador


def activa() -> bool:
    return settings.red_propia_en_central and settings.replicacion_central_configurada


def es_propia(db: DbSession, aseguradora_id: uuid.UUID) -> bool:
    return bool(db.scalar(select(Aseguradora.es_propia).where(Aseguradora.id == aseguradora_id)))


def aplica(db: DbSession, aseguradora_id: uuid.UUID) -> bool:
    """¿Esta red se lee y escribe en la central? Solo la propia, y solo con el interruptor."""
    return activa() and es_propia(db, aseguradora_id)


# ── HTTP ──────────────────────────────────────────────────────────────────────
_NO_DISPONIBLE = "La central no respondió: la Red convenio no está disponible en este momento"


def _llamar(
    metodo: str, ruta: str, cuerpo: Any = None, *, usuario: uuid.UUID | None = None
) -> tuple[int, Any]:
    try:
        estado, r = cliente_plataforma().llamar(metodo, ruta, cuerpo, usuario=usuario)
    except CentralError as error:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, detail=_NO_DISPONIBLE) from error
    if estado in (409, 422):
        detalle = r.get("detalle") if isinstance(r, dict) else None
        raise HTTPException(
            estado, detail=detalle if isinstance(detalle, str) else "Datos no válidos"
        )
    if estado >= 500 or estado in (401, 403):
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, detail=_NO_DISPONIBLE)
    return estado, r


def _fecha(valor: str | None) -> dt.date | None:
    return dt.date.fromisoformat(valor) if valor else None


def _convenio_ns(c: dict[str, Any]) -> Any:
    """Un convenio de la central con los atributos de una fila de `aseguradora_prestador`."""
    return SimpleNamespace(
        id=uuid.UUID(c["id"]),
        aseguradora_id=uuid.UUID(c["aseguradora_id"]),
        prestador_id=uuid.UUID(c["prestador_id"]),
        codigo_convenio=c["codigo_convenio"],
        red_privada=c["red_privada"],
        red_publica=c["red_publica"],
        fecha_inicio=_fecha(c["fecha_inicio"]),
        fecha_fin=_fecha(c["fecha_fin"]),
        estado=c["estado"],
        observaciones=c["observaciones"],
        listado_precios_nombre=c["listado_precios_nombre"],
        listado_precios_ruta=c["listado_precios_ruta"],
        deleted_at=None,
    )


# ── La red ───────────────────────────────────────────────────────────────────
def convenios_vivos(aseguradora_id: uuid.UUID) -> dict[uuid.UUID, Any]:
    """prestador_id → convenio vivo (cualquier estado) de la red propia."""
    _, filas = _llamar("GET", f"/api/aseguradoras/{aseguradora_id}/convenios?estado=todos")
    return {uuid.UUID(c["prestador_id"]): _convenio_ns(c) for c in filas}


def _catalogo(nombre: str) -> dict[str, str]:
    _, filas = _llamar("GET", f"/api/catalogos/{nombre}")
    return {f["codigo"]: f["nombre"] for f in filas}


def convenios_de_aseguradora(aseguradora_id: uuid.UUID) -> list[dict[str, Any]]:
    """TODOS los prestadores vivos, marcando los de la red (misma forma que el servicio)."""
    vivos = convenios_vivos(aseguradora_id)
    tipos, ciudades = _catalogo("tipos-prestador"), _catalogo("ciudades")
    prestadores: list[dict[str, Any]] = []
    offset = 0
    while True:
        _, pagina = _llamar("GET", f"/api/prestadores?limit=100&offset={offset}")
        prestadores += pagina["items"]
        offset += len(pagina["items"])
        if not pagina["items"] or offset >= pagina["total"]:
            break
    prestadores.sort(key=lambda p: p["nombre"])
    return [
        {
            "prestador": SimpleNamespace(
                id=uuid.UUID(p["id"]), codigo_interno=p["codigo_interno"], nombre=p["nombre"]
            ),
            "tipo_nombre": tipos.get(p["tipo_codigo"]),
            "ciudad_nombre": ciudades.get(p["ciudad_codigo"]) if p["ciudad_codigo"] else None,
            "marcado": uuid.UUID(p["id"]) in vivos,
            "convenio": vivos.get(uuid.UUID(p["id"])),
        }
        for p in prestadores
    ]


def fijar(
    aseguradora_id: uuid.UUID, seleccion: list[dict[str, Any]], autor: uuid.UUID
) -> dict[str, list[str]] | None:
    cuerpo = {
        "prestadores": [
            {
                "prestador_id": str(f["prestador_id"]),
                "red_privada": bool(f["red_privada"]),
                "red_publica": bool(f["red_publica"]),
            }
            for f in seleccion
        ]
    }
    _, r = _llamar("PUT", f"/api/aseguradoras/{aseguradora_id}/red", cuerpo, usuario=autor)
    return r


def convenio_del_par(aseguradora_id: uuid.UUID, prestador_id: uuid.UUID) -> Any:
    convenio = convenios_vivos(aseguradora_id).get(prestador_id)
    if convenio is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Convenio no encontrado")
    return convenio


def guardar_listado(convenio_id: uuid.UUID, ruta: str, nombre: str, autor: uuid.UUID) -> None:
    _llamar(
        "PATCH",
        f"/api/convenios/{convenio_id}/listado",
        {"ruta": ruta, "nombre": nombre},
        usuario=autor,
    )


def prestadores_en_red(aseguradora_id: uuid.UUID) -> set[uuid.UUID]:
    return set(convenios_vivos(aseguradora_id))


# ── Un convenio y sus valores FC ─────────────────────────────────────────────
def _detalle(convenio_id: uuid.UUID) -> dict[str, Any] | None:
    estado, r = _llamar("GET", f"/api/convenios/{convenio_id}")
    return None if estado == 404 else r


def es_convenio_propio(db: DbSession, convenio_id: uuid.UUID) -> bool:
    """¿Este convenio es de la red propia (y por tanto vive en la central)?"""
    if not activa():
        return False
    d = _detalle(convenio_id)
    if d is not None:
        return es_propia(db, uuid.UUID(d["aseguradora_id"]))
    # No está vivo en la central. Si aquí queda una fila vieja de la red propia,
    # es historia: no debe volver a abrirse desde la copia local.
    local = db.get(AseguradoraPrestador, convenio_id)
    return local is not None and es_propia(db, local.aseguradora_id)


def obtener_convenio(
    db: DbSession, prestador_id: uuid.UUID, convenio_id: uuid.UUID
) -> tuple[Any, str] | None:
    """
    (convenio, razón social) si el convenio es de la red propia; None si no lo es
    (y lo resuelve la base local). 404 si es de la red propia pero ya no existe o
    no es de ese prestador.
    """
    if not es_convenio_propio(db, convenio_id):
        return None
    d = _detalle(convenio_id)
    if d is None or uuid.UUID(d["prestador_id"]) != prestador_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Convenio no encontrado")
    return _convenio_ns(d), d["aseguradora"]["razon_social"]


def fc_de(convenio_id: uuid.UUID) -> list[Any]:
    d = _detalle(convenio_id)
    if d is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Convenio no encontrado")
    return [
        SimpleNamespace(
            convenio_id=convenio_id,
            concepto=f["concepto"],
            modo=f["modo"],
            valor=Decimal(str(f["valor"])) if f["valor"] is not None else None,
            base=f["base"],
        )
        for f in d["fc"]
    ]


def fijar_fc(convenio_id: uuid.UUID, pedidos: dict[str, dict[str, Any]], autor: uuid.UUID) -> None:
    conceptos = [
        {
            "concepto": concepto,
            "modo": datos["modo"],
            "valor": str(datos["valor"]) if datos.get("valor") is not None else None,
            "base": datos.get("base") if datos["modo"] == "porcentaje" else None,
        }
        for concepto, datos in pedidos.items()
    ]
    _llamar("PUT", f"/api/convenios/{convenio_id}/fc", {"conceptos": conceptos}, usuario=autor)


def convenios_del_prestador(
    db: DbSession, prestador_id: uuid.UUID
) -> list[tuple[Any, str, str | None, str]]:
    """El convenio con la red propia, visto desde el prestador (forma de `convenios.listar`)."""
    _, filas = _llamar("GET", f"/api/prestadores/{prestador_id}/convenios")
    salida = []
    for c in filas:
        aseguradora_id = uuid.UUID(c["aseguradora_id"])
        if not es_propia(db, aseguradora_id):
            continue
        ruc = db.scalar(select(Aseguradora.ruc).where(Aseguradora.id == aseguradora_id))
        a = c["aseguradora"]
        salida.append((_convenio_ns(c), a["razon_social"], a["nombre_comercial"], ruc))
    return salida
