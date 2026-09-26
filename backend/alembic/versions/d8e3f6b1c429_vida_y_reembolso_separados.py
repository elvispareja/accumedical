"""siniestro: Auditoría de Vida y Reembolso son ramas DISTINTAS

Corrige la siembra de c7d2e5a9f318: «Auditoría de vida» y «Reembolso» no son
una pieza combinada sino dos ramas separadas, cada una con su módulo homónimo.
La fila combinada `auditoria_vida_reembolso` nació en la migración anterior de
esta misma sesión y nunca se usó (cero concesiones, cero expedientes, cero
código): se elimina con sus roles y permisos — si algo llegara a colgar de
ella, los RESTRICT detienen el DELETE en voz alta — y se siembran las dos
piezas correctas.

Revision ID: d8e3f6b1c429
Revises: c7d2e5a9f318
Create Date: 2026-09-18
"""

from __future__ import annotations

from alembic import op

revision = "d8e3f6b1c429"
down_revision = "c7d2e5a9f318"
branch_labels = None
depends_on = None

COMBINADA = "auditoria_vida_reembolso"
NUEVOS = ("auditoria_vida", "reembolso")


def _quitar(codes: str) -> None:
    op.execute(
        f"""
        DELETE FROM role_permissions rp USING roles r
        WHERE rp.role_id = r.id AND r.module_code IN ({codes})
        """
    )
    op.execute(f"DELETE FROM permissions WHERE module_code IN ({codes})")
    op.execute(f"DELETE FROM roles WHERE module_code IN ({codes})")
    op.execute(f"DELETE FROM modules WHERE code IN ({codes})")


def _sembrar_roles(codes: str) -> None:
    op.execute(
        f"""
        INSERT INTO roles (module_code, code, nombre, descripcion, es_sistema)
        SELECT m.code, r.code, r.nombre || ' de ' || m.nombre, r.descripcion, true
        FROM modules m
        CROSS JOIN (VALUES
            ('operador',   'Operador',   'Opera el flujo del módulo'),
            ('supervisor', 'Supervisor', 'Supervisa y aprueba'),
            ('consulta',   'Consulta',   'Solo lectura'),
            ('auditor',    'Auditor',    'Médico auditor: solo lectura')
        ) AS r(code, nombre, descripcion)
        WHERE m.code IN ({codes})
        ON CONFLICT (module_code, code) DO NOTHING
        """
    )
    op.execute(
        f"""
        INSERT INTO permissions (module_code, code, descripcion)
        SELECT code, 'dashboard:ver', 'Entrar al módulo'
        FROM modules WHERE code IN ({codes})
        ON CONFLICT (module_code, code) DO NOTHING
        """
    )
    op.execute(
        f"""
        INSERT INTO role_permissions (role_id, permission_id)
        SELECT r.id, p.id
        FROM roles r
        JOIN permissions p
          ON p.module_code = r.module_code AND p.code = 'dashboard:ver'
        WHERE r.module_code IN ({codes})
        ON CONFLICT DO NOTHING
        """
    )


def upgrade() -> None:
    _quitar("'auditoria_vida_reembolso'")
    op.execute(
        """
        INSERT INTO modules
          (code, slug, nombre, descripcion, icono, color_acento, orden, grupo, subgrupo)
        VALUES
          ('auditoria_vida', 'auditoria-vida', 'Auditoría de Vida',
           'Auditoría de siniestros de vida', 'heart-pulse', 'purple',
           9, 'siniestro', 'auditoria_vida'),
          ('reembolso', 'reembolso', 'Reembolso',
           'Auditoría de reembolsos', 'wallet', 'green',
           10, 'siniestro', 'reembolso')
        ON CONFLICT (code) DO NOTHING
        """
    )
    _sembrar_roles("'auditoria_vida', 'reembolso'")


def downgrade() -> None:
    _quitar("'auditoria_vida', 'reembolso'")
    op.execute(
        """
        INSERT INTO modules
          (code, slug, nombre, descripcion, icono, color_acento, orden, grupo, subgrupo)
        VALUES
          ('auditoria_vida_reembolso', 'auditoria-vida-reembolso',
           'Auditoría de Vida y Reembolso',
           'Auditoría de siniestros de vida y reembolsos', 'wallet', 'purple',
           9, 'siniestro', 'auditoria_vida_reembolso')
        ON CONFLICT (code) DO NOTHING
        """
    )
    _sembrar_roles("'auditoria_vida_reembolso'")
