from __future__ import annotations

import datetime as dt
import uuid
from dataclasses import dataclass

from fastapi import Request
from sqlalchemy import or_, select, text, update
from sqlalchemy.orm import Session as DbSession

from app.core.config import settings
from app.core.security import passwords, tokens
from app.shared.aseguradoras.models import AseguradoraModulo
from app.shared.auth.models import Sesion
from app.shared.catalogos.models import Module
from app.shared.users.models import (
    Permission,
    Role,
    RolePermission,
    User,
    UserAseguradoraCoordinador,
    UserGrupoAccess,
    UserModuleAccess,
)

# El rol de coordinación. Su nombre VISIBLE es «Coordinador» desde
# `f5a8d3c6b924`; el code queda congelado, como el de los módulos renombrados:
# cambiar la etiqueta no puede cambiar lo que autoriza.
ROL_COORDINADOR = "supervisor"

# Funciones transversales que ya tienen pantallas propias en administración. La
# que no esté aquí se queda en «sin accesos» hasta que se le defina qué ve.
FUNCIONES_CON_PANTALLA = frozenset({"convenio", "contabilidad"})


def ahora() -> dt.datetime:
    return dt.datetime.now(dt.UTC)


@dataclass(frozen=True)
class ResultadoLogin:
    user: User | None
    motivo: str | None  # solo para AuditLog; JAMÁS sale en la respuesta HTTP


@dataclass(frozen=True)
class ModuloResuelto:
    codigo: str
    slug: str
    nombre: str
    icono: str
    color_acento: str
    orden: int
    rol: str


# ─────────────────────────────── Autenticación ───────────────────────────────


def autenticar(db: DbSession, email: str, password: str) -> ResultadoLogin:
    """
    Flujo de trabajo constante. El orden es normativo:

    1. Buscar el usuario (o usar el hash señuelo).
    2. Ejecutar SIEMPRE argon2, en todos los caminos: inexistente, desactivado,
       bloqueado y contraseña incorrecta. Nunca se salta la verificación.
    3. Evaluar bloqueo y estado DESPUÉS, y solo entonces decidir la respuesta.

    Si el bloqueo se comprobara antes de argon2, una cuenta bloqueada respondería
    en ~2 ms frente a ~80 ms del resto y se podrían enumerar cuentas midiendo el
    tiempo. El motivo real solo va a AuditLog; la respuesta HTTP es siempre igual.

    (El camino de email inexistente se ahorra el UPDATE de contadores: ~1 ms sobre
    ~80 ms de argon2, muy por debajo del ruido de red. Se acepta y se documenta.)
    """
    user = db.scalar(select(User).where(User.email == email, User.deleted_at.is_(None)))

    password_ok = passwords.verificar(password, user.password_hash if user else None)

    if user is None:
        return ResultadoLogin(None, "email_inexistente")
    if not user.is_active:
        _contar_fallo(db, user)
        return ResultadoLogin(None, "usuario_inactivo")
    if user.locked_until is not None and user.locked_until > ahora():
        _contar_fallo(db, user)
        return ResultadoLogin(None, "cuenta_bloqueada")
    if not password_ok:
        bloqueada = _contar_fallo(db, user)
        return ResultadoLogin(None, "cuenta_bloqueada" if bloqueada else "password_incorrecto")

    db.execute(
        update(User)
        .where(User.id == user.id)
        .values(failed_login_attempts=0, locked_until=None, last_login_at=ahora())
    )
    return ResultadoLogin(user, None)


def _contar_fallo(db: DbSession, user: User) -> bool:
    """
    Incremento y bloqueo en UN SOLO statement: si se hiciera leer-comparar-escribir,
    dos intentos concurrentes podrían leer ambos el mismo contador y o bien ninguno
    fija el bloqueo o el umbral se salta sin bloquear. La condición es >=, nunca ==.
    """
    fila = db.execute(
        text(
            """
            UPDATE users
               SET failed_login_attempts = failed_login_attempts + 1,
                   locked_until = CASE
                       WHEN failed_login_attempts + 1 >= :maximo
                       THEN now() + make_interval(mins => :minutos)
                       ELSE locked_until
                   END
             WHERE id = :id
            RETURNING failed_login_attempts, locked_until
            """
        ),
        {
            "id": user.id,
            "maximo": settings.login_max_failed_attempts,
            "minutos": settings.login_lockout_min,
        },
    ).one()
    intentos, bloqueada_hasta = fila
    return bool(bloqueada_hasta) and intentos >= settings.login_max_failed_attempts


