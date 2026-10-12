from __future__ import annotations

import datetime as dt

from sqlalchemy import CHAR, String, text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import TS, Base


class CentralReplicacion(Base):
    """
    Última foto de cada entidad del núcleo enviada a la API central.

    Una fila por entidad (`aseguradoras`, `convenios`…) con la huella SHA-256
    de lo que se envió: si la foto de ahora tiene la misma huella, no se envía
    nada. Así la replicación cuesta una consulta por entidad cuando nadie toca
    el admin, y la central solo recibe lo que cambió.
    """

    __tablename__ = "central_replicacion"

    entidad: Mapped[str] = mapped_column(String(40), primary_key=True)
    huella: Mapped[str | None] = mapped_column(CHAR(64))
    enviado_at: Mapped[dt.datetime | None] = mapped_column(TS)
    ultimo_error: Mapped[str | None] = mapped_column(String(200))
    updated_at: Mapped[dt.datetime] = mapped_column(
        TS, nullable=False, server_default=text("now()"), onupdate=text("now()")
    )
