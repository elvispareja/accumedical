from __future__ import annotations

import uuid
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session as DbSession

from app.shared import personas
from app.shared.auth import invitaciones
from app.shared.catalogos.models import Ciudad, Module
from app.shared.contactos.service import validar_documento
from app.shared.users.models import (
    PasswordSetupToken,
    Role,
    User,
    UserFuncion,
    UserGrupoAccess,
    UserModuleAccess,
)
from app.shared.users.schemas import FUNCIONES

# El personal de plataforma: gente del propio administrador, sin aseguradora ni
# contacto del que salir. Desde `f5a8d3c6b924` tiene UN rol, no uno por módulo:
#
#   coordinador → una FAMILIA entera (uno solo por familia)
#   auditor     → los módulos que se le marquen
#
# El code del coordinador sigue siendo `supervisor` en la base: identidad
# congelada, «Coordinador» es el nombre visible.
ROL_COORDINADOR = "supervisor"


def modulos_de_familia(db: DbSession, grupo: str) -> set[str]:
    """Los módulos vivos de una familia comercial. Se CALCULAN, no se listan a mano:
    un módulo nuevo en la familia entra solo."""
    return set(
        db.scalars(
            select(Module.code).where(Module.grupo == grupo, Module.activo.is_(True))
        ).all()
    )


def _de_mi_familia(grupo: str):
    """
    Quién cae dentro del alcance de un coordinador: el personal de plataforma que
    audita ALGÚN módulo de su familia. Ni el de la otra familia, ni el otro
    coordinador, ni quien lleva una función transversal.
    """
    return (
        select(UserModuleAccess.user_id)
        .join(Module, Module.code == UserModuleAccess.module_code)
        .where(
            UserModuleAccess.activo.is_(True),
            Module.grupo == grupo,
            Module.activo.is_(True),
        )
    )


def listar(db: DbSession, grupo: str | None = None) -> list[User]:
    """
    El personal de plataforma. El superadmin no se lista: no se administra a sí
    mismo. Con `grupo`, solo los auditores de ESA familia — es lo que ve un
    coordinador.
    """
    condiciones = [
        User.aseguradora_id.is_(None),
        User.is_superadmin.is_(False),
        User.deleted_at.is_(None),
    ]
    if grupo is not None:
        condiciones.append(User.id.in_(_de_mi_familia(grupo)))
    return list(
        db.scalars(
            select(User)
            .where(*condiciones)
            .order_by(User.apellido_paterno, User.apellido_materno, User.nombre_principal)
        ).all()
    )


def obtener(db: DbSession, user_id: uuid.UUID, grupo: str | None = None) -> User:
    condiciones = [
        User.id == user_id,
        User.aseguradora_id.is_(None),
        User.is_superadmin.is_(False),
        User.deleted_at.is_(None),
    ]
    if grupo is not None:
        condiciones.append(User.id.in_(_de_mi_familia(grupo)))
    usuario = db.scalar(select(User).where(*condiciones))
    if usuario is None:
        # Mismo 404 exista o no: tampoco se confirma la existencia de un usuario
        # de aseguradora, ni de uno de la otra familia, por esta ruta.
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Usuario no encontrado")
    return usuario


def validar_alcance(db: DbSession, grupo: str | None, acceso: dict[str, Any]) -> None:
    """
    Lo que un COORDINADOR puede conceder: auditores, y solo sobre módulos de su
    familia. Ni otro coordinador, ni una función transversal, ni un módulo de la
    familia de al lado.

    Con `grupo=None` —el administrador global— no se comprueba nada: él concede
    lo que quiera. Este es el único sitio donde se decide, y lo llaman tanto el
    alta como la edición.
    """
    if grupo is None:
        return
    if acceso.get("rol") != "auditor":
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            detail=f"Como coordinador de {ETIQUETA_GRUPO.get(grupo, grupo)} solo puedes "
            "dar de alta auditores",
        )
    modulos = set(acceso.get("modulos") or [])
    fuera = modulos - modulos_de_familia(db, grupo)
    if fuera:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            detail=f"Solo puedes conceder módulos de {ETIQUETA_GRUPO.get(grupo, grupo)}",
        )


def _validar_modulos(db: DbSession, modulos: list[str]) -> None:
    """Contra la base, no contra el navegador: módulos vivos y sin repetir."""
    if len(set(modulos)) != len(modulos):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Un módulo está marcado dos veces"
        )
    activos = set(db.scalars(select(Module.code).where(Module.activo.is_(True))).all())
    if set(modulos) - activos:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Alguno de los módulos marcados no existe o está apagado",
        )