# ──────────────────────────────── Sesiones ───────────────────────────────────


def crear_sesion(
    db: DbSession,
    user: User,
    request: Request,
    *,
    rotada_desde: uuid.UUID | None = None,
) -> tuple[Sesion, str, str]:
    token = tokens.generar_token()
    csrf = tokens.generar_token()
    momento = ahora()

    sesion = Sesion(
        user_id=user.id,
        token_hash=tokens.hashear_token(token),
        csrf_token_hash=tokens.hashear_token(csrf),
        ip=request.client.host if request.client else "0.0.0.0",  # noqa: S104
        user_agent=(request.headers.get("user-agent") or "")[:400],
        created_at=momento,
        last_activity_at=momento,
        expires_at=momento + dt.timedelta(minutes=settings.session_absolute_ttl_min),
        rotated_from_id=rotada_desde,
    )
    db.add(sesion)
    db.flush()
    return sesion, token, csrf


def revocar_sesion(db: DbSession, sesion: Sesion, motivo: str) -> None:
    if sesion.revoked_at is None:
        sesion.revoked_at = ahora()
        sesion.revoke_reason = motivo


def revocar_sesiones_de_usuario(db: DbSession, user_id: uuid.UUID, motivo: str) -> int:
    resultado = db.execute(
        update(Sesion)
        .where(Sesion.user_id == user_id, Sesion.revoked_at.is_(None))
        .values(revoked_at=ahora(), revoke_reason=motivo)
    )
    return resultado.rowcount or 0


def buscar_sesion_valida(db: DbSession, token: str) -> Sesion | None:
    """
    Valida las tres condiciones en la propia consulta. El TTL de inactividad se
    compara contra configuración y no se materializa como columna: cambiarlo no
    exige migración ni UPDATE masivo.
    """
    limite_inactividad = ahora() - dt.timedelta(minutes=settings.session_idle_ttl_min)
    return db.scalar(
        select(Sesion).where(
            Sesion.token_hash == tokens.hashear_token(token),
            Sesion.revoked_at.is_(None),
            Sesion.expires_at > ahora(),
            Sesion.last_activity_at > limite_inactividad,
        )
    )


def tocar_actividad(db: DbSession, sesion: Sesion) -> None:
    """Actualiza con throttle para no convertir cada GET en un UPDATE."""
    umbral = ahora() - dt.timedelta(seconds=settings.session_activity_throttle_sec)
    if sesion.last_activity_at < umbral:
        sesion.last_activity_at = ahora()


def rotar_csrf(db: DbSession, sesion: Sesion) -> str:
    csrf = tokens.generar_token()
    sesion.csrf_token_hash = tokens.hashear_token(csrf)
    db.flush()
    return csrf


def purgar_sesiones_vencidas(db: DbSession) -> int:
    """
    Única excepción documentada al no-borrado-físico: dato técnico efímero cuya
    evidencia perdura en audit_log.
    """
    limite = ahora() - dt.timedelta(days=settings.session_purge_after_days)
    resultado = db.execute(
        text(
            "DELETE FROM sessions "
            "WHERE (revoked_at IS NOT NULL AND revoked_at < :limite) "
            "   OR expires_at < :limite"
        ),
        {"limite": limite},
    )
    return resultado.rowcount or 0


# ──────────────────────── Resolución de módulos y permisos ───────────────────


def _columnas_modulo():
    return (
        Module.code,
        Module.slug,
        Module.nombre,
        Module.icono,
        Module.color_acento,
        Module.orden,
    )


