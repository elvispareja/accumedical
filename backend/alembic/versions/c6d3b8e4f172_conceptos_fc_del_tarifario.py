"""Tres conceptos más en los valores FC: UCIN, Medicina e Imagenología

Revision ID: c6d3b8e4f172
Revises: b4f1a72c9e38
Create Date: 2026-09-22

La lista de conceptos que se pactan pasa de seis a nueve: entran **UCIN
(cuidados intensivos neonatales)**, **Medicina / Especialidades** e
**Imagenología / Radiología**.

Es justo lo que prometía la forma de tabla estrenada en `b4f1a72c9e38`: un
concepto nuevo no añade columnas ni toca ninguna fila, solo ensancha el CHECK
que dice qué códigos son válidos. Se recrean dos, el del concepto y el de la
base, porque un porcentaje puede salir de cualquiera de ellos.

**No se renombra ni se retira ningún código**, así que ningún convenio pierde lo
pactado. Los nombres que se leen en pantalla —«UCI - Cuidado Intensivo»,
«Recién Nacido / Neonatales»…— no viven en la base: los sirve el servidor
(`convenios.NOMBRES_FC`), y cambiarlos no necesita migración.

Gotcha del proyecto: a `drop_constraint` se le pasa el nombre CORTO, porque la
convención lo envuelve en `ck_{tabla}_{nombre}`.
"""

from __future__ import annotations

from alembic import op

revision = "c6d3b8e4f172"
down_revision = "b4f1a72c9e38"
branch_labels = None
depends_on = None

ANTES = "'cirugia','recien_nacido','evaluacion_manejo','ayudante','anestesia','uci'"
DESPUES = (
    "'cirugia','anestesia','evaluacion_manejo','uci','ucin',"
    "'recien_nacido','medicina','imagenologia','ayudante'"
)


def _fijar(conceptos: str) -> None:
    for nombre, columna in (("concepto", "concepto"), ("base", "base")):
        op.drop_constraint(nombre, "aseguradora_prestador_fc", type_="check")
        expresion = (
            f"{columna} IN ({conceptos})"
            if columna == "concepto"
            else f"{columna} IS NULL OR {columna} IN ({conceptos})"
        )
        op.create_check_constraint(nombre, "aseguradora_prestador_fc", expresion)


def upgrade() -> None:
    _fijar(DESPUES)


def downgrade() -> None:
    # Los conceptos nuevos se van con el CHECK: si alguien llegó a pactarlos, la
    # vuelta atrás fallaría, y es correcto que falle en lugar de borrar cifras.
    _fijar(ANTES)
