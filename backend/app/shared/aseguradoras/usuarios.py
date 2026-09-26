from __future__ import annotations

import uuid
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session as DbSession

from app.core.security.passwords import hashear
from app.shared import personas
from app.shared.aseguradoras.models import (
    AseguradoraCobertura,
    AseguradoraContacto,
    AseguradoraModulo,
)
from app.shared.aseguradoras.service import COBERTURAS
from app.shared.auth import invitaciones
from app.shared.users.models import (
    PasswordSetupToken,
    Role,
    User,
    UserAseguradoraCoordinador,
    UserCoberturaAccess,
    UserModuleAccess,
)

# Los usuarios de una compañía tienen UN rol:
#
#   coordinador → la compañía entera: todos los módulos que ella tenga
#                 contratados. Uno solo por aseguradora.
#   operador    → los requerimientos que se le marquen. Los que hagan falta.
#
# El code del coordinador sigue siendo `supervisor` en la base: identidad
# congelada, «Coordinador» es el nombre visible.
ROLES = ("supervisor", "operador")
ROL_COORDINADOR = "supervisor"
# De más amplio a más estrecho. Gobierna qué rol recibe la fila de módulo cuando
# sus coberturas llevan roles distintos: la puerta debe dejar pasar al más amplio,
# y dentro manda la fila de la cobertura.
JERARQUIA = {"supervisor": 2, "operador": 1}


def requerimientos_de(db: DbSession, aseguradora_id: uuid.UUID) -> list[dict[str, Any]]:
    """
    Lo que esta aseguradora tiene contratado, en hojas: los módulos sin coberturas
    y las coberturas de los que sí las tienen. Es la única lista sobre la que se
    puede dar acceso a un usuario suyo.
    """
    modulos = {
        fila.module_code
        for fila in db.scalars(
            select(AseguradoraModulo).where(
                AseguradoraModulo.aseguradora_id == aseguradora_id,
                AseguradoraModulo.activo.is_(True),
            )
        ).all()
    }
    coberturas = {
        (fila.module_code, fila.cobertura_codigo)
        for fila in db.scalars(
            select(AseguradoraCobertura).where(
                AseguradoraCobertura.aseguradora_id == aseguradora_id,
                AseguradoraCobertura.activo.is_(True),
            )
        ).all()
    }

    hojas: list[dict[str, Any]] = []
    for module_code in sorted(modulos):
        propias = COBERTURAS.get(module_code)
        if not propias:
            hojas.append({"module_code": module_code, "cobertura_codigo": None})
            continue
        for codigo, _nombre in propias:
            if (module_code, codigo) in coberturas:
                hojas.append({"module_code": module_code, "cobertura_codigo": codigo})
    return hojas


def _validar_accesos(
    db: DbSession, aseguradora_id: uuid.UUID, accesos: list[dict[str, Any]]
) -> None:
    """
    Los requerimientos del OPERADOR, contra lo que la aseguradora tiene
    contratado AHORA. Si le revocaron un módulo mientras el formulario estaba
    abierto, el guardado se rechaza en lugar de conceder acceso a algo que ya no
    existe. (El coordinador no pasa por aquí: su alcance es la compañía entera.)
    """
    if not accesos:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Marca al menos un requerimiento: un usuario sin acceso no puede entrar a nada",
        )

    permitidos = {
        (h["module_code"], h["cobertura_codigo"]) for h in requerimientos_de(db, aseguradora_id)
    }
    vistos: set[tuple[str, str | None]] = set()
    for acceso in accesos:
        clave = (acceso["module_code"], acceso.get("cobertura_codigo"))
        if clave in vistos:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Un requerimiento está repetido",
            )
        vistos.add(clave)
        if clave not in permitidos:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Esta aseguradora no tiene contratado alguno de los requerimientos marcados",
            )
        if acceso["rol"] not in ROLES:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"Rol desconocido: {acceso['rol']}"
            )


