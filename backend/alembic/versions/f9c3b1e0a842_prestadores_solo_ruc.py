"""prestadores: solo RUC, y fuera la habilitación

Revision ID: f9c3b1e0a842
Revises: e4b2a9c7d130
Create Date: 2026-08-31

Dos simplificaciones pedidas sobre el mismo formulario:

1. **La identidad del prestador es el RUC y nada más.** Desaparecen
   `tipo_documento_codigo` y `numero_documento`, que obligaban a elegir entre
   cédula, RUC o pasaporte, y entra `ruc char(13)` con el mismo CHECK de formato y
   la misma unicidad parcial que ya tiene `aseguradoras`. Un campo que solo puede
   valer una cosa no es una elección: es ruido en la pantalla.

2. **Fuera el bloque de habilitación.** Se van `especialidad`,
   `registro_profesional` y `registro_sanitario`.

Consecuencias que conviene tener presentes:

- La coherencia de subtipo (`es_persona` ⇒ exige especialidad y prohíbe registro
  sanitario) deja de existir porque ya no hay campos que enfrentar. El catálogo
  `tipos_prestador` y su columna `es_persona` se conservan: siguen distinguiendo
  un médico de un hospital y no cuesta nada mantenerlos.
- La búsqueda por especialidad desaparece del listado; queda por nombre, RUC y
  código interno.
- `tipos_documento` sigue en uso: lo usan los contactos, no el prestador.

La tabla está vacía, así que `ruc` entra directamente como `NOT NULL`. Si hubiera
filas, Postgres lo rechazaría y habría que decidir antes qué RUC ponerles, que es
justo la conversación que no debe saltarse.

NO SE APLICA sin aprobación explícita (regla de CLAUDE.md).
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "f9c3b1e0a842"
down_revision: str | None = "e4b2a9c7d130"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # ── 1. El RUC como única identidad ───────────────────────────────────────
    op.add_column("prestadores", sa.Column("ruc", sa.CHAR(length=13), nullable=False))
    op.create_check_constraint(
        op.f("ck_prestadores_ruc_formato"), "prestadores", r"ruc ~ '^[0-9]{13}$'"
    )
    # Unicidad PARCIAL, como en aseguradoras: un RUC de un prestador eliminado no
    # bloquea para siempre volver a registrarlo.
    op.create_index(
        "uq_prestadores_ruc",
        "prestadores",
        ["ruc"],
        unique=True,
        postgresql_where="deleted_at IS NULL",
    )

    op.drop_index("uq_prestadores_documento", table_name="prestadores")
    op.drop_constraint(
        "fk_prestadores_tipo_documento_codigo_tipos_documento", "prestadores", type_="foreignkey"
    )
    op.drop_column("prestadores", "numero_documento")
    op.drop_column("prestadores", "tipo_documento_codigo")

    # ── 2. Fuera la habilitación ─────────────────────────────────────────────
    op.drop_column("prestadores", "especialidad")
    op.drop_column("prestadores", "registro_profesional")
    op.drop_column("prestadores", "registro_sanitario")


def downgrade() -> None:
    op.add_column("prestadores", sa.Column("registro_sanitario", sa.String(length=50), nullable=True))
    op.add_column(
        "prestadores", sa.Column("registro_profesional", sa.String(length=50), nullable=True)
    )
    op.add_column("prestadores", sa.Column("especialidad", sa.String(length=100), nullable=True))

    op.add_column(
        "prestadores", sa.Column("tipo_documento_codigo", sa.String(length=10), nullable=False)
    )
    op.add_column(
        "prestadores", sa.Column("numero_documento", sa.String(length=20), nullable=False)
    )
    op.create_foreign_key(
        "fk_prestadores_tipo_documento_codigo_tipos_documento",
        "prestadores",
        "tipos_documento",
        ["tipo_documento_codigo"],
        ["codigo"],
        ondelete="RESTRICT",
    )
    op.create_index(
        "uq_prestadores_documento",
        "prestadores",
        ["tipo_documento_codigo", "numero_documento"],
        unique=True,
        postgresql_where="deleted_at IS NULL",
    )

    op.drop_index("uq_prestadores_ruc", table_name="prestadores")
    op.drop_constraint(op.f("ck_prestadores_ruc_formato"), "prestadores", type_="check")
    op.drop_column("prestadores", "ruc")