def resolver_modulos(db: DbSession, user: User) -> list[ModuloResuelto]:
    """
    La lista de módulos la calcula SIEMPRE el backend. El frontend nunca la deduce.
    Respeta el kill-switch de módulo (modules.activo) y el estado del rol.

    Dos caminos suman: las filas por módulo (`user_module_access`) y la familia
    que coordina el usuario (`user_grupo_access`), que abarca todos los módulos
    vivos de esa familia —incluidos los que se agreguen mañana—.

    El administrador global entra a TODOS los módulos vivos como coordinador de
    plataforma: es exactamente el alcance que ya le da `require_module_access`
    en cada petición. Así cada módulo le enseña SU propia pantalla de
    coordinación, en su subdominio y con su diseño, y admin no tiene que copiar
    las pantallas de cada módulo (opción 2, D45).
    """
    if user.is_superadmin:
        return [
            ModuloResuelto(codigo=f[0], slug=f[1], nombre=f[2], icono=f[3], color_acento=f[4],
                           orden=f[5], rol=ROL_COORDINADOR)
            for f in db.execute(
                select(*_columnas_modulo()).where(Module.activo.is_(True))
                .order_by(Module.orden, Module.nombre)
            )
        ]
    por_modulo = db.execute(
        select(*_columnas_modulo(), Role.code)
        .select_from(UserModuleAccess)
        .join(Module, Module.code == UserModuleAccess.module_code)
        .join(Role, Role.id == UserModuleAccess.role_id)
        .where(
            UserModuleAccess.user_id == user.id,
            UserModuleAccess.activo.is_(True),
            Module.activo.is_(True),
            Role.activo.is_(True),
        )
    ).all()

    por_familia = db.execute(
        select(*_columnas_modulo(), Role.code)
        .select_from(UserGrupoAccess)
        .join(Module, Module.grupo == UserGrupoAccess.grupo)
        .join(Role, (Role.module_code == Module.code) & (Role.code == ROL_COORDINADOR))
        .where(
            UserGrupoAccess.user_id == user.id,
            UserGrupoAccess.activo.is_(True),
            Module.activo.is_(True),
            Role.activo.is_(True),
        )
    ).all()

    # Y la tercera vía: coordinar una COMPAÑÍA abre todos los módulos que ella
    # tenga habilitados, sin marcárselos uno a uno.
    por_aseguradora = db.execute(
        select(*_columnas_modulo(), Role.code)
        .select_from(UserAseguradoraCoordinador)
        .join(
            AseguradoraModulo,
            AseguradoraModulo.aseguradora_id == UserAseguradoraCoordinador.aseguradora_id,
        )
        .join(Module, Module.code == AseguradoraModulo.module_code)
        .join(Role, (Role.module_code == Module.code) & (Role.code == ROL_COORDINADOR))
        .where(
            UserAseguradoraCoordinador.user_id == user.id,
            UserAseguradoraCoordinador.activo.is_(True),
            AseguradoraModulo.activo.is_(True),
            Module.activo.is_(True),
            Role.activo.is_(True),
        )
    ).all()

    # Si por lo que fuera llegara el mismo módulo por dos caminos, manda la fila
    # propia del módulo: es la más específica.
    resueltos: dict[str, ModuloResuelto] = {}
    for f in [*por_familia, *por_aseguradora, *por_modulo]:
        resueltos[f[0]] = ModuloResuelto(
            codigo=f[0], slug=f[1], nombre=f[2], icono=f[3], color_acento=f[4],
            orden=f[5], rol=f[6],
        )
    return sorted(resueltos.values(), key=lambda m: (m.orden, m.nombre))


