"""siniestro: las ramas «Ambulatorio» y «Auditoría de vida y reembolso»

Las dos ramas restantes de la familia Siniestro, cada una con una sola pieza
del mismo nombre: `ambulatorio` y `auditoria_vida_reembolso`. Entran como
filas del catálogo con sus roles y permisos sembrados, sin tocar estructura —
exactamente lo prometido cuando nació `modules.subgrupo`.

Revision ID: c7d2e5a9f318
Revises: b6c9d4f8a527
Create Date: 2026-09-18
"""

from __future__ import annotations

from alembic import op

revision = "c7d2e5a9f318"
down_revision = "b6c9d4f8a527"
branch_labels = None
depends_on = None

NUEVOS = ("ambulatorio", "auditoria_vida_reembolso")


def upgrade() -> None:
    op.execute(
        """
        INSERT INTO modules
          (code, slug, nombre, descripcion, icono, color_acento, orden, grupo, subgrupo)
        VALUES
          ('ambulatorio', 'ambulatorio', 'Ambulatorio',
           'Auditoría de siniestros ambulatorios', 'ambulance', 'cyan',
           8, 'siniestro', 'ambulatorio'),
          ('auditoria_vida_reembolso', 'auditoria-vida-reembolso',
           'Auditoría de Vida y Reembolso',
           'Auditoría de siniestros de vida y reembolsos', 'wallet', 'purple',
           9, 'siniestro', 'auditoria_vida_reembolso')
        ON CONFLICT (code) DO NOTHING
        """
    )

    # Los mismos cuatro roles de sistema que tienen los demás módulos…
    op.execute(
        """
        INSERT INTO roles (module_code, code, nombre, descripcion, es_sistema)
        SELECT m.code, r.code, r.nombre || ' de ' || m.nombre, r.descripcion, true
        FROM modules m
        CROSS JOIN (VALUES
            ('operador',   'Operador',   'Opera el flujo del módulo'),
            ('supervisor', 'Supervisor', 'Supervisa y aprueba'),
            ('consulta',   'Consulta',   'Solo lectura'),
            ('auditor',    'Auditor',    'Médico auditor: solo lectura')
        ) AS r(code, nombre, descripcion)
        WHERE m.code IN ('ambulatorio', 'auditoria_vida_reembolso')
        ON CONFLICT (module_code, code) DO NOTHING
        """
    )
    # …con su permiso de entrada y el enlace rol→permiso, como en la semilla.
    op.execute(
        """
        INSERT INTO permissions (module_code, code, descripcion)
        SELECT code, 'dashboard:ver', 'Entrar al módulo'
        FROM modules
        WHERE code IN ('ambulatorio', 'auditoria_vida_reembolso')
        ON CONFLICT (module_code, code) DO NOTHING
        """
    )
    op.execute(
        """
        INSERT INTO role_permissions (role_id, permission_id)
        SELECT r.id, p.id
        FROM roles r
        JOIN permissions p
          ON p.module_code = r.module_code AND p.code = 'dashboard:ver'
        WHERE r.module_code IN ('ambulatorio', 'auditoria_vida_reembolso')
        ON CONFLICT DO NOTHING
        """
    )


def downgrade() -> None:
    op.execute(
        """
        DELETE FROM role_permissions rp USING roles r
        WHERE rp.role_id = r.id
          AND r.module_code IN ('ambulatorio', 'auditoria_vida_reembolso')
        """
    )
    op.execute(
        "DELETE FROM permissions WHERE module_code IN "
        "('ambulatorio', 'auditoria_vida_reembolso')"
    )
    op.execute(
        "DELETE FROM roles WHERE module_code IN ('ambulatorio', 'auditoria_vida_reembolso')"
    )
    # Con accesos o expedientes ya colgando, el RESTRICT detiene esto en voz alta.
    op.execute(
        "DELETE FROM modules WHERE code IN ('ambulatorio', 'auditoria_vida_reembolso')"
    )
