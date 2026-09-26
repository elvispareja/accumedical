"""concurrencia: el estado no_auditado y la llegada del auditor

Si la ventana de la visita pasa y el auditor nunca marcó «Ya llegué», el caso
queda como NO AUDITADO: un cuarto estado junto a programada, cancelada y
culminada, que una tarea periódica del servidor aplica sola. Para saberlo hace
falta que la llegada quede registrada: `llegada_at` guarda el momento en que el
auditor tocó «Ya llegué» en su app (nulo mientras no llegue).

Revision ID: c7f2a9d4e163
Revises: b3e8d5a1f947
Create Date: 2026-09-03
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "c7f2a9d4e163"
down_revision = "b3e8d5a1f947"
branch_labels = None
depends_on = None

# A `drop_constraint` se le pasa el nombre CORTO: la convención de nombres de
# la base le antepone `ck_conc_visitas_`.
CHECK = "estado"


def upgrade() -> None:
    op.add_column(
        "conc_visitas", sa.Column("llegada_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.drop_constraint(CHECK, "conc_visitas", type_="check")
    op.create_check_constraint(
        CHECK,
        "conc_visitas",
        "estado IN ('programada','cancelada','culminada','no_auditado')",
    )


def downgrade() -> None:
    # Un caso no auditado vuelve a programada: es el único estado del que salió.
    op.execute("UPDATE conc_visitas SET estado = 'programada' WHERE estado = 'no_auditado'")
    op.drop_constraint(CHECK, "conc_visitas", type_="check")
    op.create_check_constraint(
        CHECK,
        "conc_visitas",
        "estado IN ('programada','cancelada','culminada')",
    )
    op.drop_column("conc_visitas", "llegada_at")
