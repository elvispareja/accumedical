"""
App PACIENTES (pacientes.pymes.ec, D49): el registro de pacientes de la
plataforma, que vive en la API central. Solo personal de Accumedical.

Esta API no guarda nada: habla con la central con la credencial de la
plataforma y el usuario real (X-Usuario-Id), así la central audita quién
listó, abrió o corrigió a cada persona. Aquí se audita además cada escritura.

  GET  /pacientes                          lista y búsqueda
  GET  /pacientes/{id}                     la persona y su historial en TODAS las apps
  PUT  /pacientes/{id}                     corregir su identidad (la central es la dueña)
  POST /pacientes/eventos/{id}/informe     enlace de un solo uso al informe final (D3)
"""

from __future__ import annotations

import datetime as dt
import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from app.core.central import CentralError, cliente_plataforma
from app.core.db import get_db
from app.core.security.deps import AuthContext, require_personal_accumedical, verificar_csrf
from app.shared.aseguradoras.models import Aseguradora
from app.shared.audit import service as audit
from app.shared.catalogos.models import Module

router = APIRouter(
    prefix="/pacientes",
    tags=["pacientes"],
    dependencies=[Depends(require_personal_accumedical)],
)

_NO_DISPONIBLE = "La central no respondió: el registro de pacientes no está disponible ahora"
POR_PAGINA = 20


def _central(ctx: AuthContext, metodo: str, ruta: str, cuerpo: Any = None) -> tuple[int, Any]:
    try:
        estado, r = cliente_plataforma().llamar(metodo, ruta, cuerpo, usuario=ctx.user.id)
    except CentralError as error:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, detail=_NO_DISPONIBLE) from error
    if estado == 404:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Paciente no encontrado")
    if estado in (409, 422):
        detalle = r.get("detalle") if isinstance(r, dict) else None
        raise HTTPException(
            estado, detail=detalle if isinstance(detalle, str) else "Datos no válidos"
        )
    if estado >= 400:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, detail=_NO_DISPONIBLE)
    return estado, r


class PacienteFila(BaseModel):
    id: uuid.UUID
    tipo_documento_codigo: str
    numero_documento: str
    nombre_principal: str
    nombre_secundario: str | None
    apellido_paterno: str
    apellido_materno: str | None
    eventos: int
    ultimo_evento: dt.datetime | None


class PaginaPacientes(BaseModel):
    items: list[PacienteFila]
    total: int
    page: int
    page_size: int


@router.get("", response_model=PaginaPacientes)
def listar(
    q: str | None = Query(default=None, min_length=2, max_length=80),
    page: int = Query(default=1, ge=1, le=5000),
    ctx: AuthContext = Depends(require_personal_accumedical),
) -> PaginaPacientes:
    params = f"?limit={POR_PAGINA}&offset={(page - 1) * POR_PAGINA}"
    if q:
        from urllib.parse import quote

        params += f"&q={quote(q.strip())}"
    _, r = _central(ctx, "GET", f"/api/personas{params}")
    return PaginaPacientes(
        items=[PacienteFila.model_validate(i) for i in r["items"]],
        total=r["total"],
        page=page,
        page_size=POR_PAGINA,
    )


class Evento(BaseModel):
    id: uuid.UUID
    tipo_evento: str
    fecha_evento: dt.datetime
    aplicacion_codigo: str
    aplicacion_nombre: str
    aseguradora_nombre: str | None
    resumen: dict[str, Any]
    # Ruta LÓGICA del caso en su app (p. ej. /concurrencia/supervision/<id>).
    ruta_caso: str | None
    # Hay un documento final (informe firmado) que se puede pedir con enlace.
    documento: dict[str, Any] | None


class Paciente(BaseModel):
    id: uuid.UUID
    tipo_documento_codigo: str
    numero_documento: str
    nombre_principal: str
    nombre_secundario: str | None
    apellido_paterno: str
    apellido_materno: str | None
    email: str | None
    telefono: str | None
    fecha_nacimiento: dt.date | None
    created_at: dt.datetime
    updated_at: dt.datetime
    eventos: list[Evento]


def _ruta_caso(e: dict[str, Any]) -> str | None:
    if e["tipo_evento"] == "visita_concurrencia" and e.get("referencia_externa"):
        return f"/concurrencia/supervision/{e['referencia_externa']}"
    return None


