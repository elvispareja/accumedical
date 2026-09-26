"""El convenio dice qué red cubre: privada, pública o ambas

Revision ID: a3e9c15b7d42
Revises: f2c7d9a4e531
Create Date: 2026-09-22

Dos casillas y no un valor de tres opciones: «ambas» es marcar las dos, y así
una consulta por «las que cubren pública» no tiene que acordarse de incluir un
tercer valor. El CHECK exige al menos una: un convenio que no cubre ninguna red
no es un convenio.

Los convenios que ya existen quedan en PRIVADA, que es lo que hace el DEFAULT.
No se adivina a qué red pertenece cada uno: se corrigen desde la pantalla.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "a3e9c15b7d42"
down_revision = "f2c7d9a4e531"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "aseguradora_prestador",
        sa.Column("red_privada", sa.Boolean(), nullable=False, server_default=sa.text("true")),
    )
    op.add_column(
        "aseguradora_prestador",
        sa.Column("red_publica", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.create_check_constraint(
        "red", "aseguradora_prestador", "red_privada OR red_publica"
    )


def downgrade() -> None:
    op.drop_constraint("ck_aseguradora_prestador_red", "aseguradora_prestador", type_="check")
    op.drop_column("aseguradora_prestador", "red_publica")
    op.drop_column("aseguradora_prestador", "red_privada")
