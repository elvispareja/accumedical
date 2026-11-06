"""aseguradora_contratos: los datos del contrato o póliza

Especificación de la Central (M1 «Clientes y contratos»), pedido del usuario
(6/11/2026, «sigue con lo de las pólizas»): cada PDF de la pestaña «Contratos y
pólizas» lleva su vigencia, la tarifa a AccuMedical con su unidad, la fecha de
revisión de la tarifa (opcional) y la forma de pago de los medicamentos.

Una fila por PDF (`poliza_id`). Los PDF ya subidos quedan sin fila hasta que
alguien completa sus datos: nada se inventa. Viaja a la central por réplica
(`contratos_aseguradora`, su migración 0015, que corre ANTES que esta).

Revision ID: b5d9e3f7a128
Revises: a4c8e2f6b917
Create Date: 2026-11-06
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "b5d9e3f7a128"
down_revision = "a4c8e2f6b917"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "aseguradora_contratos",
        sa.Column("poliza_id", sa.Uuid(), nullable=False),
        sa.Column("vigencia_desde", sa.Date(), nullable=False),
        sa.Column("vigencia_hasta", sa.Date(), nullable=False),
        sa.Column("tarifa", sa.Numeric(precision=14, scale=4), nullable=False),
        sa.Column("tarifa_unidad", sa.String(length=20), nullable=False),
        sa.Column("revision_tarifa", sa.Date(), nullable=True),
        sa.Column("forma_pago_medicamentos", sa.String(length=30), nullable=False),
        sa.Column("created_by", sa.Uuid(), nullable=True),
        sa.Column("updated_by", sa.Uuid(), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "vigencia_hasta >= vigencia_desde", name=op.f("ck_aseguradora_contratos_vigencia")
        ),
        sa.CheckConstraint("tarifa >= 0", name=op.f("ck_aseguradora_contratos_tarifa")),
        sa.CheckConstraint(
            "tarifa_unidad IN ('asegurado_mes', 'evento', 'fija_mensual')",
            name=op.f("ck_aseguradora_contratos_tarifa_unidad"),
        ),
        sa.CheckConstraint(
            "forma_pago_medicamentos IN ('reembolso_aparte', 'incluido_en_tarifa')",
            name=op.f("ck_aseguradora_contratos_forma_pago_medicamentos"),
        ),
        sa.CheckConstraint(
            "revision_tarifa IS NULL OR revision_tarifa >= vigencia_desde",
            name=op.f("ck_aseguradora_contratos_revision_tarifa"),
        ),
        sa.ForeignKeyConstraint(
            ["poliza_id"], ["aseguradora_polizas.id"],
            name=op.f("fk_aseguradora_contratos_poliza_id_aseguradora_polizas"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["created_by"], ["users.id"],
            name=op.f("fk_aseguradora_contratos_created_by_users"), ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["updated_by"], ["users.id"],
            name=op.f("fk_aseguradora_contratos_updated_by_users"), ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("poliza_id", name=op.f("pk_aseguradora_contratos")),
    )


def downgrade() -> None:
    # Solo si la tabla está vacía: volver atrás no puede tirar contratos cargados.
    op.execute(
        "DO $$ BEGIN IF EXISTS (SELECT 1 FROM aseguradora_contratos) THEN "
        "RAISE EXCEPTION 'aseguradora_contratos tiene filas: respaldarlas antes de bajar'; "
        "END IF; END $$"
    )
    op.drop_table("aseguradora_contratos")
