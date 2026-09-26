"""concurrencia: bandeja de visitas del médico auditor

Revision ID: e4b2a9c7d130
Revises: d1f80a6b3e57
Create Date: 2026-08-31

Primer expediente de módulo. Una visita es una aseguradora que programa la ida de
su médico auditor a un prestador de su red, opcionalmente a una sede concreta, en
una ventana de fecha y hora, avisando a una o varias direcciones de correo.

Cumple el contrato núcleo ↔ módulo del documento 01 §8:

- Tablas con el prefijo del módulo, `conc_`.
- `aseguradora_id NOT NULL` en la tabla raíz: es la palanca de scoping y
  ownership, y lo que permite que un operador solo vea lo de su compañía.
- Referencia al núcleo (`aseguradoras`, `prestadores`, `prestador_sedes`) y
  **nunca al revés**; ninguna tabla del núcleo sabe que esto existe.
- Ningún `ALTER` sobre tablas del núcleo. La coherencia entre la sede y su
  prestador se comprueba en el servicio; ver la nota de abajo.

Que el prestador esté en la red de esa aseguradora tampoco es una FK: el convenio
vive en `aseguradora_prestador` con unicidad PARCIAL —`WHERE deleted_at IS NULL`—,
y un índice parcial no puede respaldar una clave foránea. Se valida en el servicio
contra el convenio vivo, en el alta y en cada edición.

NO SE APLICA sin aprobación explícita (regla de CLAUDE.md).
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "e4b2a9c7d130"
down_revision: str | None = "d1f80a6b3e57"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

ESTADOS = ("programada", "en_curso", "realizada", "cancelada")

# Permisos propios del módulo. La lista tiene que coincidir con
# `app/modules/concurrencia/permissions.py`.
PERMISOS = (
    ("visitas:leer", "Ver la bandeja de visitas y el detalle de cada una"),
    ("visitas:crear", "Programar una visita del médico auditor"),
    ("visitas:editar", "Cambiar fecha, sede, correos o estado de una visita"),
)
# Qué rol recibe cada uno. `consulta` solo mira.
POR_ROL = {
    "supervisor": ("visitas:leer", "visitas:crear", "visitas:editar"),
    "operador": ("visitas:leer", "visitas:crear", "visitas:editar"),
    "consulta": ("visitas:leer",),
}


def upgrade() -> None:
    # ── Secuencia del código legible, en la base y no en la aplicación ───────
    op.execute("CREATE SEQUENCE conc_visitas_codigo_interno_seq")

    op.create_table(
        "conc_visitas",
        sa.Column("id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column(
            "codigo_interno",
            sa.String(length=20),
            server_default=sa.text(
                "('CONC-' || lpad((nextval('conc_visitas_codigo_interno_seq'))::text, 4, '0'))"
            ),
            nullable=False,
        ),
        # La palanca de ownership. Sin ella un operador podría ver lo de otra
        # compañía si un filtro se olvidara en cualquier consulta futura.
        sa.Column("aseguradora_id", sa.Uuid(), nullable=False),
        sa.Column("prestador_id", sa.Uuid(), nullable=False),
        # Solo si el prestador tiene sedes; si no las tiene, se visita su
        # dirección principal y esto queda en NULL.
        sa.Column("sede_id", sa.Uuid(), nullable=True),
        sa.Column("desde", sa.DateTime(timezone=True), nullable=False),
        sa.Column("hasta", sa.DateTime(timezone=True), nullable=False),
        sa.Column("estado", sa.String(length=20), server_default="programada", nullable=False),
        sa.Column("observaciones", sa.Text(), nullable=True),
        sa.Column("created_by", sa.Uuid(), nullable=True),
        sa.Column("updated_by", sa.Uuid(), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
        ),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_by", sa.Uuid(), nullable=True),
        sa.CheckConstraint("hasta > desde", name=op.f("ck_conc_visitas_ventana")),
        sa.CheckConstraint(
            "estado IN ('programada','en_curso','realizada','cancelada')",
            name=op.f("ck_conc_visitas_estado"),
        ),
        sa.ForeignKeyConstraint(
            ["aseguradora_id"], ["aseguradoras.id"],
            name=op.f("fk_conc_visitas_aseguradora_id_aseguradoras"), ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["prestador_id"], ["prestadores.id"],
            name=op.f("fk_conc_visitas_prestador_id_prestadores"), ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["sede_id"], ["prestador_sedes.id"],
            name=op.f("fk_conc_visitas_sede_id_prestador_sedes"), ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["created_by"], ["users.id"],
            name=op.f("fk_conc_visitas_created_by_users"), ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["updated_by"], ["users.id"],
            name=op.f("fk_conc_visitas_updated_by_users"), ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["deleted_by"], ["users.id"],
            name=op.f("fk_conc_visitas_deleted_by_users"), ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_conc_visitas")),
    )
    op.create_index("uq_conc_visitas_codigo_interno", "conc_visitas", ["codigo_interno"], unique=True)
    # El índice de la bandeja: lo de MI aseguradora, lo más reciente primero.
    op.create_index(
        "ix_conc_visitas_bandeja",
        "conc_visitas",
        ["aseguradora_id", "desde"],
        postgresql_where="deleted_at IS NULL",
    )
    op.create_index(
        "ix_conc_visitas_prestador_id",
        "conc_visitas",
        ["prestador_id"],
        postgresql_where="deleted_at IS NULL",
    )

    # ── A quién se avisa de la visita ────────────────────────────────────────
    op.create_table(
        "conc_visita_correos",
        sa.Column("id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("visita_id", sa.Uuid(), nullable=False),
        sa.Column("email", postgresql.CITEXT(), nullable=False),
        sa.Column("created_by", sa.Uuid(), nullable=True),
        sa.Column("updated_by", sa.Uuid(), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
        ),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_by", sa.Uuid(), nullable=True),
        sa.ForeignKeyConstraint(
            ["visita_id"], ["conc_visitas.id"],
            name=op.f("fk_conc_visita_correos_visita_id_conc_visitas"), ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["created_by"], ["users.id"],
            name=op.f("fk_conc_visita_correos_created_by_users"), ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["updated_by"], ["users.id"],
            name=op.f("fk_conc_visita_correos_updated_by_users"), ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["deleted_by"], ["users.id"],
            name=op.f("fk_conc_visita_correos_deleted_by_users"), ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_conc_visita_correos")),
    )
    op.create_index(
        "ix_conc_visita_correos_visita_id",
        "conc_visita_correos",
        ["visita_id"],
        postgresql_where="deleted_at IS NULL",
    )
    # El mismo correo dos veces en la misma visita es un error de captura.
    op.create_index(
        "uq_conc_visita_correos_email",
        "conc_visita_correos",
        ["visita_id", "email"],
        unique=True,
        postgresql_where="deleted_at IS NULL",
    )

    # ── Permisos del módulo y su reparto por rol ─────────────────────────────
    for codigo, descripcion in PERMISOS:
        op.execute(
            sa.text(
                "INSERT INTO permissions (id, module_code, code, descripcion) "
                "VALUES (gen_random_uuid(), 'concurrencia', :code, :descripcion)"
            ).bindparams(code=codigo, descripcion=descripcion)
        )
    for rol, codigos in POR_ROL.items():
        for codigo in codigos:
            op.execute(
                sa.text(
                    "INSERT INTO role_permissions (role_id, permission_id) "
                    "SELECT r.id, p.id FROM roles r, permissions p "
                    "WHERE r.module_code = 'concurrencia' AND r.code = :rol "
                    "  AND p.module_code = 'concurrencia' AND p.code = :permiso"
                ).bindparams(rol=rol, permiso=codigo)
            )


def downgrade() -> None:
    op.execute(
        "DELETE FROM role_permissions WHERE permission_id IN "
        "(SELECT id FROM permissions WHERE module_code = 'concurrencia' "
        " AND code LIKE 'visitas:%')"
    )
    op.execute(
        "DELETE FROM permissions WHERE module_code = 'concurrencia' AND code LIKE 'visitas:%'"
    )
    op.drop_index("uq_conc_visita_correos_email", table_name="conc_visita_correos")
    op.drop_index("ix_conc_visita_correos_visita_id", table_name="conc_visita_correos")
    op.drop_table("conc_visita_correos")
    op.drop_index("ix_conc_visitas_prestador_id", table_name="conc_visitas")
    op.drop_index("ix_conc_visitas_bandeja", table_name="conc_visitas")
    op.drop_index("uq_conc_visitas_codigo_interno", table_name="conc_visitas")
    op.drop_table("conc_visitas")
    op.execute("DROP SEQUENCE conc_visitas_codigo_interno_seq")
