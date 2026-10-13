"""
Informes entregados (D3): el PDF firmado EXACTO que recibió la gente al pulsar
«Enviar informe», guardado cifrado y numerado por caso.

Es el único documento de un caso que sale de Concurrencia, y solo así:

  1. Al entregar, se guarda la entrega (`guardar_entrega`) en la misma
     transacción que culmina el caso. El correo adjunta ESTOS bytes.
  2. El sincronizador publica en la central un evento `informe_concurrencia`
     con la FICHA (número, huella, tamaño, firmante, fecha). Nunca el PDF.
  3. Otra aplicación pide a la central un enlace (motivo obligatorio). La
     central emite uno de un solo uso, 5 minutos, que apunta aquí.
  4. `compartido` lo canjea en la central (que verifica que es para ESTE
     documento y que no se usó ni venció), lo audita aquí también y entrega
     el PDF, comprobando antes que su huella sigue siendo la entregada.
"""

from __future__ import annotations

import hashlib
import re
import uuid

from cryptography.exceptions import InvalidTag
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import Response
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.central import CentralError, cliente
from app.core.config import settings
from app.core.db import get_db
from app.core.limiter import limiter
from app.core.logging import log
from app.core.security import cifrado
from app.modules.concurrencia import firma
from app.modules.concurrencia.models import InformeEntregado, Visita
from app.shared.audit import service as audit

PROPOSITO = b"informes entregados de concurrencia"
TIPO_EVENTO = "informe_concurrencia"
_TOKEN = re.compile(r"^[A-Za-z0-9_-]{40,100}$")


def url_relativa(entrega_id: uuid.UUID) -> str:
    return f"/api/v1/concurrencia/compartido/informes/{entrega_id}"


def guardar_entrega(
    db: Session, visita: Visita, contenido: bytes, usuario_id: uuid.UUID
) -> InformeEntregado:
    """Agrega la entrega n+1 del caso (sin commit: va con la culminación)."""
    # El bloqueo de la visita serializa dos envíos simultáneos del mismo caso.
    db.execute(select(Visita.id).where(Visita.id == visita.id).with_for_update())
    numero = (
        db.scalar(
            select(func.max(InformeEntregado.numero)).where(InformeEntregado.visita_id == visita.id)
        )
        or 0
    ) + 1
    entrega = InformeEntregado(
        visita_id=visita.id,
        numero=numero,
        sha256=hashlib.sha256(contenido).hexdigest(),
        tamano_bytes=len(contenido),
        contenido_cifrado=b"",
        firmante=firma.titular_actual(),
        entregado_por=usuario_id,
    )
    db.add(entrega)
    db.flush()  # fija el id: es el dato asociado del cifrado
    entrega.contenido_cifrado = cifrado.cifrar_bytes(contenido, PROPOSITO, entrega.id.bytes)
    return entrega


def contenido(entrega: InformeEntregado) -> bytes:
    """El PDF en claro; 500 si fue alterado (no coincide la huella o el cifrado)."""
    try:
        pdf = cifrado.descifrar_bytes(entrega.contenido_cifrado, PROPOSITO, entrega.id.bytes)
    except InvalidTag:
        pdf = b""
    if hashlib.sha256(pdf).hexdigest() != entrega.sha256:
        log.error("informe_entregado_alterado", entrega=str(entrega.id))
        raise HTTPException(
            status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="El informe guardado no pasó la verificación",
        )
    return pdf


def ficha(entrega: InformeEntregado, visita: Visita) -> dict:
    """Lo que la central sabe del documento: nunca su contenido."""
    return {
        "tipo": "informe_final",
        "ref": str(entrega.id),
        "numero_entrega": entrega.numero,
        "visita_codigo": visita.codigo_interno,
        "sha256": entrega.sha256,
        "tamano_bytes": entrega.tamano_bytes,
        "firmado": entrega.firmante is not None,
        "firmante": entrega.firmante,
        "entregado_at": entrega.entregado_at.isoformat(),
        "url_relativa": url_relativa(entrega.id),
    }


# ── Enlace compartido (sin sesión: el enlace de la central ES la credencial) ──
compartido = APIRouter(prefix="/concurrencia/compartido", tags=["concurrencia · compartido"])


@compartido.get("/informes/{entrega_id}")
@limiter.limit(settings.login_rate_limit_ip)
def informe_compartido(
    request: Request,
    entrega_id: uuid.UUID,
    acceso: str = Query(min_length=40, max_length=100),
    db: Session = Depends(get_db),
) -> Response:
    """
    Entrega el informe a quien trae un enlace emitido por la central. Cualquier
    fallo responde igual (404), sin decir si venció, si ya se usó o si no existe.
    """
    rechazo = HTTPException(
        status.HTTP_404_NOT_FOUND, detail="Enlace no válido, vencido o ya usado"
    )
    if not settings.central_configurada or not _TOKEN.fullmatch(acceso):
        raise rechazo
    entrega = db.get(InformeEntregado, entrega_id)
    if entrega is None:
        raise rechazo
    try:
        estado, r = cliente().llamar(
            "POST", "/api/accesos/canjear", {"token": acceso, "ref": str(entrega.id)}
        )
    except CentralError as error:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE, detail="No se pudo validar el enlace ahora"
        ) from error
    if estado != 200:
        audit.registrar(
            db,
            accion="informe_compartido_rechazado",
            request=request,
            entidad="conc_informes_entregados",
            entidad_id=str(entrega.id),
            detalle={"central": estado},
        )
        db.commit()
        raise rechazo
    pdf = contenido(entrega)
    visita = db.get(Visita, entrega.visita_id)
    audit.registrar(
        db,
        accion="informe_compartido",
        request=request,
        entidad="conc_informes_entregados",
        entidad_id=str(entrega.id),
        detalle={
            "visita": visita.codigo_interno if visita else None,
            "numero_entrega": entrega.numero,
            "solicitante_app": r.get("solicitante_app"),
            "solicitante_usuario": r.get("usuario_externo_id"),
            "motivo": r.get("motivo"),
        },
    )
    db.commit()
    nombre = f"informe-{visita.codigo_interno if visita else 'caso'}-entrega-{entrega.numero}.pdf"
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'inline; filename="{nombre}"',
            "X-Content-Type-Options": "nosniff",
            "Cache-Control": "private, no-store",
            "Referrer-Policy": "no-referrer",  # el token no debe viajar a terceros
        },
    )
