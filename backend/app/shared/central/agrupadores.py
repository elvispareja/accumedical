"""
Los diagnósticos agrupadores de la CIE-10 viven en la central (6/11/2026), como
la CIE-10: aquí se consultan con `catalogos:leer` y se ajustan con la credencial
de la plataforma (`catalogos:admin`), siempre con el usuario que lo hace.
"""

from __future__ import annotations

from typing import Any
from urllib.parse import quote, urlencode

from fastapi import HTTPException, status

from app.core.central import CentralError, cliente, cliente_plataforma

_RUTA = "/api/cie10-agrupadores"


def _no_responde() -> HTTPException:
    return HTTPException(
        status.HTTP_503_SERVICE_UNAVAILABLE, detail="Los agrupadores CIE-10 no responden ahora"
    )


def _respuesta(estado: int, r: Any) -> Any:
    if estado in (404, 409, 422):
        detalle = r.get("detalle") if isinstance(r, dict) else None
        raise HTTPException(
            estado, detail=detalle if isinstance(detalle, str) else "Datos no válidos"
        )
    if estado == 403:
        # La credencial de la plataforma no tiene `catalogos:admin` en la central.
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="La plataforma aún no tiene permiso en la central para ajustar los agrupadores",
        )
    if estado == 502:
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY, detail="La IA no pudo responder ahora. Inténtalo de nuevo"
        )
    if estado != 200:
        raise _no_responde()
    return r


def _leer(ruta: str) -> Any:
    try:
        return _respuesta(*cliente().llamar("GET", ruta))
    except CentralError as error:
        raise _no_responde() from error


def _cambiar(metodo: str, ruta: str, cuerpo: Any, autor: Any) -> Any:
    try:
        return _respuesta(*cliente_plataforma().llamar(metodo, ruta, cuerpo, usuario=autor))
    except CentralError as error:
        raise _no_responde() from error


def buscar(parametros: dict[str, Any]) -> dict[str, Any]:
    limpios = {k: v for k, v in parametros.items() if v not in (None, "", False)}
    return _leer(_RUTA + ("?" + urlencode(limpios) if limpios else ""))


def ver(codigo: str) -> dict[str, Any]:
    return _leer(f"{_RUTA}/{quote(codigo)}")


def renombrar(codigo: str, datos: dict[str, Any], autor: Any) -> dict[str, Any]:
    return _cambiar("PUT", f"{_RUTA}/{quote(codigo)}", datos, autor)


def mover(datos: dict[str, Any], autor: Any) -> dict[str, Any]:
    return _cambiar("POST", f"{_RUTA}/mover", datos, autor)


def juntar(codigo: str, datos: dict[str, Any], autor: Any) -> dict[str, Any]:
    return _cambiar("POST", f"{_RUTA}/{quote(codigo)}/juntar", datos, autor)


def sugerencias(codigo: str, autor: Any) -> list[dict[str, Any]]:
    return _cambiar("POST", f"{_RUTA}/{quote(codigo)}/sugerencias", None, autor)
