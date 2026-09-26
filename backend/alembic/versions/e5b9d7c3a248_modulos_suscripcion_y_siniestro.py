"""catálogo: los módulos se agrupan en Suscripción y Siniestro

El negocio reorganizó su oferta en dos familias comerciales. Suscripción:
Examen de Asegurabilidad, Declaración de Salud (DST) y Calificación de Riesgo.
Siniestro: Carta de Vida (el antiguo Carta de Crédito, renombrado) y Auditoría
de Concurrencia (la única construida; su identidad canónica `concurrencia` no
se toca: rutas, tablas, permisos y app siguen igual).

Los módulos viejos «Suscripción» y «Calificación» como piezas únicas se retiran
con `activo = false` —revocados, sin borrar, como manda la casa—; las piezas
nuevas nacen como filas del catálogo con sus roles y permisos sembrados igual
que las originales. `grupo` es presentación comercial: no autoriza nada.

Revision ID: e5b9d7c3a248
Revises: d8c4f6a2b915
Create Date: 2026-09-11
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "e5b9d7c3a248"
down_revision = "d8c4f6a2b915"
branch_labels = None
depends_on = None

NUEVOS = ("examen_asegurabilidad", "declaracion_salud", "calificacion_riesgo")


def upgrade() -> None:
    # La familia comercial de cada módulo. Nulable: los retirados no la llevan.
    op.add_column("modules", sa.Column("grupo", sa.String(length=20), nullable=True))
    op.create_check_constraint(
        "grupo_catalogo", "modules", "grupo IN ('suscripcion', 'siniestro')"
    )

    # Retiro de las piezas viejas: revocadas, jamás borradas. Quien las tuviera
    # como último módulo cae al selector, tal como documenta el flujo de login.
    op.execute("UPDATE modules SET activo = false WHERE code IN ('suscripcion', 'calificacion')")

    # Carta de Crédito ES Carta de Vida: cambia la identidad PÚBLICA (nombre y
    # slug); la canónica (code, paquete, prefijo de tablas) queda congelada.
    op.execute(
        """
        UPDATE modules
        SET nombre = 'Carta de Vida', slug = 'carta-vida', grupo = 'siniestro', orden = 5
        WHERE code = 'carta_credito'
        """
    )
    op.execute(
        """
        UPDATE modules
        SET nombre = 'Auditoría de Concurrencia', grupo = 'siniestro', orden = 4
        WHERE code = 'concurrencia'
        """
    )

    op.execute(
        """
        INSERT INTO modules (code, slug, nombre, descripcion, icono, color_acento, orden, grupo)
        VALUES
          ('examen_asegurabilidad', 'examen-asegurabilidad', 'Examen de Asegurabilidad',
           'Evaluación médica del riesgo a suscribir', 'stethoscope', 'emerald', 1, 'suscripcion'),
          ('declaracion_salud', 'declaracion-salud', 'Declaración de Salud (DST)',
           'Formulario de declaración de salud del asegurado', 'file-signature', 'teal', 2, 'suscripcion'),
          ('calificacion_riesgo', 'calificacion-riesgo', 'Calificación de Riesgo',
           'Calificación del riesgo del asegurado', 'clipboard-check', 'violet', 3, 'suscripcion')
        ON CONFLICT (code) DO NOTHING
        """
    )

    # Los mismos cuatro roles de sistema que tienen los módulos originales…
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
        WHERE m.code IN ('examen_asegurabilidad', 'declaracion_salud', 'calificacion_riesgo')
        ON CONFLICT (module_code, code) DO NOTHING
        """
    )

    # …con su permiso de entrada y el enlace rol→permiso, como en la semilla.
    op.execute(
        """
        INSERT INTO permissions (module_code, code, descripcion)
        SELECT code, 'dashboard:ver', 'Entrar al módulo'
        FROM modules
        WHERE code IN ('examen_asegurabilidad', 'declaracion_salud', 'calificacion_riesgo')
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
        WHERE r.module_code IN ('examen_asegurabilidad', 'declaracion_salud', 'calificacion_riesgo')
        ON CONFLICT DO NOTHING
        """
    )


def downgrade() -> None:
    op.execute(
        """
        DELETE FROM role_permissions rp USING roles r
        WHERE rp.role_id = r.id
          AND r.module_code IN ('examen_asegurabilidad', 'declaracion_salud', 'calificacion_riesgo')
        """
    )
    op.execute(
        "DELETE FROM permissions WHERE module_code IN "
        "('examen_asegurabilidad', 'declaracion_salud', 'calificacion_riesgo')"
    )
    op.execute(
        "DELETE FROM roles WHERE module_code IN "
        "('examen_asegurabilidad', 'declaracion_salud', 'calificacion_riesgo')"
    )
    # Si alguna de las piezas nuevas ya tiene accesos o expedientes, el RESTRICT
    # de sus FKs hará fallar este DELETE en voz alta: mejor que borrar historia.
    op.execute(
        "DELETE FROM modules WHERE code IN "
        "('examen_asegurabilidad', 'declaracion_salud', 'calificacion_riesgo')"
    )
    op.execute(
        """
        UPDATE modules
        SET nombre = 'Carta de Crédito', slug = 'carta-credito', orden = 4
        WHERE code = 'carta_credito'
        """
    )
    op.execute("UPDATE modules SET nombre = 'Concurrencia', orden = 3 WHERE code = 'concurrencia'")
    op.execute("UPDATE modules SET activo = true WHERE code IN ('suscripcion', 'calificacion')")
    op.drop_constraint("ck_modules_grupo_catalogo", "modules", type_="check")
    op.drop_column("modules", "grupo")
