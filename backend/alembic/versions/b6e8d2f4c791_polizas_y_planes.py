"""aseguradoras: pólizas y planes en PDF

Cada aseguradora guarda sus pólizas y planes como documentos PDF: una fila por
archivo con su nombre visible y la ruta relativa en el volumen de subidas
(fuera del árbol ejecutable, como logos y comprobantes). Auditoría de fila y
borrado lógico: retirar un documento conserva quién y cuándo, jamás borra.

Revision ID: b6e8d2f4c791
Revises: a3c7e9b5d162
Create Date: 2026-09-17
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "b6e8d2f4c791"
down_revision = "a3c7e9b5d162"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "aseguradora_polizas",
        sa.Column("id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("aseguradora_id", sa.Uuid(), nullable=False),
        sa.Column("nombre", sa.String(length=160), nullable=False),
        sa.Column("ruta", sa.String(length=500), nullable=False),
        sa.Column("created_by", sa.Uuid(), nullable=True),
        sa.Column("updated_by", sa.Uuid(), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
        ),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_by", sa.Uuid(), nullable=True),
        sa.ForeignKeyConstraint(
            ["aseguradora_id"], ["aseguradoras.id"],
            name=op.f("fk_aseguradora_polizas_aseguradora_id_aseguradoras"), ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["created_by"], ["users.id"],
            name=op.f("fk_aseguradora_polizas_created_by_users"), ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["updated_by"], ["users.id"],
            name=op.f("fk_aseguradora_polizas_updated_by_users"), ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["deleted_by"], ["users.id"],
            name=op.f("fk_aseguradora_polizas_deleted_by_users"), ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_aseguradora_polizas")),
    )
    op.create_index(
        "ix_aseguradora_polizas_aseguradora_id",
        "aseguradora_polizas",
        ["aseguradora_id"],
        postgresql_where="deleted_at IS NULL",
    )


def downgrade() -> None:
    op.drop_index("ix_aseguradora_polizas_aseguradora_id", table_name="aseguradora_polizas")
    op.drop_table("aseguradora_polizas")
