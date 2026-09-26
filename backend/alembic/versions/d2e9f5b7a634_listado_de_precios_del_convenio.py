"""convenios: el listado de precios del convenio

Cada convenio aseguradora-prestador puede llevar UN listado de precios (PDF o
Excel). Se guarda la ruta de almacenamiento (UUID, fuera del árbol ejecutable,
como toda subida) y el nombre visible. Subir otro archivo reemplaza al vigente.

Revision ID: d2e9f5b7a634
Revises: c8f4a6d2e953
Create Date: 2026-09-17
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "d2e9f5b7a634"
down_revision = "c8f4a6d2e953"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "aseguradora_prestador",
        sa.Column("listado_precios_ruta", sa.String(length=500), nullable=True),
    )
    op.add_column(
        "aseguradora_prestador",
        sa.Column("listado_precios_nombre", sa.String(length=160), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("aseguradora_prestador", "listado_precios_nombre")
    op.drop_column("aseguradora_prestador", "listado_precios_ruta")
