from __future__ import annotations

from fastapi import APIRouter, Depends

from app.core.security.deps import AuthContext, require_module_access, require_permission
from app.modules.calificacion import permissions

# La dependencia va a nivel de APIRouter, no por endpoint: cualquier endpoint que
# se anada aqui nace protegido por el acceso al modulo. El slug es la identidad
# publica; la traduccion a `code` la hace la dependencia contra la tabla modules.
router = APIRouter(
    prefix="/calificacion",
    tags=["calificacion"],
    dependencies=[Depends(require_module_access("calificacion"))],
)


@router.get("/status")
def estado(
    ctx: AuthContext = Depends(require_permission(permissions.VER_DASHBOARD)),
) -> dict:
    """Placeholder del modulo. Cero logica de negocio en esta iteracion."""
    return {
        "modulo": ctx.module_code,
        "nombre": "Calificación",
        "rol": ctx.rol,
        "permisos": ctx.permisos,
    }
