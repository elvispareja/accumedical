"""usuarios de plataforma: identificación, celular y rol auditor

El administrador global crea su propio personal —supervisores, médicos
auditores— y ese personal no sale de ningún contacto de aseguradora: sus datos
de identificación tienen que vivir en `users`. Tres columnas opcionales, con la
misma coherencia que en los contactos: tipo y número de documento van juntos o
no van.

Y el rol «auditor», que no existía, se siembra en los cuatro módulos como rol de
solo lectura: entra al módulo y, en Concurrencia, ve las visitas. Qué pantalla
ve un auditor dentro de cada módulo es diseño pendiente; el rol existe para que
los accesos se puedan dar desde hoy.

Revision ID: b8f5e3d1a692
Revises: a7e4d2c9f581
Create Date: 2026-08-31
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "b8f5e3d1a692"
down_revision = "a7e4d2c9f581"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── Identificación del personal de plataforma ────────────────────────────
    op.add_column("users", sa.Column("tipo_documento_codigo", sa.String(length=10), nullable=True))
    op.add_column("users", sa.Column("numero_documento", sa.String(length=20), nullable=True))
    op.add_column("users", sa.Column("telefono", sa.String(length=25), nullable=True))
    op.create_foreign_key(
        None,  # la convención lo nombra: fk_users_tipo_documento_codigo_tipos_documento
        "users",
        "tipos_documento",
        ["tipo_documento_codigo"],
        ["codigo"],
        ondelete="RESTRICT",
    )
    # Igual que en los contactos: un número sin tipo no identifica nada, y un
    # tipo sin número tampoco.
    op.create_check_constraint(
        "documento",
        "users",
        "(tipo_documento_codigo IS NULL) = (numero_documento IS NULL)",
    )

    # ── El rol «auditor», en los cuatro módulos ──────────────────────────────
    op.execute(
        """
        INSERT INTO roles (module_code, code, nombre, descripcion, es_sistema)
        SELECT m.code, 'auditor', 'Auditor de ' || m.nombre,
               'Audita sobre el terreno; dentro del módulo, solo lectura', true
        FROM modules m
        ON CONFLICT (module_code, code) DO NOTHING
        """
    )
    # Solo lectura: entrar al módulo, y en Concurrencia ver las visitas.
    op.execute(
        """
        INSERT INTO role_permissions (role_id, permission_id)
        SELECT r.id, p.id
        FROM roles r
        JOIN permissions p
          ON p.module_code = r.module_code AND p.code IN ('dashboard:ver', 'visitas:leer')
        WHERE r.code = 'auditor'
        ON CONFLICT DO NOTHING
        """
    )


def downgrade() -> None:
    op.execute(
        "DELETE FROM role_permissions WHERE role_id IN "
        "(SELECT id FROM roles WHERE code = 'auditor')"
    )
    # Si algún usuario ya tiene acceso con rol auditor, la FK RESTRICT frena este
    # DELETE a propósito: primero se revocan esos accesos, luego se baja.
    op.execute("DELETE FROM roles WHERE code = 'auditor'")

    # El nombre CORTO: la convención «ck» le antepone sola el ck_users_. La «fk»
    # no lleva %(constraint_name)s, así que esa se suelta por su nombre completo.
    op.drop_constraint("documento", "users", type_="check")
    op.drop_constraint(
        "fk_users_tipo_documento_codigo_tipos_documento", "users", type_="foreignkey"
    )
    op.drop_column("users", "telefono")
    op.drop_column("users", "numero_documento")
    op.drop_column("users", "tipo_documento_codigo")
