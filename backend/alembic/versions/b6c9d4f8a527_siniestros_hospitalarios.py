"""siniestro: la rama «Siniestros hospitalarios»

La familia Siniestro se organiza en ramas (subtítulos dentro de la familia);
`modules.subgrupo` es esa rama. La primera es «Siniestros hospitalarios», con
cuatro piezas en este orden: Central de Crédito (la Autorización de Crédito
renombrada — mismo `code` congelado, como siempre), Auditoría de Concurrencia
(la construida), Auditoría de Alta y Auditoría del Crédito Hospitalario (nuevas,
con roles y permisos sembrados como las demás). Las otras dos ramas de Siniestro
se definirán después: entrarán como filas nuevas, sin tocar estructura.

Sin CHECK de catálogo sobre `subgrupo` a propósito: solo lo escriben las
migraciones, y cada rama nueva debe entrar sin ALTER (regla de la casa).

Revision ID: b6c9d4f8a527
Revises: a5b8c3e7f419
Create Date: 2026-09-18
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "b6c9d4f8a527"
down_revision = "a5b8c3e7f419"
branch_labels = None
depends_on = None

RAMA = "siniestros_hospitalarios"
NUEVOS = ("auditoria_alta", "auditoria_credito_hospitalario")


def upgrade() -> None:
    op.add_column("modules", sa.Column("subgrupo", sa.String(length=40), nullable=True))

    # Autorización de Crédito ES Central de Crédito: cambia la identidad
    # pública (nombre y slug); la canónica (code carta_credito) queda congelada.
    op.execute(
        sa.text(
            "UPDATE modules SET nombre = 'Central de Crédito', slug = 'central-credito', "
            "subgrupo = :rama, orden = 4 WHERE code = 'carta_credito'"
        ).bindparams(rama=RAMA)
    )
    op.execute(
        sa.text(
            "UPDATE modules SET subgrupo = :rama, orden = 5 WHERE code = 'concurrencia'"
        ).bindparams(rama=RAMA)
    )

    op.execute(
        sa.text(
            """
            INSERT INTO modules
              (code, slug, nombre, descripcion, icono, color_acento, orden, grupo, subgrupo)
            VALUES
              ('auditoria_alta', 'auditoria-alta', 'Auditoría de Alta',
               'Auditoría médica del alta hospitalaria', 'file-check', 'indigo',
               6, 'siniestro', :rama),
              ('auditoria_credito_hospitalario', 'auditoria-credito-hospitalario',
               'Auditoría del Crédito Hospitalario',
               'Auditoría del crédito hospitalario otorgado', 'receipt', 'rose',
               7, 'siniestro', :rama)
            ON CONFLICT (code) DO NOTHING
            """
        ).bindparams(rama=RAMA)
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
        WHERE m.code IN ('auditoria_alta', 'auditoria_credito_hospitalario')
        ON CONFLICT (module_code, code) DO NOTHING
        """
    )
    # …con su permiso de entrada y el enlace rol→permiso, como en la semilla.
    op.execute(
        """
        INSERT INTO permissions (module_code, code, descripcion)
        SELECT code, 'dashboard:ver', 'Entrar al módulo'
        FROM modules
        WHERE code IN ('auditoria_alta', 'auditoria_credito_hospitalario')
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
        WHERE r.module_code IN ('auditoria_alta', 'auditoria_credito_hospitalario')
        ON CONFLICT DO NOTHING
        """
    )


def downgrade() -> None:
    op.execute(
        """
        DELETE FROM role_permissions rp USING roles r
        WHERE rp.role_id = r.id
          AND r.module_code IN ('auditoria_alta', 'auditoria_credito_hospitalario')
        """
    )
    op.execute(
        "DELETE FROM permissions WHERE module_code IN "
        "('auditoria_alta', 'auditoria_credito_hospitalario')"
    )
    op.execute(
        "DELETE FROM roles WHERE module_code IN "
        "('auditoria_alta', 'auditoria_credito_hospitalario')"
    )
    # Con accesos o expedientes ya colgando, el RESTRICT detiene esto en voz alta.
    op.execute(
        "DELETE FROM modules WHERE code IN "
        "('auditoria_alta', 'auditoria_credito_hospitalario')"
    )
    op.execute(
        "UPDATE modules SET nombre = 'Autorización de Crédito', "
        "slug = 'autorizacion-credito', orden = 5 WHERE code = 'carta_credito'"
    )
    op.execute("UPDATE modules SET orden = 4 WHERE code = 'concurrencia'")
    op.drop_column("modules", "subgrupo")
