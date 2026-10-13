"""Concurrencia guarda el informe firmado EXACTO de cada entrega

Revision ID: a7d3e9c2f518
Revises: f3a8c5e1d724
Create Date: 2026-10-13

D3 de la separación (accumedical-central): al pulsar «Enviar informe» se
guarda el PDF firmado que recibió la gente, cifrado (AES-256-GCM, llave
derivada del SECRET_KEY, id de la fila como dato asociado) y numerado por caso.
Corregir y reenviar crea la entrega siguiente; ninguna se pisa. Es lo único
del caso que otra aplicación puede ver, con un enlace de un solo uso de la
central. Tabla nueva: no se toca ninguna existente.
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "a7d3e9c2f518"
down_revision = "f3a8c5e1d724"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "conc_informes_entregados",
        sa.Column("id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("visita_id", sa.Uuid(), nullable=False),
        sa.Column("numero", sa.Integer(), nullable=False),
        sa.Column("sha256", sa.String(length=64), nullable=False),
        sa.Column("tamano_bytes", sa.Integer(), nullable=False),
        sa.Column("contenido_cifrado", sa.LargeBinary(), nullable=False),
        sa.Column("firmante", sa.String(length=200), nullable=True),
        sa.Column("entregado_por", sa.Uuid(), nullable=False),
        sa.Column(
            "entregado_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("evento_central_id", sa.Uuid(), nullable=True),
        sa.Column("intentos", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("ultimo_error", sa.String(length=200), nullable=True),
        sa.CheckConstraint("numero >= 1", name=op.f("ck_conc_informes_entregados_numero_positivo")),
        sa.CheckConstraint(
            "sha256 ~ '^[0-9a-f]{64}$'", name=op.f("ck_conc_informes_entregados_sha256_formato")
        ),
        sa.CheckConstraint("tamano_bytes > 0", name=op.f("ck_conc_informes_entregados_tamano")),
        sa.ForeignKeyConstraint(
            ["entregado_por"],
            ["users.id"],
            name=op.f("fk_conc_informes_entregados_entregado_por_users"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["visita_id"],
            ["conc_visitas.id"],
            name=op.f("fk_conc_informes_entregados_visita_id_conc_visitas"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_conc_informes_entregados")),
    )
    op.create_index(
        "uq_conc_informes_entregados_visita_numero",
        "conc_informes_entregados",
        ["visita_id", "numero"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index(
        "uq_conc_informes_entregados_visita_numero", table_name="conc_informes_entregados"
    )
    op.drop_table("conc_informes_entregados")