def _condiciones_de_plataforma_activa(salvo_user_id: uuid.UUID | None):
    """Solo cuenta el personal de plataforma ACTIVO: desactivar libera el puesto."""
    condiciones = [
        User.aseguradora_id.is_(None),
        User.is_superadmin.is_(False),
        User.deleted_at.is_(None),
        User.is_active.is_(True),
    ]
    if salvo_user_id is not None:
        condiciones.append(User.id != salvo_user_id)
    return condiciones


ETIQUETA_GRUPO = {"suscripcion": "Suscripción", "siniestro": "Siniestro"}


def validar_coordinador_unico(
    db: DbSession, grupo: str | None, salvo_user_id: uuid.UUID | None
) -> None:
    """
    UNO SOLO por familia entre el personal ACTIVO. El índice único de la base lo
    garantiza sobre las filas vivas; esto se comprueba antes para poder decir
    QUIÉN ocupa el puesto en vez de devolver un error de integridad.

    Desactivar a alguien libera su familia sin tocar su fila: por eso la
    condición mira `users.is_active`, que un índice no puede cruzar.
    """
    if grupo is None:
        return
    ocupado = db.execute(
        select(User.nombre_principal, User.apellido_paterno)
        .select_from(UserGrupoAccess)
        .join(User, User.id == UserGrupoAccess.user_id)
        .where(
            UserGrupoAccess.grupo == grupo,
            UserGrupoAccess.activo.is_(True),
            *_condiciones_de_plataforma_activa(salvo_user_id),
        )
    ).first()
    if ocupado:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail=(
                f"{ETIQUETA_GRUPO.get(grupo, grupo)} ya tiene coordinador: "
                f"{ocupado[0]} {ocupado[1]}. Solo puede haber uno; pásalo a auditor "
                "o desactívalo primero"
            ),
        )


def grupo_coordinado_por(db: DbSession, user_id: uuid.UUID) -> str | None:
    """La familia que coordina, si coordina alguna. Para revalidar al reactivarlo."""
    return db.scalar(
        select(UserGrupoAccess.grupo).where(
            UserGrupoAccess.user_id == user_id, UserGrupoAccess.activo.is_(True)
        )
    )


ETIQUETA_FUNCION = {"convenio": "Convenio", "contabilidad": "Contabilidad"}


def funcion_de(db: DbSession, user_id: uuid.UUID) -> str | None:
    """La función transversal de esta persona, si tiene alguna."""
    return db.scalar(
        select(UserFuncion.funcion).where(
            UserFuncion.user_id == user_id, UserFuncion.activo.is_(True)
        )
    )


def validar_funcion_unica(
    db: DbSession, funcion: str | None, salvo_user_id: uuid.UUID | None
) -> None:
    """
    UNA SOLA persona por función entre el personal ACTIVO. El índice único de la
    base lo garantiza sobre las filas vivas; esto se comprueba antes para poder
    decir QUIÉN ocupa el puesto.
    """
    if funcion is None:
        return
    ocupado = db.execute(
        select(User.nombre_principal, User.apellido_paterno)
        .select_from(UserFuncion)
        .join(User, User.id == UserFuncion.user_id)
        .where(
            UserFuncion.funcion == funcion,
            UserFuncion.activo.is_(True),
            *_condiciones_de_plataforma_activa(salvo_user_id),
        )
    ).first()
    if ocupado:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail=(
                f"{ETIQUETA_FUNCION.get(funcion, funcion)} ya lo lleva "
                f"{ocupado[0]} {ocupado[1]}. Solo puede haber uno; cámbialo de rol "
                "o desactívalo primero"
            ),
        )