def validar_coordinador_unico(
    db: DbSession, aseguradora_id: uuid.UUID, salvo_user_id: uuid.UUID | None
) -> None:
    """
    UNO SOLO por compañía entre los usuarios ACTIVOS. El índice único de la base
    lo garantiza sobre las filas vivas; esto se comprueba antes para poder decir
    QUIÉN ocupa el puesto en vez de devolver un error de integridad.
    """
    condiciones = [User.deleted_at.is_(None), User.is_active.is_(True)]
    if salvo_user_id is not None:
        condiciones.append(User.id != salvo_user_id)
    ocupado = db.scalar(
        select(User)
        .join(
            UserAseguradoraCoordinador,
            UserAseguradoraCoordinador.user_id == User.id,
        )
        .where(
            UserAseguradoraCoordinador.aseguradora_id == aseguradora_id,
            UserAseguradoraCoordinador.activo.is_(True),
            *condiciones,
        )
    )
    if ocupado:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail=(
                f"Esta aseguradora ya tiene coordinador: {personas.de_fila(ocupado)}. "
                "Solo puede haber uno; pásalo a operador o desactívalo primero"
            ),
        )


def es_coordinador(db: DbSession, user_id: uuid.UUID) -> bool:
    """Si esta persona coordina su compañía. Para revalidar al reactivarla."""
    return bool(
        db.scalar(
            select(UserAseguradoraCoordinador.id).where(
                UserAseguradoraCoordinador.user_id == user_id,
                UserAseguradoraCoordinador.activo.is_(True),
            )
        )
    )


def _roles_por_modulo(db: DbSession) -> dict[tuple[str, str], uuid.UUID]:
    return {
        (module_code, code): role_id
        for role_id, module_code, code in db.execute(
            select(Role.id, Role.module_code, Role.code).where(Role.activo.is_(True))
        ).all()
    }


def fijar_acceso(
    db: DbSession, usuario: User, acceso: dict[str, Any], autor: uuid.UUID
) -> None:
    """
    Fija a qué entra el usuario de la compañía: o la **coordina** entera —uno
    solo, y abarca todo lo que ella tenga contratado—, o **opera** los
    requerimientos que se le marquen. Cambiar de rol revoca lo del otro camino.
    """
    coordinador = db.scalar(
        select(UserAseguradoraCoordinador).where(
            UserAseguradoraCoordinador.user_id == usuario.id
        )
    )

    if acceso["rol"] == "coordinador":
        validar_coordinador_unico(db, usuario.aseguradora_id, salvo_user_id=usuario.id)
        # Sin filas por módulo: su alcance sale de la compañía.
        for fila in db.scalars(
            select(UserModuleAccess).where(UserModuleAccess.user_id == usuario.id)
        ).all():
            if fila.activo:
                fila.activo = False
                fila.revoked_at = func.now()
                fila.revoked_by = autor
        if coordinador is None:
            db.add(
                UserAseguradoraCoordinador(
                    user_id=usuario.id,
                    aseguradora_id=usuario.aseguradora_id,
                    granted_by=autor,
                )
            )
        elif not coordinador.activo:
            coordinador.activo = True
            coordinador.revoked_at = None
            coordinador.revoked_by = None
            coordinador.granted_by = autor
        return

    # Operador: deja de coordinar, si coordinaba, y se le fijan sus accesos.
    if coordinador is not None and coordinador.activo:
        coordinador.activo = False
        coordinador.revoked_at = func.now()
        coordinador.revoked_by = autor
        db.flush()  # libera el puesto antes de que otro lo tome

    fijar_accesos(db, usuario, acceso["accesos"], autor)


