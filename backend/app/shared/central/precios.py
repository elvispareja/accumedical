"""
La lista de precios por medicamento de una farmacia en su convenio (6/11/2026,
M4): vive en la central, que lee el Excel y lo valida contra el vademécum. Aquí
se sube el archivo al almacén y se le pide que lo procese; sus errores por fila
llegan tal cual para mostrarlos.
"""

from __future__ import annotations

import datetime as dt
import uuid
from typing import Any

from fastapi import HTTPException, status

from app.core.central import CentralError, cliente_plataforma
from app.shared.central import archivos

_NO_DISPONIBLE = "La central no responde ahora; inténtelo en un momento"


def _detalle(r: Any) -> Any:
    return r.get("detalle") if isinstance(r, dict) else None


def ver(convenio_id: uuid.UUID) -> dict[str, Any] | None:
    try:
        estado, r = cliente_plataforma().llamar("GET", f"/api/convenios/{convenio_id}/precios")
    except CentralError as error:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, detail=_NO_DISPONIBLE) from error
    if estado == 404:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Convenio no encontrado")
    if estado != 200:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, detail=_NO_DISPONIBLE)
    return r


def subir(
    convenio_id: uuid.UUID,
    contenido: bytes,
    nombre: str,
    desde: dt.date,
    hasta: dt.date | None,
    autor: uuid.UUID,
) -> dict[str, Any]:
    archivo_id = archivos.subir(contenido, nombre, autor)
    cuerpo = {
        "archivo_id": str(archivo_id),
        "vigencia_desde": desde.isoformat(),
        "vigencia_hasta": hasta.isoformat() if hasta else None,
    }
    try:
        estado, r = cliente_plataforma().llamar(
            "POST", f"/api/convenios/{convenio_id}/precios", cuerpo, usuario=autor
        )
    except CentralError as error:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, detail=_NO_DISPONIBLE) from error
    if estado in (404, 409, 422):
        detalle = _detalle(r)
        if isinstance(detalle, dict) and "errores" in detalle:
            # {mensaje, errores: ["Fila 12: …"], total_errores}: se muestran tal cual.
            raise HTTPException(estado, detail=detalle)
        raise HTTPException(
            estado, detail=detalle if isinstance(detalle, str) else "Lista no válida"
        )
    if estado != 200:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, detail=_NO_DISPONIBLE)
    return r
