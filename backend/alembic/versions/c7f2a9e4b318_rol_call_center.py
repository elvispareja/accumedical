"""Rol «call_center» (personal de Accumedical), hoy solo en Calificación de Riesgo.

Revision ID: c7f2a9e4b318
Revises: b4e7a2c9d153
Create Date: 2026-10-14

Pedido del cliente (14/10/2026): un tipo de usuario nuevo, «Call center». Por
ahora hace EXACTAMENTE lo mismo que el coordinador de la app —«para no
hacernos lío»—, así que lleva los mismos permisos que el `supervisor` de ese
módulo. Se separarán cuando el cliente lo pida.

Para darlo en otra app: una migración como esta con ese módulo.
"""

from __future__ import annotations

from alembic import op

revision = "c7f2a9e4b318"
down_revision = "b4e7a2c9d153"
branch_labels = None
depends_on = None

# El módulo va escrito en el SQL: hoy solo Calificación de Riesgo.


def upgrade() -> None:
    op.execute(
        """
        INSERT INTO roles (module_code, code, nombre, descripcion, es_sistema)
        SELECT m.code, 'call_center', 'Call center de ' || m.nombre,
               'Call center de Accumedical (hoy, los mismos permisos que el coordinador)', true
        FROM modules m
        WHERE m.code IN ('calificacion_riesgo')
        ON CONFLICT (module_code, code) DO NOTHING
        """
    )
    # Los mismos permisos que el coordinador (supervisor) de ese módulo.
    op.execute(
        """
        INSERT INTO role_permissions (role_id, permission_id)
        SELECT cc.id, rp.permission_id
        FROM roles cc
        JOIN roles sup ON sup.module_code = cc.module_code AND sup.code = 'supervisor'
        JOIN role_permissions rp ON rp.role_id = sup.id
        WHERE cc.code = 'call_center' AND cc.module_code IN ('calificacion_riesgo')
        ON CONFLICT DO NOTHING
        """
    )


def downgrade() -> None:
    op.execute(
        "DELETE FROM roles WHERE code = 'call_center' AND module_code = 'calificacion_riesgo'"
    )
