"""contactos: cargo

Revision ID: d1f80a6b3e57
Revises: b73e5c81f204
Create Date: 2026-08-30

El puesto que ocupa la persona en la compañía o en el prestador: «Gerente de
Siniestros», «Analista de Autorizaciones». Sirve para saber a quién dirigirse
según el asunto, que es justo para lo que están los contactos.

Se añade a las DOS tablas de contactos, no solo a la de aseguradoras: el
formulario es el mismo componente y la lógica de reconciliación también, así que
tenerlo en una sola las desalinearía a las primeras de cambio.

Nullable a propósito. Ya hay contactos guardados sin cargo, y una columna
`NOT NULL` sin valor por defecto no se puede añadir sobre filas existentes: habría
que inventarles un puesto, que es exactamente lo que no se debe hacer con el dato
de otro. Si más adelante se quiere obligatorio, se exige en el formulario y en el
esquema Pydantic sin tocar la base.

NO SE APLICA sin aprobación explícita (regla de CLAUDE.md).
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "d1f80a6b3e57"
down_revision: str | None = "b73e5c81f204"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TABLAS = ("aseguradora_contactos", "prestador_contactos")


def upgrade() -> None:
    for tabla in TABLAS:
        op.add_column(tabla, sa.Column("cargo", sa.String(length=100), nullable=True))


def downgrade() -> None:
    for tabla in TABLAS:
        op.drop_column(tabla, "cargo")
