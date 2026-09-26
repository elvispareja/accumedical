"""modulos habilitados por aseguradora

Revision ID: b7d2f1c9a4e3
Revises: 8c1d0a4e77b2
Create Date: 2026-08-28

A qué módulos puede entrar cada aseguradora. Mismo patrón que `user_module_access`:
destildar una casilla pone `activo = false` y conserva la fila con quién y cuándo
la revocó, en lugar de borrarla. Así queda rastro y se respeta la regla de que en
esta plataforma no hay borrado físico.
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "b7d2f1c9a4e3"
down_revision: str | None = "8c1d0a4e77b2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "aseguradora_modulos",
        sa.Column("aseguradora_id", sa.Uuid(), nullable=False),
        sa.Column("module_code", sa.String(length=30), nullable=False),
        sa.Column("activo", sa.Boolean(), server_default="true", nullable=False),
        sa.Column("granted_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("granted_by", sa.Uuid(), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_by", sa.Uuid(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(
            ["aseguradora_id"], ["aseguradoras.id"],
            name=op.f("fk_aseguradora_modulos_aseguradora_id_aseguradoras"), ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["module_code"], ["modules.code"],
            name=op.f("fk_aseguradora_modulos_module_code_modules"), ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["granted_by"], ["users.id"],
            name=op.f("fk_aseguradora_modulos_granted_by_users"), ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["revoked_by"], ["users.id"],
            name=op.f("fk_aseguradora_modulos_revoked_by_users"), ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("aseguradora_id", "module_code", name=op.f("pk_aseguradora_modulos")),
    )
    # Responde "¿qué aseguradoras tienen habilitado el módulo X?", que es la
    # consulta que harán los módulos cuando tengan lógica propia.
    op.create_index("ix_aseguradora_modulos_module_code", "aseguradora_modulos", ["module_code"])


def downgrade() -> None:
    op.drop_index("ix_aseguradora_modulos_module_code", table_name="aseguradora_modulos")
    op.drop_table("aseguradora_modulos")
