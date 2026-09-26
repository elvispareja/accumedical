"""suscripción: Requisitos de Asegurabilidad; se retira la DST

La familia Suscripción queda con DOS módulos: «Requisitos de Asegurabilidad»
—el Examen de Asegurabilidad renombrado, mismo `code` congelado, como se hizo
con Autorización de Crédito— y «Calificación de Riesgo». La Declaración de
Salud (DST) se retira (`activo = false`, fila conservada); no tenía concesiones
ni código construido.

Revision ID: a5b8c3e7f419
Revises: f4a7b9d1e263
Create Date: 2026-09-18
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "a5b8c3e7f419"
down_revision = "f4a7b9d1e263"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        sa.text(
            "UPDATE modules SET nombre = 'Requisitos de Asegurabilidad', "
            "slug = 'requisitos-asegurabilidad' WHERE code = 'examen_asegurabilidad'"
        )
    )
    op.execute(sa.text("UPDATE modules SET activo = false WHERE code = 'declaracion_salud'"))


def downgrade() -> None:
    op.execute(sa.text("UPDATE modules SET activo = true WHERE code = 'declaracion_salud'"))
    op.execute(
        sa.text(
            "UPDATE modules SET nombre = 'Examen de Asegurabilidad', "
            "slug = 'examen-asegurabilidad' WHERE code = 'examen_asegurabilidad'"
        )
    )
