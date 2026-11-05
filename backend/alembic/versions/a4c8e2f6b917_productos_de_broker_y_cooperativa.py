"""aseguradora_productos: los productos de brokers y cooperativas

Pedido del usuario (5/11/2026): si la aseguradora es broker o cooperativa, una
pestaña «Producto» con «Agregar producto» que pide nombre, valor y porcentaje.
Lista editable con la ficha, como los contactos; baja lógica, nunca DELETE. Va
a la central como ficha (`aseguradora_productos`, su migración 0014, que corre
ANTES que esta).

Revision ID: a4c8e2f6b917
Revises: f3b7d1a9c254
Create Date: 2026-11-05
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "a4c8e2f6b917"
down_revision = "f3b7d1a9c254"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "aseguradora_productos",
        sa.Column("id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("aseguradora_id", sa.Uuid(), nullable=False),
        sa.Column("nombre", sa.String(length=150), nullable=False),
        sa.Column("valor", sa.Numeric(precision=12, scale=2), nullable=False),
        sa.Column("porcentaje", sa.Numeric(precision=5, scale=2), nullable=False),
        sa.Column("created_by", sa.Uuid(), nullable=True),
        sa.Column("updated_by", sa.Uuid(), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_by", sa.Uuid(), nullable=True),
        sa.CheckConstraint("valor >= 0", name=op.f("ck_aseguradora_productos_valor")),
        sa.CheckConstraint(
            "porcentaje BETWEEN 0 AND 100", name=op.f("ck_aseguradora_productos_porcentaje")
        ),
        sa.ForeignKeyConstraint(
            ["aseguradora_id"], ["aseguradoras.id"],
            name=op.f("fk_aseguradora_productos_aseguradora_id_aseguradoras"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["created_by"], ["users.id"],
            name=op.f("fk_aseguradora_productos_created_by_users"), ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["updated_by"], ["users.id"],
            name=op.f("fk_aseguradora_productos_updated_by_users"), ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["deleted_by"], ["users.id"],
            name=op.f("fk_aseguradora_productos_deleted_by_users"), ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_aseguradora_productos")),
    )
    op.create_index(
        "ix_aseguradora_productos_aseguradora_id",
        "aseguradora_productos",
        ["aseguradora_id"],
        postgresql_where="deleted_at IS NULL",
    )
    op.create_index(
        "uq_aseguradora_productos_nombre",
        "aseguradora_productos",
        ["aseguradora_id", "nombre"],
        unique=True,
        postgresql_where="deleted_at IS NULL",
    )


def downgrade() -> None:
    # Solo si la tabla está vacía: volver atrás no puede tirar productos cargados.
    op.execute(
        "DO $$ BEGIN IF EXISTS (SELECT 1 FROM aseguradora_productos) THEN "
        "RAISE EXCEPTION 'aseguradora_productos tiene filas: respaldarlas antes de bajar'; "
        "END IF; END $$"
    )
    op.drop_index("uq_aseguradora_productos_nombre", table_name="aseguradora_productos")
    op.drop_index("ix_aseguradora_productos_aseguradora_id", table_name="aseguradora_productos")
    op.drop_table("aseguradora_productos")
