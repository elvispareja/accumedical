from __future__ import annotations

import uuid
from collections.abc import Callable
from dataclasses import dataclass, field

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from app.core.config import settings
from app.core.db import get_db
from app.core.security import tokens
from app.shared.audit import service as audit
from app.shared.auth import service as auth_service
from app.shared.auth.models import Sesion
from app.shared.users.models import User, UserFuncion, UserGrupoAccess

# Toda denegación de autorización responde EXACTAMENTE esto. Nunca se revela si el
# módulo existe, si el usuario existe, ni qué accesos tiene. El motivo real va al
# AuditLog.
NO_AUTORIZADO = HTTPException(status.HTTP_403_FORBIDDEN, detail="No autorizado")
NO_AUTENTICADO = HTTPException(status.HTTP_401_UNAUTHORIZED, detail="No autenticado")


@dataclass
class AuthContext:
    user: User
    sesion: Sesion
    module_code: str | None = None
    role_id: uuid.UUID | None = None
    rol: str | None = None
    permisos: list[str] = field(default_factory=list)
    # La familia comercial que coordina, cuando la ruta lo resuelve
    # (`require_coordinacion`). `None` en el administrador global, que no está
    # acotado a ninguna: es la diferencia entre «todo» y «lo de mi familia».
    grupo: str | None = None
    # True cuando el token llegó por `Authorization: Bearer` (la app móvil) y no
    # por cookie. Decide si aplica el CSRF: ver `verificar_csrf`.
    via_bearer: bool = False


def get_current_user(
    request: Request, db: DbSession = Depends(get_db)
) -> AuthContext:
    # El MISMO token opaco de sesión por dos vías: la cookie httpOnly del
    # navegador o, para la app móvil, `Authorization: Bearer` con el token que el
    # login «movil» entregó una única vez. Misma tabla, misma expiración, misma
    # revocación inmediata: no es otro esquema de autenticación, es otro sobre.
    token = request.cookies.get(settings.nombre_cookie_sesion)
    via_bearer = False
    if not token:
        cabecera = request.headers.get("authorization", "")
        if cabecera.startswith("Bearer "):
            token = cabecera[len("Bearer "):].strip()
            via_bearer = True
    if not token:
        raise NO_AUTENTICADO

    sesion = auth_service.buscar_sesion_valida(db, token)
    if sesion is None:
        raise NO_AUTENTICADO

    user = db.get(User, sesion.user_id)
    # Desactivar o borrar un usuario mata sus sesiones en el acto, sin esperar a
    # que expiren: es el control que corta el acceso de una cuenta comprometida.
    if user is None or not user.is_active or user.deleted_at is not None:
        auth_service.revocar_sesion(db, sesion, "user_deactivated")
        db.commit()
        raise NO_AUTENTICADO

    auth_service.tocar_actividad(db, sesion)
    db.commit()

    ctx = AuthContext(user=user, sesion=sesion, via_bearer=via_bearer)
    request.state.auth = ctx
    return ctx


def verificar_csrf(request: Request, ctx: AuthContext = Depends(get_current_user)) -> None:
    """
    Double-submit: la cabecera debe coincidir con el token de ESTA sesión. Un
    atacante cross-site no puede leer la cookie ni fijar la cabecera, y el token
    de otra víctima tampoco sirve porque está ligado a su sesión.

    La vía Bearer queda exenta A PROPÓSITO: el CSRF existe porque el navegador
    adjunta cookies solo, sin preguntar; una cabecera `Authorization` no la
    adjunta nadie más que la propia app, así que no hay diputado confundido que
    proteger. Y la sesión de cookie de otra pestaña no puede colarse por aquí:
    la exención depende de CÓMO llegó el token, no de quién es el usuario.
    """
    if request.method not in {"POST", "PUT", "PATCH", "DELETE"}:
        return
    if ctx.via_bearer:
        return
    enviado = request.headers.get("x-csrf-token")
    if not enviado:
        raise NO_AUTORIZADO
    if not tokens.comparar_hashes(tokens.hashear_token(enviado), ctx.sesion.csrf_token_hash):
        raise NO_AUTORIZADO


def _denegar(
    db: DbSession,
    request: Request,
    ctx: AuthContext,
    *,
    module_code: str | None,
    detalle: dict,
) -> None:
    audit.registrar(
        db,
        accion="acceso_denegado",
        request=request,
        user_id=ctx.user.id,
        session_id=ctx.sesion.id,
        module_code=module_code,
        detalle=detalle,
    )
    db.commit()
    raise NO_AUTORIZADO


def require_module_access(slug: str) -> Callable[..., AuthContext]:
    """
    Se aplica a nivel de APIRouter, nunca por endpoint suelto: así un endpoint
    nuevo dentro del router nace protegido y olvidarlo es imposible.
    """

    def dependencia(
        request: Request,
        ctx: AuthContext = Depends(get_current_user),
        db: DbSession = Depends(get_db),
    ) -> AuthContext:
        code = auth_service.codigo_por_slug(db, slug)
        if code is None:
            _denegar(db, request, ctx, module_code=None, detalle={"slug_solicitado": slug})

        # El administrador global SUPERVISA los módulos: entra con el mismo
        # alcance que un supervisor de plataforma —su panel de Auditorías—, sin
        # fila de acceso propia. Es la única puerta por la que pasa: el resto de
        # su poder sigue viniendo de require_global_admin, y todo lo que haga
        # aquí queda en AuditLog con su usuario, como cualquier supervisor.
        if ctx.user.is_superadmin:
            ctx.module_code = code
            ctx.rol = "supervisor"
            ctx.permisos = auth_service.permisos_del_modulo(db, code)
            return ctx

        role_id = auth_service.rol_en_modulo(db, ctx.user.id, code)
        if role_id is None:
            _denegar(
                db, request, ctx, module_code=code,
                detalle={"ruta": request.url.path, "modulo_solicitado": code},
            )

        ctx.module_code = code
        ctx.role_id = role_id
        ctx.rol = auth_service.codigo_de_rol(db, role_id)
        ctx.permisos = auth_service.permisos_de(db, role_id)
        return ctx

    return dependencia


