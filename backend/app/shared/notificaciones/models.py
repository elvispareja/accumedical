from __future__ import annotations

import datetime as dt
import uuid

from sqlalchemy import ForeignKey, Index, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import TS, Base, MarcasTiempoMixin, columna_pk_uuid


class Notificacion(Base, MarcasTiempoMixin):
    """
    Un aviso para UNA persona. Lo escribe el módulo donde ocurrió el hecho, en la
    misma transacción que el hecho: o existen los dos o no existe ninguno.

    **El texto se guarda ya compuesto**, no se calcula al leer. Es una foto de lo
    que pasó: si el caso cambia de estado mañana, el aviso sigue diciendo lo que
    decía cuando ocurrió, que es lo que la persona necesita reconocer. Por lo
    mismo la tabla no tiene FK a la entidad de origen —`entidad` y `entidad_id`
    son una referencia suelta, a propósito: el núcleo no puede depender de las
    tablas de ningún módulo (regla dura de arquitectura)—.
    """

    __tablename__ = "notificaciones"

    id: Mapped[uuid.UUID] = columna_pk_uuid()
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    module_code: Mapped[str] = mapped_column(
        String(30), ForeignKey("modules.code", ondelete="RESTRICT"), nullable=False
    )

    # Lo que se lee en la campana, de arriba abajo.
    titulo: Mapped[str] = mapped_column(String(120), nullable=False)
    subtitulo: Mapped[str] = mapped_column(String(200), nullable=False)
    detalle: Mapped[str] = mapped_column(String(300), nullable=False)
    # A dónde lleva el clic. Se guarda por notificación y no se deduce: dos
    # personas pueden tener que ir a sitios distintos por el mismo hecho.
    url: Mapped[str] = mapped_column(String(300), nullable=False)

    # De qué habla, para poder rastrearlo. Sin FK, ver el docstring.
    entidad: Mapped[str] = mapped_column(String(50), nullable=False)
    entidad_id: Mapped[uuid.UUID] = mapped_column(nullable=False)

    # Leer no borra: marca. El historial de lo avisado se conserva.
    leida_at: Mapped[dt.datetime | None] = mapped_column(TS, nullable=True)

    __table_args__ = (
        # La consulta de la campana es siempre la misma: lo mío, lo no leído
        # primero, y lo más reciente arriba.
        Index(
            "ix_notificaciones_bandeja",
            "user_id",
            "leida_at",
            "created_at",
        ),
    )
