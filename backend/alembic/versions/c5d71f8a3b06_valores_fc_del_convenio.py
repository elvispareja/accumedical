"""convenio: valores del Factor de Cobertura

Revision ID: c5d71f8a3b06
Revises: f9c3b1e0a842
Create Date: 2026-08-31

Los valores con los que se liquida cada convenio. Van **por convenio**, no por
aseguradora ni por prestador: la misma compañía puede pactar un FC distinto con
cada prestador de su red, que es justo lo que representa `aseguradora_prestador`.

Tabla aparte y no columnas sueltas en el convenio, por dos razones: que la fila
exista o no responde sin ambigüedad a «¿este convenio ya tiene valores pactados?»,
y el día que haya que versionarlos por fecha de vigencia hay dónde crecer sin
tocar la tabla del convenio.

La clave primaria **es** `convenio_id`: uno a uno, garantizado por la base y no
por disciplina.

Qué guarda cada campo:

- `fc_cirugia` — el valor base de cirugía. Ayudante y anestesia se calculan sobre
  él, no se teclean.
- `fc_general` — valor independiente, no sale de ningún porcentaje.
- `pct_ayudante`, `pct_anestesia` — porcentajes sobre el FC de cirugía. El importe
  resultante NO se guarda: es `fc_cirugia * pct / 100` y guardarlo sería duplicar
  un dato que puede quedar desincronizado del que lo origina.
- UCI — o un valor fijo, o puntos. `usa_uci_valor_fijo` dice cuál manda, y el
  CHECK impide marcarlo sin haber puesto el valor.

NO SE APLICA sin aprobación explícita (regla de CLAUDE.md).
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "c5d71f8a3b06"
down_revision: str | None = "f9c3b1e0a842"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Importes en dólares. Porcentajes con dos decimales, que es lo que se pacta.
IMPORTE = sa.Numeric(precision=12, scale=2)
PORCENTAJE = sa.Numeric(precision=5, scale=2)


def upgrade() -> None:
    op.create_table(
        "aseguradora_prestador_valores",
        sa.Column("convenio_id", sa.Uuid(), nullable=False),
        sa.Column("fc_cirugia", IMPORTE, nullable=True),
        sa.Column("fc_general", IMPORTE, nullable=True),
        sa.Column("pct_ayudante", PORCENTAJE, nullable=True),
        sa.Column("pct_anestesia", PORCENTAJE, nullable=True),
        sa.Column("usa_uci_valor_fijo", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("uci_valor_fijo", IMPORTE, nullable=True),
        sa.Column("uci_puntos", IMPORTE, nullable=True),
        sa.Column("created_by", sa.Uuid(), nullable=True),
        sa.Column("updated_by", sa.Uuid(), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
        ),
        # Ningún importe negativo: un FC en negativo no significa nada.
        sa.CheckConstraint(
            "(fc_cirugia IS NULL OR fc_cirugia >= 0) "
            "AND (fc_general IS NULL OR fc_general >= 0) "
            "AND (uci_valor_fijo IS NULL OR uci_valor_fijo >= 0) "
            "AND (uci_puntos IS NULL OR uci_puntos >= 0)",
            name=op.f("ck_aseguradora_prestador_valores_importes"),
        ),
        sa.CheckConstraint(
            "(pct_ayudante IS NULL OR pct_ayudante BETWEEN 0 AND 100) "
            "AND (pct_anestesia IS NULL OR pct_anestesia BETWEEN 0 AND 100)",
            name=op.f("ck_aseguradora_prestador_valores_porcentajes"),
        ),
        # Marcar «usar valor fijo» sin poner el valor dejaría la UCI sin forma de
        # liquidarse: ni por fijo ni por puntos.
        sa.CheckConstraint(
            "NOT usa_uci_valor_fijo OR uci_valor_fijo IS NOT NULL",
            name=op.f("ck_aseguradora_prestador_valores_uci"),
        ),
        sa.ForeignKeyConstraint(
            ["convenio_id"],
            ["aseguradora_prestador.id"],
            name=op.f("fk_aseguradora_prestador_valores_convenio_id"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["created_by"],
            ["users.id"],
            name=op.f("fk_aseguradora_prestador_valores_created_by_users"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["updated_by"],
            ["users.id"],
            name=op.f("fk_aseguradora_prestador_valores_updated_by_users"),
            ondelete="RESTRICT",
        ),
        # La PK es el convenio: uno a uno, garantizado por la base.
        sa.PrimaryKeyConstraint("convenio_id", name=op.f("pk_aseguradora_prestador_valores")),
    )


def downgrade() -> None:
    op.drop_table("aseguradora_prestador_valores")
