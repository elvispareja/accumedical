"""prestador_contactos.sede_id: la sede a la que pertenece el contacto

Pedido del usuario (26/10/2026): al añadir un contacto de un prestador se elige
su sede. NULL = la casa matriz. FK RESTRICT: las sedes no se borran, se
desactivan. La central tiene la misma columna (migración 0012) y es la dueña.

Va en RAMA aparte de `e4a7c2d9f513` (módulo Farmacovigilancia, solo en el
laboratorio): en AWS se aplica esta sin arrastrar aquella. Cuando Farmacovigilancia
pase a producción, una migración de unión junta las dos ramas.

Revision ID: f1c3a8b2d604
Revises: d1b5c8e3f742
Create Date: 2026-10-26
"""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "f1c3a8b2d604"
down_revision = "d1b5c8e3f742"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "prestador_contactos", sa.Column("sede_id", postgresql.UUID(as_uuid=True), nullable=True)
    )
    op.create_foreign_key(
        "prestador_contactos_sede_id_fkey",
        "prestador_contactos",
        "prestador_sedes",
        ["sede_id"],
        ["id"],
        ondelete="RESTRICT",
    )


def downgrade() -> None:
    op.drop_constraint("prestador_contactos_sede_id_fkey", "prestador_contactos", type_="foreignkey")
    op.drop_column("prestador_contactos", "sede_id")