def fijar_acceso(
    db: DbSession, usuario: User, acceso: dict[str, Any], autor: uuid.UUID
) -> None:
    """
    Fija a qué entra el usuario: o coordina una familia entera, o audita los
    módulos marcados. Nunca las dos cosas, así que al cambiar de rol se revoca
    lo del otro camino.

    Revocar es `activo=False` con su marca de tiempo, nunca borrar: estas tablas
    son la puerta que se consulta en cada request y su historial importa.
    """
    rol = acceso["rol"]
    grupo = acceso.get("grupo")
    modulos = list(acceso.get("modulos") or [])

    grupos_existentes = {
        fila.grupo: fila
        for fila in db.scalars(
            select(UserGrupoAccess).where(UserGrupoAccess.user_id == usuario.id)
        ).all()
    }
    modulos_existentes = {
        fila.module_code: fila
        for fila in db.scalars(
            select(UserModuleAccess).where(UserModuleAccess.user_id == usuario.id)
        ).all()
    }
    funcion_existente = db.scalar(
        select(UserFuncion).where(UserFuncion.user_id == usuario.id)
    )

    # Un rol por persona: al cambiar, lo de los otros caminos se revoca.
    if rol not in FUNCIONES and funcion_existente is not None:
        _revocar([funcion_existente], autor)

    if rol in FUNCIONES:
        validar_funcion_unica(db, rol, salvo_user_id=usuario.id)
        # Una función transversal no entra por módulo ni por familia.
        _revocar(modulos_existentes.values(), autor)
        _revocar(grupos_existentes.values(), autor)
        if funcion_existente is None:
            db.add(UserFuncion(user_id=usuario.id, funcion=rol, granted_by=autor))
        else:
            if funcion_existente.funcion != rol:
                # Cambiar de función libera la anterior antes de ocupar la nueva.
                funcion_existente.funcion = rol
            if not funcion_existente.activo:
                funcion_existente.activo = True
                funcion_existente.revoked_at = None
                funcion_existente.revoked_by = None
                funcion_existente.granted_by = autor
        return

    if rol == "coordinador":
        validar_coordinador_unico(db, grupo, salvo_user_id=usuario.id)
        # Un coordinador no lleva módulos sueltos: su alcance sale de la familia.
        _revocar(modulos_existentes.values(), autor)
        for otro, fila in grupos_existentes.items():
            if otro != grupo and fila.activo:
                _revocar([fila], autor)
        db.flush()  # libera el puesto antes de ocupar el nuevo

        fila = grupos_existentes.get(grupo)
        if fila is None:
            db.add(UserGrupoAccess(user_id=usuario.id, grupo=grupo, granted_by=autor))
        elif not fila.activo:
            fila.activo = True
            fila.revoked_at = None
            fila.revoked_by = None
            fila.granted_by = autor
        return

    # ── Auditor: módulos marcados, uno a uno ─────────────────────────────────
    _validar_modulos(db, modulos)
    _revocar(grupos_existentes.values(), autor)

    rol_auditor = {
        module_code: role_id
        for role_id, module_code in db.execute(
            select(Role.id, Role.module_code).where(
                Role.code == "auditor", Role.activo.is_(True)
            )
        ).all()
    }
    for module_code in modulos:
        role_id = rol_auditor.get(module_code)
        if role_id is None:
            # El rol no está sembrado en ese módulo: fallo de datos, no del
            # cliente. Mejor 422 legible que 500.
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"El rol auditor no existe en el módulo {module_code}",
            )
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
                fila.revoked_by = None
                fila.granted_by = autor
    for module_code, fila in modulos_existentes.items():
        if module_code not in modulos:
            _revocar([fila], autor)


def _revocar(filas, autor: uuid.UUID) -> None:
    """Apaga las filas vivas que se le pasen, dejando quién y cuándo."""
    for fila in filas:
        if fila.activo:
            fila.activo = False
            fila.revoked_at = func.now()
            fila.revoked_by = autor


def _email_libre(db: DbSession, email: str, salvo: uuid.UUID | None = None) -> None:
    consulta = select(func.count()).select_from(User).where(
        User.email == email, User.deleted_at.is_(None)
    )
    if salvo is not None:
        consulta = consulta.where(User.id != salvo)
    if db.scalar(consulta):
        raise HTTPException(
            status.HTTP_409_CONFLICT, detail="Ya existe un usuario con ese correo en la plataforma"
        )


def _validar_ubicacion(db: DbSession, provincia: str | None, ciudad: str | None) -> None:
    """
    El mismo control que en aseguradoras y prestadores: la FK compuesta ya lo
    impide en la base, pero aquí se corta antes con un mensaje legible.
    """
    if ciudad is None:
        return
    if provincia is None:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Para elegir una ciudad hay que elegir primero la provincia",
        )
    existe = db.scalar(
        select(func.count())
        .select_from(Ciudad)
        .where(Ciudad.codigo == ciudad, Ciudad.provincia_codigo == provincia)
    )
    if not existe:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="La ciudad seleccionada no pertenece a esa provincia",
        )


