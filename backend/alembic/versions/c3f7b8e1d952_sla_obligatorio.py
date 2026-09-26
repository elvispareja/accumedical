"""aseguradoras: el SLA de un módulo contratado es obligatorio

Horas y precio dejan de ser opcionales: un módulo contratado sin SLA es un
acuerdo a medias. La regla ya la impone el servicio —exige que lleguen TODOS los
módulos activos, y nombra los que falten—; esto la asienta en la base, que es
donde no se puede saltar.

Las filas existentes se rellenaron antes con valores de ejemplo (24 h · 25,00)
desde la propia API, así que la columna se puede endurecer sin defaults
inventados aquí dentro: si quedara algún nulo, esta migración fallaría en voz
alta en lugar de tapar el agujero.

Revision ID: c3f7b8e1d952
Revises: b9e5c2a7d340
Create Date: 2026-09-18
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "c3f7b8e1d952"
down_revision = "b9e5c2a7d340"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column("aseguradora_sla", "horas", existing_type=sa.Numeric(6, 2), nullable=False)
    op.alter_column("aseguradora_sla", "precio", existing_type=sa.Numeric(12, 2), nullable=False)


def downgrade() -> None:
    op.alter_column("aseguradora_sla", "precio", existing_type=sa.Numeric(12, 2), nullable=True)
    op.alter_column("aseguradora_sla", "horas", existing_type=sa.Numeric(6, 2), nullable=True)
