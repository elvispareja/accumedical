"""aseguradora_producto_servicios: cada servicio del producto con sus condiciones

Decisión del usuario (6/11/2026): «que funcione para ambos casos». Un plan real
paga distinto cada servicio (hospitalario al 100 % hasta USD 20.000, ambulatorio
al 80 % hasta USD 1.500, farmacia al 80 %) y otro, como Asistencia Total,
comparte un solo tope entre sus servicios. Por eso:

- el producto guarda el tope COMÚN (`valor` + `tope_unidad`, ahora siempre en
  pareja) y lo que vale para todos (contrato, quiénes entran, carencia...);
- cada servicio guarda su cobertura, su tope propio (opcional), su deducible
  (nuevo: lo que paga primero el asegurado) y sus eventos.

Cada producto vivo pasa tal cual: un servicio por cada uno de `servicios`, con
la cobertura y los eventos que tenía; su tope sigue siendo el común. Fechas y
autoría salen del producto, así la central (0022) tiene las MISMAS filas. Los
dados de baja conservan su cobertura y sus eventos como histórico (nada se
borra). La central corre su 0022 ANTES que esta.

Revision ID: b8d2f4a6c913
Revises: a9c3e7f1b462
Create Date: 2026-11-06
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "b8d2f4a6c913"
down_revision = "a9c3e7f1b462"
branch_labels = None
depends_on = None

T = "aseguradora_productos"
S = "aseguradora_producto_servicios"


def upgrade() -> None:
    op.create_table(
        S,
        sa.Column("producto_id", sa.Uuid(), nullable=False),
        sa.Column("servicio", sa.String(length=30), nullable=False),
        sa.Column("porcentaje", sa.Numeric(precision=5, scale=2), nullable=True),
        sa.Column("tope", sa.Numeric(precision=12, scale=2), nullable=True),
        sa.Column("tope_unidad", sa.String(length=20), nullable=True),
        sa.Column("deducible", sa.Numeric(precision=12, scale=2), server_default="0",
                  nullable=False),
        sa.Column("deducible_unidad", sa.String(length=20), nullable=True),
        sa.Column("eventos_maximo", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"),
                  nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"),
                  nullable=False),
        sa.Column("created_by", sa.Uuid(), nullable=True),
        sa.Column("updated_by", sa.Uuid(), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_by", sa.Uuid(), nullable=True),
        sa.CheckConstraint(
            "servicio IN ('farmacia', 'teleconsulta', 'consulta_ambulatoria', 'hospitalaria')",
            name=op.f("ck_aseguradora_producto_servicios_servicio")),
        sa.CheckConstraint("porcentaje BETWEEN 0 AND 100",
                           name=op.f("ck_aseguradora_producto_servicios_porcentaje")),
        sa.CheckConstraint("tope >= 0", name=op.f("ck_aseguradora_producto_servicios_tope")),
        sa.CheckConstraint("tope_unidad IN ('evento', 'persona_mes', 'persona_anio', 'receta')",
                           name=op.f("ck_aseguradora_producto_servicios_tope_unidad")),
        sa.CheckConstraint("(tope IS NULL) = (tope_unidad IS NULL)",
                           name=op.f("ck_aseguradora_producto_servicios_tope_con_unidad")),
        sa.CheckConstraint("servicio = 'farmacia' OR tope_unidad IS DISTINCT FROM 'receta'",
                           name=op.f("ck_aseguradora_producto_servicios_tope_por_receta")),
        sa.CheckConstraint("deducible >= 0",
                           name=op.f("ck_aseguradora_producto_servicios_deducible")),
        sa.CheckConstraint("deducible_unidad IN ('evento', 'persona_anio', 'familia_anio')",
                           name=op.f("ck_aseguradora_producto_servicios_deducible_unidad")),
        sa.CheckConstraint("(deducible = 0) = (deducible_unidad IS NULL)",
                           name=op.f("ck_aseguradora_producto_servicios_deducible_con_unidad")),
        sa.CheckConstraint("eventos_maximo >= 1",
                           name=op.f("ck_aseguradora_producto_servicios_eventos_maximo")),
        sa.ForeignKeyConstraint(
            ["producto_id"], ["aseguradora_productos.id"],
            name=op.f("fk_aseguradora_producto_servicios_producto_id_aseguradora_productos"),
            ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(
            ["created_by"], ["users.id"],
            name=op.f("fk_aseguradora_producto_servicios_created_by_users"), ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(
            ["updated_by"], ["users.id"],
            name=op.f("fk_aseguradora_producto_servicios_updated_by_users"), ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(
            ["deleted_by"], ["users.id"],
            name=op.f("fk_aseguradora_producto_servicios_deleted_by_users"), ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("producto_id", "servicio",
                                name=op.f("pk_aseguradora_producto_servicios")),
    )
    # Cada producto vivo, tal cual: un servicio por cada uno de los que cubre.
    op.execute(
        "INSERT INTO aseguradora_producto_servicios (producto_id, servicio, porcentaje, deducible, eventos_maximo,"
        " created_by, updated_by, created_at, updated_at)"
        " SELECT p.id, s.servicio, p.porcentaje, 0, p.eventos_maximo,"
        " p.updated_by, p.updated_by, p.updated_at, p.updated_at"
        " FROM aseguradora_productos p CROSS JOIN LATERAL unnest(p.servicios) AS s(servicio)"
        " WHERE p.deleted_at IS NULL"
    )
    op.execute("UPDATE aseguradora_productos SET porcentaje = NULL, eventos_maximo = NULL WHERE deleted_at IS NULL")
    # Un tope común con monto y sin unidad (o al revés) no se puede aplicar.
    op.execute(
        "DO $$ BEGIN IF EXISTS (SELECT 1 FROM aseguradora_productos WHERE deleted_at IS NULL"
        " AND (valor IS NULL) <> (tope_unidad IS NULL)) THEN RAISE EXCEPTION"
        " 'hay productos vivos con tope sin unidad: completarlos antes'; END IF; END $$"
    )
    op.create_check_constraint(
        "condiciones_por_servicio", T,
        "deleted_at IS NOT NULL OR (porcentaje IS NULL AND eventos_maximo IS NULL)",
    )
    op.create_check_constraint(
        "tope_con_unidad", T, "deleted_at IS NOT NULL OR (valor IS NULL) = (tope_unidad IS NULL)"
    )


def downgrade() -> None:
    # Solo si cabe en la forma anterior: una cobertura y unos eventos por producto,
    # sin tope propio ni deducible por servicio.
    op.execute(
        "DO $$ BEGIN IF EXISTS (SELECT 1 FROM aseguradora_producto_servicios WHERE deleted_at IS NULL"
        " AND (tope IS NOT NULL OR deducible <> 0))"
        " OR EXISTS (SELECT 1 FROM aseguradora_producto_servicios WHERE deleted_at IS NULL GROUP BY producto_id"
        " HAVING count(DISTINCT porcentaje) > 1 OR count(DISTINCT eventos_maximo) > 1)"
        " OR EXISTS (SELECT 1 FROM aseguradora_producto_servicios WHERE deleted_at IS NOT NULL)"
        " THEN RAISE EXCEPTION 'hay condiciones por servicio que la forma anterior no"
        " guarda: respaldarlas'; END IF; END $$"
    )
    op.drop_constraint(op.f("ck_aseguradora_productos_tope_con_unidad"), T, type_="check")
    op.drop_constraint(op.f("ck_aseguradora_productos_condiciones_por_servicio"), T, type_="check")
    op.execute(
        "UPDATE aseguradora_productos p SET porcentaje = s.porcentaje, eventos_maximo = s.eventos_maximo"
        " FROM (SELECT DISTINCT ON (producto_id) producto_id, porcentaje, eventos_maximo"
        " FROM aseguradora_producto_servicios WHERE deleted_at IS NULL ORDER BY producto_id) s"
        " WHERE p.id = s.producto_id"
    )
    op.drop_table(S)
