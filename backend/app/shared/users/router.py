from __future__ import annotations

import datetime as dt
import uuid

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel
from sqlalchemy.orm import Session as DbSession

from app.core.db import get_db
from app.core.security.deps import AuthContext, require_coordinacion, verificar_csrf
from app.shared import personas
from app.shared.audit import service as audit
from app.shared.auth import invitaciones
from app.shared.auth import service as auth_service
from app.shared.catalogos.models import Ciudad, Provincia, TipoDocumento
from app.shared.users import service
from app.shared.users.models import User
from app.shared.users.schemas import (
    AccesoPlataformaSalida,
    UsuarioPlataformaActualizar,
    UsuarioPlataformaCrear,
    UsuarioPlataformaSalida,
)

# El personal de la plataforma: usuarios del propio administrador, sin
# aseguradora. Router protegido a nivel de APIRouter, como todos: cualquier
# endpoint que se añada aquí nace exigiendo `require_coordinacion`.
#
# Entran dos figuras, y la diferencia es `ctx.grupo`:
#
#   · el administrador global (`grupo = None`), que ve y concede todo;
#   · el coordinador de una familia (`"siniestro"` / `"suscripcion"`), acotado a
#     LOS AUDITORES DE SU FAMILIA: los ve, los crea y los mantiene, y nada más.
#
# El acotado no se pinta en la pantalla: viaja a cada llamada del servicio, que
# es quien filtra y quien corta lo que no le toca.
router = APIRouter(
    prefix="/shared/usuarios",
    tags=["usuarios-plataforma"],
    dependencies=[Depends(require_coordinacion)],
)


def _salida(db: DbSession, usuario: User) -> UsuarioPlataformaSalida:
    tipo = (
        db.get(TipoDocumento, usuario.tipo_documento_codigo)
        if usuario.tipo_documento_codigo
        else None
    )
    provincia = db.get(Provincia, usuario.provincia_codigo) if usuario.provincia_codigo else None
    ciudad = db.get(Ciudad, usuario.ciudad_codigo) if usuario.ciudad_codigo else None
    return UsuarioPlataformaSalida(
        id=str(usuario.id),
        **personas.partes_out(usuario),
        email=usuario.email,
        tipo_documento_codigo=usuario.tipo_documento_codigo,
        tipo_documento_nombre=tipo.nombre if tipo else None,
        numero_documento=usuario.numero_documento,
        telefono=usuario.telefono,
        provincia_codigo=usuario.provincia_codigo,
        provincia_nombre=provincia.nombre if provincia else None,
        ciudad_codigo=usuario.ciudad_codigo,
        ciudad_nombre=ciudad.nombre if ciudad else None,
        is_active=usuario.is_active,
        password_definida=usuario.last_login_at is not None
        or usuario.password_changed_at > usuario.created_at,
        invitacion_pendiente=service.invitacion_viva(db, usuario.id),
        ultimo_acceso=usuario.last_login_at,
        acceso=AccesoPlataformaSalida(**service.acceso_de(db, usuario.id)),
    )


@router.get("", response_model=list[UsuarioPlataformaSalida])
def listar(
    ctx: AuthContext = Depends(require_coordinacion),
    db: DbSession = Depends(get_db),
) -> list[UsuarioPlataformaSalida]:
    return [_salida(db, u) for u in service.listar(db, ctx.grupo)]


class Tramo(BaseModel):
    user_id: str
    nombre: str
    email: str | None
    rol: str
    rol_etiqueta: str
    desde: dt.datetime
    hasta: dt.datetime | None
    vigente: bool
    otorgado_por: str | None
    retirado_por: str | None


class HistorialDeApp(BaseModel):
    module_code: str
    module_nombre: str
    tramos: list[Tramo]


class TramoDeUsuario(Tramo):
    ambito: str
    donde: str


@router.get("/historial-por-aplicacion", response_model=list[HistorialDeApp])
def historial_por_aplicacion(
    ctx: AuthContext = Depends(require_coordinacion),
    db: DbSession = Depends(get_db),
) -> list[HistorialDeApp]:
    """
    Por aplicación: quién la coordina, audita o atiende hoy y quién lo hizo
    antes, con desde, hasta y quién dio o quitó el acceso. Nada se borra.
    """
    return [HistorialDeApp(**h) for h in service.historial_por_aplicacion(db)]


@router.get("/{user_id}/historial", response_model=list[TramoDeUsuario])
def historial_de_usuario(
    user_id: uuid.UUID,
    ctx: AuthContext = Depends(require_coordinacion),
    db: DbSession = Depends(get_db),
) -> list[TramoDeUsuario]:
    """La trayectoria de una persona: cada rol que tuvo, dónde y cuándo."""
    service.obtener(db, user_id, ctx.grupo)
    return [TramoDeUsuario(**t) for t in service.historial_de_usuario(db, user_id)]


@router.get("/{user_id}", response_model=UsuarioPlataformaSalida)
def obtener(
    user_id: uuid.UUID,
    ctx: AuthContext = Depends(require_coordinacion),
    db: DbSession = Depends(get_db),
) -> UsuarioPlataformaSalida:
    return _salida(db, service.obtener(db, user_id, ctx.grupo))


