from __future__ import annotations

import uuid
from decimal import Decimal
from typing import Any

from fastapi import Request
from sqlalchemy.orm import Session as DbSession

from app.core.logging import CLAVES_PROHIBIDAS, request_id_ctx
from app.shared.audit.models import AuditLog

# Catálogo cerrado de acciones. Ampliarlo es editar esta tupla y el documento
# docs/01-esquema-bd.md §6.1; no se inventan acciones sueltas por el código.
ACCIONES = (
    "login_ok",
    "login_fallido",
    "cuenta_bloqueada",
    "logout",
    "sesion_revocada",
    "cambio_modulo",
    "acceso_denegado",
    "crear",
    "actualizar",
    "eliminar",
    "acceso_modulo_asignado",
    "acceso_modulo_revocado",
    "usuario_creado",
    "usuario_actualizado",
    "usuario_desactivado",
    "invitacion_enviada",
    "password_definida",
    "logo_subido",
    # Concurrencia: el supervisor de plataforma deriva un caso a un auditor.
    "visita_derivada",
    # Concurrencia: el supervisor cambia la ventana de la visita.
    "visita_reprogramada",
    # Concurrencia: la imagen que comprueba el cambio de horario pedido por correo.
    "comprobante_subido",
    # Concurrencia: el auditor dicta y borra notas en el hospital, y la IA
    # redacta el informe. El detalle lleva tipo y longitud, JAMÁS el texto:
    # las notas son dato clínico y el log no los guarda (A09).
    "nota_creada",
    "nota_eliminada",
    "informe_generado",
    # Concurrencia: el auditor dicta correcciones y la IA reescribe solo eso.
    # Al log van longitudes, jamás el texto: es dato clínico (A09).
    "informe_corregido",
    # Concurrencia: el auditor envía el informe en PDF a los correos del caso.
    "informe_enviado",
    # Concurrencia (D3): otra app abrió un informe entregado con un enlace de
    # la central (app, usuario y motivo), o se rechazó un enlace no válido.
    "informe_compartido",
    "informe_compartido_rechazado",
    # App Pacientes (D49): alguien de Accumedical pidió el informe final de un
    # caso desde la ficha del paciente (con su motivo).
    "informe_pedido",
    # Concurrencia: las fotos que el auditor toma en el hospital. Al log solo
    # van MIME y tamaño, jamás la imagen: es dato clínico (A09).
    "foto_subida",
    "foto_eliminada",
    # Configuración de plataforma: el superadmin puso (o reemplazó) el .p12 de
    # la firma electrónica. Al log van titular y tamaño; la contraseña JAMÁS.
    "firma_configurada",
    # Concurrencia: el auditor marca «Ya llegué» al hospital desde su app.
    "llegada_registrada",
    # Concurrencia: el plazo de llegada venció sin el auditor y el SERVIDOR
    # marca el caso.
    "visita_no_auditada",
    # Concurrencia: la coordinación le da al auditor más horas para llegar.
    "visita_prorrogada",
)


def _limpiar(valor: Any) -> Any:
    """
    Recorre lo que cuelga de una clave. `detalle` acaba en una columna JSONB, así
    que aquí se convierte lo que `json.dumps` no sabe escribir: las coordenadas
    son `Decimal` y reventarían la escritura de la auditoría —y con ella la
    transacción de negocio entera, porque comparten commit—.
    """
    if isinstance(valor, dict):
        return redactar(valor)
    if isinstance(valor, (list, tuple)):
        return [_limpiar(v) for v in valor]
    if isinstance(valor, Decimal):
        return float(valor)
    return valor


def redactar(detalle: dict[str, Any] | None) -> dict[str, Any] | None:
    """
    Único punto por el que pasa todo lo que se escribe en `detalle`. Jamás una
    contraseña, un token ni un dato clínico llegan a la auditoría en claro.
    """
    if detalle is None:
        return None
    limpio: dict[str, Any] = {}
    for clave, valor in detalle.items():
        if clave.lower() in CLAVES_PROHIBIDAS:
            limpio[clave] = "[redactado]"
        else:
            limpio[clave] = _limpiar(valor)
    return limpio


def registrar(
    db: DbSession,
    *,
    accion: str,
    request: Request | None = None,
    user_id: uuid.UUID | None = None,
    session_id: uuid.UUID | None = None,
    module_code: str | None = None,
    entidad: str | None = None,
    entidad_id: str | None = None,
    detalle: dict[str, Any] | None = None,
) -> AuditLog:
    """
    Escribe en la MISMA transacción que la mutación de negocio: o se registran
    ambas o ninguna. No hace commit; lo hace quien llama.
    """
    if accion not in ACCIONES:
        raise ValueError(f"Acción de auditoría no catalogada: {accion}")

    ip = None
    user_agent = None
    if request is not None:
        # request.client.host ya viene resuelto por el middleware de proxy de
        # uvicorn (--proxy-headers): nunca se parsea X-Forwarded-For a mano.
        ip = request.client.host if request.client else None
        user_agent = (request.headers.get("user-agent") or "")[:400]

    fila = AuditLog(
        user_id=user_id,
        session_id=session_id,
        module_code=module_code,
        accion=accion,
        entidad=entidad,
        entidad_id=entidad_id,
        detalle=redactar(detalle),
        ip=ip,
        user_agent=user_agent,
        request_id=request_id_ctx.get(),
    )
    db.add(fila)
    return fila
