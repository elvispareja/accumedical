from __future__ import annotations

import datetime as dt
import uuid
from collections.abc import Iterator

from sqlalchemy import DateTime, ForeignKey, MetaData, Numeric, create_engine, func
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker

from app.core.config import settings
from app.core.ids import uuid7

# Sin esta convención, Postgres autonombra los constraints y cada `alembic
# autogenerate` produce diffs espurios o constraints imposibles de referenciar
# en un downgrade.
NAMING_CONVENTION = {
    "ix": "ix_%(table_name)s_%(column_0_N_name)s",
    "uq": "uq_%(table_name)s_%(column_0_N_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING_CONVENTION)


def columna_pk_uuid() -> Mapped[uuid.UUID]:
    """PK uuid v7 generada en la aplicación; el default de servidor es red de seguridad."""
    return mapped_column(
        primary_key=True,
        default=uuid7,
        server_default=func.gen_random_uuid(),
    )


TS = DateTime(timezone=True)

# Coordenada geográfica: ~11 cm de resolución. Decimal exacto y no coma flotante,
# para que el mismo punto no se guarde y se lea con dígitos distintos.
COORDENADA = Numeric(precision=9, scale=6)

# Dinero y porcentajes de los valores pactados. Decimal exacto: con coma
# flotante, sumar tarifas acumularía céntimos de error.
IMPORTE = Numeric(precision=12, scale=2)
PORCENTAJE = Numeric(precision=5, scale=2)


class MarcasTiempoMixin:
    created_at: Mapped[dt.datetime] = mapped_column(TS, nullable=False, server_default=func.now())
    updated_at: Mapped[dt.datetime] = mapped_column(
        TS, nullable=False, server_default=func.now(), onupdate=func.now()
    )


class AuditoriaFilaMixin(MarcasTiempoMixin):
    """
    Trazabilidad a nivel de fila (quién la dejó como está). Complementa a AuditLog,
    que guarda la película completa. Nullable solo por el bootstrap y los seeds.
    """

    @property
    def _fk_users(self) -> str:  # pragma: no cover - documental
        return "users.id"

    created_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), nullable=True
    )
    updated_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), nullable=True
    )


class BorradoLogicoMixin:
    """
    Nunca hay DELETE físico. Fila viva ⇔ deleted_at IS NULL.

    Consecuencia no obvia: toda unicidad de negocio de una tabla con este mixin
    debe declararse como índice único PARCIAL `WHERE deleted_at IS NULL`; si no,
    un RUC borrado bloquearía para siempre el re-registro de esa aseguradora.
    """

    deleted_at: Mapped[dt.datetime | None] = mapped_column(TS, nullable=True)
    deleted_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), nullable=True
    )


engine = create_engine(
    settings.database_url,
    pool_pre_ping=True,
    pool_size=5,
    max_overflow=10,
    future=True,
)

SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def get_db() -> Iterator[Session]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
