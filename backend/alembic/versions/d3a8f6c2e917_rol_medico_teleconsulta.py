"""Rol «medico» (Médico de teleconsulta), solo en Farmacovigilancia.

Revision ID: d3a8f6c2e917
Revises: b8d2f4a6c913
Create Date: 2026-11-07

Pedido del usuario (7/11/2026): «un nuevo tipo de usuario para nosotros: médicos
de teleconsulta, que solo están disponibles para farmacia». Es personal de
Accumedical (no de un cliente) y existe SOLO en el módulo `farmacia`: atiende
la teleconsulta por video, llena la historia clínica y emite la receta. Lleva el
mismo permiso de la plataforma que los demás roles de ese módulo
(`dashboard:ver`); lo que puede hacer lo decide Farmacovigilancia por el rol.

Para darlo en otra app: una migración como esta con ese módulo.
"""

from __future__ import annotations

from alembic import op

revision = "d3a8f6c2e917"
down_revision = "b8d2f4a6c913"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        INSERT INTO roles (module_code, code, nombre, descripcion, es_sistema)
        SELECT m.code, 'medico', 'Médico de teleconsulta',
               'Médico de teleconsulta de Accumedical: atiende por video, llena la historia '
               || 'clínica y emite la receta', true
        FROM modules m
        WHERE m.code IN ('farmacia')
        ON CONFLICT (module_code, code) DO NOTHING
        """
    )
    op.execute(
        """
        INSERT INTO role_permissions (role_id, permission_id)
        SELECT md.id, rp.permission_id
        FROM roles md
        JOIN roles aud ON aud.module_code = md.module_code AND aud.code = 'auditor'
        JOIN role_permissions rp ON rp.role_id = aud.id
        WHERE md.code = 'medico' AND md.module_code IN ('farmacia')
        ON CONFLICT DO NOTHING
        """
    )


def downgrade() -> None:
    # Solo si nadie lo tiene: un acceso dado no se borra (queda su historia).
    op.execute(
        "DO $$ BEGIN IF EXISTS (SELECT 1 FROM user_module_access a JOIN roles r ON r.id = a.role_id"
        " WHERE r.code = 'medico' AND r.module_code = 'farmacia') THEN RAISE EXCEPTION"
        " 'hay usuarios con el rol medico: quitárselo antes de bajar'; END IF; END $$"
    )
    op.execute(
        "DELETE FROM role_permissions WHERE role_id IN (SELECT id FROM roles WHERE code = 'medico'"
        " AND module_code = 'farmacia')"
    )
    op.execute("DELETE FROM roles WHERE code = 'medico' AND module_code = 'farmacia'")
