from __future__ import annotations

import datetime as dt
import secrets
import uuid

from fastapi import HTTPException, status
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session as DbSession

from app.core.config import settings
from app.core.mail import enviar
from app.core.security.passwords import hashear
from app.core.security.tokens import generar_token, hashear_token
from app.shared.users.models import PasswordSetupToken, User

ASUNTO = "Tu acceso a Accumedical"


def password_inservible() -> str:
    """
    Un usuario invitado todavía no tiene contraseña, pero la columna es NOT NULL a
    propósito: con ella vacía, el login necesitaría una rama nueva y esa rama
    tardaría distinto, que es justo el canal de tiempo que el login evita
    ejecutando siempre argon2. Se guarda el hash de un valor aleatorio que nadie
    conoce: el camino es idéntico y sencillamente nunca acierta.
    """
    return hashear(secrets.token_urlsafe(32))


def _enlace(token: str) -> str:
    # La base es configuración del despliegue, nunca la cabecera Host de la
    # petición: esa es suplantable y mandaría a la víctima a otro dominio.
    return f"{settings.app_base_url.rstrip('/')}/definir-password?token={token}"


def _cuerpo(usuario: User, enlace: str, horas: int) -> tuple[str, str]:
    # Se saluda por el primer nombre, que es como se saluda a una persona.
    saludo = f"Hola, {usuario.nombre_principal}"
    texto = (
        f"{saludo}:\n\n"
        "Se ha creado tu usuario en Accumedical. Para entrar necesitas entrar tu "
        "propia contraseña en este enlace:\n\n"
        f"{enlace}\n\n"
        f"El enlace caduca en {horas} horas y solo se puede usar una vez. "
        "Si no esperabas este correo, ignóralo: sin abrirlo, la cuenta no se activa.\n\n"
        "Accumedical"
    )
    html = f"""<!doctype html>
<html lang="es"><body style="margin:0;background:#f6f8f7;font-family:system-ui,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
             style="max-width:520px;background:#fff;border:1px solid #e3e8e6;border-radius:10px">
        <tr><td style="padding:28px 28px 8px">
          <p style="margin:0 0 4px;font-size:12px;letter-spacing:.14em;
                    text-transform:uppercase;color:#6b7c77">Accumedical</p>
          <h1 style="margin:0;font-size:20px;color:#10312a">{saludo}</h1>
        </td></tr>
        <tr><td style="padding:8px 28px 0;font-size:15px;line-height:1.55;color:#33443f">
          <p style="margin:0 0 20px">
            Se ha creado tu usuario en Accumedical. Para entrar, crea tu propia contraseña:
          </p>
          <p style="margin:0 0 20px">
            <a href="{enlace}" style="display:inline-block;padding:11px 20px;border-radius:7px;
               background:#0f5a4a;color:#fff;text-decoration:none;font-weight:600">
              Crear mi contraseña
            </a>
          </p>
          <p style="margin:0 0 20px;font-size:13px;color:#6b7c77">
            El enlace caduca en {horas} horas y solo se puede usar una vez.
            Si no esperabas este correo, ignóralo: sin abrirlo, la cuenta no se activa.
          </p>
          <p style="margin:0 0 28px;font-size:12px;color:#6b7c77;word-break:break-all">
            ¿No funciona el botón? Copia esta dirección: {enlace}
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>"""
    return texto, html


def emitir(db: DbSession, usuario: User, autor: uuid.UUID | None) -> str:
    """
    Crea una invitación y devuelve el token EN CLARO, que solo existe en memoria y
    dentro del correo: en la base queda únicamente su SHA-256.

    Emitir una invalida las anteriores del mismo usuario. Si no fuera así, un
    enlace viejo filtrado seguiría sirviendo después de reenviar el correo.
    """
    db.execute(
        update(PasswordSetupToken)
        .where(PasswordSetupToken.user_id == usuario.id, PasswordSetupToken.used_at.is_(None))
        .values(used_at=func.now())
    )
    token = generar_token()
    db.add(
        PasswordSetupToken(
            user_id=usuario.id,
            token_hash=hashear_token(token),
            expires_at=dt.datetime.now(dt.UTC)
            + dt.timedelta(hours=settings.invitacion_ttl_horas),
            created_by=autor,
        )
    )
    return token


def enviar_invitacion(usuario: User, token: str) -> None:
    """Se llama DESPUÉS del commit: un correo enviado no se puede deshacer."""
    texto, html = _cuerpo(usuario, _enlace(token), settings.invitacion_ttl_horas)
    enviar(para=usuario.email, asunto=ASUNTO, texto=texto, html=html)


def resolver(db: DbSession, token: str) -> tuple[PasswordSetupToken, User]:
    """
    Busca la invitación por el hash del token. Respuesta idéntica en todos los
    fallos —inexistente, caducada, ya usada o de un usuario desactivado—: quien
    prueba enlaces al azar no aprende nada de la diferencia.
    """
    generico = HTTPException(
        status.HTTP_400_BAD_REQUEST,
        detail="El enlace no es válido o ya caducó. Pide uno nuevo a tu administrador.",
    )
    fila = db.execute(
        select(PasswordSetupToken, User)
        .join(User, User.id == PasswordSetupToken.user_id)
        .where(PasswordSetupToken.token_hash == hashear_token(token))
    ).first()
    if fila is None:
        raise generico

    invitacion, usuario = fila
    if invitacion.used_at is not None:
        raise generico
    if invitacion.expires_at <= dt.datetime.now(dt.UTC):
        raise generico
    if not usuario.is_active or usuario.deleted_at is not None:
        raise generico
    return invitacion, usuario
