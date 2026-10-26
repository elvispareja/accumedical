from __future__ import annotations

import uuid
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session as DbSession

from app.shared.catalogos.models import Ciudad
from app.shared.prestadores.models import PrestadorSede

DESCONOCIDO = "Una de las sedes referencia un identificador desconocido"

CAMPOS = (
    "nombre",
    "provincia_codigo",
    "ciudad_codigo",
    "direccion",
    "telefono",
    "email",
    "latitud",
    "longitud",
    "estado",
)


def listar(db: DbSession, prestador_id: uuid.UUID) -> list[PrestadorSede]:
    return list(
        db.scalars(
            select(PrestadorSede)
            .where(
                PrestadorSede.prestador_id == prestador_id,
                PrestadorSede.deleted_at.is_(None),
            )
            # Mismo desempate que en contactos: las sedes de una misma alta
            # comparten `created_at` —es la marca de la transacción— y sin el id
            # (UUIDv7, o sea orden de inserción) el orden sería arbitrario.
            .order_by(PrestadorSede.created_at, PrestadorSede.id)
        ).all()
    )


def _validar(db: DbSession, datos: dict[str, Any]) -> None:
    """
    La FK compuesta ya impide en la base que la ciudad sea de otra provincia,
    pero esa violación llegaría como un error de integridad ilegible.
    """
    existe = db.scalar(
        select(func.count())
        .select_from(Ciudad)
        .where(
            Ciudad.codigo == datos["ciudad_codigo"],
            Ciudad.provincia_codigo == datos["provincia_codigo"],
        )
    )
    if not existe:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"La ciudad de la sede «{datos['nombre']}» no pertenece a esa provincia",
        )


def fijar(
    db: DbSession,
    prestador_id: uuid.UUID,
    entrantes: list[dict[str, Any]],
    autor: uuid.UUID,
) -> dict[str, int] | None:
    """
    Reconcilia la lista completa: las que traen `id` se actualizan y las que no
    lo traen se crean. Ninguna guardada puede faltar: las sedes no se eliminan,
    se desactivan.

    Tener sedes es opcional, pero la sede que se envía va entera: nombre, provincia, ciudad,
    dirección y punto en el mapa los exige el esquema.
    """
    existentes = {s.id: s for s in listar(db, prestador_id)}
    creadas = actualizadas = eliminadas = 0

    nombres: set[str] = set()
    for datos in entrantes:
        nombre = (datos.get("nombre") or "").strip().casefold()
        if nombre in nombres:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"El nombre de sede «{datos['nombre']}» está repetido",
            )
        nombres.add(nombre)

    # ── 1. Quién sobrevive ───────────────────────────────────────────────
    vistos: set[uuid.UUID] = set()
    for datos in entrantes:
        crudo = datos.get("id")
        if not crudo:
            continue
        try:
            clave = uuid.UUID(str(crudo))
        except ValueError:
            clave = None
        # Un id que no pertenece a este dueño es un error del cliente, no una
        # invitación a crear una fila nueva en silencio.
        if clave is None or clave not in existentes:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=DESCONOCIDO,
            )
        vistos.add(clave)

    # ── 2. Una sede guardada NO se elimina (pedido del usuario, 26/10/2026):
    # se desactiva (`estado = inactiva`), para no perder la trazabilidad de las
    # visitas que fueron a ella. Si falta alguna en la lista, se rechaza todo.
    if set(existentes) - vistos:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Las sedes no se eliminan: desactívala para dejar de usarla",
        )

    # ── 3. Altas y ediciones ─────────────────────────────────────────────
    for datos in entrantes:
        _validar(db, datos)
        campos = {campo: datos.get(campo) for campo in CAMPOS}
        campos["nombre"] = campos["nombre"].strip()
        campos["direccion"] = campos["direccion"].strip()
        campos["telefono"] = campos["telefono"] or None
        # Mismo criterio que en contactos: entero en mayúsculas, no a medias.
        campos["email"] = (campos["email"] or "").strip().upper() or None

        crudo = datos.get("id")
        actual = existentes[uuid.UUID(str(crudo))] if crudo else None

        if actual is None:
            db.add(
                PrestadorSede(
                    prestador_id=prestador_id, created_by=autor, updated_by=autor, **campos
                )
            )
            creadas += 1
            continue

        if any(getattr(actual, campo) != valor for campo, valor in campos.items()):
            for campo, valor in campos.items():
                setattr(actual, campo, valor)
            actual.updated_by = autor
            actualizadas += 1

    if not (creadas or actualizadas or eliminadas):
        return None
    return {"creadas": creadas, "actualizadas": actualizadas, "eliminadas": eliminadas}
