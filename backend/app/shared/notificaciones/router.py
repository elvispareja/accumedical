from __future__ import annotations

import datetime as dt
import uuid

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session as DbSession

from app.core.db import get_db
from app.core.security.deps import AuthContext, get_current_user, verificar_csrf
from app.shared.notificaciones import service

# La campana del armazón. No exige rol ninguno —cualquiera que haya iniciado
# sesión tiene la suya—, pero SOLO ve la suya: el `user_id` sale del contexto de
# la sesión y jamás de un parámetro, así que no hay nada que acotar por fuera.
router = APIRouter(
    prefix="/shared/notificaciones",
    tags=["notificaciones"],
    dependencies=[Depends(get_current_user)],
)


class NotificacionOut(BaseModel):
    id: str
    module_code: str
    titulo: str
    subtitulo: str
    detalle: str
    url: str
    leida: bool
    creada_at: dt.datetime


class ModuloDeNotificaciones(BaseModel):
    """Una pastilla del filtro por módulo, con lo que hay detrás de ella."""

    codigo: str
    nombre: str
    total: int
    sin_leer: int


class BandejaOut(BaseModel):
    items: list[NotificacionOut]
    # El del globito: cuenta TODAS las no leídas, no solo las de esta página.
    sin_leer: int
    total: int
    page: int
    page_size: int
    # Los módulos que pueden avisar a esta persona, con sus cuentas. Vacío salvo
    # que se pidan: la campana sondea esta ruta cada pocos segundos y no los usa.
    modulos: list[ModuloDeNotificaciones] = []


def _salida(fila) -> NotificacionOut:
    return NotificacionOut(
        id=str(fila.id),
        module_code=fila.module_code,
        titulo=fila.titulo,
        subtitulo=fila.subtitulo,
        detalle=fila.detalle,
        url=fila.url,
        leida=fila.leida_at is not None,
        creada_at=fila.created_at,
    )


def _bandeja(
    db: DbSession,
    user,
    *,
    solo_sin_leer: bool = False,
    module_code: str | None = None,
    con_modulos: bool = False,
    page: int = 1,
    page_size: int = service.TOPE,
) -> BandejaOut:
    """
    Arma la respuesta. Función aparte y no el propio endpoint: los valores por
    defecto de un endpoint son objetos `Query`, así que llamarlo como función
    normal desde otro endpoint revienta con un `TypeError` —pasó, y salió como
    un 500 al marcar leída—. Aquí los valores por defecto son valores.
    """
    filas, total = service.listar(
        db,
        user.id,
        solo_sin_leer=solo_sin_leer,
        module_code=module_code,
        page=page,
        page_size=page_size,
    )
    modulos: list[ModuloDeNotificaciones] = []
    if con_modulos:
        conteos = service.conteo_por_modulo(db, user.id)
        modulos = [
            ModuloDeNotificaciones(
                codigo=codigo,
                nombre=nombre,
                total=conteos.get(codigo, (0, 0))[0],
                sin_leer=conteos.get(codigo, (0, 0))[1],
            )
            for codigo, nombre in service.modulos_que_avisan(db, user)
        ]
    return BandejaOut(
        items=[_salida(f) for f in filas],
        sin_leer=service.sin_leer(db, user.id),
        total=total,
        page=page,
        page_size=page_size,
        modulos=modulos,
    )


@router.get("", response_model=BandejaOut)
def bandeja(
    solo_sin_leer: bool = Query(default=False),
    module_code: str | None = Query(default=None, max_length=30),
    con_modulos: bool = Query(default=False),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=service.TOPE, ge=1, le=100),
    ctx: AuthContext = Depends(get_current_user),
    db: DbSession = Depends(get_db),
) -> BandejaOut:
    """
    La misma ruta para las dos vistas, con los parámetros por defecto puestos en
    lo que pide la campana: las últimas, leídas y sin leer. La pantalla completa
    pagina y filtra con esos mismos parámetros.

    El navegador la consulta cada pocos segundos, así que devuelve lo justo: las
    pastillas del filtro por módulo cuestan dos consultas más y solo las pide la
    pantalla completa, con `con_modulos`.
    """
    return _bandeja(
        db,
        ctx.user,
        solo_sin_leer=solo_sin_leer,
        module_code=module_code,
        con_modulos=con_modulos,
        page=page,
        page_size=page_size,
    )


@router.post("/{notificacion_id}/leida", response_model=BandejaOut)
def marcar_leida(
    notificacion_id: uuid.UUID,
    ctx: AuthContext = Depends(get_current_user),
    _: None = Depends(verificar_csrf),
    db: DbSession = Depends(get_db),
) -> BandejaOut:
    """
    Marcar leída no es un hecho de negocio: no se audita. Responde la bandeja
    entera para que la campana no tenga que volver a preguntarla.
    """
    service.marcar_leida(db, ctx.user.id, notificacion_id)
    db.commit()
    return _bandeja(db, ctx.user)


@router.post("/leidas", response_model=BandejaOut)
def marcar_todas(
    module_code: str | None = Query(default=None, pattern=r"^[a-z][a-z0-9_]{1,29}$"),
    ctx: AuthContext = Depends(get_current_user),
    _: None = Depends(verificar_csrf),
    db: DbSession = Depends(get_db),
) -> BandejaOut:
    service.marcar_todas(db, ctx.user.id, module_code)
    db.commit()
    return _bandeja(db, ctx.user)
