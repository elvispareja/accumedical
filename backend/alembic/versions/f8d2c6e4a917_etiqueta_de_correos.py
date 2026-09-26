"""concurrencia: quién es cada correo del caso

Al programar una visita, cada correo puede llevar una etiqueta que diga quién
es esa persona: los contactos del prestador la heredan de su ficha («RODOLFO
ALARCON · Gerente General») y los tecleados a mano la escriben ahí mismo
(«Auditor interno»). La etiqueta viaja en el aviso, en la lista «Este aviso se
envió a:», para que todos sepan quién es quién.

Revision ID: f8d2c6e4a917
Revises: e5b9d7c3a248
Create Date: 2026-09-16
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "f8d2c6e4a917"
down_revision = "e5b9d7c3a248"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Nulable: un correo sin etiqueta sigue siendo perfectamente válido, y las
    # filas ya guardadas quedan como están.
    op.add_column(
        "conc_visita_correos", sa.Column("etiqueta", sa.String(length=120), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("conc_visita_correos", "etiqueta")
