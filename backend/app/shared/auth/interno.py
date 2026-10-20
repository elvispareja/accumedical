"""
Verificación de credenciales para las apps que viven FUERA de la plataforma
(hoy: Calificación de Riesgo, repo propio). Esas apps no guardan contraseñas:
la persona usa la MISMA clave que fijó con su invitación de admin, y la app
pregunta aquí si es correcta y si tiene acceso a ella.

- No es una ruta del navegador: nginx la cierra al público (`/api/v1/interno/`)
  y solo se llega por la red interna de Docker.
- La app se identifica con su token (`APPS_INTERNAS_TOKENS`); sin token válido
  se responde 404, como si la ruta no existiera.
- Pasa por `auth_service.autenticar`: el mismo argon2, el mismo bloqueo por
  intentos y el mismo AuditLog que el login de la plataforma.
- No crea sesión de la plataforma: la app emite la suya (sesión por app, D53).
"""

from __future__ import annotations

import uuid

import hmac

from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy.orm import Session as DbSession

from app.core.config import settings
from app.core.db import get_db
from app.shared.audit import service as audit
from app.shared.auth import service as auth_service

router = APIRouter(prefix="/interno", tags=["interno"])

_NO_EXISTE = HTTPException(status.HTTP_404_NOT_FOUND, detail="Not Found")
_CREDENCIALES = HTTPException(status.HTTP_401_UNAUTHORIZED, detail="Credenciales inválidas")


class CredencialesIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=256)


class CredencialesOut(BaseModel):
    usuario_id: str
    # El rol de la persona EN esa app (operador, supervisor, auditor,
    # coordinador…), tal como lo resuelve la plataforma.
    rol: str


def _tokens() -> dict[str, str]:
    """`APPS_INTERNAS_TOKENS` = «app=token,app2=token2»."""
    crudo = settings.apps_internas_tokens.get_secret_value()
    pares = (p.split("=", 1) for p in crudo.split(",") if "=" in p)
    return {app.strip(): token.strip() for app, token in pares if app.strip() and token.strip()}


def app_del_token(authorization: str | None = Header(default=None)) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise _NO_EXISTE
    recibido = authorization.removeprefix("Bearer ").strip().encode()
    encontrada = None
    # Se comparan TODOS, en tiempo constante, sin salir antes.
    for app, token in _tokens().items():
        if hmac.compare_digest(recibido, token.encode()):
            encontrada = app
    if encontrada is None:
        raise _NO_EXISTE
    return encontrada


@router.post("/credenciales", response_model=CredencialesOut)
def verificar_credenciales(
    request: Request,
    datos: CredencialesIn,
    app: str = Depends(app_del_token),
    db: DbSession = Depends(get_db),
) -> CredencialesOut:
    resultado = auth_service.autenticar(db, str(datos.email), datos.password)
    if resultado.user is None:
        audit.registrar(
            db, accion="login_fallido", request=request, module_code=app,
            detalle={"email_intentado": str(datos.email), "motivo": resultado.motivo, "app": app},
        )
        if resultado.motivo == "cuenta_bloqueada":
            audit.registrar(db, accion="cuenta_bloqueada", request=request,
                            detalle={"email_intentado": str(datos.email), "app": app})
        db.commit()
        raise _CREDENCIALES

    user = resultado.user
    modulo = next((m for m in auth_service.resolver_modulos(db, user) if m.codigo == app), None)
    if modulo is None:
        audit.registrar(
            db, accion="login_fallido", request=request, user_id=user.id, module_code=app,
            detalle={"motivo": "sin_acceso_a_la_app", "app": app},
        )
        db.commit()
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Sin acceso a esta aplicación")

    audit.registrar(
        db, accion="login_ok", request=request, user_id=user.id, module_code=app,
        detalle={"app": app, "rol": modulo.rol},
    )
    db.commit()
    return CredencialesOut(usuario_id=str(user.id), rol=modulo.rol)


@router.get("/aseguradoras/{aseguradora_id}/logo")
def logo_de_aseguradora(
    aseguradora_id: uuid.UUID,
    app: str = Depends(app_del_token),
    db: DbSession = Depends(get_db),
):
    """
    El logo de una aseguradora para una app de fuera (20/10/2026): Calificación de
    Riesgo lo muestra en el menú lateral de los usuarios de esa compañía. Mismo
    candado que las credenciales —token de la app y solo red interna— y solo si la
    aseguradora tiene contratada ESA app. Sin logo, o sin contrato: 404.
    """
    from sqlalchemy import select

    from app.shared.aseguradoras.logo import respuesta_logo
    from app.shared.aseguradoras.models import Aseguradora, AseguradoraModulo

    aseguradora = db.get(Aseguradora, aseguradora_id)
    contratada = db.scalar(
        select(AseguradoraModulo.aseguradora_id).where(
            AseguradoraModulo.aseguradora_id == aseguradora_id,
            AseguradoraModulo.module_code == app,
            AseguradoraModulo.activo.is_(True),
        )
    )
    if aseguradora is None or aseguradora.deleted_at is not None or contratada is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Sin logo")
    return respuesta_logo(aseguradora)