def crear(
    db: DbSession, datos: dict[str, Any], acceso: dict[str, Any], autor: uuid.UUID
) -> tuple[User, str]:
    """
    Da de alta el usuario y devuelve el token de invitación EN CLARO, que solo
    viaja al correo. Sin contraseña tecleada por nadie: la define la persona al
    abrir su enlace, igual que los usuarios de aseguradora.
    """
    email = str(datos["email"]).strip().upper()
    _email_libre(db, email)
    # El mismo validador que usan contactos y pacientes: tipo del catálogo,
    # formato y dígito verificador.
    validar_documento(
        db,
        datos.get("tipo_documento_codigo"),
        (datos.get("numero_documento") or "").strip() or None,
    )
    _validar_ubicacion(db, datos.get("provincia_codigo"), datos.get("ciudad_codigo"))

    usuario = User(
        email=email,
        # Ya normalizadas por el validador de `personas`.
        nombre_principal=datos["nombre_principal"],
        nombre_secundario=datos.get("nombre_secundario"),
        apellido_paterno=datos["apellido_paterno"],
        apellido_materno=datos.get("apellido_materno"),
        tipo_documento_codigo=datos.get("tipo_documento_codigo"),
        numero_documento=(datos.get("numero_documento") or "").strip() or None,
        telefono=(datos.get("telefono") or "").strip() or None,
        provincia_codigo=datos.get("provincia_codigo"),
        ciudad_codigo=datos.get("ciudad_codigo"),
        password_hash=invitaciones.password_inservible(),
        created_by=autor,
        updated_by=autor,
    )
    db.add(usuario)
    db.flush()

    fijar_acceso(db, usuario, acceso, autor)
    return usuario, invitaciones.emitir(db, usuario, autor)


CAMPOS_EDITABLES = (
    *personas.PARTES,
    "tipo_documento_codigo",
    "numero_documento",
    "telefono",
    "provincia_codigo",
    "ciudad_codigo",
)


def actualizar(db: DbSession, usuario: User, cambios: dict[str, Any]) -> dict[str, Any]:
    """Aplica los campos de identidad y devuelve el diff. Accesos e is_active van aparte."""
    if "email" in cambios and cambios["email"] is not None:
        cambios["email"] = str(cambios["email"]).strip().upper()
        _email_libre(db, cambios["email"], salvo=usuario.id)

    diff: dict[str, Any] = {"antes": {}, "despues": {}}
    for campo in (*CAMPOS_EDITABLES, "email"):
        if campo not in cambios:
            continue
        valor = cambios[campo]
        if isinstance(valor, str):
            valor = valor.strip() or None
        if campo in ("nombre_principal", "apellido_paterno", "email") and valor is None:
            # Los tres obligatorios no se pueden vaciar. Los dos opcionales sí:
            # mandar `nombre_secundario: ""` es quitarle el segundo nombre.
            continue
        anterior = getattr(usuario, campo)
        if anterior != valor:
            diff["antes"][campo] = anterior
            diff["despues"][campo] = valor
            setattr(usuario, campo, valor)

    # El documento, sobre el estado RESULTANTE y con el MISMO validador que
    # contactos y pacientes: coherencia tipo/número, formato del catálogo y
    # dígito verificador. Antes aquí solo se comprobaba que el tipo existiera,
    # así que un usuario de plataforma podía quedar con una cédula inventada.
    validar_documento(db, usuario.tipo_documento_codigo, usuario.numero_documento)
    # Y la ubicación igual: sobre lo que quedaría guardado, no sobre el payload.
    _validar_ubicacion(db, usuario.provincia_codigo, usuario.ciudad_codigo)
    return diff


def acceso_de(db: DbSession, user_id: uuid.UUID) -> dict[str, Any]:
    """
    A qué entra el usuario, ya resuelto: su rol y los módulos que alcanza HOY.

    Para el coordinador, los módulos se CALCULAN a partir de su familia, no se
    leen de ninguna fila: por eso un módulo nuevo en la familia aparece aquí sin
    que nadie reedite nada.
    """
    funcion = funcion_de(db, user_id)
    if funcion is not None:
        # Transversal: ni familia ni módulos. Qué ve, por definir.
        return {"rol": funcion, "grupo": None, "modulos": []}

    grupo = grupo_coordinado_por(db, user_id)
    if grupo is not None:
        modulos = db.execute(
            select(Module.code, Module.nombre)
            .where(Module.grupo == grupo, Module.activo.is_(True))
            .order_by(Module.orden, Module.nombre)
        ).all()
        return {
            "rol": "coordinador",
            "grupo": grupo,
            "modulos": [{"module_code": c, "module_nombre": n} for c, n in modulos],
        }

    modulos = db.execute(
        select(UserModuleAccess.module_code, Module.nombre)
        .join(Module, Module.code == UserModuleAccess.module_code)
        .where(
            UserModuleAccess.user_id == user_id,
            UserModuleAccess.activo.is_(True),
            Module.activo.is_(True),
        )
        .order_by(Module.orden, Module.nombre)
    ).all()
    return {
        "rol": "auditor",
        "grupo": None,
        "modulos": [{"module_code": c, "module_nombre": n} for c, n in modulos],
    }


def invitacion_viva(db: DbSession, user_id: uuid.UUID) -> bool:
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
