"""El plazo de llegada vive aparte, y la entrega del informe sale del SLA

Revision ID: d7e2f9a3c418
Revises: c6d3b8e4f172
Create Date: 2026-09-26

Hasta ahora el alta pedía una ventana entera —`desde` y `hasta` tecleados— y el
vencimiento miraba `hasta`. Desde este cambio:

* `desde` sigue siendo **a qué hora debe llegar el auditor**, y es lo único que
  se teclea.
* `hasta` pasa a ser **cuándo vence la entrega del informe**, y ya no se teclea:
  se calcula como `desde + las horas de SLA` que esa compañía tiene pactadas
  para Concurrencia. Se materializa en la fila a propósito: renegociar el SLA
  mañana no puede mover el plazo de un caso ya abierto.
* `llegada_limite` es nuevo: **hasta cuándo se le acepta la llegada al
  auditor**. Nace igual a `desde` y cada prórroga del coordinador lo empuja a
  «ahora + las horas que ponga», que es como se pidió: se cuenta desde que
  pulsa, no desde la hora original.

Son dos plazos distintos y por eso son dos columnas: con una sola, extender la
llegada correría también la entrega y dejaríamos de poder decir si un informe
llegó tarde.

Los casos que ya existen reciben `llegada_limite = desde`, que es exactamente
la regla que se les venía aplicando; su `hasta` no se toca, porque fue tecleado
y es lo que se pactó en su momento.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "d7e2f9a3c418"
down_revision = "c6d3b8e4f172"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "conc_visitas",
        sa.Column("llegada_limite", sa.DateTime(timezone=True), nullable=True),
    )
    op.execute("UPDATE conc_visitas SET llegada_limite = desde WHERE llegada_limite IS NULL")
    op.alter_column("conc_visitas", "llegada_limite", nullable=False)
    # Prorrogar solo puede dar MÁS tiempo, nunca menos del que ya se concedió.
    op.create_check_constraint(
        "limite", "conc_visitas", "llegada_limite >= desde"
    )


def downgrade() -> None:
    op.drop_constraint("ck_conc_visitas_limite", "conc_visitas", type_="check")
    op.drop_column("conc_visitas", "llegada_limite")
