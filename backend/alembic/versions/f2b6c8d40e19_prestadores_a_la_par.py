"""prestadores: codigo interno, ciudad, logo y contactos

Revision ID: f2b6c8d40e19
Revises: d5f3a91c2b48
Create Date: 2026-08-29

Pone a `prestadores` a la par de `aseguradoras`:
  - `codigo_interno` autogenerado (PREST-0001) por una secuencia de la base.
  - `ciudad_codigo` con la misma FK compuesta que impide guardar una ciudad de
    otra provincia.
  - `logo_path`, con los mismos controles A08 en el endpoint.
  - `prestador_contactos`, tabla propia y no compartida con aseguradoras: los
    prestadores tendrán campos propios más adelante y conviene que cada dueño
    tenga su tabla, con FK real en lugar de un dueño polimórfico.

Se retiran `email` y `telefono` de `prestadores` por la misma razón que en
aseguradoras: todo dato de contacto vive ahora en la tabla de contactos.
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "f2b6c8d40e19"
down_revision: str | None = "d5f3a91c2b48"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # ── Contactos ────────────────────────────────────────────────────────────
    op.create_table(
        "prestador_contactos",
        sa.Column("id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("prestador_id", sa.Uuid(), nullable=False),
        sa.Column("nombre", sa.String(length=100), nullable=False),
        sa.Column("apellido", sa.String(length=100), nullable=False),
        sa.Column("email", postgresql.CITEXT(), nullable=False),
        sa.Column("telefono", sa.String(length=25), nullable=True),
        sa.Column("tipo_documento_codigo", sa.String(length=10), nullable=True),
        sa.Column("numero_documento", sa.String(length=20), nullable=True),
        sa.Column("created_by", sa.Uuid(), nullable=True),
        sa.Column("updated_by", sa.Uuid(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_by", sa.Uuid(), nullable=True),
        sa.CheckConstraint(
            "(tipo_documento_codigo IS NULL) = (numero_documento IS NULL)",
            name=op.f("ck_prestador_contactos_documento"),
        ),
        sa.ForeignKeyConstraint(
            ["prestador_id"], ["prestadores.id"],
            name=op.f("fk_prestador_contactos_prestador_id_prestadores"), ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["tipo_documento_codigo"], ["tipos_documento.codigo"],
            name=op.f("fk_prestador_contactos_tipo_documento_codigo_tipos_documento"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["created_by"], ["users.id"],
            name=op.f("fk_prestador_contactos_created_by_users"), ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["updated_by"], ["users.id"],
            name=op.f("fk_prestador_contactos_updated_by_users"), ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["deleted_by"], ["users.id"],
            name=op.f("fk_prestador_contactos_deleted_by_users"), ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_prestador_contactos")),
    )
    op.create_index(
        "ix_prestador_contactos_prestador_id",
        "prestador_contactos",
        ["prestador_id"],
        postgresql_where="deleted_at IS NULL",
    )
    op.create_index(
        "uq_prestador_contactos_email",
        "prestador_contactos",
        ["prestador_id", "email"],
        unique=True,
        postgresql_where="deleted_at IS NULL",
    )

    # ── Paridad con aseguradoras ─────────────────────────────────────────────
    op.add_column("prestadores", sa.Column("ciudad_codigo", sa.String(length=4), nullable=True))
    op.add_column("prestadores", sa.Column("logo_path", sa.String(length=500), nullable=True))

    # La secuencia vive en la base: dos altas simultáneas no pueden obtener el
    # mismo número, cosa que sí pasaría calculándolo en la aplicación.
    op.execute("CREATE SEQUENCE prestadores_codigo_interno_seq")
    op.add_column("prestadores", sa.Column("codigo_interno", sa.String(length=20), nullable=True))
    op.execute(
        "ALTER TABLE prestadores ALTER COLUMN codigo_interno "
        "SET DEFAULT ('PREST-' || lpad(nextval('prestadores_codigo_interno_seq')::text, 4, '0'))"
    )
    op.execute(
        "UPDATE prestadores SET codigo_interno = "
        "'PREST-' || lpad(nextval('prestadores_codigo_interno_seq')::text, 4, '0') "
        "WHERE codigo_interno IS NULL"
    )
    op.alter_column("prestadores", "codigo_interno", nullable=False)
    op.create_index("uq_prestadores_codigo_interno", "prestadores", ["codigo_interno"], unique=True)

    # Misma FK compuesta que en aseguradoras: la ciudad debe pertenecer a la
    # provincia elegida, y lo garantiza la base, no una validación de servicio.
    op.create_foreign_key(
        "fk_prestadores_ciudad_codigo_ciudades",
        "prestadores", "ciudades",
        ["ciudad_codigo", "provincia_codigo"], ["codigo", "provincia_codigo"],
        ondelete="RESTRICT",
    )

    # Todo dato de contacto vive ahora en prestador_contactos.
    op.drop_column("prestadores", "email")
    op.drop_column("prestadores", "telefono")


def downgrade() -> None:
    op.add_column("prestadores", sa.Column("telefono", sa.String(length=25), nullable=True))
    op.add_column("prestadores", sa.Column("email", sa.String(length=254), nullable=True))
    op.drop_constraint("fk_prestadores_ciudad_codigo_ciudades", "prestadores", type_="foreignkey")
    op.drop_index("uq_prestadores_codigo_interno", table_name="prestadores")
    op.drop_column("prestadores", "codigo_interno")
    op.execute("DROP SEQUENCE prestadores_codigo_interno_seq")
    op.drop_column("prestadores", "logo_path")
    op.drop_column("prestadores", "ciudad_codigo")
    op.drop_index("uq_prestador_contactos_email", table_name="prestador_contactos")
    op.drop_index("ix_prestador_contactos_prestador_id", table_name="prestador_contactos")
    op.drop_table("prestador_contactos")