def fijar_accesos(
    db: DbSession, usuario: User, accesos: list[dict[str, Any]], autor: uuid.UUID
) -> None:
    """
    Reconcilia módulos y coberturas del OPERADOR. Revocar es `activo=False` con
    su marca de tiempo, nunca borrar: `user_module_access` es la puerta que se
    consulta en cada request y su historial importa.
    """
    _validar_accesos(db, usuario.aseguradora_id, accesos)
    catalogo = _roles_por_modulo(db)

    # Rol de la fila de módulo: el más amplio de lo concedido dentro de él.
    rol_de_modulo: dict[str, str] = {}
    for acceso in accesos:
        actual = rol_de_modulo.get(acceso["module_code"])
        if actual is None or JERARQUIA[acceso["rol"]] > JERARQUIA[actual]:
            rol_de_modulo[acceso["module_code"]] = acceso["rol"]

    modulos_existentes = {
        fila.module_code: fila
        for fila in db.scalars(
            select(UserModuleAccess).where(UserModuleAccess.user_id == usuario.id)
        ).all()
    }
    coberturas_existentes = {
        (fila.module_code, fila.cobertura_codigo): fila
        for fila in db.scalars(
            select(UserCoberturaAccess).where(UserCoberturaAccess.user_id == usuario.id)
        ).all()
    }

    # ── Coberturas que se van: primero, porque su FK apunta al módulo ────────
    deseadas = {
        (a["module_code"], a["cobertura_codigo"])
        for a in accesos
        if a.get("cobertura_codigo")
    }
    for clave, fila in coberturas_existentes.items():
        if clave not in deseadas and fila.activo:
            fila.activo = False
            fila.revoked_at = func.now()
            fila.revoked_by = autor

    # ── Módulos ──────────────────────────────────────────────────────────────
    for module_code, rol in rol_de_modulo.items():
        role_id = catalogo[(module_code, rol)]
        fila = modulos_existentes.get(module_code)
        if fila is None:
            db.add(
                UserModuleAccess(
                    user_id=usuario.id,
                    module_code=module_code,
                    role_id=role_id,
                    granted_by=autor,
                )
            )
        else:
            fila.role_id = role_id
            if not fila.activo:
                fila.activo = True
                fila.revoked_at = None
    for module_code, fila in modulos_existentes.items():
        if module_code not in rol_de_modulo and fila.activo:
            fila.activo = False
            fila.revoked_at = func.now()
    # El alta de las coberturas necesita que la fila de módulo ya exista.
    db.flush()

    # ── Coberturas que se conceden ───────────────────────────────────────────
    for acceso in accesos:
        cobertura = acceso.get("cobertura_codigo")
        if not cobertura:
            continue
        clave = (acceso["module_code"], cobertura)
        role_id = catalogo[(acceso["module_code"], acceso["rol"])]
        fila = coberturas_existentes.get(clave)
        if fila is None:
            db.add(
                UserCoberturaAccess(
                    user_id=usuario.id,
                    module_code=acceso["module_code"],
                    cobertura_codigo=cobertura,
                    role_id=role_id,
                    granted_by=autor,
                )
            )
        else:
            fila.role_id = role_id
            if not fila.activo:
                fila.activo = True
                fila.revoked_at = None
                fila.granted_by = autor


def listar(db: DbSession, aseguradora_id: uuid.UUID) -> list[tuple[Any, ...]]:
    """Usuarios de la aseguradora junto con el contacto del que salieron."""
    filas = db.execute(
        select(User, AseguradoraContacto)
        .outerjoin(AseguradoraContacto, AseguradoraContacto.id == User.aseguradora_contacto_id)
        .where(User.aseguradora_id == aseguradora_id, User.deleted_at.is_(None))
        .order_by(User.apellido_paterno, User.apellido_materno, User.nombre_principal)
    ).all()
    return [tuple(f) for f in filas]


def accesos_de(db: DbSession, user_id: uuid.UUID) -> list[dict[str, Any]]:
    """Los requerimientos vivos del usuario, en la misma forma que se conceden."""
    roles = {
        role_id: code
        for role_id, code in db.execute(select(Role.id, Role.code)).all()
    }
    modulos = db.scalars(
        select(UserModuleAccess).where(
            UserModuleAccess.user_id == user_id, UserModuleAccess.activo.is_(True)
        )
    ).all()
    coberturas = db.scalars(
        select(UserCoberturaAccess).where(
            UserCoberturaAccess.user_id == user_id, UserCoberturaAccess.activo.is_(True)
        )
    ).all()
    por_modulo: dict[str, list[Any]] = {}
    for fila in coberturas:
        por_modulo.setdefault(fila.module_code, []).append(fila)

    salida: list[dict[str, Any]] = []
    for modulo in modulos:
        suyas = por_modulo.get(modulo.module_code, [])
        if suyas:
            salida.extend(
                {
                    "module_code": c.module_code,
                    "cobertura_codigo": c.cobertura_codigo,
                    "rol": roles.get(c.role_id, ""),
                }
                for c in suyas
            )
        else:
            salida.append(
                {
                    "module_code": modulo.module_code,
                    "cobertura_codigo": None,
                    "rol": roles.get(modulo.role_id, ""),
                }
            )
    return salida


