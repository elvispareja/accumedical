"""concurrencia: la visita se deriva a un médico auditor

El supervisor de plataforma ve los casos que llegan de todas las aseguradoras y
deriva cada uno a un auditor. Eso es una columna en la visita: a quién se le
asignó. Nulable, porque una visita recién programada todavía no es de nadie.

Quién puede asignar y a quién se puede asignar lo decide el servicio —personal
de plataforma, rol auditor, activos—; la base solo garantiza que el usuario
exista y no se pueda borrar mientras tenga casos.

Revision ID: c9d6e4f2b713
Revises: b8f5e3d1a692
Create Date: 2026-08-31
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "c9d6e4f2b713"
down_revision = "b8f5e3d1a692"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("conc_visitas", sa.Column("auditor_id", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        None,  # la convención lo nombra: fk_conc_visitas_auditor_id_users
        "conc_visitas",
        "users",
        ["auditor_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    # La bandeja del auditor del futuro: «mis casos», vivos.
    op.create_index(
        "ix_conc_visitas_auditor_id",
        "conc_visitas",
        ["auditor_id"],
        postgresql_where=sa.text("deleted_at IS NULL AND auditor_id IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("ix_conc_visitas_auditor_id", table_name="conc_visitas")
    op.drop_constraint("fk_conc_visitas_auditor_id_users", "conc_visitas", type_="foreignkey")
    op.drop_column("conc_visitas", "auditor_id")
