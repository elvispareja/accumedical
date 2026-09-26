"""aseguradoras: el SLA de cada módulo (horas y precio)

Lo pactado con la compañía para cada módulo que tiene contratado: cuántas horas
de SLA y a qué precio. Una fila por aseguradora y módulo; ambos valores son
opcionales, porque se van acordando.

La FK compuesta apunta a `aseguradora_modulos` —igual que las coberturas—, así
que no se puede pactar el SLA de un módulo que esa compañía no tiene. Destildar
el módulo NO borra lo pactado: la fila queda y reaparece si vuelve a marcarse,
que es lo que se espera de un acuerdo.

Revision ID: b9e5c2a7d340
Revises: a7c4e9f2b581
Create Date: 2026-09-18
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "b9e5c2a7d340"
down_revision = "a7c4e9f2b581"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "aseguradora_sla",
        sa.Column("aseguradora_id", sa.UUID(), nullable=False),
        sa.Column("module_code", sa.String(length=30), nullable=False),
        # Las horas del acuerdo. Numeric y no entero: media hora es un plazo
        # perfectamente pactable, y permitirlo ahora sale gratis.
        sa.Column("horas", sa.Numeric(precision=6, scale=2), nullable=True),
        sa.Column("precio", sa.Numeric(precision=12, scale=2), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.Column("created_by", sa.UUID(), nullable=True),
        sa.Column("updated_by", sa.UUID(), nullable=True),
        sa.CheckConstraint(
            "(horas IS NULL OR horas >= 0) AND (precio IS NULL OR precio >= 0)",
            name="ck_aseguradora_sla_importes",
        ),
        # No se puede pactar el SLA de un módulo que la compañía no tiene. Basta
        # con que la fila exista, aunque esté inactiva: así destildar conserva lo
        # acordado.
        sa.ForeignKeyConstraint(
            ["aseguradora_id", "module_code"],
            ["aseguradora_modulos.aseguradora_id", "aseguradora_modulos.module_code"],
            ondelete="RESTRICT",
            name="fk_aseguradora_sla_modulo",
        ),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="RESTRICT",
                                name="fk_aseguradora_sla_created_by_users"),
        sa.ForeignKeyConstraint(["updated_by"], ["users.id"], ondelete="RESTRICT",
                                name="fk_aseguradora_sla_updated_by_users"),
        sa.PrimaryKeyConstraint("aseguradora_id", "module_code", name="pk_aseguradora_sla"),
    )


def downgrade() -> None:
    op.drop_table("aseguradora_sla")
