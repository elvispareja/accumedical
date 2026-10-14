"""
**Las dos llaves de la cuenta que solo tiene el superadministrador**
(14/10/2026, pedido del usuario). Sirven para cualquier persona —del personal
o de una aseguradora— porque la contraseña es UNA por persona para todas las
aplicaciones de Accumedical: la verifica la plataforma, y Calificación de
Riesgo le pregunta a ella.

- **Cambiar la contraseña** desde el admin. Caso de uso: un auditor o
  coordinador renuncia con casos abiertos (y por eso no se le puede desactivar,
  ver `pendientes.py`); el superadministrador entra con su cuenta, los cierra
  y después lo desactiva. Queda auditado quién la cambió, cuándo y por qué, y
  se cierran las sesiones abiertas de esa persona.
- **Enviar un enlace de restablecimiento** por correo, cuando a alguien se le
  olvida. Es el mismo enlace de un solo uso de la invitación, a la página
  común `/definir-password`; al entrar, el login lleva a cada uno a su app.

Ni un coordinador ni nadie más: el router entero exige superadministrador.
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import func, update
from sqlalchemy.orm import Session as DbSession

from app.core.config import settings
from app.core.db import get_db
from app.core.security.deps import AuthContext, require_global_admin, verificar_csrf
from app.shared.aseguradoras.usuarios import fijar_password
from app.shared.audit import service as audit
from app.shared.auth import invitaciones
from app.shared.auth import service as auth_service
from app.shared.users.models import PasswordSetupToken, User

router = APIRouter(
    prefix="/shared/cuentas",
    tags=["cuentas"],
    dependencies=[Depends(require_global_admin)],
)


class CambiarPassword(BaseModel):
    password: str = Field(min_length=1, max_length=200)
    # Para la trazabilidad: por qué el superadministrador tomó esta cuenta.
    motivo: str = Field(min_length=3, max_length=300)


def _cuenta(db: DbSession, user_id: uuid.UUID) -> User:
    usuario = db.get(User, user_id)
    if usuario is None or usuario.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Usuario no encontrado")
    if not usuario.is_active:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail="El usuario está desactivado: actívalo antes de tocar su contraseña",
        )
    return usuario


@router.post("/{user_id}/password", status_code=status.HTTP_204_NO_CONTENT)
def cambiar_password(
    request: Request,
    user_id: uuid.UUID,
    datos: CambiarPassword,
    ctx: AuthContext = Depends(require_global_admin),
    _: None = Depends(verificar_csrf),
    db: DbSession = Depends(get_db),
) -> None:
    """
    Fija una contraseña nueva. Anula los enlaces pendientes —uno viejo no puede
    pisarla después— y cierra todas las sesiones de esa persona.
    """
    if len(datos.password) < settings.password_min_length:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"La contraseña debe tener al menos {settings.password_min_length} caracteres",
        )
    usuario = _cuenta(db, user_id)
    fijar_password(db, usuario, datos.password)
    db.execute(
        update(PasswordSetupToken)
        .where(PasswordSetupToken.user_id == usuario.id, PasswordSetupToken.used_at.is_(None))
        .values(used_at=func.now())
    )
    revocadas = auth_service.revocar_sesiones_de_usuario(db, usuario.id, "password_change")
    usuario.updated_by = ctx.user.id
    audit.registrar(
        db,
        accion="password_cambiada_por_admin",
        request=request,
        user_id=ctx.user.id,
        session_id=ctx.sesion.id,
        entidad="users",
        entidad_id=str(usuario.id),
        detalle={"motivo": datos.motivo.strip(), "sesiones_revocadas": revocadas},
    )
    db.commit()


@router.post("/{user_id}/enlace-restablecer", status_code=status.HTTP_202_ACCEPTED)
def enviar_enlace(
    request: Request,
    user_id: uuid.UUID,
    ctx: AuthContext = Depends(require_global_admin),
    _: None = Depends(verificar_csrf),
    db: DbSession = Depends(get_db),
) -> dict:
    """
    Envía al correo de la persona un enlace de un solo uso para poner su
    contraseña. Emitirlo invalida los anteriores. La contraseña vieja sigue
    valiendo hasta que use el enlace.
    """
    usuario = _cuenta(db, user_id)
    token = invitaciones.emitir(db, usuario, ctx.user.id)
    audit.registrar(
        db,
        accion="enlace_restablecer_enviado",
        request=request,
        user_id=ctx.user.id,
        session_id=ctx.sesion.id,
        entidad="users",
        entidad_id=str(usuario.id),
        detalle={"email": usuario.email},
    )
    db.commit()
    # DESPUÉS del commit: un correo enviado no se puede deshacer.
    invitaciones.enviar_restablecer(usuario, token)
    return {"detail": f"Enlace enviado a {usuario.email}"}
