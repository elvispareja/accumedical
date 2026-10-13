"""
Traductor Concurrencia → API central (docs/contexto: «cada sistema solo necesita
su propio traductor hacia el formato canónico del centro»).

Qué publica, y nada más:

  paciente de la visita  →  persona   (se busca por tipo + número; si no existe,
                                       se crea; si existe NO se sobrescribe: la
                                       central es la dueña de la identidad)
  visita culminada       →  evento `visita_concurrencia` con datos ADMINISTRATIVOS
                                       (código, fechas, sede). Nunca el informe,
                                       las notas ni las fotos: lo clínico se
                                       queda en Concurrencia.
  informe entregado      →  evento `informe_concurrencia` con la FICHA del PDF
                                       firmado (número, huella, tamaño, firmante).
                                       El PDF no viaja: otra app lo ve solo con
                                       un enlace de un solo uso (informes.py, D3).

Lo corre una tarea periódica (app.main) y el comando `python -m app.cli
sincronizar-central`. Si la central no responde, la visita queda pendiente y se
reintenta en la siguiente pasada; la app nunca se bloquea por la central.
"""

from __future__ import annotations

import datetime as dt
import uuid
from typing import Any

from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session

from app.core.central import CentralError, ClienteCentral
from app.core.logging import log
from app.modules.concurrencia import informes
from app.modules.concurrencia.models import InformeEntregado, SyncCentral, Visita

TIPO_EVENTO = "visita_concurrencia"
APLICACION = "concurrencia"


# ── Traducción al formato canónico ───────────────────────────────────────────
def persona_canonica(v: Visita) -> dict[str, Any]:
    return {
        "tipo_documento_codigo": v.paciente_tipo_documento_codigo,
        "numero_documento": v.paciente_numero_documento.strip().upper(),
        "nombre_principal": v.paciente_nombre_principal,
        "nombre_secundario": v.paciente_nombre_secundario,
        "apellido_paterno": v.paciente_apellido_paterno,
        "apellido_materno": v.paciente_apellido_materno,
    }


def evento_canonico(v: Visita, persona_id: uuid.UUID) -> dict[str, Any]:
    def iso(x: dt.datetime | None) -> str | None:
        return x.isoformat() if x else None

    return {
        "persona_id": str(persona_id),
        "tipo_evento": TIPO_EVENTO,
        # Cuándo culminó: el último envío del informe, o la última modificación.
        "fecha_evento": iso(v.informe_actualizado_at or v.updated_at),
        "aseguradora_id": str(v.aseguradora_id),
        "prestador_id": str(v.prestador_id),
        "referencia_externa": str(v.id),
        "resultado": {
            "codigo": v.codigo_interno,
            "estado": v.estado,
            "desde": iso(v.desde),
            "hasta": iso(v.hasta),
            "llegada_at": iso(v.llegada_at),
            "sede_id": str(v.sede_id) if v.sede_id else None,
        },
    }


# ── Llamadas a la central ────────────────────────────────────────────────────
def _persona_central(c: ClienteCentral, v: Visita) -> uuid.UUID:
    p = persona_canonica(v)
    ruta = f"/api/personas/{p['tipo_documento_codigo']}/{p['numero_documento']}"
    estado, r = c.llamar("GET", ruta, usuario=v.created_by)
    if estado == 200:
        return uuid.UUID(r["id"])
    if estado != 404:
        raise CentralError(estado, "buscar persona")
    estado, r = c.llamar("POST", "/api/personas", p, usuario=v.created_by)
    if estado == 201:
        return uuid.UUID(r["id"])
    if estado == 409:  # otra pasada la creó entre el GET y el POST
        estado, r = c.llamar("GET", ruta, usuario=v.created_by)
        if estado == 200:
            return uuid.UUID(r["id"])
    raise CentralError(estado, "crear persona")


def _evento_central(c: ClienteCentral, v: Visita, persona_id: uuid.UUID) -> uuid.UUID:
    cuerpo = evento_canonico(v, persona_id)
    estado, r = c.llamar("POST", "/api/eventos", cuerpo, usuario=v.auditor_id or v.updated_by)
    if estado == 422 and _menciona_entidad(r):
        # La aseguradora o el prestador aún no existen en la central (se crearon en
        # el admin de la plataforma después de la carga inicial). El evento se
        # registra igual, sin el vínculo, y los ids viajan en el resultado.
        cuerpo["resultado"]["aseguradora_id_plataforma"] = cuerpo.pop("aseguradora_id")
        cuerpo["resultado"]["prestador_id_plataforma"] = cuerpo.pop("prestador_id")
        log.warning("central_evento_sin_vinculo", visita=str(v.id))
        estado, r = c.llamar("POST", "/api/eventos", cuerpo, usuario=v.auditor_id or v.updated_by)
    if estado in (200, 201):
        return uuid.UUID(r["id"])
    raise CentralError(estado, "registrar evento")


