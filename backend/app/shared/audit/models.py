from __future__ import annotations

import datetime as dt
import uuid

from sqlalchemy import BigInteger, ForeignKey, Identity, Index, String, func
from sqlalchemy.dialects.postgresql import INET, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import TS, Base


class AuditLog(Base):
    """
    Append-only e inmutable (un trigger rechaza UPDATE y DELETE).

    `module_code`, `session_id` y `entidad_id` van SIN FK deliberadamente:
      a) el log debe poder registrar el intento de acceso a un módulo inexistente,
         que es justo el evento interesante para seguridad;
      b) insertar en auditoría nunca puede fallar por integridad ni competir por
         locks con la transacción de negocio;
      c) la purga de sessions no debe mutar ni bloquear la auditoría;
      d) entidad_id como texto admite PKs heterogéneas (uuid, bigint, código).
    """

    __tablename__ = "audit_log"
    __table_args__ = (
        Index("ix_audit_log_user_id_created_at", "user_id", "created_at"),
        Index("ix_audit_log_entidad_entidad_id", "entidad", "entidad_id"),
        # BRIN: barridos por rango temporal a coste de KB incluso con cientos de
        # millones de filas. Append-only con IDENTITY ⇒ correlación física perfecta.
        Index("ix_audit_log_created_at_brin", "created_at", postgresql_using="brin"),
    )

    # GENERATED ALWAYS, no SERIAL: nadie puede insertar un id explícito en la
    # auditoría, ni por error ni a propósito.
    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT")
    )
    session_id: Mapped[uuid.UUID | None] = mapped_column()
    module_code: Mapped[str | None] = mapped_column(String(30))
    accion: Mapped[str] = mapped_column(String(50), nullable=False)
    entidad: Mapped[str | None] = mapped_column(String(63))
    entidad_id: Mapped[str | None] = mapped_column(String(64))
    # Para CRUD: {"antes": {...}, "despues": {...}} solo con los campos que cambiaron,
    # ya pasados por el redactor. Para eventos de auth: contexto del evento.
    detalle: Mapped[dict | None] = mapped_column(JSONB)
    ip: Mapped[str | None] = mapped_column(INET)
    user_agent: Mapped[str | None] = mapped_column(String(400))
    request_id: Mapped[uuid.UUID | None] = mapped_column()
    created_at: Mapped[dt.datetime] = mapped_column(
        TS, nullable=False, server_default=func.now()
    )
