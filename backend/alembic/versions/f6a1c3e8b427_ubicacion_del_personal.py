"""usuarios: provincia y ciudad del personal de plataforma

Dónde está cada supervisor o médico auditor. Sirve para que, al derivar un
caso, el supervisor vea primero a los auditores de la misma ciudad del destino,
luego a los de la provincia y al final al resto. Nulables: los usuarios de
aseguradora no la necesitan y el personal ya creado la irá completando. La FK
compuesta contra `ciudades` garantiza, como en aseguradoras y prestadores, que
la ciudad pertenezca a la provincia elegida.

Revision ID: f6a1c3e8b427
Revises: e7b2d9f4a061
Create Date: 2026-09-02
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "f6a1c3e8b427"
down_revision = "e7b2d9f4a061"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("provincia_codigo", sa.String(length=2), nullable=True))
    op.add_column("users", sa.Column("ciudad_codigo", sa.String(length=4), nullable=True))
    op.create_foreign_key(
        "fk_users_provincia_codigo_provincias",
        "users",
        "provincias",
        ["provincia_codigo"],
        ["codigo"],
        ondelete="RESTRICT",
    )
    op.create_foreign_key(
        "fk_users_ciudad_codigo_ciudades",
        "users",
        "ciudades",
        ["ciudad_codigo", "provincia_codigo"],
        ["codigo", "provincia_codigo"],
        ondelete="RESTRICT",
    )


def downgrade() -> None:
    op.drop_constraint("fk_users_ciudad_codigo_ciudades", "users", type_="foreignkey")
    op.drop_constraint("fk_users_provincia_codigo_provincias", "users", type_="foreignkey")
    op.drop_column("users", "ciudad_codigo")
    op.drop_column("users", "provincia_codigo")
