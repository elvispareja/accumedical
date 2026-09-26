"""sedes de prestador y coordenadas obligatorias

Revision ID: a91c4e7f2d38
Revises: f2b6c8d40e19
Create Date: 2026-08-29

Dos cosas, del mismo encargo:

1. `prestador_sedes`. Un prestador puede atender en varios sitios: matriz,
   sucursales, consultorios. Tener sedes es OPCIONAL —un prestador puede no tener
   ninguna—, pero la sede que se crea sí lleva todos sus campos, coordenadas
   incluidas: una sede sin punto no sirve para lo único que se le pide, saber
   dónde está.

2. `latitud` y `longitud` OBLIGATORIAS en `aseguradoras` y en `prestadores`.

Las coordenadas se guardan como `numeric(9,6)` —unos 11 cm de resolución— y no
como `double precision`: el decimal exacto evita que el mismo punto se guarde y
se lea con dígitos distintos. No se usa PostGIS: para fijar un pin y pintarlo no
hace falta, y añadiría una extensión al despliegue.

Las columnas se añaden NOT NULL y sin valor por defecto **a propósito**: no
existe una coordenada por defecto que no sea mentira. Postgres solo lo permite si
la tabla está vacía, así que en un entorno con filas la migración falla en voz
alta en lugar de inventar una ubicación. Si eso pasa, hay que decidir el relleno
antes de migrar.
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "a91c4e7f2d38"
down_revision: str | None = "f2b6c8d40e19"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

COORDENADA = sa.Numeric(precision=9, scale=6)


def _checks_de_rango(tabla: str) -> None:
    """Rango real del planeta. Un dedazo en el formulario no llega a la tabla."""
    op.create_check_constraint(
        op.f(f"ck_{tabla}_latitud"), tabla, "latitud BETWEEN -90 AND 90"
    )
    op.create_check_constraint(
        op.f(f"ck_{tabla}_longitud"), tabla, "longitud BETWEEN -180 AND 180"
    )


def upgrade() -> None:
    # ── 1. Sedes del prestador ───────────────────────────────────────────────
    op.create_table(
        "prestador_sedes",
        sa.Column("id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("prestador_id", sa.Uuid(), nullable=False),
        sa.Column("nombre", sa.String(length=150), nullable=False),
        sa.Column("provincia_codigo", sa.String(length=2), nullable=False),
        sa.Column("ciudad_codigo", sa.String(length=4), nullable=False),
        sa.Column("direccion", sa.String(length=300), nullable=False),
        sa.Column("telefono", sa.String(length=25), nullable=True),
        sa.Column("email", postgresql.CITEXT(), nullable=True),
        sa.Column("latitud", COORDENADA, nullable=False),
        sa.Column("longitud", COORDENADA, nullable=False),
        sa.Column("estado", sa.String(length=20), server_default="activa", nullable=False),
        sa.Column("created_by", sa.Uuid(), nullable=True),
        sa.Column("updated_by", sa.Uuid(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_by", sa.Uuid(), nullable=True),
        sa.CheckConstraint(
            "estado IN ('activa','inactiva')", name=op.f("ck_prestador_sedes_estado")
        ),
        sa.CheckConstraint(
            "latitud BETWEEN -90 AND 90", name=op.f("ck_prestador_sedes_latitud")
        ),
        sa.CheckConstraint(
            "longitud BETWEEN -180 AND 180", name=op.f("ck_prestador_sedes_longitud")
        ),
        sa.ForeignKeyConstraint(
            ["prestador_id"],
            ["prestadores.id"],
            name=op.f("fk_prestador_sedes_prestador_id_prestadores"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["provincia_codigo"],
            ["provincias.codigo"],
            name=op.f("fk_prestador_sedes_provincia_codigo_provincias"),
            ondelete="RESTRICT",
        ),
        # FK COMPUESTA, igual que en prestadores y aseguradoras: la ciudad tiene
        # que pertenecer a la provincia elegida, y lo garantiza la base.
        sa.ForeignKeyConstraint(
            ["ciudad_codigo", "provincia_codigo"],
            ["ciudades.codigo", "ciudades.provincia_codigo"],
            name=op.f("fk_prestador_sedes_ciudad_codigo_ciudades"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["created_by"],
            ["users.id"],
            name=op.f("fk_prestador_sedes_created_by_users"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["updated_by"],
            ["users.id"],
            name=op.f("fk_prestador_sedes_updated_by_users"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["deleted_by"],
            ["users.id"],
            name=op.f("fk_prestador_sedes_deleted_by_users"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_prestador_sedes")),
    )
    op.create_index(
        "ix_prestador_sedes_prestador_id",
        "prestador_sedes",
        ["prestador_id"],
        postgresql_where="deleted_at IS NULL",
    )
    # Dos sedes con el mismo nombre en el mismo prestador es un error de captura.
    # Parcial, como toda unicidad de negocio: un nombre liberado por baja lógica
    # se puede volver a usar.
    op.create_index(
        "uq_prestador_sedes_nombre",
        "prestador_sedes",
        ["prestador_id", "nombre"],
        unique=True,
        postgresql_where="deleted_at IS NULL",
    )

    # ── 2. Coordenadas obligatorias en las dos tablas raíz ───────────────────
    for tabla in ("aseguradoras", "prestadores"):
        op.add_column(tabla, sa.Column("latitud", COORDENADA, nullable=False))
        op.add_column(tabla, sa.Column("longitud", COORDENADA, nullable=False))
        _checks_de_rango(tabla)


def downgrade() -> None:
    for tabla in ("aseguradoras", "prestadores"):
        op.drop_constraint(op.f(f"ck_{tabla}_longitud"), tabla, type_="check")
        op.drop_constraint(op.f(f"ck_{tabla}_latitud"), tabla, type_="check")
        op.drop_column(tabla, "longitud")
        op.drop_column(tabla, "latitud")

    op.drop_index("uq_prestador_sedes_nombre", table_name="prestador_sedes")
    op.drop_index("ix_prestador_sedes_prestador_id", table_name="prestador_sedes")
    op.drop_table("prestador_sedes")
