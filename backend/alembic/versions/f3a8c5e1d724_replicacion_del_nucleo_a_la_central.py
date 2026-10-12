"""El núcleo anota qué foto de cada entidad envió a la API central

Revision ID: f3a8c5e1d724
Revises: e1c4a7d2b913
Create Date: 2026-10-12

Paso 4b de la separación (accumedical-central): mientras el admin de
aseguradoras y prestadores siga aquí, esta base es la fuente y la central su
réplica. Cada minuto se toma la foto de cada entidad (aseguradoras, contactos,
prestadores, sedes, módulos contratados, SLA, coberturas, convenios y sus
valores FC) y solo se envía si su huella SHA-256 cambió. Esta tabla guarda esa
última huella por entidad y el último error, si lo hubo.
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "f3a8c5e1d724"
down_revision = "e1c4a7d2b913"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "central_replicacion",
        sa.Column("entidad", sa.String(length=40), nullable=False),
        sa.Column("huella", sa.CHAR(length=64), nullable=True),
        sa.Column("enviado_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ultimo_error", sa.String(length=200), nullable=True),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
        ),
        sa.PrimaryKeyConstraint("entidad", name=op.f("pk_central_replicacion")),
    )


def downgrade() -> None:
    op.drop_table("central_replicacion")
