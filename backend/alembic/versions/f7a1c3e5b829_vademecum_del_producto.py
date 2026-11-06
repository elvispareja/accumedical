"""aseguradora_productos.vademecum: los medicamentos que cubre cada producto

Especificación de la Central, M5 (6/11/2026): el vademécum del producto es el
subconjunto del maestro (que vive en la central, tabla `vademecum`) que cubre un
producto que «requiere vademécum». Códigos «VAD-00001»; la API comprueba contra
la central que existan y estén activos. La central hace lo mismo en su 0018,
ANTES que esta.

Revision ID: f7a1c3e5b829
Revises: e5f9b3c7a246
Create Date: 2026-11-06
"""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "f7a1c3e5b829"
down_revision = "e5f9b3c7a246"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "aseguradora_productos",
        sa.Column("vademecum", postgresql.ARRAY(sa.String(9)), nullable=False,
                  server_default=sa.text("'{}'")),
    )
    op.alter_column("aseguradora_productos", "vademecum", server_default=None)
    op.create_check_constraint(
        "vademecum_lista", "aseguradora_productos",
        "requiere_vademecum IS TRUE OR cardinality(vademecum) = 0",
    )


def downgrade() -> None:
    op.execute(
        "DO $$ BEGIN IF EXISTS (SELECT 1 FROM aseguradora_productos"
        " WHERE cardinality(vademecum) > 0) THEN RAISE EXCEPTION"
        " 'hay productos con vademécum: respaldarlos antes de bajar'; END IF; END $$"
    )
    op.drop_constraint(
        op.f("ck_aseguradora_productos_vademecum_lista"), "aseguradora_productos", type_="check"
    )
    op.drop_column("aseguradora_productos", "vademecum")
