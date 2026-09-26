"""valores FC: cuidado de recién nacido y evaluación y manejo

Dos importes más en los valores del convenio, al lado del general: el cuidado
de recién nacido y la evaluación y manejo (E&M). El CHECK de importes se
recrea para cubrirlos también.

Revision ID: e3f6a8c2d945
Revises: d2e9f5b7a634
Create Date: 2026-09-18
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "e3f6a8c2d945"
down_revision = "d2e9f5b7a634"
branch_labels = None
depends_on = None

TABLA = "aseguradora_prestador_valores"
CHECK_VIEJO = (
    "(fc_cirugia IS NULL OR fc_cirugia >= 0) "
    "AND (fc_general IS NULL OR fc_general >= 0) "
    "AND (uci_valor_fijo IS NULL OR uci_valor_fijo >= 0) "
    "AND (uci_puntos IS NULL OR uci_puntos >= 0)"
)
CHECK_NUEVO = (
    "(fc_cirugia IS NULL OR fc_cirugia >= 0) "
    "AND (fc_general IS NULL OR fc_general >= 0) "
    "AND (fc_recien_nacido IS NULL OR fc_recien_nacido >= 0) "
    "AND (fc_evaluacion_manejo IS NULL OR fc_evaluacion_manejo >= 0) "
    "AND (uci_valor_fijo IS NULL OR uci_valor_fijo >= 0) "
    "AND (uci_puntos IS NULL OR uci_puntos >= 0)"
)


# La convención de nombres del proyecto envuelve lo que se le pase
# (ck_{tabla}_{nombre}): a drop/create se les da el nombre CORTO.


def upgrade() -> None:
    op.add_column(TABLA, sa.Column("fc_recien_nacido", sa.Numeric(12, 2), nullable=True))
    op.add_column(TABLA, sa.Column("fc_evaluacion_manejo", sa.Numeric(12, 2), nullable=True))
    op.drop_constraint("importes", TABLA, type_="check")
    op.create_check_constraint("importes", TABLA, CHECK_NUEVO)


def downgrade() -> None:
    op.drop_constraint("importes", TABLA, type_="check")
    op.create_check_constraint("importes", TABLA, CHECK_VIEJO)
    op.drop_column(TABLA, "fc_evaluacion_manejo")
    op.drop_column(TABLA, "fc_recien_nacido")
