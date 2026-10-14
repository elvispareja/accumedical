"""Historial de accesos para TODOS (14/10/2026): reemplaza al de coordinadores.

Revision ID: d1b5c8e3f742
Revises: c7f2a9e4b318
Create Date: 2026-10-14

Pedido del cliente: cada persona puede tener un rol distinto en cada aplicación
(Mario: coordinador de Calificación y Convenio; un auditor puede coordinar otra
app), y en medicina no se borra nada: quitar un rol cierra su tramo. Esta tabla
guarda los tramos de todas las aplicaciones, funciones y compañías.

Se reconstruye la historia con lo que ya guardaban las tablas de acceso
(`granted_at`/`revoked_at`), y se trasladan los tramos de `coordinacion_historial`,
que se elimina.
"""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "d1b5c8e3f742"
down_revision = "c7f2a9e4b318"
branch_labels = None
depends_on = None

# El rol tal como se nombra en el historial: «supervisor» es «Coordinador de …».
_ROL = "CASE r.code WHEN 'supervisor' THEN 'coordinador' ELSE r.code END"


def upgrade() -> None:
    op.create_table(
        "historial_accesos",
        sa.Column("id", postgresql.UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("ambito", sa.String(20), nullable=False),
        sa.Column("clave", sa.String(80), nullable=False),
        sa.Column("module_code", sa.String(30), nullable=True),
        sa.Column("funcion", sa.String(20), nullable=True),
        sa.Column("aseguradora_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("rol", sa.String(20), nullable=False),
        sa.Column("desde", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("hasta", sa.DateTime(timezone=True), nullable=True),
        sa.Column("otorgado_por", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("retirado_por", postgresql.UUID(as_uuid=True), nullable=True),
        sa.CheckConstraint("ambito IN ('aplicacion', 'funcion', 'compania')", name=op.f("ck_historial_accesos_ambito")),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], name=op.f("fk_historial_accesos_user_id_users"), ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["module_code"], ["modules.code"], name=op.f("fk_historial_accesos_module_code_modules"), ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["aseguradora_id"], ["aseguradoras.id"], name=op.f("fk_historial_accesos_aseguradora_id_aseguradoras"), ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["otorgado_por"], ["users.id"], name=op.f("fk_historial_accesos_otorgado_por_users"), ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["retirado_por"], ["users.id"], name=op.f("fk_historial_accesos_retirado_por_users"), ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_historial_accesos")),
    )
    op.create_index("ix_historial_accesos_module_code", "historial_accesos", ["module_code"])
    op.create_index("ix_historial_accesos_user_id", "historial_accesos", ["user_id"])
    op.create_index("uq_historial_accesos_abierto", "historial_accesos", ["user_id", "clave"],
                    unique=True, postgresql_where=sa.text("hasta IS NULL"))

    # 1) Los tramos de coordinador que ya se llevaban (con la fecha de su familia).
    op.execute("""
        INSERT INTO historial_accesos (user_id, ambito, clave, module_code, rol, desde, hasta, otorgado_por, retirado_por)
        SELECT user_id, 'aplicacion', 'app:' || module_code, module_code, 'coordinador', desde, hasta, otorgado_por, retirado_por
        FROM coordinacion_historial
    """)
    # 2) Cada acceso por aplicación (de cualquiera: personal y aseguradoras), con
    #    sus fechas. Vivo y usuario activo → abierto; revocado → cerrado; vivo
    #    pero usuario desactivado → cerrado cuando se tocó al usuario.
    op.execute(f"""
        INSERT INTO historial_accesos (user_id, ambito, clave, module_code, rol, desde, hasta, otorgado_por, retirado_por)
        SELECT a.user_id, 'aplicacion', 'app:' || a.module_code, a.module_code, {_ROL}, a.granted_at,
               CASE WHEN NOT a.activo THEN COALESCE(a.revoked_at, a.updated_at)
                    WHEN NOT u.is_active OR u.deleted_at IS NOT NULL THEN COALESCE(u.deleted_at, u.updated_at)
               END,
               a.granted_by,
               CASE WHEN NOT a.activo THEN a.revoked_by END
        FROM user_module_access a
        JOIN roles r ON r.id = a.role_id
        JOIN users u ON u.id = a.user_id
        WHERE NOT (r.code = 'supervisor' AND EXISTS (
            SELECT 1 FROM coordinacion_historial c WHERE c.user_id = a.user_id AND c.module_code = a.module_code))
    """)
    # 3) Coordinaciones de FAMILIA ya retiradas (esquema anterior), módulo por
    #    módulo. Las de Libio y Mario ya están en el paso 1.
    op.execute("""
        INSERT INTO historial_accesos (user_id, ambito, clave, module_code, rol, desde, hasta, otorgado_por, retirado_por)
        SELECT g.user_id, 'aplicacion', 'app:' || m.code, m.code, 'coordinador', g.granted_at,
               COALESCE(g.revoked_at, g.updated_at), g.granted_by, g.revoked_by
        FROM user_grupo_access g
        JOIN modules m ON m.grupo = g.grupo
        WHERE NOT g.activo
          AND NOT EXISTS (SELECT 1 FROM coordinacion_historial c WHERE c.user_id = g.user_id)
    """)
    # 4) Funciones transversales (Convenio, Contabilidad).
    op.execute("""
        INSERT INTO historial_accesos (user_id, ambito, clave, funcion, rol, desde, hasta, otorgado_por, retirado_por)
        SELECT f.user_id, 'funcion', 'funcion:' || f.funcion, f.funcion, f.funcion, f.granted_at,
               CASE WHEN NOT f.activo THEN COALESCE(f.revoked_at, f.updated_at)
                    WHEN NOT u.is_active OR u.deleted_at IS NOT NULL THEN COALESCE(u.deleted_at, u.updated_at)
               END,
               f.granted_by, CASE WHEN NOT f.activo THEN f.revoked_by END
        FROM user_funcion f JOIN users u ON u.id = f.user_id
    """)
    # 5) Coordinadores de una compañía (aseguradora).
    op.execute("""
        INSERT INTO historial_accesos (user_id, ambito, clave, aseguradora_id, rol, desde, hasta, otorgado_por, retirado_por)
        SELECT c.user_id, 'compania', 'compania:' || c.aseguradora_id, c.aseguradora_id, 'coordinador', c.granted_at,
               CASE WHEN NOT c.activo THEN COALESCE(c.revoked_at, c.updated_at)
                    WHEN NOT u.is_active OR u.deleted_at IS NOT NULL THEN COALESCE(u.deleted_at, u.updated_at)
               END,
               c.granted_by, CASE WHEN NOT c.activo THEN c.revoked_by END
        FROM user_aseguradora_coordinador c JOIN users u ON u.id = c.user_id
    """)
    op.drop_table("coordinacion_historial")


def downgrade() -> None:
    raise NotImplementedError("El historial de accesos no se deshace: restaurar el respaldo previo")
