"""usuarios de aseguradora, acceso por cobertura e invitación por correo

Revision ID: b73e5c81f204
Revises: a91c4e7f2d38
Create Date: 2026-08-29

Tres piezas del mismo encargo: dar de alta usuarios de una aseguradora a partir
de sus contactos, acotar su acceso a los requerimientos que esa aseguradora
tiene contratados, y avisarles por correo con un enlace para fijar su contraseña.

1. `users.aseguradora_id` — a quién pertenece el usuario. NULL es personal de la
   plataforma (hoy, solo el administrador global). Es la palanca de ownership que
   ya usan el resto de tablas, y el CHECK impide que un superadmin pertenezca a
   una aseguradora: si perteneciera, su scope global y el de la compañía se
   contradirían.

2. `users.aseguradora_contacto_id` — de qué contacto salió. El usuario no se
   teclea aparte: se elige un contacto ya registrado y de ahí vienen nombre,
   apellido y correo, que así no pueden divergir. Único parcial: un contacto
   tiene como mucho un usuario vivo.

3. `user_cobertura_access` — el acceso fino. `user_module_access` sigue siendo LA
   puerta y no se toca: una fila por usuario y módulo, revocable al instante.
   Esta tabla solo ESTRECHA lo que ya se concedió, para el caso de Calificación,
   donde la aseguradora contrata coberturas sueltas. La FK compuesta contra
   `user_module_access` hace imposible conceder una cobertura de un módulo al que
   el usuario no entra.

   Lleva `role_id` propio porque el rol se elige POR REQUERIMIENTO: la misma
   persona puede ser supervisora en Vida y operadora en Vida desgravamen. Su FK
   compuesta `(role_id, module_code) → roles` repite la garantía de
   `user_module_access`: ningún rol de otro módulo puede colarse.

   Cuando un módulo tiene coberturas, el `role_id` de su fila en
   `user_module_access` es el MÁS AMPLIO de los que tenga dentro (supervisor si
   hay alguno, si no operador): esa fila es la puerta y debe dejar pasar, y lo
   que manda dentro es la fila de la cobertura.

4. `password_setup_tokens` — la invitación. Del token opaco de 256 bits solo se
   guarda su SHA-256, igual que las sesiones: quien lea la base no puede fijar la
   contraseña de nadie. De un solo uso y con caducidad.

Los usuarios invitados nacen con un hash de contraseña ALEATORIO e inservible en
lugar de con la columna vacía: así el login sigue ejecutando siempre argon2 —sin
rama nueva que abra un canal de tiempo— y sencillamente nunca acierta hasta que
la persona usa su enlace.

NO SE APLICA sin aprobación explícita (regla de CLAUDE.md).
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "b73e5c81f204"
down_revision: str | None = "a91c4e7f2d38"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # ── 1 y 2. El usuario pertenece a una aseguradora y sale de un contacto ──
    op.add_column("users", sa.Column("aseguradora_id", sa.Uuid(), nullable=True))
    op.add_column("users", sa.Column("aseguradora_contacto_id", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        op.f("fk_users_aseguradora_id_aseguradoras"),
        "users",
        "aseguradoras",
        ["aseguradora_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.create_foreign_key(
        op.f("fk_users_aseguradora_contacto_id_aseguradora_contactos"),
        "users",
        "aseguradora_contactos",
        ["aseguradora_contacto_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.create_check_constraint(
        op.f("ck_users_superadmin_sin_aseguradora"),
        "users",
        "NOT is_superadmin OR aseguradora_id IS NULL",
    )
    op.create_index(
        "ix_users_aseguradora_id",
        "users",
        ["aseguradora_id"],
        postgresql_where="deleted_at IS NULL",
    )
    # Un contacto tiene como mucho un usuario vivo. Parcial: si el usuario se
    # elimina, ese mismo contacto puede volver a tener uno.
    op.create_index(
        "uq_users_aseguradora_contacto_id",
        "users",
        ["aseguradora_contacto_id"],
        unique=True,
        postgresql_where="deleted_at IS NULL AND aseguradora_contacto_id IS NOT NULL",
    )

    # ── 3. Acceso por cobertura, que estrecha el acceso al módulo ────────────
    op.create_table(
        "user_cobertura_access",
        sa.Column("id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("module_code", sa.String(length=30), nullable=False),
        sa.Column("cobertura_codigo", sa.String(length=30), nullable=False),
        sa.Column("role_id", sa.Uuid(), nullable=False),
        sa.Column("activo", sa.Boolean(), server_default="true", nullable=False),
        sa.Column(
            "granted_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
        ),
        sa.Column("granted_by", sa.Uuid(), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_by", sa.Uuid(), nullable=True),
        # Espejo del CHECK de `aseguradora_coberturas`: la constante del servicio
        # y estos dos CHECK son la única fuente del catálogo, por decisión previa.
        sa.CheckConstraint(
            "module_code = 'calificacion' AND cobertura_codigo IN "
            "('vida', 'asistencia_medica', 'vida_desgravamen')",
            name=op.f("ck_user_cobertura_access_catalogo"),
        ),
        # FK COMPUESTA: no se puede conceder una cobertura de un módulo al que el
        # usuario no tiene acceso. Ningún bug de servicio puede saltárselo.
        sa.ForeignKeyConstraint(
            ["user_id", "module_code"],
            ["user_module_access.user_id", "user_module_access.module_code"],
            name=op.f("fk_user_cobertura_access_user_module_access"),
            ondelete="RESTRICT",
        ),
        # Misma garantía que en user_module_access: el rol pertenece al módulo.
        sa.ForeignKeyConstraint(
            ["role_id", "module_code"],
            ["roles.id", "roles.module_code"],
            name=op.f("fk_user_cobertura_access_role_id_roles"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["granted_by"],
            ["users.id"],
            name=op.f("fk_user_cobertura_access_granted_by_users"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["revoked_by"],
            ["users.id"],
            name=op.f("fk_user_cobertura_access_revoked_by_users"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_user_cobertura_access")),
        # Total, no parcial, igual que en user_module_access: a lo sumo una fila
        # por usuario, módulo y cobertura. Revocar es UPDATE, no borrar.
        sa.UniqueConstraint(
            "user_id",
            "module_code",
            "cobertura_codigo",
            name=op.f("uq_user_cobertura_access_user_id_module_code_cobertura_codigo"),
        ),
    )

    op.create_index("ix_user_cobertura_access_role_id", "user_cobertura_access", ["role_id"])

    # ── 4. Invitación para fijar la contraseña ───────────────────────────────
    op.create_table(
        "password_setup_tokens",
        sa.Column("id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        # Solo el SHA-256 del token, nunca el token. Mismo criterio que sessions.
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
        ),
        sa.Column("created_by", sa.Uuid(), nullable=True),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_password_setup_tokens_user_id_users"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["created_by"],
            ["users.id"],
            name=op.f("fk_password_setup_tokens_created_by_users"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_password_setup_tokens")),
        sa.UniqueConstraint("token_hash", name=op.f("uq_password_setup_tokens_token_hash")),
    )
    # Reenviar una invitación invalida la anterior, así que a lo sumo hay una
    # viva por usuario; el índice la encuentra sin recorrer la tabla.
    op.create_index(
        "ix_password_setup_tokens_user_id",
        "password_setup_tokens",
        ["user_id"],
        postgresql_where="used_at IS NULL",
    )
    op.create_index(
        "ix_password_setup_tokens_expires_at", "password_setup_tokens", ["expires_at"]
    )


def downgrade() -> None:
    op.drop_index("ix_password_setup_tokens_expires_at", table_name="password_setup_tokens")
    op.drop_index("ix_password_setup_tokens_user_id", table_name="password_setup_tokens")
    op.drop_table("password_setup_tokens")

    op.drop_index("ix_user_cobertura_access_role_id", table_name="user_cobertura_access")
    op.drop_table("user_cobertura_access")

    op.drop_index("uq_users_aseguradora_contacto_id", table_name="users")
    op.drop_index("ix_users_aseguradora_id", table_name="users")
    op.drop_constraint(op.f("ck_users_superadmin_sin_aseguradora"), "users", type_="check")
    op.drop_constraint(
        op.f("fk_users_aseguradora_contacto_id_aseguradora_contactos"), "users", type_="foreignkey"
    )
    op.drop_constraint(op.f("fk_users_aseguradora_id_aseguradoras"), "users", type_="foreignkey")
    op.drop_column("users", "aseguradora_contacto_id")
    op.drop_column("users", "aseguradora_id")
