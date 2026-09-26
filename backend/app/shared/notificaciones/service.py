from __future__ import annotations

import datetime as dt
import uuid

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session as DbSession

from app.shared.auth import service as auth_service
from app.shared.catalogos.models import Module
from app.shared.notificaciones.models import Notificacion
from app.shared.users.models import User

# Cuántas devuelve la campana. La bandeja es un vistazo, no un archivo: lo viejo
# se queda en la tabla, pero nadie baja por ello desde el icono.
TOPE = 30


def ahora() -> dt.datetime:
    return dt.datetime.now(dt.UTC)


def crear(
    db: DbSession,
    *,
    user_id: uuid.UUID,
    module_code: str,
    titulo: str,
    subtitulo: str,
    detalle: str,
    url: str,
    entidad: str,
    entidad_id: uuid.UUID,
) -> Notificacion:
    """
    Escribe un aviso. Se llama DENTRO de la transacción del hecho que lo provoca:
    o se guardan los dos o no se guarda ninguno, para que no exista un aviso de
    un caso que no llegó a crearse.

    No hace commit; lo hace quien llama, igual que el servicio de auditoría.
    """
    fila = Notificacion(
        user_id=user_id,
        module_code=module_code,
        titulo=titulo,
        subtitulo=subtitulo,
        detalle=detalle,
        url=url,
        entidad=entidad,
        entidad_id=entidad_id,
    )
    db.add(fila)
    return fila


def listar(
    db: DbSession,
    user_id: uuid.UUID,
    *,
    solo_sin_leer: bool = False,
    module_code: str | None = None,
    page: int = 1,
    page_size: int = TOPE,
) -> tuple[list[Notificacion], int]:
    """
    Las suyas y solo las suyas, lo más reciente arriba, con su total.

    Los valores por defecto son los de la campana —las últimas `TOPE`, leídas y
    sin leer—; la pantalla completa pagina y filtra con los mismos parámetros,
    que es lo que evita tener dos consultas que mantener a la par.

    `module_code` no se valida contra el catálogo a propósito: uno que no exista
    simplemente no tiene avisos y devuelve la lista vacía. Va parametrizado como
    todo lo demás, así que no hay nada que sanear.
    """
    condiciones = [Notificacion.user_id == user_id]
    if solo_sin_leer:
        condiciones.append(Notificacion.leida_at.is_(None))
    if module_code:
        condiciones.append(Notificacion.module_code == module_code)

    total = (
        db.scalar(select(func.count()).select_from(Notificacion).where(*condiciones)) or 0
    )
    filas = db.scalars(
        select(Notificacion)
        .where(*condiciones)
        .order_by(Notificacion.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()
    return list(filas), total


def sin_leer(db: DbSession, user_id: uuid.UUID) -> int:
    """El número del globito. Cuenta TODAS las no leídas, no solo las del tope."""
    return (
        db.scalar(
            select(func.count())
            .select_from(Notificacion)
            .where(Notificacion.user_id == user_id, Notificacion.leida_at.is_(None))
        )
        or 0
    )


def conteo_por_modulo(db: DbSession, user_id: uuid.UUID) -> dict[str, tuple[int, int]]:
    """
    Cuántos avisos tiene de cada módulo: `{code: (total, sin_leer)}`.

    **Se cuenta SIN el filtro de módulo puesto**, a propósito: si contara con él,
    elegir un módulo dejaría a los demás en cero y ya no se podría volver. La
    pastilla tiene que decir siempre cuántos hay detrás de ella.
    """
    filas = db.execute(
        select(
            Notificacion.module_code,
            func.count(),
            func.count().filter(Notificacion.leida_at.is_(None)),
        )
        .where(Notificacion.user_id == user_id)
        .group_by(Notificacion.module_code)
    ).all()
    return {f[0]: (int(f[1]), int(f[2])) for f in filas}


def modulos_que_avisan(db: DbSession, user: User) -> list[tuple[str, str]]:
    """
    De qué módulos puede recibir avisos esta persona: `(code, nombre)`, por orden
    alfabético, que es el mismo con el que se le listan en el menú.

    **La lista la calcula el backend**, como toda lista de módulos; la pantalla
    no deduce cuáles existen. Son los suyos —los que le resuelve la sesión—, y el
    administrador global los ve todos porque a él le avisan de todos.

    Se añaden además los módulos de los que YA tiene avisos aunque hoy no tenga
    acceso: si no, al revocarle uno le quedarían filas en la lista sin ninguna
    pastilla capaz de filtrarlas. Por lo mismo aquí no se exige `activo`: un
    módulo retirado cuyos avisos siguen ahí se sigue pudiendo filtrar.
    """
    if user.is_superadmin:
        codigos = set(db.scalars(select(Module.code).where(Module.activo.is_(True))))
    else:
        codigos = {m.codigo for m in auth_service.resolver_modulos(db, user)}

    codigos |= set(
        db.scalars(
            select(Notificacion.module_code)
            .where(Notificacion.user_id == user.id)
            .distinct()
        )
    )
    if not codigos:
        return []

    filas = db.execute(
        select(Module.code, Module.nombre)
        .where(Module.code.in_(codigos))
        .order_by(Module.nombre)
    ).all()
    return [(f[0], f[1]) for f in filas]


def marcar_leida(db: DbSession, user_id: uuid.UUID, notificacion_id: uuid.UUID) -> bool:
    """
    Marca una como leída. El `user_id` va en el WHERE, no se comprueba después:
    así la de otra persona no se puede marcar ni aunque se adivine su id, y la
    respuesta es la misma —no pasó nada— exista o no.
    """
    resultado = db.execute(
        update(Notificacion)
        .where(
            Notificacion.id == notificacion_id,
            Notificacion.user_id == user_id,
            Notificacion.leida_at.is_(None),
        )
        .values(leida_at=ahora())
    )
    return bool(resultado.rowcount)


def marcar_todas(db: DbSession, user_id: uuid.UUID) -> int:
    resultado = db.execute(
        update(Notificacion)
        .where(Notificacion.user_id == user_id, Notificacion.leida_at.is_(None))
        .values(leida_at=ahora())
    )
    return int(resultado.rowcount or 0)
