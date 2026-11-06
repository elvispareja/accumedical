"""aseguradora_productos: ligado a su contrato; condiciones que pueden faltar

Decisiones del usuario (6/11/2026): «un contrato puede traer varios
productos» → cada producto dice de qué contrato sale (`contrato_id`, el PDF de
«Contratos y pólizas»), y está vigente mientras lo esté su contrato. Y crear un
producto no debe abrumar: se crea con nombre, contrato y servicios; el tope, la
cobertura, la carencia, los beneficiarios y lo de farmacia pueden faltar y el
producto queda «incompleto» (no se usa) hasta llenarlos. Por eso esas columnas
admiten nulo y la receta deja de ser obligatoria con Farmacia (sigue prohibida
sin ella). La central hace lo mismo en su 0021, ANTES que esta.

Revision ID: a9c3e7f1b462
Revises: f7a1c3e5b829
Create Date: 2026-11-06
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "a9c3e7f1b462"
down_revision = "f7a1c3e5b829"
branch_labels = None
depends_on = None

T = "aseguradora_productos"
_NULOS = (("valor", sa.Numeric(12, 2)), ("porcentaje", sa.Numeric(5, 2)),
          ("beneficiarios_incluidos", sa.Boolean()), ("carencia_dias", sa.Integer()))


def upgrade() -> None:
    op.add_column(T, sa.Column("contrato_id", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        op.f("fk_aseguradora_productos_contrato_id_aseguradora_polizas"), T,
        "aseguradora_polizas", ["contrato_id"], ["id"], ondelete="RESTRICT",
    )
    for columna, tipo in _NULOS:
        op.alter_column(T, columna, existing_type=tipo, nullable=True)
    op.drop_constraint(op.f("ck_aseguradora_productos_receta_con_farmacia"), T, type_="check")
    op.create_check_constraint(
        "receta_con_farmacia", T, "'farmacia' = ANY(servicios) OR vigencia_receta_horas IS NULL"
    )


def downgrade() -> None:
    op.execute(
        "DO $$ BEGIN IF EXISTS (SELECT 1 FROM aseguradora_productos WHERE contrato_id IS NOT NULL"
        " OR valor IS NULL OR porcentaje IS NULL OR beneficiarios_incluidos IS NULL"
        " OR carencia_dias IS NULL OR ('farmacia' = ANY(servicios) AND vigencia_receta_horas IS NULL))"
        " THEN RAISE EXCEPTION 'hay productos ligados a contrato o incompletos: respaldarlos';"
        " END IF; END $$"
    )
    op.drop_constraint(op.f("ck_aseguradora_productos_receta_con_farmacia"), T, type_="check")
    op.create_check_constraint(
        "receta_con_farmacia", T,
        "('farmacia' = ANY(servicios)) = (vigencia_receta_horas IS NOT NULL)",
    )
    for columna, tipo in _NULOS:
        op.alter_column(T, columna, existing_type=tipo, nullable=False)
    op.drop_constraint(
        op.f("fk_aseguradora_productos_contrato_id_aseguradora_polizas"), T, type_="foreignkey"
    )
    op.drop_column(T, "contrato_id")