def coordinadores_de_modulo(db: DbSession, module_code: str) -> list[User]:
    """
    Quién coordina ese módulo, por CUALQUIERA de las dos puertas: la fila propia
    del módulo o la familia entera. Personal de plataforma, activo y vivo.

    Existe para que quien avisa no tenga que saber por dónde entró el
    coordinador. Mirar solo `user_module_access` —como se hacía— deja fuera al
    coordinador de familia, que es justo el que hoy existe.
    """
    grupo = db.scalar(select(Module.grupo).where(Module.code == module_code))
    por_modulo = (
        select(UserModuleAccess.user_id)
        .join(Role, Role.id == UserModuleAccess.role_id)
        .where(
            UserModuleAccess.module_code == module_code,
            UserModuleAccess.activo.is_(True),
            Role.code == ROL_COORDINADOR,
            Role.activo.is_(True),
        )
    )
    condiciones = [User.id.in_(por_modulo)]
    if grupo is not None:
        condiciones.append(
            User.id.in_(
                select(UserGrupoAccess.user_id).where(
                    UserGrupoAccess.grupo == grupo, UserGrupoAccess.activo.is_(True)
                )
            )
        )
    return list(
        db.scalars(
            select(User).where(
                or_(*condiciones),
                User.aseguradora_id.is_(None),
                User.is_superadmin.is_(False),
                User.is_active.is_(True),
                User.deleted_at.is_(None),
            )
        ).all()
    )


def coordinadores_de_aseguradora(
    db: DbSession, aseguradora_id: uuid.UUID, module_code: str
) -> list[User]:
    """
    Quién coordina ESA compañía en ese módulo, por sus dos puertas: la fila del
    módulo con rol coordinador, o `user_aseguradora_coordinador`, que abarca
    todos los módulos que la compañía tenga habilitados.

    El gemelo de `coordinadores_de_modulo` para el lado de la aseguradora, y por
    el mismo motivo: quien avisa no tiene por qué saber por dónde entró cada
    quien. Mirar solo `user_module_access` dejaba fuera justo al coordinador de
    compañía, que es el que hoy existe.
    """
    por_modulo = (
        select(UserModuleAccess.user_id)
        .join(Role, Role.id == UserModuleAccess.role_id)
        .where(
            UserModuleAccess.module_code == module_code,
            UserModuleAccess.activo.is_(True),
            Role.code == ROL_COORDINADOR,
            Role.activo.is_(True),
        )
    )
    por_compania = (
        select(UserAseguradoraCoordinador.user_id)
        .join(
            AseguradoraModulo,
            AseguradoraModulo.aseguradora_id == UserAseguradoraCoordinador.aseguradora_id,
        )
        .where(
            UserAseguradoraCoordinador.aseguradora_id == aseguradora_id,
            UserAseguradoraCoordinador.activo.is_(True),
            AseguradoraModulo.module_code == module_code,
            AseguradoraModulo.activo.is_(True),
        )
    )
    return list(
        db.scalars(
            select(User)
            .where(
                or_(User.id.in_(por_modulo), User.id.in_(por_compania)),
                User.aseguradora_id == aseguradora_id,
                User.is_active.is_(True),
                User.deleted_at.is_(None),
            )
            .order_by(User.email)
        ).all()
    )


def rol_en_modulo(db: DbSession, user_id: uuid.UUID, module_code: str) -> uuid.UUID | None:
    """
    Con qué rol entra este usuario a ese módulo, o `None` si no entra.

    Se ejecuta en CADA request. Por eso revocar (activo=False) surte efecto en el
    siguiente request de una sesión ya abierta, sin mecanismo adicional. Primero
    la fila propia del módulo; si no la hay, la familia que coordina.
    """
    directo = db.scalar(
        select(UserModuleAccess.role_id)
        .join(Module, Module.code == UserModuleAccess.module_code)
        .join(Role, Role.id == UserModuleAccess.role_id)
        .where(
            UserModuleAccess.user_id == user_id,
            UserModuleAccess.module_code == module_code,
            UserModuleAccess.activo.is_(True),
            Module.activo.is_(True),
            Role.activo.is_(True),
        )
    )
    if directo is not None:
        return directo

    # Coordinador de la familia a la que pertenece el módulo: entra con el rol
    # de coordinación de ESE módulo, así que sus permisos salen de siempre.
    por_familia = db.scalar(
        select(Role.id)
        .select_from(UserGrupoAccess)
        .join(Module, Module.grupo == UserGrupoAccess.grupo)
        .join(Role, (Role.module_code == Module.code) & (Role.code == ROL_COORDINADOR))
        .where(
            UserGrupoAccess.user_id == user_id,
            UserGrupoAccess.activo.is_(True),
            Module.code == module_code,
            Module.activo.is_(True),
            Role.activo.is_(True),
        )
    )
    if por_familia is not None:
        return por_familia

    # Coordinador de una COMPAÑÍA: entra a lo que ella tenga habilitado. Si la
    # aseguradora destilda el módulo, la puerta se cierra en el siguiente
    # request, sin tocar ninguna fila de acceso.
    return db.scalar(
        select(Role.id)
        .select_from(UserAseguradoraCoordinador)
        .join(
            AseguradoraModulo,
            AseguradoraModulo.aseguradora_id == UserAseguradoraCoordinador.aseguradora_id,
        )
        .join(Module, Module.code == AseguradoraModulo.module_code)
        .join(Role, (Role.module_code == Module.code) & (Role.code == ROL_COORDINADOR))
        .where(
            UserAseguradoraCoordinador.user_id == user_id,
            UserAseguradoraCoordinador.activo.is_(True),
            AseguradoraModulo.activo.is_(True),
            Module.code == module_code,
            Module.activo.is_(True),
            Role.activo.is_(True),
        )
    )


