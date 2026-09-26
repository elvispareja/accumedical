from __future__ import annotations

import datetime as dt
import uuid

from sqlalchemy import (
    CheckConstraint,
    ForeignKey,
    Index,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import INET
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import TS, Base, columna_pk_uuid

MOTIVOS_REVOCACION = (
    "logout",
    "rotation",
    "admin",
    "password_change",
    "expiration",
    "user_deactivated",
)


class Sesion(Base):
    """
    Sesión opaca en servidor (tabla `sessions` del diseño). Se eligió frente a JWT
    porque el requisito de revocación inmediata obliga a consultar la base en cada
    request, lo que anula la única ventaja del JWT y deja solo su superficie de ataque.

    El token JAMÁS se persiste: la cookie lleva 256 bits opacos y aquí vive solo su
    SHA-256. Un volcado de esta tabla no permite fabricar sesiones válidas.
    """

    __tablename__ = "sessions"
    __table_args__ = (
        UniqueConstraint("token_hash", name="uq_sessions_token_hash"),
        CheckConstraint("expires_at > created_at", name="expira_despues_de_crear"),
        CheckConstraint(
            "revoke_reason IS NULL OR revoke_reason IN "
            "('logout','rotation','admin','password_change','expiration','user_deactivated')",
            name="revoke_reason",
        ),
        Index("ix_sessions_user_id", "user_id", postgresql_where="revoked_at IS NULL"),
        Index("ix_sessions_expires_at", "expires_at"),
    )

    id: Mapped[uuid.UUID] = columna_pk_uuid()
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    # Token CSRF propio y aleatorio, no un HMAC derivado de SECRET_KEY: un HMAC
    # determinista ataría todos los tokens CSRF a la clave maestra y rotarla
    # invalidaría en silencio las mutaciones en vuelo.
    csrf_token_hash: Mapped[str] = mapped_column(String(64), nullable=False)

    # Estado de navegación. JAMÁS autoriza: el módulo se toma de la ruta y se
    # revalida contra user_module_access en cada request.
    active_module_code: Mapped[str | None] = mapped_column(
        String(30), ForeignKey("modules.code", ondelete="RESTRICT")
    )

    ip: Mapped[str] = mapped_column(INET, nullable=False)
    user_agent: Mapped[str] = mapped_column(String(400), nullable=False, server_default="")

    created_at: Mapped[dt.datetime] = mapped_column(
        TS, nullable=False, server_default=func.now()
    )
    last_activity_at: Mapped[dt.datetime] = mapped_column(
        TS, nullable=False, server_default=func.now()
    )
    expires_at: Mapped[dt.datetime] = mapped_column(TS, nullable=False)
    revoked_at: Mapped[dt.datetime | None] = mapped_column(TS)
    revoke_reason: Mapped[str | None] = mapped_column(String(30))
    # SET NULL es excepción deliberada al RESTRICT general: las sesiones vencidas se
    # purgan a los 30 días y un RESTRICT en la cadena de rotación haría fallar la purga.
    rotated_from_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("sessions.id", ondelete="SET NULL")
    )
