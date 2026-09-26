from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from fastapi.responses import FileResponse
from sqlalchemy import func
from sqlalchemy.orm import Session as DbSession

from app.core.config import settings
from app.core.db import get_db
from app.core.limiter import limiter
from app.core.security import cookies
from app.core.security.deps import (
    NO_AUTORIZADO,
    AuthContext,
    get_current_user,
    verificar_csrf,
)
from app.shared import personas
from app.shared.aseguradoras import usuarios as usuarios_service
from app.shared.aseguradoras.logo import respuesta_logo
from app.shared.aseguradoras.models import Aseguradora
from app.shared.audit import service as audit
from app.shared.auth import invitaciones
from app.shared.auth import service as auth_service
from app.shared.auth.schemas import (
    AseguradoraDeSesionOut,
    CambioModuloRequest,
    DefinirPasswordRequest,
    InvitacionOut,
    LoginRequest,
    ModuloOut,
    SesionOut,
    UsuarioOut,
)
from app.shared.users import service as users_service

router = APIRouter(prefix="/auth", tags=["auth"])

# Respuesta idéntica exista o no el correo, esté o no bloqueada la cuenta.
CREDENCIALES_INVALIDAS = HTTPException(
    status.HTTP_401_UNAUTHORIZED, detail="Credenciales inválidas"
)


def _aseguradora_de_sesion(db: DbSession, ctx_user) -> AseguradoraDeSesionOut | None:
    """La compañía del usuario, para su marca en el armazón. El admin no tiene."""
    if ctx_user.aseguradora_id is None:
        return None
    aseguradora = db.get(Aseguradora, ctx_user.aseguradora_id)
    if aseguradora is None or aseguradora.deleted_at is not None:
        return None
    return AseguradoraDeSesionOut(
        nombre=aseguradora.nombre_comercial or aseguradora.razon_social,
        tiene_logo=bool(aseguradora.logo_path),
    )


def _armar_sesion_out(
    db: DbSession, ctx_user, modulos, *, modulo_activo: str | None, permisos: list[str]
) -> SesionOut:
    funcion = users_service.funcion_de(db, ctx_user.id)
    grupo = users_service.grupo_coordinado_por(db, ctx_user.id)
    return SesionOut(
        user=UsuarioOut(
            id=str(ctx_user.id),
            email=ctx_user.email,
            nombre_completo=personas.de_fila(ctx_user),
            es_admin_global=ctx_user.is_superadmin,
            funcion=funcion,
            grupo_coordinado=grupo,
        ),
        aseguradora=_aseguradora_de_sesion(db, ctx_user),
        modulos=[
            ModuloOut(
                codigo=m.codigo, slug=m.slug, nombre=m.nombre, icono=m.icono,
                color_acento=m.color_acento, orden=m.orden, rol=m.rol,
            )
            for m in modulos
        ],
        ultimo_modulo_usado=ctx_user.last_module_code,
        modulo_activo=modulo_activo,
        permisos=permisos,
        redireccion=auth_service.calcular_redireccion(
            ctx_user, modulos, ctx_user.last_module_code, funcion, grupo
        ),
    )


