"""plataforma: las funciones Convenio y Contabilidad

Dos tipos más de personal propio, y de cada uno hay **uno solo**:

- **Convenio**: lleva la red de convenios (la pantalla «Red convenio»).
- **Contabilidad**: su sección está por definir; el rol se deja listo para que
  el día que exista solo haya que abrirle la puerta.

No entran por módulo ni por familia: su trabajo es transversal, así que no
encajan en `user_module_access` ni en `user_grupo_access`. Tienen su propia
tabla, con la misma mecánica de siempre: revocar es `activo = false`, y el
índice único parcial sobre las filas vivas garantiza que no haya dos.

Revision ID: d6b3f9c8e214
Revises: c3f7b8e1d952
Create Date: 2026-09-18
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "d6b3f9c8e214"
down_revision = "c3f7b8e1d952"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "user_funcion",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("funcion", sa.String(length=20), nullable=False),
        sa.Column("activo", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("granted_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.Column("granted_by", sa.UUID(), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_by", sa.UUID(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.CheckConstraint(
            "funcion IN ('convenio', 'contabilidad')", name="ck_user_funcion_catalogo"
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="RESTRICT",
                                name="fk_user_funcion_user_id_users"),
        sa.ForeignKeyConstraint(["granted_by"], ["users.id"], ondelete="RESTRICT",
                                name="fk_user_funcion_granted_by_users"),
        sa.ForeignKeyConstraint(["revoked_by"], ["users.id"], ondelete="RESTRICT",
                                name="fk_user_funcion_revoked_by_users"),
        sa.PrimaryKeyConstraint("id", name="pk_user_funcion"),
        # Una fila por persona: cambiar de rol es UPDATE sobre ella.
        sa.UniqueConstraint("user_id", name="uq_user_funcion_user_id"),
    )
    # UNO SOLO de cada función, garantizado por la base sobre las filas vivas:
    # revocar libera el puesto sin borrar el historial.
    op.create_index(
        "uq_user_funcion_unica", "user_funcion", ["funcion"], unique=True,
        postgresql_where=sa.text("activo"),
    )


def downgrade() -> None:
    op.drop_index("uq_user_funcion_unica", table_name="user_funcion")
    op.drop_table("user_funcion")
