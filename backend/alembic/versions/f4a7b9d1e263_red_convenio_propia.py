"""red convenio: la ficha propia de Accumedical

La empresa arma su PROPIA red de prestadores con la misma maquinaria de
convenios que usan las aseguradoras (marcar la red, listado de precios,
valores FC). Para no duplicar tablas ni endpoints, la contraparte es una
ficha interna en `aseguradoras` marcada `es_propia = true`, que:

- NO aparece en el listado de aseguradoras ni en ningún selector;
- un índice único parcial garantiza que solo pueda existir UNA;
- se crea aquí mismo, para que «Red convenio» funcione sin pasos manuales.

Revision ID: f4a7b9d1e263
Revises: e3f6a8c2d945
Create Date: 2026-09-18
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "f4a7b9d1e263"
down_revision = "e3f6a8c2d945"
branch_labels = None
depends_on = None

# El RUC de la ficha interna. Único entre vivos, como cualquier otro.
RUC_PROPIO = "0999999999001"


def upgrade() -> None:
    op.add_column(
        "aseguradoras",
        sa.Column("es_propia", sa.Boolean(), nullable=False, server_default="false"),
    )
    # A lo sumo UNA ficha propia: el índice único parcial lo garantiza la base.
    op.create_index(
        "uq_aseguradoras_propia",
        "aseguradoras",
        ["es_propia"],
        unique=True,
        postgresql_where=sa.text("es_propia"),
    )
    op.execute(
        sa.text(
            "INSERT INTO aseguradoras "
            "(id, razon_social, nombre_comercial, ruc, latitud, longitud, estado, es_propia) "
            "VALUES (gen_random_uuid(), 'ACCURATE BILLING & MEDICAL AUDIT S.A.', "
            "'ACCUMEDICAL', :ruc, -2.1894, -79.8891, 'activo', true)"
        ).bindparams(ruc=RUC_PROPIO)
    )


def downgrade() -> None:
    # Si la red propia ya tiene convenios, el FK RESTRICT detiene este DELETE
    # en voz alta: no se pierde historia por accidente.
    op.execute(sa.text("DELETE FROM aseguradoras WHERE es_propia"))
    op.drop_index("uq_aseguradoras_propia", table_name="aseguradoras")
    op.drop_column("aseguradoras", "es_propia")
