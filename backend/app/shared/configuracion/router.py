from __future__ import annotations

from pathlib import Path
from typing import Literal

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile, status
from pydantic import BaseModel
from sqlalchemy.orm import Session as DbSession

from app.core.config import settings
from app.core.db import get_db
from app.core.security import cifrado
from app.core.security.deps import AuthContext, require_global_admin, verificar_csrf
from app.modules.concurrencia import firma
from app.shared.audit import service as audit

# Configuración de la plataforma, SOLO para el administrador global. Hoy: la
# firma electrónica de los informes. El .p12 y la contraseña —cifrada con la
# llave derivada del SECRET_KEY— viven en el volumen de subidas, fuera del
# repositorio y de la base; la contraseña jamás viaja de vuelta al navegador.
router = APIRouter(
    prefix="/shared/configuracion",
    tags=["configuracion"],
    dependencies=[Depends(require_global_admin)],
)

# Un .p12 real pesa unos KB; 1 MB ya es holgadísimo.
_TOPE_P12 = 1024 * 1024


class FirmaEstado(BaseModel):
    configurada: bool
    # De dónde sale el certificado vigente: del entorno del servidor (manda) o
    # de lo subido aquí. El entorno bloquea el formulario del panel.
    fuente: Literal["entorno", "panel"] | None = None
    titular: str | None = None


def _estado() -> FirmaEstado:
    if settings.firma_p12_path:
        return FirmaEstado(configurada=True, fuente="entorno")
    p12 = Path(settings.upload_dir) / firma.RUTA_P12_SUBIDO
    clave = Path(settings.upload_dir) / firma.RUTA_CLAVE_SUBIDA
    if not (p12.is_file() and clave.is_file()):
        return FirmaEstado(configurada=False)
    try:
        titular = firma.validar_certificado(p12.read_bytes(), cifrado.descifrar(clave.read_bytes()))
    except Exception:  # noqa: BLE001 - un archivo dañado no debe tumbar la pantalla
        titular = None
    return FirmaEstado(configurada=True, fuente="panel", titular=titular)


@router.get("/firma", response_model=FirmaEstado)
def estado_firma() -> FirmaEstado:
    """Qué firma hay puesta, para pintar la pantalla. La contraseña jamás sale."""
    return _estado()


@router.post("/firma", response_model=FirmaEstado)
async def guardar_firma(
    request: Request,
    archivo: UploadFile = File(...),
    contrasena: str = Form(...),
    ctx: AuthContext = Depends(require_global_admin),
    _: None = Depends(verificar_csrf),
    db: DbSession = Depends(get_db),
) -> FirmaEstado:
    """
    Sube el .p12 de la empresa con su contraseña. La validación ES abrirlo: si
    la contraseña no coincide o el archivo no es un PKCS#12, no se guarda nada
    (422). Al guardar, la contraseña queda cifrada en el volumen y el próximo
    PDF ya sale firmado —la caché del certificado se renueva sola por huella—.
    """
    if settings.firma_p12_path:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail=(
                "La firma está fijada por el entorno del servidor (FIRMA_P12_PATH): "
                "quítala de ahí para gestionarla desde este panel"
            ),
        )

    datos = await archivo.read()
    if not datos:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="El archivo está vacío")
    if len(datos) > _TOPE_P12:
        raise HTTPException(
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="Eso no parece un certificado: un .p12 pesa unos pocos KB",
        )

    try:
        titular = firma.validar_certificado(datos, contrasena)
    except Exception as error:  # noqa: BLE001 - da igual el motivo exacto: no abre
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="El archivo no es un .p12 válido o la contraseña no coincide",
        ) from error

    destino_p12 = Path(settings.upload_dir) / firma.RUTA_P12_SUBIDO
    destino_clave = Path(settings.upload_dir) / firma.RUTA_CLAVE_SUBIDA
    destino_p12.parent.mkdir(parents=True, exist_ok=True)
    destino_p12.write_bytes(datos)
    destino_clave.write_bytes(cifrado.cifrar(contrasena))

    # Al log y a la auditoría van el titular y el tamaño. LA CONTRASEÑA JAMÁS.
    audit.registrar(
        db,
        accion="firma_configurada",
        request=request,
        user_id=ctx.user.id,
        session_id=ctx.sesion.id,
        module_code=None,
        entidad="configuracion",
        entidad_id="firma",
        detalle={"titular": titular, "bytes": len(datos)},
    )
    db.commit()
    return _estado()