def _ficha(ctx: AuthContext, db: DbSession, persona_id: uuid.UUID) -> Paciente:
    _, persona = _central(ctx, "GET", f"/api/personas/{persona_id}")
    _, pagina = _central(ctx, "GET", f"/api/personas/{persona_id}/eventos?limit=100")
    apps = dict(db.execute(select(Module.code, Module.nombre)).all())
    ids = {uuid.UUID(e["aseguradora_id"]) for e in pagina["items"] if e.get("aseguradora_id")}
    # Nombres de las compañías desde el espejo local (sus fichas son de la central).
    asegs = (
        {
            i: comercial or razon
            for i, comercial, razon in db.execute(
                select(
                    Aseguradora.id, Aseguradora.nombre_comercial, Aseguradora.razon_social
                ).where(Aseguradora.id.in_(ids))
            )
        }
        if ids
        else {}
    )
    eventos = []
    for e in pagina["items"]:
        resultado = e.get("resultado") or {}
        documento = resultado.get("documento") if isinstance(resultado, dict) else None
        eventos.append(
            Evento(
                id=e["id"],
                tipo_evento=e["tipo_evento"],
                fecha_evento=e["fecha_evento"],
                aplicacion_codigo=e["aplicacion_codigo"],
                aplicacion_nombre=apps.get(e["aplicacion_codigo"], e["aplicacion_codigo"]),
                aseguradora_nombre=asegs.get(uuid.UUID(e["aseguradora_id"]))
                if e.get("aseguradora_id")
                else None,
                # Solo lo administrativo; el documento va aparte y sin su URL interna.
                resumen={k: v for k, v in resultado.items() if k != "documento"}
                if isinstance(resultado, dict)
                else {},
                ruta_caso=_ruta_caso(e),
                documento=(
                    {
                        k: documento.get(k)
                        for k in (
                            "tipo",
                            "numero_entrega",
                            "firmado",
                            "firmante",
                            "entregado_at",
                            "tamano_bytes",
                            "visita_codigo",
                        )
                    }
                    if isinstance(documento, dict)
                    else None
                ),
            )
        )
    return Paciente(
        **{k: persona[k] for k in Paciente.model_fields if k != "eventos"}, eventos=eventos
    )


@router.get("/{persona_id}", response_model=Paciente)
def obtener(
    persona_id: uuid.UUID,
    ctx: AuthContext = Depends(require_personal_accumedical),
    db: DbSession = Depends(get_db),
) -> Paciente:
    return _ficha(ctx, db, persona_id)


class IdentidadCorregir(BaseModel):
    model_config = ConfigDict(extra="forbid")

    nombre_principal: str = Field(min_length=1, max_length=60)
    nombre_secundario: str | None = Field(default=None, max_length=60)
    apellido_paterno: str = Field(min_length=1, max_length=60)
    apellido_materno: str | None = Field(default=None, max_length=60)
    email: str | None = Field(default=None, max_length=254)
    telefono: str | None = Field(default=None, max_length=25)
    fecha_nacimiento: dt.date | None = None


@router.put("/{persona_id}", response_model=Paciente)
def corregir(
    request: Request,
    persona_id: uuid.UUID,
    datos: IdentidadCorregir,
    ctx: AuthContext = Depends(require_personal_accumedical),
    _: None = Depends(verificar_csrf),
    db: DbSession = Depends(get_db),
) -> Paciente:
    """La identidad la corrige el registro de pacientes: la central es su dueña (D49)."""
    cuerpo = datos.model_dump(mode="json")
    _central(ctx, "PUT", f"/api/personas/{persona_id}", cuerpo)
    audit.registrar(
        db,
        accion="actualizar",
        request=request,
        user_id=ctx.user.id,
        session_id=ctx.sesion.id,
        entidad="personas_central",
        entidad_id=str(persona_id),
        # Qué campos llegaron, no sus valores: son datos personales (A09).
        detalle={"campos": sorted(k for k, v in cuerpo.items() if v is not None)},
    )
    db.commit()
    return _ficha(ctx, db, persona_id)


class InformePedir(BaseModel):
    model_config = ConfigDict(extra="forbid")

    motivo: str = Field(min_length=10, max_length=300)


class EnlaceInforme(BaseModel):
    url: str
    expira_at: dt.datetime


@router.post("/eventos/{evento_id}/informe", response_model=EnlaceInforme)
def pedir_informe(
    request: Request,
    evento_id: uuid.UUID,
    datos: InformePedir,
    ctx: AuthContext = Depends(require_personal_accumedical),
    _: None = Depends(verificar_csrf),
    db: DbSession = Depends(get_db),
) -> EnlaceInforme:
    """
    El informe final firmado de un caso, con el enlace de UN SOLO USO que emite
    la central (D3): el documento sigue en su app y se abre allí, una vez.
    """
    _, r = _central(ctx, "POST", f"/api/eventos/{evento_id}/acceso", {"motivo": datos.motivo})
    audit.registrar(
        db,
        accion="informe_pedido",
        request=request,
        user_id=ctx.user.id,
        session_id=ctx.sesion.id,
        entidad="eventos_persona",
        entidad_id=str(evento_id),
        detalle={"motivo": datos.motivo},
    )
    db.commit()
    return EnlaceInforme(url=r["url"], expira_at=r["expira_at"])
