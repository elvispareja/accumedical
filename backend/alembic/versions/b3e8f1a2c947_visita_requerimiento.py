"""conc_visitas: por qué medio y cuándo llegó el requerimiento

Pedido del usuario (26/10/2026): en el alta del coordinador, debajo de la
aseguradora, se anota si el requerimiento llegó por correo o por otro medio
(cuál) y la fecha y hora en que llegó. Columnas opcionales: los casos que la
compañía crea en el sistema no las llevan.

Revision ID: b3e8f1a2c947
Revises: a7d3e9c1b852
Create Date: 2026-10-26
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "b3e8f1a2c947"
down_revision = "a7d3e9c1b852"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("conc_visitas", sa.Column("requerimiento_medio", sa.String(10), nullable=True))
    op.add_column(
        "conc_visitas", sa.Column("requerimiento_medio_detalle", sa.String(60), nullable=True)
    )
    op.add_column(
        "conc_visitas",
        sa.Column("requerimiento_recibido_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_check_constraint(
        "requerimiento_medio",
        "conc_visitas",
        "requerimiento_medio IS NULL OR requerimiento_medio IN ('correo','otro')",
    )


def downgrade() -> None:
    op.drop_constraint("ck_conc_visitas_requerimiento_medio", "conc_visitas", type_="check")
    op.drop_column("conc_visitas", "requerimiento_recibido_at")
    op.drop_column("conc_visitas", "requerimiento_medio_detalle")
    op.drop_column("conc_visitas", "requerimiento_medio")