def permisos_de(db: DbSession, role_id: uuid.UUID) -> list[str]:
    return list(
        db.scalars(
            select(Permission.code)
            .join(RolePermission, RolePermission.permission_id == Permission.id)
            .where(RolePermission.role_id == role_id)
            .order_by(Permission.code)
        ).all()
    )


def permisos_del_modulo(db: DbSession, module_code: str) -> list[str]:
    """Todos los permisos que existen en un módulo: el alcance del admin global."""
    return list(
        db.scalars(
            select(Permission.code)
            .where(Permission.module_code == module_code)
            .order_by(Permission.code)
        ).all()
    )


def codigo_de_rol(db: DbSession, role_id: uuid.UUID) -> str | None:
    return db.scalar(select(Role.code).where(Role.id == role_id))


def codigo_por_slug(db: DbSession, slug: str) -> str | None:
    """Único punto de traducción slug → code de toda la plataforma."""
    return db.scalar(select(Module.code).where(Module.slug == slug, Module.activo.is_(True)))


def calcular_redireccion(
    user: User,
    modulos: list[ModuloResuelto],
    ultimo_modulo: str | None,
    funcion: str | None = None,
    grupo_coordinado: str | None = None,
) -> str:
    if user.is_superadmin:
        return "/admin"
    # El coordinador de PLATAFORMA entra SIEMPRE a su bandeja: lleva varias
    # auditorías a la vez y su trabajo es mirarlas juntas, no elegir una. Se
    # resuelve antes que el selector de módulo, que para él no aporta nada.
    #
    # Vale por las dos puertas —familia o fila del módulo—; el coordinador de una
    # COMPAÑÍA queda fuera por su `aseguradora_id`: no tiene panel de supervisión
    # que juntar, sino la bandeja de su propia empresa.
    coordina = grupo_coordinado is not None or any(
        m.rol == ROL_COORDINADOR for m in modulos
    )
    if coordina and user.aseguradora_id is None:
        # Su área es `/coordinacion`, no `/admin`: coordinar no es administrar
        # la plataforma, y la dirección no debe decir lo contrario.
        return "/coordinacion/bandeja"
    # Las funciones transversales no son módulos (no pasan por
    # `UserModuleAccess` ni por el selector): cada una tiene su app (D50).
    if funcion in FUNCIONES_CON_PANTALLA:
        # Cada función tiene su propia app (D50): convenios.pymes.ec o
        # contabilidad.pymes.ec. Es la dirección lógica; el frontend la lleva a
        # su subdominio.
        return "/convenios/dashboard" if funcion == "convenio" else "/contabilidad/dashboard"
    if not modulos:
        return "/sin-accesos"
    if len(modulos) == 1:
        return f"/{modulos[0].slug}"
    if ultimo_modulo:
        # Se valida contra la lista recién calculada, no contra el campo: si el
        # módulo fue revocado o apagado, no se usa y se cae al selector.
        vigente = next((m for m in modulos if m.codigo == ultimo_modulo), None)
        if vigente is not None:
            return f"/{vigente.slug}"
    return "/seleccionar-modulo"