def _menciona_entidad(r: Any) -> bool:
    detalle = str(r.get("detalle", "")) if isinstance(r, dict) else ""
    return "aseguradora" in detalle.lower() or "prestador" in detalle.lower()


# ── Sincronización ───────────────────────────────────────────────────────────
def pendientes(db: Session, limite: int) -> list[Visita]:
    """Visitas vivas sin persona publicada, o culminadas sin su evento."""
    return list(
        db.scalars(
            select(Visita)
            .outerjoin(SyncCentral, SyncCentral.visita_id == Visita.id)
            .where(
                Visita.deleted_at.is_(None),
                or_(
                    SyncCentral.visita_id.is_(None),
                    SyncCentral.persona_central_id.is_(None),
                    and_(Visita.estado == "culminada", SyncCentral.evento_central_id.is_(None)),
                ),
            )
            # Los que más veces fallaron van al final, para que uno atascado no tape al resto.
            .order_by(func.coalesce(SyncCentral.intentos, 0), Visita.updated_at)
            .limit(limite)
        )
    )


def sincronizar_visita(db: Session, c: ClienteCentral, v: Visita) -> bool:
    fila = db.get(SyncCentral, v.id) or SyncCentral(visita_id=v.id, intentos=0)
    db.add(fila)
    try:
        if fila.persona_central_id is None:
            fila.persona_central_id = _persona_central(c, v)
        if v.estado == "culminada" and fila.evento_central_id is None:
            fila.evento_central_id = _evento_central(c, v, fila.persona_central_id)
        fila.sincronizada_at = func.now()
        fila.ultimo_error = None
        ok = True
    except CentralError as error:
        fila.intentos = (fila.intentos or 0) + 1
        # Solo el estado HTTP y la operación: nunca el cuerpo, que puede llevar datos personales.
        fila.ultimo_error = f"{error.estado or 'sin respuesta'}: {error.detalle}"[:200]
        ok = False
    db.commit()
    return ok


def publicar_informe(db: Session, c: ClienteCentral, entrega: InformeEntregado) -> bool:
    """La ficha de una entrega como evento `informe_concurrencia` (idempotente por su id)."""
    visita = db.get(Visita, entrega.visita_id)
    sync = db.get(SyncCentral, entrega.visita_id)
    try:
        if visita is None or sync is None or sync.persona_central_id is None:
            raise CentralError(None, "persona aún no publicada")
        cuerpo = {
            "persona_id": str(sync.persona_central_id),
            "tipo_evento": informes.TIPO_EVENTO,
            "fecha_evento": entrega.entregado_at.isoformat(),
            "referencia_externa": str(entrega.id),
            "resultado": {"documento": informes.ficha(entrega, visita)},
        }
        estado, r = c.llamar("POST", "/api/eventos", cuerpo, usuario=entrega.entregado_por)
        if estado not in (200, 201):
            raise CentralError(estado, "registrar informe")
        entrega.evento_central_id = uuid.UUID(r["id"])
        entrega.ultimo_error = None
        ok = True
    except CentralError as error:
        entrega.intentos = (entrega.intentos or 0) + 1
        entrega.ultimo_error = f"{error.estado or 'sin respuesta'}: {error.detalle}"[:200]
        ok = False
    db.commit()
    return ok


def informes_pendientes(db: Session, limite: int) -> list[InformeEntregado]:
    """Entregas sin publicar cuya persona ya está en la central."""
    return list(
        db.scalars(
            select(InformeEntregado)
            .join(SyncCentral, SyncCentral.visita_id == InformeEntregado.visita_id)
            .where(
                InformeEntregado.evento_central_id.is_(None),
                SyncCentral.persona_central_id.is_not(None),
            )
            .order_by(InformeEntregado.intentos, InformeEntregado.entregado_at)
            .limit(limite)
        )
    )


def sincronizar_pendientes(db: Session, c: ClienteCentral, limite: int = 50) -> tuple[int, int]:
    """Devuelve (sincronizadas, fallidas). Si la central no responde, corta la pasada."""
    hechas = fallidas = 0
    for visita in pendientes(db, limite):
        if sincronizar_visita(db, c, visita):
            hechas += 1
        else:
            fallidas += 1
            fila = db.get(SyncCentral, visita.id)
            if fila and fila.ultimo_error and fila.ultimo_error.startswith("sin respuesta"):
                return hechas, fallidas  # central caída: no tiene sentido seguir golpeando
    # Después de las visitas: así la persona de cada informe ya está publicada.
    for entrega in informes_pendientes(db, limite):
        if publicar_informe(db, c, entrega):
            hechas += 1
        else:
            fallidas += 1
            if entrega.ultimo_error and entrega.ultimo_error.startswith("sin respuesta"):
                break
    return hechas, fallidas
