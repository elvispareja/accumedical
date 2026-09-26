"""concurrencia: el paciente del caso, obligatorio

Un caso de concurrencia ES el seguimiento de un paciente hospitalizado: sin
paciente no hay caso. Nombre, apellidos, tipo y número de identificación, los
cuatro NOT NULL y sin valor por defecto —no existe un paciente por defecto que
no sea mentira—, así que la tabla debe estar vacía al migrar; el usuario ordenó
borrar los casos existentes justo antes (eran de prueba y quedaron listados en
la conversación).

El tipo de identificación es FK al catálogo `tipos_documento`, y el formato del
número lo valida el servicio contra el regex del catálogo, igual que en los
contactos.

Revision ID: d4a8f6c1e935
Revises: c9d6e4f2b713
Create Date: 2026-09-01
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "d4a8f6c1e935"
down_revision = "c9d6e4f2b713"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "conc_visitas", sa.Column("paciente_nombre", sa.String(length=100), nullable=False)
    )
    op.add_column(
        "conc_visitas", sa.Column("paciente_apellido", sa.String(length=100), nullable=False)
    )
    op.add_column(
        "conc_visitas",
        sa.Column("paciente_tipo_documento_codigo", sa.String(length=10), nullable=False),
    )
    op.add_column(
        "conc_visitas",
        sa.Column("paciente_numero_documento", sa.String(length=20), nullable=False),
    )
    op.create_foreign_key(
        None,  # la convención: fk_conc_visitas_paciente_tipo_documento_codigo_tipos_documento
        "conc_visitas",
        "tipos_documento",
        ["paciente_tipo_documento_codigo"],
        ["codigo"],
        ondelete="RESTRICT",
    )


def downgrade() -> None:
    op.drop_constraint(
        "fk_conc_visitas_paciente_tipo_documento_codigo_tipos_documento",
        "conc_visitas",
        type_="foreignkey",
    )
    op.drop_column("conc_visitas", "paciente_numero_documento")
    op.drop_column("conc_visitas", "paciente_tipo_documento_codigo")
    op.drop_column("conc_visitas", "paciente_apellido")
    op.drop_column("conc_visitas", "paciente_nombre")
