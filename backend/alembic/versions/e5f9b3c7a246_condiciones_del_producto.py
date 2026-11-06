"""aseguradora_productos: las condiciones de cobertura del producto (M2)

Especificación de la Central, M2 «Productos y condiciones de cobertura», decidido
el 6/11/2026: cada producto dice qué servicios cubre (farmacia, teleconsulta,
consulta ambulatoria, hospitalaria) y, según eso, sus condiciones: unidad del
tope, ventana del evento, número de eventos (nulo = ilimitado), vademécum y
despacho parcial (solo con Farmacia), máximo de diagnósticos por consulta (nulo
= sin límite), beneficiarios con sus parentescos, carencia y exclusiones. El
tope y el % de cobertura son `valor` y `porcentaje`, que ya existían.

Las filas con vigencia de receta quedan con el servicio Farmacia (la receta solo
existe en farmacia). La central hace lo mismo en su 0017, ANTES que esta.

Revision ID: e5f9b3c7a246
Revises: c2e8f4a6d135
Create Date: 2026-11-06
"""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "e5f9b3c7a246"
down_revision = "c2e8f4a6d135"
branch_labels = None
depends_on = None

T = "aseguradora_productos"
_CHECKS = (
    ("servicios", "servicios <@ ARRAY['farmacia', 'teleconsulta', 'consulta_ambulatoria',"
                  " 'hospitalaria']::varchar[]"),
    ("tope_unidad", "tope_unidad IS NULL OR tope_unidad IN ('evento', 'persona_mes',"
                    " 'persona_anio', 'receta')"),
    ("ventana_evento", "ventana_evento IS NULL OR ventana_evento IN ('mes_calendario',"
                       " 'dias_moviles_30', 'vigencia_poliza')"),
    ("eventos_maximo", "eventos_maximo IS NULL OR eventos_maximo >= 1"),
    ("max_diagnosticos", "max_diagnosticos IS NULL OR max_diagnosticos BETWEEN 1 AND 20"),
    ("carencia_dias", "carencia_dias BETWEEN 0 AND 3650"),
    ("parentescos", "parentescos <@ ARRAY['conyuge', 'hijos', 'padres']::varchar[]"),
    ("parentescos_con_beneficiarios", "beneficiarios_incluidos OR cardinality(parentescos) = 0"),
    ("receta_con_farmacia",
     "('farmacia' = ANY(servicios)) = (vigencia_receta_horas IS NOT NULL)"),
    ("farmacia_campos",
     "'farmacia' = ANY(servicios) OR (requiere_vademecum IS NULL AND despacho_parcial IS NULL)"),
)


def upgrade() -> None:
    op.add_column(T, sa.Column("servicios", postgresql.ARRAY(sa.String(30)), nullable=False,
                               server_default=sa.text("'{}'")))
    op.add_column(T, sa.Column("tope_unidad", sa.String(20), nullable=True))
    op.add_column(T, sa.Column("ventana_evento", sa.String(20), nullable=True))
    op.add_column(T, sa.Column("eventos_maximo", sa.Integer(), nullable=True))
    op.add_column(T, sa.Column("requiere_vademecum", sa.Boolean(), nullable=True))
    op.add_column(T, sa.Column("despacho_parcial", sa.Boolean(), nullable=True))
    op.add_column(T, sa.Column("max_diagnosticos", sa.Integer(), nullable=True))
    op.add_column(T, sa.Column("beneficiarios_incluidos", sa.Boolean(), nullable=False,
                               server_default=sa.false()))
    op.add_column(T, sa.Column("parentescos", postgresql.ARRAY(sa.String(20)), nullable=False,
                               server_default=sa.text("'{}'")))
    op.add_column(T, sa.Column("carencia_dias", sa.Integer(), nullable=False,
                               server_default=sa.text("0")))
    op.add_column(T, sa.Column("exclusiones", sa.String(2000), nullable=True))
    op.execute("UPDATE aseguradora_productos SET servicios = ARRAY['farmacia']::varchar[]"
               " WHERE vigencia_receta_horas IS NOT NULL")
    # Sin valores por omisión: la API manda siempre el producto completo.
    for columna in ("servicios", "beneficiarios_incluidos", "parentescos", "carencia_dias"):
        op.alter_column(T, columna, server_default=None)
    for nombre, condicion in _CHECKS:
        op.create_check_constraint(nombre, T, condicion)


def downgrade() -> None:
    # Volver atrás no puede tirar condiciones cargadas.
    op.execute("DO $$ BEGIN IF EXISTS (SELECT 1 FROM aseguradora_productos"
               " WHERE tope_unidad IS NOT NULL"
               " OR cardinality(servicios) > 0) THEN RAISE EXCEPTION"
               " 'hay productos con condiciones: respaldarlos antes de bajar'; END IF; END $$")
    for nombre, _condicion in reversed(_CHECKS):
        op.drop_constraint(op.f(f"ck_{T}_{nombre}"), T, type_="check")
    for columna in ("exclusiones", "carencia_dias", "parentescos", "beneficiarios_incluidos",
                    "max_diagnosticos", "despacho_parcial", "requiere_vademecum",
                    "eventos_maximo", "ventana_evento", "tope_unidad", "servicios"):
        op.drop_column(T, columna)