@router.post("/login", response_model=SesionOut)
@limiter.limit(settings.login_rate_limit_ip)
def login(
    request: Request,
    response: Response,
    datos: LoginRequest,
    db: DbSession = Depends(get_db),
) -> SesionOut:
    # El "solo JSON" que cierra el CSRF de login se aplica en OrigenMiddleware:
    # FastAPI parsea el cuerpo antes de llegar aquí, así que una comprobación en
    # este punto no llegaría a tiempo.
    resultado = auth_service.autenticar(db, str(datos.email), datos.password)

    if resultado.user is None:
        audit.registrar(
            db,
            accion="login_fallido",
            request=request,
            detalle={"email_intentado": str(datos.email), "motivo": resultado.motivo},
        )
        if resultado.motivo == "cuenta_bloqueada":
            audit.registrar(
                db, accion="cuenta_bloqueada", request=request,
                detalle={"email_intentado": str(datos.email)},
            )
        db.commit()
        raise CREDENCIALES_INVALIDAS

    user = resultado.user

    # Rotación de identificador SOLO tras verificar credenciales: si se revocara
    # antes, un POST fallido a /login desde otra pestaña destruiría la sesión válida.
    anterior = None
    token_previo = request.cookies.get(settings.nombre_cookie_sesion)
    if token_previo:
        anterior = auth_service.buscar_sesion_valida(db, token_previo)
        if anterior is not None:
            auth_service.revocar_sesion(db, anterior, "rotation")

    sesion, token, csrf = auth_service.crear_sesion(
        db, user, request, rotada_desde=anterior.id if anterior else None
    )

    modulos = auth_service.resolver_modulos(db, user)
    audit.registrar(
        db, accion="login_ok", request=request, user_id=user.id, session_id=sesion.id,
        detalle={"modulos": len(modulos), "cliente": datos.cliente},
    )
    db.commit()

    salida = _armar_sesion_out(db, user, modulos, modulo_activo=None, permisos=[])
    if datos.cliente == "movil":
        # La app nativa no tiene navegador que guarde cookies: el token opaco
        # viaja UNA única vez en el cuerpo, la app lo guarda en el llavero del
        # sistema (Keychain/Keystore) y lo manda por `Authorization: Bearer`.
        # Sin Set-Cookie: dos sobres a la vez sería el peor de los dos mundos.
        salida.token = token
        return salida
    cookies.poner_cookies_sesion(response, token, csrf)
    return salida


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(
    request: Request,
    response: Response,
    ctx: AuthContext = Depends(get_current_user),
    _: None = Depends(verificar_csrf),
    db: DbSession = Depends(get_db),
) -> Response:
    # Invalidación EN SERVIDOR, no basta con borrar la cookie: un token robado
    # deja de servir en este instante.
    auth_service.revocar_sesion(db, ctx.sesion, "logout")
    audit.registrar(
        db, accion="logout", request=request, user_id=ctx.user.id, session_id=ctx.sesion.id
    )
    db.commit()
    cookies.borrar_cookies_sesion(response)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/me", response_model=SesionOut)
def me(ctx: AuthContext = Depends(get_current_user), db: DbSession = Depends(get_db)) -> SesionOut:
    modulos = auth_service.resolver_modulos(db, ctx.user)

    permisos: list[str] = []
    activo = ctx.sesion.active_module_code
    if activo is not None:
        role_id = auth_service.rol_en_modulo(db, ctx.user.id, activo)
        if role_id is None:
            # El acceso fue revocado mientras la sesión seguía viva: se limpia el
            # módulo activo para que el frontend caiga al selector.
            ctx.sesion.active_module_code = None
            db.commit()
            activo = None
        else:
            permisos = auth_service.permisos_de(db, role_id)

    return _armar_sesion_out(db, ctx.user, modulos, modulo_activo=activo, permisos=permisos)


@router.get("/mi-aseguradora/logo")
def logo_de_mi_aseguradora(
    ctx: AuthContext = Depends(get_current_user), db: DbSession = Depends(get_db)
) -> FileResponse:
    """
    El logo de la compañía del PROPIO usuario, para su marca en el armazón de los
    módulos. La autorización es la pertenencia: la ruta no recibe identificador,
    así que no existe forma de pedir el logo de otra compañía. El administrador
    global no tiene compañía y recibe 404, igual que una compañía sin logo.
    """
    if ctx.user.aseguradora_id is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Sin logo")
    aseguradora = db.get(Aseguradora, ctx.user.aseguradora_id)
    if aseguradora is None or aseguradora.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Sin logo")
    return respuesta_logo(aseguradora)


@router.get("/csrf", status_code=status.HTTP_204_NO_CONTENT)
def emitir_csrf(request: Request, db: DbSession = Depends(get_db)) -> Response:
    """
    Rota y reemite la cookie CSRF de la sesión viva. Caso real: el cliente perdió
    la cookie CSRF pero conserva la de sesión. Sin sesión válida: 204 sin cookie,
    porque el login siempre emite ambas y no hay otro caso legítimo.
    """
    respuesta = Response(status_code=status.HTTP_204_NO_CONTENT)
    token = request.cookies.get(settings.nombre_cookie_sesion)
    if not token:
        return respuesta
    sesion = auth_service.buscar_sesion_valida(db, token)
    if sesion is None:
        return respuesta
    csrf = auth_service.rotar_csrf(db, sesion)
    db.commit()
    cookies.poner_cookie_csrf(respuesta, csrf)
    return respuesta


