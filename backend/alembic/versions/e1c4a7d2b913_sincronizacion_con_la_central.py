"""Concurrencia anota qué publicó en la API central

Revision ID: e1c4a7d2b913
Revises: d7e2f9a3c418
Create Date: 2026-10-12

Primer paso de la separación (accumedical-central): Concurrencia publica sus
pacientes como `personas` y sus visitas culminadas como eventos
`visita_concurrencia` en la central. Esta tabla, propia del módulo, guarda
qué se publicó de cada visita (los ids en la central), cuántas veces falló y
el último error, para que la tarea periódica reintente solo lo pendiente.

Tabla nueva y no columnas en `conc_visitas`: la sincronización es una
preocupación aparte y así no se altera ninguna tabla existente.
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "e1c4a7d2b913"
down_revision = "d7e2f9a3c418"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "conc_sync_central",
        sa.Column("visita_id", sa.Uuid(), nullable=False),
        sa.Column("persona_central_id", sa.Uuid(), nullable=True),
        sa.Column("evento_central_id", sa.Uuid(), nullable=True),
        sa.Column("sincronizada_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("intentos", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("ultimo_error", sa.String(length=200), nullable=True),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
        ),
        sa.ForeignKeyConstraint(
            ["visita_id"],
            ["conc_visitas.id"],
            name=op.f("fk_conc_sync_central_visita_id_conc_visitas"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("visita_id", name=op.f("pk_conc_sync_central")),
    )


def downgrade() -> None:
    op.drop_table("conc_sync_central")
