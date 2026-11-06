"""Vigencia de la receta en el producto; tarifa del contrato solo con farmacia

Decisión del usuario (6/11/2026): en farmacia el SLA es la vigencia de la receta
—el tiempo que tiene el paciente para ir con ella; pasado, la receta vence— y no
lleva precio ni monto. Va en cada producto (`aseguradora_productos.
vigencia_receta_horas`, nulo = no aplica), porque cada producto puede tener la
suya. Lo que cobra AccuMedical por farmacia va en el contrato; en los demás
módulos, en la pestaña SLA. Por eso la tarifa, su unidad y la forma de pago de
los medicamentos de `aseguradora_contratos` dejan de ser obligatorias: van las
tres juntas, y solo en un cliente con Farmacovigilancia (lo exige la API).

La central hace lo mismo en su 0016, ANTES que esta.

Revision ID: c2e8f4a6d135
Revises: b5d9e3f7a128
Create Date: 2026-11-06
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "c2e8f4a6d135"
down_revision = "b5d9e3f7a128"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "aseguradora_productos", sa.Column("vigencia_receta_horas", sa.Integer(), nullable=True)
    )
    op.create_check_constraint(
        "vigencia_receta_horas",
        "aseguradora_productos",
        "vigencia_receta_horas IS NULL OR vigencia_receta_horas BETWEEN 1 AND 8760",
    )
    for columna, tipo in (
        ("tarifa", sa.Numeric(14, 4)),
        ("tarifa_unidad", sa.String(20)),
        ("forma_pago_medicamentos", sa.String(30)),
    ):
        op.alter_column("aseguradora_contratos", columna, existing_type=tipo, nullable=True)
    op.create_check_constraint(
        "tarifa_completa",
        "aseguradora_contratos",
        "(tarifa IS NULL) = (tarifa_unidad IS NULL)"
        " AND (tarifa IS NULL) = (forma_pago_medicamentos IS NULL)",
    )


def downgrade() -> None:
    # Volver atrás no puede tirar lo cargado ni inventar una tarifa.
    op.execute(
        "DO $$ BEGIN"
        " IF EXISTS (SELECT 1 FROM aseguradora_productos WHERE vigencia_receta_horas IS NOT NULL)"
        " THEN RAISE EXCEPTION 'hay productos con vigencia de receta: respaldarlos antes de bajar';"
        " END IF;"
        " IF EXISTS (SELECT 1 FROM aseguradora_contratos WHERE tarifa IS NULL)"
        " THEN RAISE EXCEPTION 'hay contratos sin tarifa: completarlos o respaldarlos antes de bajar';"
        " END IF; END $$"
    )
    op.drop_constraint(
        op.f("ck_aseguradora_contratos_tarifa_completa"), "aseguradora_contratos", type_="check"
    )
    for columna, tipo in (
        ("tarifa", sa.Numeric(14, 4)),
        ("tarifa_unidad", sa.String(20)),
        ("forma_pago_medicamentos", sa.String(30)),
    ):
        op.alter_column("aseguradora_contratos", columna, existing_type=tipo, nullable=False)
    op.drop_constraint(
        op.f("ck_aseguradora_productos_vigencia_receta_horas"),
        "aseguradora_productos",
        type_="check",
    )
    op.drop_column("aseguradora_productos", "vigencia_receta_horas")
