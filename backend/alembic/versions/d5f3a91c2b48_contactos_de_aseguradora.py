"""contactos de la aseguradora

Revision ID: d5f3a91c2b48
Revises: c4a8e2b6d017
Create Date: 2026-08-29

Una aseguradora tiene varios contactos. Nombre, apellido y correo son obligatorios;
teléfono y documento son opcionales, y el tipo de documento sale del catálogo
`tipos_documento` que ya existe (cédula, RUC, pasaporte), reutilizando de paso su
`regex_validacion` para validar el número.

Se retiran `contacto_nombre`, `email` y `telefono` de `aseguradoras`: quedaban
sueltas de la especificación original, nunca entraron al formulario y ahora este
es el único sitio donde vive un contacto.
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "d5f3a91c2b48"
down_revision: str | None = "c4a8e2b6d017"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "aseguradora_contactos",
        sa.Column("id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("aseguradora_id", sa.Uuid(), nullable=False),
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
        # El documento es opcional, pero a medias no: o tipo y número, o ninguno.
        sa.CheckConstraint(
            "(tipo_documento_codigo IS NULL) = (numero_documento IS NULL)",
            name=op.f("ck_aseguradora_contactos_documento"),
        ),
        sa.ForeignKeyConstraint(
            ["aseguradora_id"], ["aseguradoras.id"],
            name=op.f("fk_aseguradora_contactos_aseguradora_id_aseguradoras"), ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["tipo_documento_codigo"], ["tipos_documento.codigo"],
            name=op.f("fk_aseguradora_contactos_tipo_documento_codigo_tipos_documento"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["created_by"], ["users.id"],
            name=op.f("fk_aseguradora_contactos_created_by_users"), ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["updated_by"], ["users.id"],
            name=op.f("fk_aseguradora_contactos_updated_by_users"), ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["deleted_by"], ["users.id"],
            name=op.f("fk_aseguradora_contactos_deleted_by_users"), ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_aseguradora_contactos")),
    )
    op.create_index(
        "ix_aseguradora_contactos_aseguradora_id",
        "aseguradora_contactos",
        ["aseguradora_id"],
        postgresql_where="deleted_at IS NULL",
    )
    # Unicidad PARCIAL, como toda unicidad de negocio aquí: un correo borrado
    # lógicamente no debe impedir volver a darlo de alta.
    op.create_index(
        "uq_aseguradora_contactos_email",
        "aseguradora_contactos",
        ["aseguradora_id", "email"],
        unique=True,
        postgresql_where="deleted_at IS NULL",
    )

    # Las tres columnas sueltas quedan sin sentido: el contacto ya tiene su tabla.
    op.drop_column("aseguradoras", "contacto_nombre")
    op.drop_column("aseguradoras", "email")
    op.drop_column("aseguradoras", "telefono")


def downgrade() -> None:
    op.add_column("aseguradoras", sa.Column("telefono", sa.String(length=25), nullable=True))
    op.add_column("aseguradoras", sa.Column("email", sa.String(length=254), nullable=True))
    op.add_column("aseguradoras", sa.Column("contacto_nombre", sa.String(length=150), nullable=True))
    op.drop_index("uq_aseguradora_contactos_email", table_name="aseguradora_contactos")
    op.drop_index("ix_aseguradora_contactos_aseguradora_id", table_name="aseguradora_contactos")
    op.drop_table("aseguradora_contactos")
