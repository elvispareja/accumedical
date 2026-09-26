"""
Servir el logo de una aseguradora.

Lo usan dos rutas con autorizaciones distintas —el administrador global pide el
de cualquiera por id, y un usuario de compañía solo el de la suya, sin id de por
medio—, así que la parte común vive aquí y no duplicada en los dos routers. La
autorización NO está aquí a propósito: es de cada ruta.
"""

from __future__ import annotations

from pathlib import Path

from fastapi import HTTPException, status
from fastapi.responses import FileResponse

from app.core.config import settings
from app.shared.aseguradoras.models import Aseguradora

# Allowlist por tipo real del contenido, no por extensión ni por lo que diga el
# cliente en Content-Type.
MIME_PERMITIDOS = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/webp": ".webp",
}


def respuesta_logo(aseguradora: Aseguradora) -> FileResponse:
    """
    El archivo, ya autorizado por quien llama. Se fuerza el Content-Type desde el
    servidor y se prohíbe el sniffing: el navegador nunca decide qué es esto.
    """
    if not aseguradora.logo_path:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Sin logo")

    ruta = Path(settings.upload_dir) / aseguradora.logo_path
    if not ruta.is_file():
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Sin logo")

    tipo = next(
        (m for m, ext in MIME_PERMITIDOS.items() if ruta.suffix == ext),
        "application/octet-stream",
    )
    return FileResponse(
        ruta,
        media_type=tipo,
        headers={"X-Content-Type-Options": "nosniff", "Cache-Control": "private, max-age=60"},
    )
