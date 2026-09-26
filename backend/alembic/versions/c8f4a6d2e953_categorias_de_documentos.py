"""aseguradoras: los documentos PDF se organizan por categoría

La tabla de pólizas se generaliza: cada documento lleva su categoría —pólizas
y planes, cobertura y condiciones, SLA, convenios— y el formulario enseña una
pestaña por categoría, todas con el mismo panel de subir/ver/retirar. Las
filas existentes quedan como 'polizas', que es lo que eran.

Revision ID: c8f4a6d2e953
Revises: b6e8d2f4c791
Create Date: 2026-09-17
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "c8f4a6d2e953"
down_revision = "b6e8d2f4c791"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "aseguradora_polizas",
        sa.Column("categoria", sa.String(length=30), nullable=False, server_default="polizas"),
    )
    op.create_check_constraint(
        "categoria_catalogo",
        "aseguradora_polizas",
        "categoria IN ('polizas', 'cobertura_condiciones', 'sla', 'convenios')",
    )


def downgrade() -> None:
    op.drop_constraint(
        "ck_aseguradora_polizas_categoria_catalogo", "aseguradora_polizas", type_="check"
    )
    op.drop_column("aseguradora_polizas", "categoria")