def acceso_de(db: DbSession, usuario: User) -> dict[str, Any]:
    """
    A qué entra el usuario de la compañía, ya resuelto. Para el coordinador, los
    requerimientos se CALCULAN de lo que la aseguradora tiene contratado: por eso
    contratar un módulo se lo da sin reeditar su ficha.
    """
    if es_coordinador(db, usuario.id):
        return {
            "rol": "coordinador",
            "accesos": [
                {**hoja, "rol": "coordinador"}
                for hoja in requerimientos_de(db, usuario.aseguradora_id)
            ],
        }
    return {"rol": "operador", "accesos": accesos_de(db, usuario.id)}


def obtener(db: DbSession, aseguradora_id: uuid.UUID, user_id: uuid.UUID) -> User:
    usuario = db.scalar(
        select(User).where(
            User.id == user_id,
            User.aseguradora_id == aseguradora_id,
            User.deleted_at.is_(None),
        )
    )
    if usuario is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Usuario no encontrado")
    return usuario


def crear_desde_contacto(
    db: DbSession,
    aseguradora_id: uuid.UUID,
    contacto_id: uuid.UUID,
    acceso: dict[str, Any],
    autor: uuid.UUID,
) -> tuple[User, str]:
    """
    Da de alta el usuario a partir de un contacto de la aseguradora y devuelve el
    token de invitación EN CLARO, que solo viaja al correo. Nombre, apellido y
    correo salen del contacto: no se teclean aparte y así no pueden divergir.
    """
    contacto = db.scalar(
        select(AseguradoraContacto).where(
            AseguradoraContacto.id == contacto_id,
            AseguradoraContacto.aseguradora_id == aseguradora_id,
            AseguradoraContacto.deleted_at.is_(None),
        )
    )
    if contacto is None:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Ese contacto no existe en esta aseguradora",
        )

    if db.scalar(
        select(func.count())
        .select_from(User)
        .where(User.aseguradora_contacto_id == contacto_id, User.deleted_at.is_(None))
    ):
        raise HTTPException(
            status.HTTP_409_CONFLICT, detail="Ese contacto ya tiene usuario"
        )
    if db.scalar(
        select(func.count())
        .select_from(User)
        .where(User.email == contacto.email, User.deleted_at.is_(None))
    ):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail="Ya existe un usuario con ese correo en la plataforma",
        )

    usuario = User(
        email=contacto.email,
        # El usuario de aseguradora ES su contacto: hereda las cuatro partes.
        nombre_principal=contacto.nombre_principal,
        nombre_secundario=contacto.nombre_secundario,
        apellido_paterno=contacto.apellido_paterno,
        apellido_materno=contacto.apellido_materno,
        password_hash=invitaciones.password_inservible(),
        aseguradora_id=aseguradora_id,
        aseguradora_contacto_id=contacto_id,
        created_by=autor,
        updated_by=autor,
    )
    db.add(usuario)
    db.flush()

    fijar_acceso(db, usuario, acceso, autor)
    return usuario, invitaciones.emitir(db, usuario, autor)


def tiene_usuario(db: DbSession, contacto_ids: list[uuid.UUID]) -> set[uuid.UUID]:
    """Qué contactos de la lista tienen usuario vivo. Se usa para no dejarlos quitar."""
    if not contacto_ids:
        return set()
    return set(
        db.scalars(
            select(User.aseguradora_contacto_id).where(
                User.aseguradora_contacto_id.in_(contacto_ids), User.deleted_at.is_(None)
            )
        ).all()
    )


def invitacion_viva(db: DbSession, user_id: uuid.UUID) -> bool:
    """¿Queda una invitación sin usar y sin caducar? Es lo que la pantalla enseña."""
    return bool(
        db.scalar(
            select(func.count())
            .select_from(PasswordSetupToken)
            .where(
                PasswordSetupToken.user_id == user_id,
                PasswordSetupToken.used_at.is_(None),
                PasswordSetupToken.expires_at > func.now(),
            )
        )
    )


def fijar_password(db: DbSession, usuario: User, password: str) -> None:
    usuario.password_hash = hashear(password)
    usuario.password_changed_at = func.now()
    usuario.failed_login_attempts = 0
    usuario.locked_until = None
