"""conc_visitas: sin CHECK «hasta > desde» (el SLA corre desde el pedido)

Pedido del usuario (27/10/2026): el SLA de la compañía se cuenta desde que
llegó el pedido —el alta de la compañía o el «Requerimiento» de nuestra
coordinación—, no desde la hora de la visita. La entrega (`hasta`) puede
quedar antes de la ventana de visita, así que el CHECK `ventana` sobra.

Revision ID: c6a2d4f8e135
Revises: b3e8f1a2c947
Create Date: 2026-10-27
"""

from __future__ import annotations

from alembic import op

revision = "c6a2d4f8e135"
down_revision = "b3e8f1a2c947"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_constraint(op.f("ck_conc_visitas_ventana"), "conc_visitas", type_="check")


def downgrade() -> None:
    op.create_check_constraint("ventana", "conc_visitas", "hasta > desde")
