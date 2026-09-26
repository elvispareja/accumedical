"""núcleo: la campana de notificaciones

Una tabla compartida, no de módulo: cada módulo escribe su fila cuando ocurre
algo que alguien debe saber, y la campana del armazón las lee todas igual.

Dos decisiones que explican la forma:

- **El texto se guarda ya compuesto** (`titulo`, `subtitulo`, `detalle`) en vez
  de calcularse al leer. Un aviso es la foto de lo que pasó: si el caso cambia
  de estado mañana, la notificación tiene que seguir diciendo lo que decía.
- **Sin FK a la entidad de origen.** `entidad` + `entidad_id` son una referencia
  suelta a propósito: el núcleo no puede depender de las tablas de un módulo, y
  con ocho módulos por delante esa FK sería imposible de escribir.

Leer no borra: pone `leida_at`. El historial de lo avisado se conserva.

Revision ID: e7f4a2c9b806
Revises: d6b3f9c8e214
Create Date: 2026-09-18
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "e7f4a2c9b806"
down_revision = "d6b3f9c8e214"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "notificaciones",
        sa.Column(
            "id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False
        ),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("module_code", sa.String(length=30), nullable=False),
        sa.Column("titulo", sa.String(length=120), nullable=False),
        sa.Column("subtitulo", sa.String(length=200), nullable=False),
        sa.Column("detalle", sa.String(length=300), nullable=False),
        sa.Column("url", sa.String(length=300), nullable=False),
        sa.Column("entidad", sa.String(length=50), nullable=False),
        sa.Column("entidad_id", sa.Uuid(), nullable=False),
        sa.Column("leida_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["module_code"],
            ["modules.code"],
            name=op.f("fk_notificaciones_module_code_modules"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_notificaciones_user_id_users"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_notificaciones")),
    )
    # La campana pregunta siempre lo mismo: lo mío, lo no leído primero y lo más
    # reciente arriba.
    op.create_index(
        "ix_notificaciones_bandeja",
        "notificaciones",
        ["user_id", "leida_at", "created_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_notificaciones_bandeja", table_name="notificaciones")
    op.drop_table("notificaciones")
