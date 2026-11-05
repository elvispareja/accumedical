"""aseguradoras.tipo: aseguradora, broker o cooperativa

Pedido del usuario (5/11/2026): en la ficha de la aseguradora, un select «Tipo»
con aseguradora, broker o cooperativa. La columna `tipo` ya existía reservada
(pública/privada/medicina prepagada) sin uso: vacía en todas las filas, en el
laboratorio y en producción, y sin pantalla ni app que la lea. Se le da su uso:
las existentes pasan a «aseguradora», el CHECK cambia y queda NOT NULL.

La central hace lo mismo en su 0013, ANTES que esta: las fichas se comparan
fila a fila y la columna tiene que valer lo mismo en las dos bases.

Revision ID: f3b7d1a9c254
Revises: d8b4f2e6a913
Create Date: 2026-11-05
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "f3b7d1a9c254"
down_revision = "d8b4f2e6a913"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Primero fuera el CHECK viejo (no admite los valores nuevos). Luego solo las
    # vacías: si alguna trajera un valor del uso viejo, el CHECK nuevo falla y la
    # migración se detiene en vez de inventar a qué tipo corresponde.
    op.drop_constraint(op.f("ck_aseguradoras_tipo"), "aseguradoras", type_="check")
    op.execute("UPDATE aseguradoras SET tipo = 'aseguradora' WHERE tipo IS NULL")
    op.create_check_constraint(
        "tipo", "aseguradoras", "tipo IN ('aseguradora','broker','cooperativa')"
    )
    op.alter_column(
        "aseguradoras",
        "tipo",
        existing_type=sa.String(30),
        nullable=False,
        server_default=sa.text("'aseguradora'"),
    )


def downgrade() -> None:
    op.alter_column(
        "aseguradoras", "tipo", existing_type=sa.String(30), nullable=True, server_default=None
    )
    op.drop_constraint(op.f("ck_aseguradoras_tipo"), "aseguradoras", type_="check")
    # Volver atrás no borra lo que se cargó (en medicina no se borra nada) y deja
    # las fichas editables: el CHECK admite los valores viejos Y los nuevos. Un
    # CHECK viejo NOT VALID no serviría: rige en cada UPDATE y ninguna ficha con
    # tipo nuevo se podría volver a guardar.
    op.create_check_constraint(
        "tipo",
        "aseguradoras",
        "tipo IN ('publica','privada','medicina_prepagada','aseguradora','broker','cooperativa')",
    )
