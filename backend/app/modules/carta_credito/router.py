from __future__ import annotations

from fastapi import APIRouter, Depends

from app.core.security.deps import AuthContext, require_module_access, require_permission
from app.modules.carta_credito import permissions

# La dependencia va a nivel de APIRouter, no por endpoint: cualquier endpoint que
# se anada aqui nace protegido por el acceso al modulo. El slug es la identidad
# publica; la traduccion a `code` la hace la dependencia contra la tabla modules.
router = APIRouter(
    # La identidad pública cambió a central-credito (el negocio la renombró
    # tres veces: Carta de Crédito → Carta de Vida → Autorización de Crédito →
    # Central de Crédito, rama Siniestros hospitalarios); la canónica sigue
    # siendo carta_credito: paquete, code y prefijo de tablas.
    prefix="/central-credito",
    tags=["central-credito"],
    dependencies=[Depends(require_module_access("central-credito"))],
)


@router.get("/status")
def estado(
    ctx: AuthContext = Depends(require_permission(permissions.VER_DASHBOARD)),
) -> dict:
    """Placeholder del modulo. Cero logica de negocio en esta iteracion."""
    return {
        "modulo": ctx.module_code,
        "nombre": "Central de Crédito",
        "rol": ctx.rol,
        "permisos": ctx.permisos,
    }
