"""concurrencia: el comprobante del cambio de horario

Cuando piden por correo cambiar la fecha de una visita, el supervisor sube una
imagen que lo comprueba (el pantallazo del correo) y reprograma. La imagen se
guarda como los logos: en el volumen de subidas, renombrada por la visita, y la
columna solo lleva la ruta relativa. Nulable: la mayoría de visitas no se
reprograman nunca.

Revision ID: e7b2d9f4a061
Revises: d4a8f6c1e935
Create Date: 2026-09-01
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "e7b2d9f4a061"
down_revision = "d4a8f6c1e935"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "conc_visitas",
        sa.Column("comprobante_horario_path", sa.String(length=300), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("conc_visitas", "comprobante_horario_path")
