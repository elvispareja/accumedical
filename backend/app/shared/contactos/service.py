from __future__ import annotations

import re
import uuid
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session as DbSession

from app.shared import identificacion
from app.shared.catalogos.models import TipoDocumento

# Cada dueño —aseguradora, prestador— tiene su propia tabla de contactos con su
# FK real; lo único compartido es esta lógica, que es idéntica en todos. Las
# funciones reciben el modelo y el nombre de la columna del dueño.


def validar_documento(db: DbSession, tipo: str | None, numero: str | None) -> None:
    """
    El documento es opcional, pero si viene debe venir entero y con el formato del
    catálogo. El regex es dato de `tipos_documento`, no está escrito aquí.
    """
    if tipo is None and numero is None:
        return
    if tipo is None or numero is None:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Para el documento hacen falta el tipo y el número, o ninguno de los dos",
        )

    fila = db.execute(
        select(TipoDocumento.nombre, TipoDocumento.regex_validacion).where(
            TipoDocumento.codigo == tipo, TipoDocumento.activo.is_(True)
        )
    ).first()
    if fila is None:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"Tipo de documento desconocido: {tipo}"
        )

    nombre, regex = fila
    numero = numero.strip()
    if regex and not re.fullmatch(regex, numero):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"El número no tiene el formato de {nombre.lower()}",
        )

    # Tener la forma no basta: la cédula y el RUC llevan dígito verificador, y
    # un número inventado con la forma correcta sigue sin existir. La aritmética
    # no cabe en un regex, así que vive en `identificacion`.
    problema = identificacion.problema_con(tipo, numero)
    if problema:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail=problema)


def listar(db: DbSession, modelo: type, columna_dueno: str, dueno_id: uuid.UUID) -> list[Any]:
    return list(
        db.scalars(
            select(modelo)
            .where(
                getattr(modelo, columna_dueno) == dueno_id,
                modelo.deleted_at.is_(None),
            )
            # Los contactos de un mismo alta comparten `created_at` al milímetro:
            # es la marca de tiempo de la transacción. Sin desempatar por id
            # —UUIDv7, así que ordena por inserción— el orden sería arbitrario y
            # el formulario los devolvería intercambiados.
            .order_by(modelo.created_at, modelo.id)
        ).all()
    )


def nombres_tipos_documento(db: DbSession) -> dict[str, str]:
    """Código → nombre, para mostrar «Cédula» y no «cedula» en el detalle."""
    return dict(db.execute(select(TipoDocumento.codigo, TipoDocumento.nombre)).all())


def fijar(
    db: DbSession,
    modelo: type,
    columna_dueno: str,
    dueno_id: uuid.UUID,
    entrantes: list[dict[str, Any]],
    autor: uuid.UUID,
) -> dict[str, int] | None:
    """
    Reconcilia la lista completa: los que traen `id` se actualizan, los que no lo
    traen se crean, y los que faltan respecto a lo guardado se borran lógicamente.

    Quitar un contacto no borra la fila: la marca con `deleted_at`/`deleted_by`.
    """
    existentes = {c.id: c for c in listar(db, modelo, columna_dueno, dueno_id)}
    creados = actualizados = eliminados = 0

    correos: set[str] = set()
    for datos in entrantes:
        correo = (datos.get("email") or "").strip().lower()
        if correo in correos:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"El correo {correo} está repetido entre los contactos",
            )
        correos.add(correo)

    # ── 1. Quién sobrevive ───────────────────────────────────────────────────
    # El id llega como TEXTO desde el JSON y las claves de `existentes` son UUID:
    # comparar sin convertir no casa nunca, y cada contacto existente se trataría
    # como nuevo, duplicándolo y borrando el original.
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
                detail="Uno de los contactos referencia un identificador desconocido",
            )
        vistos.add(clave)

    # ── 2. Los ausentes se dan de baja ANTES de insertar nada ────────────────
    # Y se vuelca el cambio: si un contacto nuevo reutiliza el correo del que se
    # va, el índice único parcial vería los dos vivos a la vez y rechazaría el
    # guardado entero.
    for contacto_id, contacto in existentes.items():
        if contacto_id not in vistos:
            contacto.deleted_at = func.now()
            contacto.deleted_by = autor
            eliminados += 1
    if eliminados:
        db.flush()

    # ── 3. Altas y ediciones ─────────────────────────────────────────────────
    for datos in entrantes:
        validar_documento(db, datos.get("tipo_documento_codigo"), datos.get("numero_documento"))
        campos = {
            # Las cuatro partes ya llegan normalizadas por el validador de
            # `personas`: aquí solo se asientan.
            "nombre_principal": datos["nombre_principal"],
            "nombre_secundario": datos.get("nombre_secundario"),
            "apellido_paterno": datos["apellido_paterno"],
            "apellido_materno": datos.get("apellido_materno"),
            # `EmailStr` valida y de paso pasa el DOMINIO a minúsculas, así que
            # sin esto el correo quedaría a medias: ASOTO@seguroslanion.com.
            # La columna es `citext`: guardar en mayúsculas no rompe ninguna
            # búsqueda ni el inicio de sesión.
            "email": datos["email"].strip().upper(),
            # Ya normalizado por el schema: aquí solo se asienta.
            "telefono": (datos.get("telefono") or None),
            "tipo_documento_codigo": datos.get("tipo_documento_codigo"),
            "numero_documento": (datos.get("numero_documento") or None),
            "cargo": ((datos.get("cargo") or "").strip() or None),
        }

        crudo = datos.get("id")
        actual = existentes[uuid.UUID(str(crudo))] if crudo else None

        if actual is None:
            db.add(
                modelo(**{columna_dueno: dueno_id}, created_by=autor, updated_by=autor, **campos)
            )
            creados += 1
            continue

        if any(getattr(actual, campo) != valor for campo, valor in campos.items()):
            for campo, valor in campos.items():
                setattr(actual, campo, valor)
            actual.updated_by = autor
            actualizados += 1

    if not (creados or actualizados or eliminados):
        return None
    return {"creados": creados, "actualizados": actualizados, "eliminados": eliminados}