def require_permission(codigo: str) -> Callable[..., AuthContext]:
    """
    Se apila DESPUÉS de require_module_access, que es quien resuelve el rol del
    usuario en ese módulo. Si no hay contexto de módulo falla cerrado.
    """

    def dependencia(
        request: Request,
        ctx: AuthContext = Depends(get_current_user),
        db: DbSession = Depends(get_db),
    ) -> AuthContext:
        if ctx.module_code is None or codigo not in ctx.permisos:
            _denegar(
                db, request, ctx, module_code=ctx.module_code,
                detalle={"permiso_requerido": codigo, "ruta": request.url.path},
            )
        return ctx

    return dependencia


def require_global_admin(
    request: Request,
    ctx: AuthContext = Depends(get_current_user),
    db: DbSession = Depends(get_db),
) -> AuthContext:
    if not ctx.user.is_superadmin:
        _denegar(db, request, ctx, module_code=None, detalle={"ruta": request.url.path})
    return ctx


def require_personal_accumedical(
    request: Request,
    ctx: AuthContext = Depends(get_current_user),
    db: DbSession = Depends(get_db),
) -> AuthContext:
    """
    Solo personal de ACCUMEDICAL (sin aseguradora): el administrador global y la
    gente de la plataforma. Un usuario de aseguradora recibe el 403 genérico
    aunque tenga sesión: es la puerta de la app Pacientes (D49), que reúne a las
    personas de todas las compañías.
    """
    if ctx.user.aseguradora_id is not None:
        _denegar(db, request, ctx, module_code=None, detalle={"ruta": request.url.path})
    return ctx


def require_coordinacion(
    request: Request,
    ctx: AuthContext = Depends(get_current_user),
    db: DbSession = Depends(get_db),
) -> AuthContext:
    """
    Abre la puerta al administrador global **o** al coordinador de una familia,
    y deja en `ctx.grupo` cuál es la suya.

    Esa diferencia es toda la autorización de lo que cuelga detrás: `None` es el
    admin y lo ve todo; `"siniestro"` o `"suscripcion"` acotan al coordinador a
    su familia, y el servicio filtra por ahí. No hay un tercer caso.

    Consulta directa a `user_grupo_access` y no el servicio de usuarios: `core`
    no debe depender de `shared` para dejar pasar a nadie. Se comprueba en CADA
    request, así que quitarle la familia surte efecto en la siguiente.
    """
    if ctx.user.is_superadmin:
        ctx.grupo = None
        return ctx
    grupo = db.scalar(
        select(UserGrupoAccess.grupo).where(
            UserGrupoAccess.user_id == ctx.user.id, UserGrupoAccess.activo.is_(True)
        )
    )
    if grupo is not None:
        ctx.grupo = grupo
        return ctx
    _denegar(db, request, ctx, module_code=None, detalle={"ruta": request.url.path})
    raise AssertionError("inalcanzable: _denegar siempre lanza")  # pragma: no cover


def require_funcion(*funciones: str) -> Callable[..., AuthContext]:
    """
    Abre la puerta al administrador global **o** a quien lleva alguna de esas
    funciones transversales (`user_funcion`): hoy, «convenio» y «contabilidad».

    Admite varias porque hay rutas que las dos necesitan —el listado de
    compañías, por ejemplo— y una ruta solo se puede registrar una vez. Nombrar
    ahí a las dos es más honesto que repartirlas en dos rutas gemelas.

    Se comprueba contra la base en CADA request, como todo lo demás: quitarle la
    función a alguien surte efecto en su siguiente petición, sin esperar a que
    caduque su sesión.

    El objeto que devuelve es la dependencia: guárdalo en una constante y úsalo
    tanto en el router como en los endpoints que necesiten el `AuthContext`. Dos
    llamadas a `require_funcion` con el mismo argumento producen funciones
    DISTINTAS, y FastAPI cachea por identidad: repetirla consulta la base dos
    veces en la misma petición.
    """
    if not funciones:  # pragma: no cover - error de programación, no de uso
        raise ValueError("require_funcion necesita al menos una función")
    permitidas = frozenset(funciones)

    def dependencia(
        request: Request,
        ctx: AuthContext = Depends(get_current_user),
        db: DbSession = Depends(get_db),
    ) -> AuthContext:
        if ctx.user.is_superadmin:
            return ctx
        # Consulta directa y no el servicio de usuarios: `deps` es de core y no
        # debe depender de un módulo de shared para dejar pasar a nadie.
        suya = db.scalar(
            select(UserFuncion.funcion).where(
                UserFuncion.user_id == ctx.user.id, UserFuncion.activo.is_(True)
            )
        )
        if suya in permitidas:
            return ctx
        _denegar(
            db, request, ctx,
            module_code=None,
            detalle={"ruta": request.url.path, "funciones_admitidas": sorted(permitidas)},
        )
        raise AssertionError("inalcanzable: _denegar siempre lanza")  # pragma: no cover

    return dependencia
