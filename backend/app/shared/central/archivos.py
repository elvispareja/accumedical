"""
Archivos de la aseguradora en el almacén cifrado de la API central (D2).

Con `DOCUMENTOS_EN_CENTRAL=true`, los documentos de la aseguradora (pestañas
Pólizas, Cobertura, SLA y Convenios) y los listados de precios ya no se escriben
en el volumen local: se suben al almacén de la central y en la columna `ruta`
queda una REFERENCIA, `central:<id del archivo>`. Las rutas antiguas (relativas
al volumen local) siguen funcionando hasta que `app.cli migrar-documentos-central`
las mueva.

Sin respaldo local: si la central no responde, el documento no se sube ni se
puede ver (503). Guardarlo aquí «mientras tanto» dejaría documentos que ninguna
otra aplicación encontraría.
"""

from __future__ import annotations

import uuid
from typing import Any
from urllib.parse import quote

from fastapi import HTTPException, status
from fastapi.responses import Response

from app.core.central import CentralError, cliente_plataforma
from app.core.config import settings

PREFIJO = "central:"
_NO_DISPONIBLE = "La central no respondió: el documento no está disponible en este momento"


def activo() -> bool:
    return settings.documentos_en_central and settings.replicacion_central_configurada


def es_referencia(ruta: str | None) -> bool:
    return bool(ruta) and ruta.startswith(PREFIJO)


def referencia(archivo_id: uuid.UUID) -> str:
    return f"{PREFIJO}{archivo_id}"


def id_de(ruta: str) -> uuid.UUID:
    return uuid.UUID(ruta.removeprefix(PREFIJO))


def subir(contenido: bytes, nombre: str, autor: uuid.UUID | None) -> uuid.UUID:
    """Sube al almacén de la central y devuelve el id del archivo."""
    try:
        estado, r = cliente_plataforma().llamar_binario(
            "POST", "/api/archivos", contenido, nombre=nombre, usuario=autor
        )
    except CentralError as error:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, detail=_NO_DISPONIBLE) from error
    if estado in (413, 422):
        detalle = r.get("detalle") if isinstance(r, dict) else None
        raise HTTPException(
            estado, detail=detalle if isinstance(detalle, str) else "Archivo no válido"
        )
    if estado != 201:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, detail=_NO_DISPONIBLE)
    return uuid.UUID(r["id"])


def descargar(archivo_id: uuid.UUID) -> tuple[bytes, dict[str, Any]]:
    """(contenido, metadatos) de un archivo de la central; la central verifica su integridad."""
    try:
        c = cliente_plataforma()
        estado, meta = c.llamar("GET", f"/api/archivos/{archivo_id}")
        if estado == 404:
            raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Documento no encontrado")
        if estado != 200:
            raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, detail=_NO_DISPONIBLE)
        estado, contenido = c.descargar(f"/api/archivos/{archivo_id}/contenido")
    except CentralError as error:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, detail=_NO_DISPONIBLE) from error
    if estado != 200:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, detail=_NO_DISPONIBLE)
    return contenido, meta


def respuesta(ruta: str, nombre_visible: str | None = None) -> Response:
    """El archivo de la central como respuesta HTTP, con las cabeceras seguras de siempre."""
    contenido, meta = descargar(id_de(ruta))
    nombre = f"{nombre_visible or meta['nombre']}{meta['extension']}"
    return Response(
        content=contenido,
        media_type=meta["tipo_mime"],
        headers={
            "Content-Disposition": f"inline; filename*=UTF-8''{quote(nombre)}",
            "X-Content-Type-Options": "nosniff",
            "Cache-Control": "private, no-store",
        },
    )
