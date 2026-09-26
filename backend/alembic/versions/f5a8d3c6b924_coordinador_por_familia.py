"""roles: «Supervisor» pasa a llamarse «Coordinador», y el propio abarca una familia

Dos cosas, y conviene no confundirlas:

1. **Es solo el término.** Donde decía «Supervisor» ahora dice «Coordinador»,
   tanto en el personal de Accumedical como en los usuarios de aseguradora. El
   `code` del rol sigue siendo `supervisor`: identidad canónica congelada, igual
   que `carta_credito` se llama Central de Crédito. Así ninguna dependencia de
   autorización cambia de significado por un cambio de nombre.

2. **El coordinador de PLATAFORMA abarca una familia entera** —toda Suscripción
   o todo Siniestro—, y hay uno solo por familia. Se guarda la familia y no la
   lista de módulos de hoy (`user_grupo_access`): el día que entre un módulo
   nuevo a Siniestro, su coordinador ya lo cubre sin reeditar a nadie. El
   coordinador de una ASEGURADORA no cambia: sigue siendo por módulo.

Revision ID: f5a8d3c6b924
Revises: e9f4c7b2d651
Create Date: 2026-09-18
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "f5a8d3c6b924"
down_revision = "e9f4c7b2d651"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── 1. El nombre visible del rol ─────────────────────────────────────────
    # «Supervisor de Auditoría de Concurrencia» → «Coordinador de …». El code
    # no se toca.
    op.execute(
        """
        UPDATE roles
        SET nombre = replace(nombre, 'Supervisor', 'Coordinador'),
            descripcion = 'Coordina el módulo o la familia a la que pertenece'
        WHERE code = 'supervisor'
        """
    )

    # ── 2. El acceso por familia, para el coordinador de plataforma ──────────
    op.create_table(
        "user_grupo_access",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        # La familia comercial: 'suscripcion' | 'siniestro'. Sin FK porque
        # `modules.grupo` no es una tabla; el CHECK la acota igual.
        sa.Column("grupo", sa.String(length=20), nullable=False),
        sa.Column("activo", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("granted_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.Column("granted_by", sa.UUID(), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_by", sa.UUID(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.CheckConstraint(
            "grupo IN ('suscripcion', 'siniestro')", name="ck_user_grupo_access_grupo"
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="RESTRICT",
                                name="fk_user_grupo_access_user_id_users"),
        sa.ForeignKeyConstraint(["granted_by"], ["users.id"], ondelete="RESTRICT",
                                name="fk_user_grupo_access_granted_by_users"),
        sa.ForeignKeyConstraint(["revoked_by"], ["users.id"], ondelete="RESTRICT",
                                name="fk_user_grupo_access_revoked_by_users"),
        sa.PrimaryKeyConstraint("id", name="pk_user_grupo_access"),
        # Total, como en user_module_access: una fila por usuario y familia.
        # Revocar y reactivar es UPDATE sobre ella; el historial va a audit_log.
        sa.UniqueConstraint("user_id", "grupo", name="uq_user_grupo_access_user_id_grupo"),
    )
    # UNO SOLO por familia, garantizado por la base y no por la disciplina del
    # servicio: índice único parcial sobre las filas vivas.
    op.create_index(
        "uq_user_grupo_access_coordinador_unico",
        "user_grupo_access",
        ["grupo"],
        unique=True,
        postgresql_where=sa.text("activo"),
    )

    # ── 3. El coordinador de plataforma que ya existía ───────────────────────
    # Pasa a la familia donde vive su acceso real (Concurrencia → Siniestro) y
    # sus filas por módulo se revocan: su alcance ahora sale de la familia. Los
    # usuarios de ASEGURADORA no se tocan.
    op.execute(
        """
        INSERT INTO user_grupo_access (id, user_id, grupo)
        SELECT gen_random_uuid(), u.id, 'siniestro'
        FROM users u
        WHERE u.aseguradora_id IS NULL
          AND u.is_superadmin = false
          AND u.deleted_at IS NULL
          AND EXISTS (
              SELECT 1 FROM user_module_access uma
              JOIN roles r ON r.id = uma.role_id
              WHERE uma.user_id = u.id AND uma.activo AND r.code = 'supervisor'
          )
        ON CONFLICT DO NOTHING
        """
    )
    op.execute(
        """
        UPDATE user_module_access uma
        SET activo = false, revoked_at = now()
        FROM roles r, users u
        WHERE r.id = uma.role_id AND u.id = uma.user_id
          AND r.code = 'supervisor' AND u.aseguradora_id IS NULL AND u.is_superadmin = false
          AND uma.activo
        """
    )


def downgrade() -> None:
    # Devolver al coordinador de plataforma sus módulos exactos es imposible: la
    # familia no guarda de cuáles venía. Se reactiva lo que quedó revocado, que
    # es justo lo que había antes de subir.
    op.execute(
        """
        UPDATE user_module_access uma
        SET activo = true, revoked_at = NULL
        FROM roles r, users u
        WHERE r.id = uma.role_id AND u.id = uma.user_id
          AND r.code = 'supervisor' AND u.aseguradora_id IS NULL AND u.is_superadmin = false
          AND NOT uma.activo AND uma.revoked_at IS NOT NULL
        """
    )
    op.drop_index("uq_user_grupo_access_coordinador_unico", table_name="user_grupo_access")
    op.drop_table("user_grupo_access")
    op.execute(
        """
        UPDATE roles
        SET nombre = replace(nombre, 'Coordinador', 'Supervisor'),
            descripcion = 'Supervisa y aprueba'
        WHERE code = 'supervisor'
        """
    )
