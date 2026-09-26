"""concurrencia: los estados de una visita son programada, cancelada y culminada

El flujo real de la operadora no distingue un «en curso» —nadie va a la pantalla
a marcar que el auditor acaba de entrar por la puerta— y «realizada» pasa a
llamarse «culminada», que es como se dice en el negocio. Tres estados: la visita
está por pasar, se canceló, o ya pasó.

Revision ID: a7e4d2c9f581
Revises: c5d71f8a3b06
Create Date: 2026-08-31
"""

from __future__ import annotations

from alembic import op

revision = "a7e4d2c9f581"
down_revision = "c5d71f8a3b06"
branch_labels = None
depends_on = None

# A `drop_constraint` se le pasa el nombre CORTO: la convención de nombres de
# `core/db.py` le antepone sola el ck_conc_visitas_, igual que al crearlo.
CHECK = "estado"


def upgrade() -> None:
    # Primero los datos, luego el CHECK: al revés, una fila vieja lo violaría.
    # «realizada» ES «culminada» con el nombre nuevo; «en_curso» vuelve a
    # «programada», porque una visita a medias es una visita que aún no terminó.
    op.execute("UPDATE conc_visitas SET estado = 'culminada' WHERE estado = 'realizada'")
    op.execute("UPDATE conc_visitas SET estado = 'programada' WHERE estado = 'en_curso'")

    op.drop_constraint(CHECK, "conc_visitas", type_="check")
    op.create_check_constraint(
        CHECK,
        "conc_visitas",
        "estado IN ('programada','cancelada','culminada')",
    )


def downgrade() -> None:
    op.execute("UPDATE conc_visitas SET estado = 'realizada' WHERE estado = 'culminada'")
    op.drop_constraint(CHECK, "conc_visitas", type_="check")
    op.create_check_constraint(
        CHECK,
        "conc_visitas",
        "estado IN ('programada','en_curso','realizada','cancelada')",
    )
