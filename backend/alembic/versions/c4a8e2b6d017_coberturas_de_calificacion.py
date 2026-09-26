"""coberturas contratadas por aseguradora

Revision ID: c4a8e2b6d017
Revises: b7d2f1c9a4e3
Create Date: 2026-08-28

Las coberturas son subramas de un módulo. Hoy solo `calificacion` tiene: vida,
asistencia médica y vida desgravamen.

Sin tabla de catálogo, por decisión explícita: las tres viven en un CHECK y en la
constante COBERTURAS del servicio. Es más simple ahora, a cambio de que añadir una
cobertura, o dárselas a otro módulo, exija una migración.

Al destildar un módulo sus coberturas NO se tocan: se conservan tal cual y vuelven
a mostrarse si el módulo se marca de nuevo.
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "c4a8e2b6d017"
down_revision: str | None = "b7d2f1c9a4e3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "aseguradora_coberturas",
        sa.Column("aseguradora_id", sa.Uuid(), nullable=False),
        sa.Column("module_code", sa.String(length=30), nullable=False),
        sa.Column("cobertura_codigo", sa.String(length=40), nullable=False),
        sa.Column("activo", sa.Boolean(), server_default="true", nullable=False),
        sa.Column("granted_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("granted_by", sa.Uuid(), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_by", sa.Uuid(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        # La aseguradora tiene que tener fila para ese módulo. Así es imposible
        # registrar una cobertura de un módulo que ni siquiera se le asignó.
        # Nótese que basta con que la fila exista: puede estar inactiva, que es
        # justo lo que permite conservar las coberturas al destildar el módulo.
        sa.ForeignKeyConstraint(
            ["aseguradora_id", "module_code"],
            ["aseguradora_modulos.aseguradora_id", "aseguradora_modulos.module_code"],
            name="fk_aseguradora_coberturas_modulo",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["granted_by"], ["users.id"],
            name=op.f("fk_aseguradora_coberturas_granted_by_users"), ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["revoked_by"], ["users.id"],
            name=op.f("fk_aseguradora_coberturas_revoked_by_users"), ondelete="RESTRICT",
        ),
        sa.CheckConstraint(
            "module_code = 'calificacion' AND cobertura_codigo IN "
            "('vida', 'asistencia_medica', 'vida_desgravamen')",
            name=op.f("ck_aseguradora_coberturas_catalogo"),
        ),
        sa.PrimaryKeyConstraint(
            "aseguradora_id", "module_code", "cobertura_codigo",
            name=op.f("pk_aseguradora_coberturas"),
        ),
    )


def downgrade() -> None:
    op.drop_table("aseguradora_coberturas")
