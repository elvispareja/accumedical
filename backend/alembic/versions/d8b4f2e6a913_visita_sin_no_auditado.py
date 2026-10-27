"""conc_visitas: sin el estado «no_auditado» (ahora se vigila el SLA)

Pedido del usuario (27/10/2026): «no auditado» —la ventana de llegada vencía
sin el auditor— desaparece. Lo que se vigila es el SLA: un caso abierto cuya
entrega pactada (`hasta`) ya pasó está «fuera del SLA», que es una condición y
no un estado.

Los casos que hubiera en `no_auditado` vuelven al estado que tenían al vencer
—`asignada` con auditor, `programada` sin él—, cada uno con su constancia en
AuditLog (en medicina no se borra nada). La constancia va como
`visita_no_auditada`, no como `visita_fuera_sla`: esa marca «ya avisado» y el
caso aún tiene que recibir su aviso de SLA si le toca.

Revision ID: d8b4f2e6a913
Revises: c6a2d4f8e135
Create Date: 2026-10-27
"""

from __future__ import annotations

from alembic import op

revision = "d8b4f2e6a913"
down_revision = "c6a2d4f8e135"
branch_labels = None
depends_on = None

_CINCO = "'programada','asignada','auditando','cancelada','culminada'"


def upgrade() -> None:
    op.execute(
        """
        WITH vueltos AS (
            UPDATE conc_visitas
               SET estado = CASE WHEN auditor_id IS NOT NULL THEN 'asignada'
                                 ELSE 'programada' END,
                   updated_at = now()
             WHERE estado = 'no_auditado'
         RETURNING id, codigo_interno, estado
        )
        INSERT INTO audit_log (module_code, accion, entidad, entidad_id, detalle)
        SELECT 'concurrencia', 'visita_no_auditada', 'conc_visitas', id::text,
               jsonb_build_object(
                   'visita', codigo_interno,
                   'motivo', 'el estado «no auditado» dejó de existir',
                   'antes', jsonb_build_object('estado', 'no_auditado'),
                   'despues', jsonb_build_object('estado', estado)
               )
          FROM vueltos
        """
    )
    op.drop_constraint(op.f("ck_conc_visitas_estado"), "conc_visitas", type_="check")
    op.create_check_constraint("estado", "conc_visitas", f"estado IN ({_CINCO})")


def downgrade() -> None:
    # Los casos devueltos a la agenda no vuelven a «no auditado»: su constancia
    # sigue en AuditLog.
    op.drop_constraint(op.f("ck_conc_visitas_estado"), "conc_visitas", type_="check")
    op.create_check_constraint("estado", "conc_visitas", f"estado IN ({_CINCO},'no_auditado')")
