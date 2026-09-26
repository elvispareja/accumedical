"""personas: nombre principal/secundario y apellido paterno/materno

Toda persona de la plataforma —usuario, contacto de aseguradora, contacto de
prestador y paciente del caso— pasa de `nombre` + `apellido` a cuatro partes:

    nombre_principal   (obligatorio)   nombre_secundario  (opcional)
    apellido_paterno   (obligatorio)   apellido_materno   (opcional)

Los dos obligatorios son los que ya existían, así que se RENOMBRAN —los datos
se conservan intactos, sin copiar ni adivinar— y los dos opcionales nacen
nulos. Nadie pierde nada y ninguna fila queda a medias.

Sin CHECK de formato en la base: las filas vivas incluyen apellidos escritos
como «S.A.» de pruebas del dueño, y un CHECK las volvería ilegales de golpe.
La regla «solo letras» se valida en el servidor con Pydantic (mismo criterio
que ya usaba el paciente de concurrencia) y se filtra en el cliente.

Revision ID: e9f4c7b2d651
Revises: d8e3f6b1c429
Create Date: 2026-09-18
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "e9f4c7b2d651"
down_revision = "d8e3f6b1c429"
branch_labels = None
depends_on = None

# Tabla → prefijo de sus columnas de persona. El paciente vive dentro de la
# visita y por eso lleva prefijo; las demás tablas SON la persona.
TABLAS = {
    "users": "",
    "aseguradora_contactos": "",
    "prestador_contactos": "",
    "conc_visitas": "paciente_",
}


def upgrade() -> None:
    for tabla, p in TABLAS.items():
        op.alter_column(tabla, f"{p}nombre", new_column_name=f"{p}nombre_principal")
        op.alter_column(tabla, f"{p}apellido", new_column_name=f"{p}apellido_paterno")
        op.add_column(
            tabla, sa.Column(f"{p}nombre_secundario", sa.String(length=100), nullable=True)
        )
        op.add_column(
            tabla, sa.Column(f"{p}apellido_materno", sa.String(length=100), nullable=True)
        )


def downgrade() -> None:
    # Volver atrás DESCARTA las partes opcionales: no hay dónde guardarlas. Se
    # dejan caer a propósito y en voz alta, no se pegan al campo obligatorio.
    for tabla, p in TABLAS.items():
        op.drop_column(tabla, f"{p}apellido_materno")
        op.drop_column(tabla, f"{p}nombre_secundario")
        op.alter_column(tabla, f"{p}nombre_principal", new_column_name=f"{p}nombre")
        op.alter_column(tabla, f"{p}apellido_paterno", new_column_name=f"{p}apellido")
