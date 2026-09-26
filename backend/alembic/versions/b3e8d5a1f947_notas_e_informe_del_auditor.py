"""concurrencia: las notas dictadas del auditor y el informe final

En el hospital, el auditor dicta lo que encuentra —el historial clínico del
paciente, las charlas con enfermería y con los médicos— y cada dictado queda
como una nota tipificada del caso. Con esas notas, la IA redacta el informe
final, que se guarda en la propia visita: una columna y no una tabla porque el
informe vigente es uno (regenerarlo lo reemplaza) y la película de cambios ya
la lleva AuditLog.

Revision ID: b3e8d5a1f947
Revises: f6a1c3e8b427
Create Date: 2026-09-02
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "b3e8d5a1f947"
down_revision = "f6a1c3e8b427"
branch_labels = None
depends_on = None

TIPOS = ("historial_clinico", "charla_enfermeria", "charla_medico", "observacion")


def upgrade() -> None:
    op.create_table(
        "conc_visita_notas",
        sa.Column("id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("visita_id", sa.Uuid(), nullable=False),
        sa.Column("tipo", sa.String(length=30), nullable=False),
        sa.Column("texto", sa.Text(), nullable=False),
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
        sa.CheckConstraint(
            "tipo IN ('historial_clinico','charla_enfermeria','charla_medico','observacion')",
            name=op.f("ck_conc_visita_notas_tipo"),
        ),
        sa.ForeignKeyConstraint(
            ["visita_id"], ["conc_visitas.id"],
            name=op.f("fk_conc_visita_notas_visita_id_conc_visitas"), ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["created_by"], ["users.id"],
            name=op.f("fk_conc_visita_notas_created_by_users"), ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["updated_by"], ["users.id"],
            name=op.f("fk_conc_visita_notas_updated_by_users"), ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["deleted_by"], ["users.id"],
            name=op.f("fk_conc_visita_notas_deleted_by_users"), ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_conc_visita_notas")),
    )
    op.create_index(
        "ix_conc_visita_notas_visita_id",
        "conc_visita_notas",
        ["visita_id"],
        postgresql_where="deleted_at IS NULL",
    )

    # El informe vigente del caso, redactado por la IA a partir de las notas.
    op.add_column("conc_visitas", sa.Column("informe", sa.Text(), nullable=True))
    op.add_column(
        "conc_visitas",
        sa.Column("informe_actualizado_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("conc_visitas", "informe_actualizado_at")
    op.drop_column("conc_visitas", "informe")
    op.drop_index("ix_conc_visita_notas_visita_id", table_name="conc_visita_notas")
    op.drop_table("conc_visita_notas")
