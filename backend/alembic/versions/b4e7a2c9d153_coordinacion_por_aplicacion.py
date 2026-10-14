"""Coordinadores por aplicación: historial de coordinaciones (14/10/2026).

El coordinador de Accumedical deja de ser de una FAMILIA (uno solo por
Suscripción o Siniestro) y pasa a ser de cada APLICACIÓN, con varios por
aplicación. Esta tabla guarda quién coordinó cada una y en qué tramo.

La conversión de los coordinadores de familia que existan NO va aquí: sus
filas viajan a la central y se hace con el servicio de la plataforma
(`scripts/coordinacion-por-aplicacion.py` en el repo de infraestructura).
"""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "b4e7a2c9d153"
down_revision = "a7d3e9c2f518"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "coordinacion_historial",
        sa.Column("id", postgresql.UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("module_code", sa.String(30), nullable=False),
        sa.Column("desde", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("hasta", sa.DateTime(timezone=True), nullable=True),
        sa.Column("otorgado_por", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("retirado_por", postgresql.UUID(as_uuid=True), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], name=op.f("fk_coordinacion_historial_user_id_users"), ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["module_code"], ["modules.code"], name=op.f("fk_coordinacion_historial_module_code_modules"), ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["otorgado_por"], ["users.id"], name=op.f("fk_coordinacion_historial_otorgado_por_users"), ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["retirado_por"], ["users.id"], name=op.f("fk_coordinacion_historial_retirado_por_users"), ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_coordinacion_historial")),
    )
    op.create_index("ix_coordinacion_historial_module_code", "coordinacion_historial", ["module_code"])
    op.create_index("uq_coordinacion_historial_abierto", "coordinacion_historial", ["user_id", "module_code"],
                    unique=True, postgresql_where=sa.text("hasta IS NULL"))
    # Ya no hay «uno solo por familia»: los coordinadores son por aplicación.
    op.drop_index("uq_user_grupo_access_coordinador_unico", table_name="user_grupo_access")


def downgrade() -> None:
    op.create_index("uq_user_grupo_access_coordinador_unico", "user_grupo_access", ["grupo"],
                    unique=True, postgresql_where=sa.text("activo"))
    op.drop_index("uq_coordinacion_historial_abierto", table_name="coordinacion_historial")
    op.drop_index("ix_coordinacion_historial_module_code", table_name="coordinacion_historial")
    op.drop_table("coordinacion_historial")
