"""
El vademécum maestro vive en la central (6/11/2026, M5), como el CIE-10: aquí
solo se consulta, con la credencial de la plataforma (`catalogos:leer`).
"""

from __future__ import annotations

import re
from typing import Any
from urllib.parse import urlencode

from fastapi import HTTPException, status

from app.core.central import CentralError, cliente

CODIGO = re.compile(r"^VAD-[0-9]{5}$")


def _no_responde() -> HTTPException:
    return HTTPException(
        status.HTTP_503_SERVICE_UNAVAILABLE, detail="El vademécum no responde ahora"
    )


def _get(ruta: str) -> Any:
    try:
        estado, r = cliente().llamar("GET", ruta)
    except CentralError as error:
        raise _no_responde() from error
    if estado == 422:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Búsqueda no válida")
    if estado != 200:
        raise _no_responde()
    return r


def buscar(parametros: dict[str, Any]) -> list[dict[str, Any]]:
    limpios = {k: v for k, v in parametros.items() if v not in (None, "")}
    return _get("/api/catalogos/vademecum?" + urlencode(limpios))


def filtros() -> dict[str, Any]:
    return _get("/api/catalogos/vademecum-filtros")


def por_codigos(codigos: list[str]) -> dict[str, dict[str, Any]]:
    """Los medicamentos de esos códigos, por código (también los inactivos)."""
    validos = sorted({c for c in codigos if CODIGO.match(c)})
    if not validos:
        return {}
    try:
        estado, r = cliente().llamar(
            "POST", "/api/catalogos/vademecum/codigos", {"codigos": validos}
        )
    except CentralError as error:
        raise _no_responde() from error
    if estado != 200 or not isinstance(r, list):
        raise _no_responde()
    return {m["codigo"]: m for m in r}


def plantilla_precios() -> bytes:
    try:
        estado, contenido = cliente().descargar("/api/catalogos/vademecum/plantilla-precios")
    except CentralError as error:
        raise _no_responde() from error
    if estado != 200:
        raise _no_responde()
    return contenido
