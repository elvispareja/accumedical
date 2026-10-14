"""
**No se desactiva a quien tiene trabajo pendiente** (14/10/2026, pedido del
usuario). Desactivar a alguien —del personal o de una aseguradora— o quitarle
una aplicación se rechaza mientras participe en casos que siguen abiertos en
ella. En Concurrencia, abiertos son los programados, asignados o en auditoría;
solo se puede cuando todo lo suyo está cancelado, culminado o no auditado.

Cada aplicación registra aquí su propia regla (`registrar`), así este módulo
compartido no depende de ninguna: la plataforma pregunta y cada app responde.
"""

from __future__ import annotations

import uuid
from collections.abc import Callable

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

#: module_code → función que devuelve los casos abiertos de esa persona
#: («CONC-0001 (asignada)»…), vacía si no tiene ninguno.
_REGLAS: dict[str, Callable[[DbSession, uuid.UUID], list[str]]] = {}

#: Cuántos casos se nombran en el mensaje; del resto solo se dice cuántos más.
_MAX_EN_MENSAJE = 5


def registrar(module_code: str, regla: Callable[[DbSession, uuid.UUID], list[str]]) -> None:
    _REGLAS[module_code] = regla


def con_regla() -> set[str]:
    """Las aplicaciones que tienen regla de pendientes."""
    return set(_REGLAS)


def modulos_vigentes(db: DbSession, user_id: uuid.UUID) -> set[str]:
    """Las aplicaciones a las que la persona tiene acceso hoy."""
    from app.shared.users.models import UserModuleAccess

    return set(
        db.scalars(
            select(UserModuleAccess.module_code).where(
                UserModuleAccess.user_id == user_id, UserModuleAccess.activo.is_(True)
            )
        )
    )


def validar(
    db: DbSession, user_id: uuid.UUID, modulos: set[str] | None = None, *, accion: str
) -> None:
    """
    409 si la persona tiene casos abiertos en alguna de esas aplicaciones (todas
    las que tengan regla, con `None`). `accion` completa el mensaje: «desactivar
    a este usuario», «quitarle Concurrencia».
    """
    for module_code, regla in _REGLAS.items():
        if modulos is not None and module_code not in modulos:
            continue
        abiertos = regla(db, user_id)
        if not abiertos:
            continue
        nombrados = ", ".join(abiertos[:_MAX_EN_MENSAJE])
        resto = len(abiertos) - _MAX_EN_MENSAJE
        if resto > 0:
            nombrados += f" y {resto} más"
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail=(
                f"No se puede {accion}: participa en casos que siguen abiertos "
                f"({nombrados}). Primero deben quedar culminados, cancelados o no auditados."
            ),
        )
