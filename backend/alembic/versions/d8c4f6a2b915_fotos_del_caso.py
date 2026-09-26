"""concurrencia: las fotos que el auditor toma en el hospital

En la visita, además de dictar, el auditor fotografía lo relevante —hojas del
expediente, resultados, la pizarra de enfermería— y cada imagen queda como una
fila del caso. Son materia prima del informe igual que las notas: la IA las
recibe junto al dictado y las incorpora al análisis. Solo se guarda la ruta
relativa dentro del volumen de subidas, como el comprobante de horario y los
logos: el archivo vive fuera del árbol ejecutable y se sirve sin ejecución.

Revision ID: d8c4f6a2b915
Revises: c7f2a9d4e163
Create Date: 2026-09-03
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "d8c4f6a2b915"
down_revision = "c7f2a9d4e163"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "conc_visita_fotos",
        sa.Column("id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("visita_id", sa.Uuid(), nullable=False),
        sa.Column("ruta", sa.String(length=300), nullable=False),
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
            ["visita_id"], ["conc_visitas.id"],
            name=op.f("fk_conc_visita_fotos_visita_id_conc_visitas"), ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["created_by"], ["users.id"],
            name=op.f("fk_conc_visita_fotos_created_by_users"), ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["updated_by"], ["users.id"],
            name=op.f("fk_conc_visita_fotos_updated_by_users"), ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["deleted_by"], ["users.id"],
            name=op.f("fk_conc_visita_fotos_deleted_by_users"), ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_conc_visita_fotos")),
    )
    op.create_index(
        "ix_conc_visita_fotos_visita_id",
        "conc_visita_fotos",
        ["visita_id"],
        postgresql_where="deleted_at IS NULL",
    )


def downgrade() -> None:
    op.drop_index("ix_conc_visita_fotos_visita_id", table_name="conc_visita_fotos")
    op.drop_table("conc_visita_fotos")