@router.post("", response_model=UsuarioPlataformaSalida, status_code=status.HTTP_201_CREATED)
def crear(
    request: Request,
    datos: UsuarioPlataformaCrear,
    ctx: AuthContext = Depends(require_coordinacion),
    _: None = Depends(verificar_csrf),
    db: DbSession = Depends(get_db),
) -> UsuarioPlataformaSalida:
    cuerpo = datos.model_dump()
    acceso = cuerpo.pop("acceso")
    # Un coordinador solo da de alta auditores de SU familia. El admin, lo que quiera.
    service.validar_alcance(db, ctx.grupo, acceso)
    usuario, token = service.crear(db, cuerpo, acceso, ctx.user.id)
    audit.registrar(
        db,
        accion="usuario_creado",
        request=request,
        user_id=ctx.user.id,
        session_id=ctx.sesion.id,
        entidad="users",
        entidad_id=str(usuario.id),
        detalle={
            "plataforma": True,
            "acceso": {
                "aplicaciones": acceso.get("aplicaciones") or [],
                "funcion": acceso.get("funcion"),
            },
        },
    )
    db.commit()

    # DESPUÉS del commit: un correo enviado no se puede deshacer, así que primero
    # se asegura que el usuario existe de verdad. Si el envío falla, el usuario
    # queda creado y se reenvía la invitación desde la pantalla.
    invitaciones.enviar_invitacion(usuario, token)
    return _salida(db, usuario)


@router.patch("/{user_id}", response_model=UsuarioPlataformaSalida)
def actualizar(
    request: Request,
    user_id: uuid.UUID,
    datos: UsuarioPlataformaActualizar,
    ctx: AuthContext = Depends(require_coordinacion),
    _: None = Depends(verificar_csrf),
    db: DbSession = Depends(get_db),
) -> UsuarioPlataformaSalida:
    usuario = service.obtener(db, user_id, ctx.grupo)
    cambios = datos.model_dump(exclude_unset=True)
    acceso = cambios.pop("acceso", None)
    is_active = cambios.pop("is_active", None)
    # También al editar: nadie se saca de su familia por la puerta de atrás.
    if acceso is not None:
        service.validar_alcance(db, ctx.grupo, acceso)

    diff = service.actualizar(db, usuario, cambios)
    detalle: dict = dict(diff["despues"])

    if acceso is not None:
        service.fijar_acceso(db, usuario, acceso, ctx.user.id)
        detalle["acceso"] = {
            "aplicaciones": acceso.get("aplicaciones") or [],
            "funcion": acceso.get("funcion"),
        }
    if is_active is not None and is_active != usuario.is_active:
        if is_active:
            # Reactivar recupera su alcance: si otro tomó su función mientras
            # estaba desactivado, no caben dos y se corta aquí. (Coordinadores
            # puede haber varios por aplicación: ahí no hay choque.)
            service.validar_funcion_unica(
                db, service.funcion_de(db, usuario.id), salvo_user_id=usuario.id
            )
        usuario.is_active = is_active
        detalle["is_active"] = is_active
        # Trazabilidad: desactivar libera su función (para nombrar al reemplazo)
        # y cierra todos sus tramos; reactivar abre de nuevo los de sus apps.
        if not is_active:
            service.liberar_puestos(db, usuario, ctx.user.id)
        db.flush()
        service.sincronizar_historial(db, usuario, ctx.user.id)
        # Desactivar mata TODAS sus sesiones vivas, no solo impide entrar de nuevo.
        if not is_active:
            detalle["sesiones_revocadas"] = auth_service.revocar_sesiones_de_usuario(
                db, usuario.id, "usuario_desactivado"
            )

    if detalle:
        usuario.updated_by = ctx.user.id
        audit.registrar(
            db,
            accion="usuario_actualizado" if is_active is not False else "usuario_desactivado",
            request=request,
            user_id=ctx.user.id,
            session_id=ctx.sesion.id,
            entidad="users",
            entidad_id=str(user_id),
            detalle=detalle,
        )
    db.commit()
    return _salida(db, usuario)


@router.post("/{user_id}/invitacion", status_code=status.HTTP_202_ACCEPTED)
def reenviar_invitacion(
    request: Request,
    user_id: uuid.UUID,
    ctx: AuthContext = Depends(require_coordinacion),
    _: None = Depends(verificar_csrf),
    db: DbSession = Depends(get_db),
) -> dict:
    """Emite una invitación nueva e invalida la anterior."""
    usuario = service.obtener(db, user_id, ctx.grupo)
    if not usuario.is_active:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail="El usuario está desactivado: actívalo antes de invitarlo",
        )
    token = invitaciones.emitir(db, usuario, ctx.user.id)
    audit.registrar(
        db,
        accion="invitacion_enviada",
        request=request,
        user_id=ctx.user.id,
        session_id=ctx.sesion.id,
        entidad="users",
        entidad_id=str(user_id),
        detalle={"reenvio": True, "plataforma": True},
    )
    db.commit()
    invitaciones.enviar_invitacion(usuario, token)
    return {"detail": "Invitación enviada"}