@router.post("/modulo-activo", response_model=SesionOut)
def cambiar_modulo_activo(
    request: Request,
    datos: CambioModuloRequest,
    ctx: AuthContext = Depends(get_current_user),
    _: None = Depends(verificar_csrf),
    db: DbSession = Depends(get_db),
) -> SesionOut:
    """
    Cambio de módulo SIN reautenticar. No puede usar la factory require_module_access
    porque el módulo llega en el cuerpo y no en la ruta, así que llama a la MISMA
    función interna para que no existan dos implementaciones divergentes.
    """
    code = auth_service.codigo_por_slug(db, datos.slug)
    role_id = auth_service.rol_en_modulo(db, ctx.user.id, code) if code else None
    if role_id is None:
        audit.registrar(
            db, accion="acceso_denegado", request=request, user_id=ctx.user.id,
            session_id=ctx.sesion.id, module_code=code,
            detalle={"slug_solicitado": datos.slug, "via": "modulo-activo"},
        )
        db.commit()
        raise NO_AUTORIZADO

    origen = ctx.sesion.active_module_code
    ctx.sesion.active_module_code = code
    ctx.user.last_module_code = code
    audit.registrar(
        db, accion="cambio_modulo", request=request, user_id=ctx.user.id,
        session_id=ctx.sesion.id, module_code=code,
        detalle={"modulo_origen": origen, "modulo_destino": code},
    )
    db.commit()

    modulos = auth_service.resolver_modulos(db, ctx.user)
    permisos = auth_service.permisos_de(db, role_id)
    return _armar_sesion_out(db, ctx.user, modulos, modulo_activo=code, permisos=permisos)


# ─────────────────────── Invitación (rutas PÚBLICAS) ─────────────────────────
#
# Las dos únicas rutas sin sesión que se añaden, y están en la allowlist de
# `main.py`. Quien abre el enlace todavía no tiene contraseña, así que no puede
# haber sesión: el token de la invitación ES la credencial, de un solo uso y con
# caducidad. Por eso van con límite de peticiones por IP, como el login.


@router.get("/invitacion", response_model=InvitacionOut)
@limiter.limit(settings.login_rate_limit_ip)
def leer_invitacion(
    request: Request,
    token: str = Query(min_length=16, max_length=256),
    db: DbSession = Depends(get_db),
) -> InvitacionOut:
    """
    Valida el enlace y devuelve a quién pertenece, para poder saludarle por su
    nombre. Nada más: es público, así que no se expone ni la aseguradora ni sus
    accesos. Cualquier fallo responde igual, sin distinguir causa.
    """
    _, usuario = invitaciones.resolver(db, token)
    return InvitacionOut(nombre_completo=personas.de_fila(usuario), email=usuario.email)


@router.post("/definir-password", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit(settings.login_rate_limit_ip)
def definir_password(
    request: Request,
    datos: DefinirPasswordRequest,
    db: DbSession = Depends(get_db),
) -> Response:
    """
    Fija la contraseña y consume la invitación. No abre sesión a propósito: quien
    acaba de crearla pasa por el login como todo el mundo, y así el camino de
    entrada sigue siendo uno solo.
    """
    if len(datos.password) < settings.password_min_length:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"La contraseña debe tener al menos {settings.password_min_length} caracteres",
        )

    invitacion, usuario = invitaciones.resolver(db, datos.token)
    usuarios_service.fijar_password(db, usuario, datos.password)
    # De un solo uso: se marca en la misma transacción que el cambio.
    invitacion.used_at = func.now()
    # Cualquier sesión previa deja de valer: la contraseña cambió.
    revocadas = auth_service.revocar_sesiones_de_usuario(db, usuario.id, "password_change")
    audit.registrar(
        db,
        accion="password_definida",
        request=request,
        user_id=usuario.id,
        entidad="users",
        entidad_id=str(usuario.id),
        detalle={"via": "invitacion", "sesiones_revocadas": revocadas},
    )
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
