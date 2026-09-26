"""catálogo: Carta de Vida pasa a llamarse Autorización de Crédito

Solo cambia la identidad PÚBLICA (nombre y slug); la canónica —code
`carta_credito`, paquete Python, prefijo de tablas— queda congelada, como en
el renombre anterior (e5b9d7c3a248). El módulo sigue en la familia Siniestro.

Revision ID: a3c7e9b5d162
Revises: f8d2c6e4a917
Create Date: 2026-09-16
"""

from __future__ import annotations

from alembic import op

revision = "a3c7e9b5d162"
down_revision = "f8d2c6e4a917"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        UPDATE modules
        SET nombre = 'Autorización de Crédito', slug = 'autorizacion-credito'
        WHERE code = 'carta_credito'
        """
    )


def downgrade() -> None:
    op.execute(
        """
        UPDATE modules
        SET nombre = 'Carta de Vida', slug = 'carta-vida'
        WHERE code = 'carta_credito'
        """
    )
