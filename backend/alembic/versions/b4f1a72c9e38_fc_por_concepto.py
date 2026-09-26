"""Cada concepto del convenio elige cómo se pacta: punto, porcentaje o fijo

Revision ID: b4f1a72c9e38
Revises: a3e9c15b7d42
Create Date: 2026-09-22

`aseguradora_prestador_valores` era una tabla de UNA fila por convenio con una
columna por concepto, y cada concepto llevaba su forma congelada en el esquema:
Cirugía era un valor, Ayudante un porcentaje, la UCI fija o por puntos. Ahora la
forma la decide quien pacta, así que pasa a ser un dato —`modo`— y la tabla
pasa a llevar **una fila por concepto**: seis filas iguales en lugar de doce
columnas y seis CHECK repetidos, y el día que el tarifario traiga un rubro nuevo
entra como una fila.

`base` dice de qué concepto sale un porcentaje. Que esa base no sea a su vez un
porcentaje —una cadena— lo comprueba el servicio: es una regla ENTRE filas y en
la base costaría un trigger, que este proyecto no usa.

Lo pactado se vuelca con el modo que ya tenía. **Se pierde `fc_general`**, el
concepto «General»: retirarlo fue el pedido, y su eliminación se aprobó
explícitamente sabiendo que los dos convenios vivos tenían 30,00 y 28,00.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "b4f1a72c9e38"
down_revision = "a3e9c15b7d42"
branch_labels = None
depends_on = None

CONCEPTOS = "'cirugia','recien_nacido','evaluacion_manejo','ayudante','anestesia','uci'"


def upgrade() -> None:
    op.create_table(
        "aseguradora_prestador_fc",
        sa.Column("convenio_id", sa.Uuid(), nullable=False),
        sa.Column("concepto", sa.String(length=30), nullable=False),
        sa.Column("modo", sa.String(length=12), nullable=False),
        sa.Column("valor", sa.Numeric(precision=12, scale=2), nullable=True),
        sa.Column("base", sa.String(length=30), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("created_by", sa.Uuid(), nullable=True),
        sa.Column("updated_by", sa.Uuid(), nullable=True),
        sa.PrimaryKeyConstraint("convenio_id", "concepto", name="pk_aseguradora_prestador_fc"),
        sa.ForeignKeyConstraint(
            ["convenio_id"],
            ["aseguradora_prestador.id"],
            ondelete="RESTRICT",
            name="fk_aseguradora_prestador_fc_convenio_id_aseguradora_prestador",
        ),
        sa.ForeignKeyConstraint(
            ["created_by"],
            ["users.id"],
            ondelete="RESTRICT",
            name="fk_aseguradora_prestador_fc_created_by_users",
        ),
        sa.ForeignKeyConstraint(
            ["updated_by"],
            ["users.id"],
            ondelete="RESTRICT",
            name="fk_aseguradora_prestador_fc_updated_by_users",
        ),
        sa.CheckConstraint(f"concepto IN ({CONCEPTOS})", name="concepto"),
        sa.CheckConstraint("modo IN ('punto','porcentaje','fijo')", name="modo"),
        sa.CheckConstraint(f"base IS NULL OR base IN ({CONCEPTOS})", name="base"),
        sa.CheckConstraint(
            "(modo = 'porcentaje') = (base IS NOT NULL)", name="base_solo_en_porcentaje"
        ),
        sa.CheckConstraint("base IS NULL OR base <> concepto", name="base_distinta"),
        sa.CheckConstraint(
            "valor IS NULL "
            "OR (modo = 'porcentaje' AND valor BETWEEN 0 AND 100) "
            "OR (modo <> 'porcentaje' AND valor >= 0)",
            name="valor",
        ),
    )

    # ── Lo pactado pasa a su fila, con el modo que ya tenía ──
    # Cirugía, recién nacido y E&M eran valores por punto; ayudante y anestesia,
    # porcentajes sobre cirugía —la única base que existía—; y la UCI, lo que
    # dijera su bandera. «General» no se vuelca: se retira.
    for concepto, columna in (
        ("cirugia", "fc_cirugia"),
        ("recien_nacido", "fc_recien_nacido"),
        ("evaluacion_manejo", "fc_evaluacion_manejo"),
    ):
        op.execute(
            f"""
            INSERT INTO aseguradora_prestador_fc
                (convenio_id, concepto, modo, valor, created_by, updated_by)
            SELECT convenio_id, '{concepto}', 'punto', {columna}, created_by, updated_by
            FROM aseguradora_prestador_valores
            WHERE {columna} IS NOT NULL
            """
        )
    for concepto, columna in (("ayudante", "pct_ayudante"), ("anestesia", "pct_anestesia")):
        op.execute(
            f"""
            INSERT INTO aseguradora_prestador_fc
                (convenio_id, concepto, modo, valor, base, created_by, updated_by)
            SELECT convenio_id, '{concepto}', 'porcentaje', {columna}, 'cirugia',
                   created_by, updated_by
            FROM aseguradora_prestador_valores
            WHERE {columna} IS NOT NULL
            """
        )
    op.execute(
        """
        INSERT INTO aseguradora_prestador_fc
            (convenio_id, concepto, modo, valor, created_by, updated_by)
        SELECT convenio_id,
               'uci',
               CASE WHEN usa_uci_valor_fijo THEN 'fijo' ELSE 'punto' END,
               CASE WHEN usa_uci_valor_fijo THEN uci_valor_fijo ELSE uci_puntos END,
               created_by, updated_by
        FROM aseguradora_prestador_valores
        WHERE CASE WHEN usa_uci_valor_fijo THEN uci_valor_fijo ELSE uci_puntos END IS NOT NULL
        """
    )

    op.drop_table("aseguradora_prestador_valores")


def downgrade() -> None:
    op.create_table(
        "aseguradora_prestador_valores",
        sa.Column("convenio_id", sa.Uuid(), nullable=False),
        sa.Column("fc_cirugia", sa.Numeric(precision=12, scale=2), nullable=True),
        sa.Column("fc_general", sa.Numeric(precision=12, scale=2), nullable=True),
        sa.Column("fc_recien_nacido", sa.Numeric(precision=12, scale=2), nullable=True),
        sa.Column("fc_evaluacion_manejo", sa.Numeric(precision=12, scale=2), nullable=True),
        sa.Column("pct_ayudante", sa.Numeric(precision=5, scale=2), nullable=True),
        sa.Column("pct_anestesia", sa.Numeric(precision=5, scale=2), nullable=True),
        sa.Column(
            "usa_uci_valor_fijo", sa.Boolean(), server_default=sa.text("false"), nullable=False
        ),
        sa.Column("uci_valor_fijo", sa.Numeric(precision=12, scale=2), nullable=True),
        sa.Column("uci_puntos", sa.Numeric(precision=12, scale=2), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("created_by", sa.Uuid(), nullable=True),
        sa.Column("updated_by", sa.Uuid(), nullable=True),
        sa.PrimaryKeyConstraint("convenio_id", name="pk_aseguradora_prestador_valores"),
        sa.ForeignKeyConstraint(
            ["convenio_id"],
            ["aseguradora_prestador.id"],
            ondelete="RESTRICT",
            name="fk_aseguradora_prestador_valores_convenio_id",
        ),
        sa.ForeignKeyConstraint(
            ["created_by"],
            ["users.id"],
            ondelete="RESTRICT",
            name="fk_aseguradora_prestador_valores_created_by_users",
        ),
        sa.ForeignKeyConstraint(
            ["updated_by"],
            ["users.id"],
            ondelete="RESTRICT",
            name="fk_aseguradora_prestador_valores_updated_by_users",
        ),
        sa.CheckConstraint(
            "(fc_cirugia IS NULL OR fc_cirugia >= 0) "
            "AND (fc_general IS NULL OR fc_general >= 0) "
            "AND (fc_recien_nacido IS NULL OR fc_recien_nacido >= 0) "
            "AND (fc_evaluacion_manejo IS NULL OR fc_evaluacion_manejo >= 0) "
            "AND (uci_valor_fijo IS NULL OR uci_valor_fijo >= 0) "
            "AND (uci_puntos IS NULL OR uci_puntos >= 0)",
            name="importes",
        ),
        sa.CheckConstraint(
            "(pct_ayudante IS NULL OR pct_ayudante BETWEEN 0 AND 100) "
            "AND (pct_anestesia IS NULL OR pct_anestesia BETWEEN 0 AND 100)",
            name="porcentajes",
        ),
        sa.CheckConstraint("NOT usa_uci_valor_fijo OR uci_valor_fijo IS NOT NULL", name="uci"),
    )
    # Vuelve lo que cabe en la forma vieja. `fc_general` no puede recuperarse:
    # el concepto dejó de existir en la ida.
    op.execute(
        """
        INSERT INTO aseguradora_prestador_valores
            (convenio_id, fc_cirugia, fc_recien_nacido, fc_evaluacion_manejo,
             pct_ayudante, pct_anestesia, usa_uci_valor_fijo, uci_valor_fijo, uci_puntos)
        SELECT convenio_id,
               MAX(valor) FILTER (WHERE concepto = 'cirugia'           AND modo = 'punto'),
               MAX(valor) FILTER (WHERE concepto = 'recien_nacido'     AND modo = 'punto'),
               MAX(valor) FILTER (WHERE concepto = 'evaluacion_manejo' AND modo = 'punto'),
               MAX(valor) FILTER (WHERE concepto = 'ayudante'          AND modo = 'porcentaje'),
               MAX(valor) FILTER (WHERE concepto = 'anestesia'         AND modo = 'porcentaje'),
               COALESCE(bool_or(concepto = 'uci' AND modo = 'fijo'), false),
               MAX(valor) FILTER (WHERE concepto = 'uci' AND modo = 'fijo'),
               MAX(valor) FILTER (WHERE concepto = 'uci' AND modo = 'punto')
        FROM aseguradora_prestador_fc
        GROUP BY convenio_id
        """
    )
    op.drop_table("aseguradora_prestador_fc")
