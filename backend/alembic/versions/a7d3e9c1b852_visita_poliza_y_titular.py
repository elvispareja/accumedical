"""conc_visitas: número de póliza y titular

Pedido del usuario (26/10/2026): en Concurrencia el caso lleva el número de
póliza y, si el paciente no es el titular, los datos del titular (cuatro
partes del nombre, identificación) y el parentesco del paciente con él.

Columnas nuevas, todas opcionales salvo `paciente_es_titular` (por defecto
true): los casos de antes quedan como «el paciente es el titular» y sin
póliza. Dos CHECK: parentesco del catálogo y titular completo cuando no es el
paciente.

Sigue la rama de `f1c3a8b2d604` (no la de Farmacovigilancia).

Revision ID: a7d3e9c1b852
Revises: f1c3a8b2d604
Create Date: 2026-10-26
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "a7d3e9c1b852"
down_revision = "f1c3a8b2d604"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("conc_visitas", sa.Column("poliza_numero", sa.String(40), nullable=True))
    op.add_column(
        "conc_visitas",
        sa.Column(
            "paciente_es_titular", sa.Boolean(), nullable=False, server_default=sa.text("true")
        ),
    )
    op.add_column("conc_visitas", sa.Column("titular_parentesco", sa.String(20), nullable=True))
    for campo in (
        "titular_nombre_principal",
        "titular_nombre_secundario",
        "titular_apellido_paterno",
        "titular_apellido_materno",
    ):
        op.add_column("conc_visitas", sa.Column(campo, sa.String(100), nullable=True))
    op.add_column(
        "conc_visitas", sa.Column("titular_tipo_documento_codigo", sa.String(10), nullable=True)
    )
    op.add_column(
        "conc_visitas", sa.Column("titular_numero_documento", sa.String(20), nullable=True)
    )
    op.create_foreign_key(
        None,  # la convención lo nombra: fk_conc_visitas_titular_tipo_documento_codigo_tipos_documento
        "conc_visitas",
        "tipos_documento",
        ["titular_tipo_documento_codigo"],
        ["codigo"],
        ondelete="RESTRICT",
    )
    op.create_check_constraint(
        "parentesco",
        "conc_visitas",
        "titular_parentesco IS NULL OR titular_parentesco IN "
        "('conyuge','hijo','padre_madre','otro')",
    )
    op.create_check_constraint(
        "titular",
        "conc_visitas",
        "paciente_es_titular OR (titular_nombre_principal IS NOT NULL "
        "AND titular_apellido_paterno IS NOT NULL "
        "AND titular_tipo_documento_codigo IS NOT NULL "
        "AND titular_numero_documento IS NOT NULL "
        "AND titular_parentesco IS NOT NULL)",
    )


def downgrade() -> None:
    op.drop_constraint("ck_conc_visitas_titular", "conc_visitas", type_="check")
    op.drop_constraint("ck_conc_visitas_parentesco", "conc_visitas", type_="check")
    op.drop_constraint(
        "fk_conc_visitas_titular_tipo_documento_codigo_tipos_documento",
        "conc_visitas",
        type_="foreignkey",
    )
    for campo in (
        "titular_numero_documento",
        "titular_tipo_documento_codigo",
        "titular_apellido_materno",
        "titular_apellido_paterno",
        "titular_nombre_secundario",
        "titular_nombre_principal",
        "titular_parentesco",
        "paciente_es_titular",
        "poliza_numero",
    ):
        op.drop_column("conc_visitas", campo)
