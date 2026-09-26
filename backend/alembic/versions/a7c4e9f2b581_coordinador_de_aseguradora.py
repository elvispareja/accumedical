"""aseguradora: un solo coordinador, y abarca todos sus módulos

La compañía tiene **un** coordinador, y entra a todos los módulos que ella
tenga habilitados —los de `aseguradora_modulos` activos—, sin marcárselos uno a
uno. Si mañana contrata otro módulo, su coordinador ya lo cubre; si lo destilda,
deja de cubrirlo. Es la misma idea que el coordinador de plataforma, pero el
alcance aquí lo define la aseguradora, no la familia comercial.

El **operador** no cambia: sigue entrando a los módulos que se le marquen, y
puede haber varios.

No se guarda la lista de módulos del coordinador en ninguna fila: se calcula. Lo
único que se guarda es que ESA persona coordina ESA compañía.

Revision ID: a7c4e9f2b581
Revises: f5a8d3c6b924
Create Date: 2026-09-18
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "a7c4e9f2b581"
down_revision = "f5a8d3c6b924"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "user_aseguradora_coordinador",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        # Redundante con `users.aseguradora_id` a propósito: sin ella no se puede
        # escribir el índice «uno por compañía», que es la regla entera.
        sa.Column("aseguradora_id", sa.UUID(), nullable=False),
        sa.Column("activo", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("granted_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.Column("granted_by", sa.UUID(), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_by", sa.UUID(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="RESTRICT",
                                name="fk_user_aseguradora_coordinador_user_id_users"),
        sa.ForeignKeyConstraint(["aseguradora_id"], ["aseguradoras.id"], ondelete="RESTRICT",
                                name="fk_user_aseguradora_coordinador_aseguradora_id"),
        sa.ForeignKeyConstraint(["granted_by"], ["users.id"], ondelete="RESTRICT",
                                name="fk_user_aseguradora_coordinador_granted_by_users"),
        sa.ForeignKeyConstraint(["revoked_by"], ["users.id"], ondelete="RESTRICT",
                                name="fk_user_aseguradora_coordinador_revoked_by_users"),
        sa.PrimaryKeyConstraint("id", name="pk_user_aseguradora_coordinador"),
        # Una fila por persona: cambiar de rol es UPDATE sobre ella.
        sa.UniqueConstraint("user_id", name="uq_user_aseguradora_coordinador_user_id"),
    )
    # UNO SOLO por compañía, garantizado por la base sobre las filas vivas.
    op.create_index(
        "uq_user_aseguradora_coordinador_unico",
        "user_aseguradora_coordinador",
        ["aseguradora_id"],
        unique=True,
        postgresql_where=sa.text("activo"),
    )

    # El supervisor que ya existía en cada compañía pasa a ser su coordinador.
    # Si por lo que fuera hubiera dos en la misma, el índice único lo diría aquí
    # y en voz alta, que es donde debe doler.
    op.execute(
        """
        INSERT INTO user_aseguradora_coordinador (id, user_id, aseguradora_id)
        SELECT DISTINCT ON (u.aseguradora_id) gen_random_uuid(), u.id, u.aseguradora_id
        FROM users u
        JOIN user_module_access uma ON uma.user_id = u.id AND uma.activo
        JOIN roles r ON r.id = uma.role_id AND r.code = 'supervisor'
        WHERE u.aseguradora_id IS NOT NULL AND u.deleted_at IS NULL
        ORDER BY u.aseguradora_id, u.created_at
        """
    )
    # Sus filas por módulo sobran: su alcance ahora sale de la compañía.
    op.execute(
        """
        UPDATE user_module_access uma
        SET activo = false, revoked_at = now()
        FROM roles r, user_aseguradora_coordinador c
        WHERE r.id = uma.role_id AND c.user_id = uma.user_id
          AND r.code = 'supervisor' AND uma.activo
        """
    )


def downgrade() -> None:
    op.execute(
        """
        UPDATE user_module_access uma
        SET activo = true, revoked_at = NULL
        FROM roles r, user_aseguradora_coordinador c
        WHERE r.id = uma.role_id AND c.user_id = uma.user_id
          AND r.code = 'supervisor' AND NOT uma.activo AND uma.revoked_at IS NOT NULL
        """
    )
    op.drop_index(
        "uq_user_aseguradora_coordinador_unico", table_name="user_aseguradora_coordinador"
    )
    op.drop_table("user_aseguradora_coordinador")
