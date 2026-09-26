"""Dos estados más para la visita: asignada y auditando

Revision ID: f2c7d9a4e531
Revises: e7f4a2c9b806
Create Date: 2026-09-19

El estado de un caso deja de ser un campo que alguien teclea y pasa a ser la
consecuencia de lo que ocurrió, así que hacían falta los dos que faltaban:

    programada ──► asignada ──► auditando ──► culminada
         │             │
         │             └──► no_auditado   (la ventana venció sin llegada)
         └──► cancelada                   (el operador, mientras nadie llegó)

Los datos no se pierden ni se inventan: los estados viejos siguen siendo
válidos, y lo único que se pone al día son las visitas que YA están derivadas a
un auditor y seguían figurando como programadas. Eso no es reescribir historia:
es la misma realidad con el nombre que ahora tiene.
"""

from __future__ import annotations

from alembic import op

revision = "f2c7d9a4e531"
down_revision = "e7f4a2c9b806"
branch_labels = None
depends_on = None


ESTADOS_NUEVOS = "'programada','asignada','auditando','cancelada','culminada','no_auditado'"
ESTADOS_VIEJOS = "'programada','cancelada','culminada','no_auditado'"


def upgrade() -> None:
    op.drop_constraint("estado", "conc_visitas", type_="check")
    op.create_check_constraint(
        "estado", "conc_visitas", f"estado IN ({ESTADOS_NUEVOS})"
    )
    # Lo que ya está derivado se llama por su nombre.
    op.execute(
        "UPDATE conc_visitas SET estado = 'asignada' "
        "WHERE estado = 'programada' AND auditor_id IS NOT NULL AND deleted_at IS NULL"
    )


def downgrade() -> None:
    # Al volver atrás, los dos estados nuevos se pliegan sobre el que existía
    # antes: los dos describen una visita que todavía no ocurrió.
    op.execute(
        "UPDATE conc_visitas SET estado = 'programada' "
        "WHERE estado IN ('asignada','auditando')"
    )
    op.drop_constraint("estado", "conc_visitas", type_="check")
    op.create_check_constraint(
        "estado", "conc_visitas", f"estado IN ({ESTADOS_VIEJOS})"
    )
