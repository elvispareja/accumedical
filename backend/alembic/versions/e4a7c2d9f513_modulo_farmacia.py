"""siniestro: la rama «Farmacovigilancia» con su módulo `farmacia`

App aparte (repo elvispareja/farmacia, farmacovigilancia.pymes.ec, 22/10/2026),
conectada como Calificación de Riesgo: el acceso se da aquí en admin y la contraseña la verifica la
plataforma (`/api/v1/interno/credenciales`). Entra como fila del catálogo con
sus roles y permisos sembrados, sin tocar estructura, igual que Ambulatorio.

Revision ID: e4a7c2d9f513
Revises: d1b5c8e3f742
Create Date: 2026-10-22
"""

from __future__ import annotations

from alembic import op

revision = "e4a7c2d9f513"
down_revision = "d1b5c8e3f742"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        INSERT INTO modules
          (code, slug, nombre, descripcion, icono, color_acento, orden, grupo, subgrupo)
        VALUES
          ('farmacia', 'farmacovigilancia', 'Farmacovigilancia',
           'Farmacias con sus sedes: farmacovigilancia y despacho', 'pill', 'teal',
           11, 'siniestro', 'farmacia')
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
        WHERE m.code = 'farmacia'
        ON CONFLICT (module_code, code) DO NOTHING
        """
    )
    # …con su permiso de entrada y el enlace rol→permiso, como en la semilla.
    op.execute(
        """
        INSERT INTO permissions (module_code, code, descripcion)
        VALUES ('farmacia', 'dashboard:ver', 'Entrar al módulo')
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
        WHERE r.module_code = 'farmacia'
        ON CONFLICT DO NOTHING
        """
    )


def downgrade() -> None:
    op.execute(
        """
        DELETE FROM role_permissions rp USING roles r
        WHERE rp.role_id = r.id AND r.module_code = 'farmacia'
        """
    )
    op.execute("DELETE FROM permissions WHERE module_code = 'farmacia'")
    op.execute("DELETE FROM roles WHERE module_code = 'farmacia'")
    # Con accesos ya colgando, el RESTRICT detiene esto en voz alta.
    op.execute("DELETE FROM modules WHERE code = 'farmacia'")
