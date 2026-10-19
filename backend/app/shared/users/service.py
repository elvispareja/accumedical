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
    HistorialAcceso,
    PasswordSetupToken,
    Role,
    User,
    UserAseguradoraCoordinador,
    UserFuncion,
    UserGrupoAccess,
    UserModuleAccess,
)

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


# El rol en la app tal como vive en `roles.code`, y su nombre en el historial.
CODIGO_ROL = {"coordinador": ROL_COORDINADOR, "auditor": "auditor", "call_center": "call_center"}
ROL_DE_CODIGO = {v: k for k, v in CODIGO_ROL.items()}
ETIQUETA_ROL = {
    "coordinador": "Coordinador",
    "auditor": "Auditor",
    "call_center": "Call center",
    "operador": "Operador",
    "consulta": "Consulta",
    "convenio": "Convenio",
    "contabilidad": "Contabilidad",
}

#: Del lado de la ASEGURADORA (19/10/2026, pedido del cliente): su coordinador se
#: llama «Supervisor» y su operador «Ejecutivo». Solo cambia el nombre visible;
#: los códigos (`coordinador`/`supervisor`, `operador`) y lo que autorizan, no.
#: Del lado de Accumedical el coordinador sigue siendo «Coordinador».
ETIQUETA_ROL_ASEGURADORA = {
    "coordinador": "Supervisor",
    "supervisor": "Supervisor",
    "operador": "Ejecutivo",
}


def etiqueta_rol(rol: str | None, de_aseguradora: bool = False) -> str:
    """El nombre visible de un rol, según si la persona es de una aseguradora."""
    if not rol:
        return ""
    if de_aseguradora and rol in ETIQUETA_ROL_ASEGURADORA:
        return ETIQUETA_ROL_ASEGURADORA[rol]
    return ETIQUETA_ROL.get(rol, rol)


def fijar_acceso(
    db: DbSession, usuario: User, acceso: dict[str, Any], autor: uuid.UUID
) -> None:
    """
    Deja al usuario con EXACTAMENTE estas aplicaciones (cada una con su rol) y
    esta función. Lo que sobra se REVOCA (`activo=False`, quién y cuándo), nunca
    se borra, y su tramo se cierra en `historial_accesos`.
    """
    aplicaciones = {a["module_code"]: a["rol"] for a in acceso.get("aplicaciones") or []}
    funcion = acceso.get("funcion")
    _validar_modulos(db, list(aplicaciones))

    # Coordinación de FAMILIA (esquema anterior al 14/10/2026): ya no existe.
    _revocar(
        db.scalars(select(UserGrupoAccess).where(UserGrupoAccess.user_id == usuario.id)).all(),
        autor,
    )

    roles = {
        (module_code, code): role_id
        for role_id, module_code, code in db.execute(
            select(Role.id, Role.module_code, Role.code).where(Role.activo.is_(True))
        ).all()
    }
    existentes = {
        fila.module_code: fila
        for fila in db.scalars(
            select(UserModuleAccess).where(UserModuleAccess.user_id == usuario.id)
        ).all()
    }
    for module_code, rol in aplicaciones.items():
        role_id = roles.get((module_code, CODIGO_ROL[rol]))
        if role_id is None:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"La aplicación {module_code} no admite el rol {ETIQUETA_ROL.get(rol, rol)}",
            )
        fila = existentes.get(module_code)
        if fila is None:
            db.add(UserModuleAccess(user_id=usuario.id, module_code=module_code,
                                    role_id=role_id, granted_by=autor))
        else:
            if fila.role_id != role_id:
                fila.role_id = role_id
                fila.granted_by = autor
            if not fila.activo:
                fila.activo = True
                fila.revoked_at = None
                fila.revoked_by = None
                fila.granted_by = autor
    for module_code, fila in existentes.items():
        if module_code not in aplicaciones:
            _revocar([fila], autor)

    # La función transversal: una por persona, y cada una con UNA sola persona.
    fila_funcion = db.scalar(select(UserFuncion).where(UserFuncion.user_id == usuario.id))
    if funcion is not None:
        validar_funcion_unica(db, funcion, salvo_user_id=usuario.id)
        if fila_funcion is None:
            db.add(UserFuncion(user_id=usuario.id, funcion=funcion, granted_by=autor))
        else:
            if fila_funcion.funcion != funcion:
                _revocar([fila_funcion], autor)
                db.flush()
                fila_funcion.funcion = funcion
            if not fila_funcion.activo:
                fila_funcion.activo = True
                fila_funcion.revoked_at = None
                fila_funcion.revoked_by = None
                fila_funcion.granted_by = autor
    elif fila_funcion is not None:
        _revocar([fila_funcion], autor)

    db.flush()
    sincronizar_historial(db, usuario, autor)


def liberar_puestos(db: DbSession, usuario: User, autor: uuid.UUID | None) -> None:
    """
    Al DESACTIVAR a alguien: sus puestos de «uno a la vez» (función Convenio o
    Contabilidad, coordinador de una compañía) se revocan para que se pueda
    nombrar a su reemplazo. Se cierran con fecha y quedan en el historial; si
    vuelve, el administrador le asigna de nuevo lo que corresponda.
    """
    _revocar(
        db.scalars(select(UserFuncion).where(
            UserFuncion.user_id == usuario.id, UserFuncion.activo.is_(True))).all(),
        autor,
    )
    _revocar(
        db.scalars(select(UserAseguradoraCoordinador).where(
            UserAseguradoraCoordinador.user_id == usuario.id,
            UserAseguradoraCoordinador.activo.is_(True))).all(),
        autor,
    )


def accesos_vigentes(db: DbSession, user_id: uuid.UUID) -> dict[str, dict[str, Any]]:
    """
    Lo que la persona tiene HOY, por clave del historial: «app:<módulo>» con su
    rol, «funcion:<función>» y «compania:<aseguradora>» (coordinador de una
    compañía). Sirve para el personal propio y para el de las aseguradoras.
    """
    vigentes: dict[str, dict[str, Any]] = {}
    for module_code, code in db.execute(
        select(UserModuleAccess.module_code, Role.code)
        .join(Role, Role.id == UserModuleAccess.role_id)
        .where(UserModuleAccess.user_id == user_id, UserModuleAccess.activo.is_(True))
    ):
        vigentes[f"app:{module_code}"] = {
            "ambito": "aplicacion", "module_code": module_code,
            "rol": ROL_DE_CODIGO.get(code, code),
        }
    for funcion in db.scalars(
        select(UserFuncion.funcion).where(
            UserFuncion.user_id == user_id, UserFuncion.activo.is_(True)
        )
    ):
        vigentes[f"funcion:{funcion}"] = {"ambito": "funcion", "funcion": funcion, "rol": funcion}
    for aseguradora_id in db.scalars(
        select(UserAseguradoraCoordinador.aseguradora_id).where(
            UserAseguradoraCoordinador.user_id == user_id,
            UserAseguradoraCoordinador.activo.is_(True),
        )
    ):
        vigentes[f"compania:{aseguradora_id}"] = {
            "ambito": "compania", "aseguradora_id": aseguradora_id, "rol": "coordinador",
        }
    return vigentes


def sincronizar_historial(db: DbSession, usuario: User, autor: uuid.UUID | None) -> None:
    """
    Deja `historial_accesos` igual a lo que la persona tiene HOY: cierra los
    tramos de lo que ya no tiene (o si cambió de rol) y abre los nuevos. Un
    usuario DESACTIVADO no tiene nada vigente: se le cierran todos (sus filas de
    acceso se conservan para cuando vuelva). Nunca se borra un tramo.
    """
    vigentes = (
        accesos_vigentes(db, usuario.id)
        if usuario.is_active and usuario.deleted_at is None
        else {}
    )
    abiertos = {
        fila.clave: fila
        for fila in db.scalars(
            select(HistorialAcceso).where(
                HistorialAcceso.user_id == usuario.id, HistorialAcceso.hasta.is_(None)
            )
        )
    }
    for clave, fila in abiertos.items():
        hoy = vigentes.get(clave)
        if hoy is None or hoy["rol"] != fila.rol:
            fila.hasta = func.now()
            fila.retirado_por = autor
    db.flush()
    for clave, hoy in vigentes.items():
        abierto = abiertos.get(clave)
        if abierto is not None and abierto.rol == hoy["rol"]:
            continue
        db.add(HistorialAcceso(
            user_id=usuario.id, ambito=hoy["ambito"], clave=clave,
            module_code=hoy.get("module_code"), funcion=hoy.get("funcion"),
            aseguradora_id=hoy.get("aseguradora_id"), rol=hoy["rol"], otorgado_por=autor,
        ))


def _nombres(db: DbSession) -> dict[uuid.UUID, str]:
    return {
        u.id: " ".join(x for x in (u.nombre_principal, u.apellido_paterno) if x)
        for u in db.scalars(select(User))
    }


def _tramo(
    fila: HistorialAcceso, nombres: dict, correos: dict, de_aseguradora: bool = False
) -> dict[str, Any]:
    return {
        "user_id": str(fila.user_id),
        "nombre": nombres.get(fila.user_id, "—"),
        "email": correos.get(fila.user_id),
        "rol": fila.rol,
        "rol_etiqueta": etiqueta_rol(fila.rol, de_aseguradora),
        "desde": fila.desde,
        "hasta": fila.hasta,
        "vigente": fila.hasta is None,
        "otorgado_por": nombres.get(fila.otorgado_por) if fila.otorgado_por else None,
        "retirado_por": nombres.get(fila.retirado_por) if fila.retirado_por else None,
    }


def historial_por_aplicacion(db: DbSession) -> list[dict[str, Any]]:
    """
    Por aplicación: quién la coordina, audita o atiende HOY y quién lo hizo
    antes (personal de Accumedical). Lo más reciente primero.
    """
    nombres = _nombres(db)
    correos = dict(db.execute(select(User.id, User.email)).all())
    personal = select(User.id).where(User.aseguradora_id.is_(None))
    filas = db.execute(
        select(HistorialAcceso, Module.nombre)
        .join(Module, Module.code == HistorialAcceso.module_code)
        .where(HistorialAcceso.ambito == "aplicacion", HistorialAcceso.user_id.in_(personal))
        .order_by(Module.orden, Module.nombre, HistorialAcceso.desde.desc())
    ).all()
    por_modulo: dict[str, dict[str, Any]] = {}
    for fila, nombre_modulo in filas:
        grupo = por_modulo.setdefault(
            fila.module_code,
            {"module_code": fila.module_code, "module_nombre": nombre_modulo, "tramos": []},
        )
        grupo["tramos"].append(_tramo(fila, nombres, correos))
    return list(por_modulo.values())


def historial_de_usuario(db: DbSession, user_id: uuid.UUID) -> list[dict[str, Any]]:
    """Toda la trayectoria de UNA persona: cada rol que tuvo, dónde y cuándo."""
    nombres = _nombres(db)
    correos = dict(db.execute(select(User.id, User.email)).all())
    modulos = dict(db.execute(select(Module.code, Module.nombre)).all())
    persona = db.get(User, user_id)
    de_aseguradora = persona is not None and persona.aseguradora_id is not None
    salida = []
    for fila in db.scalars(
        select(HistorialAcceso).where(HistorialAcceso.user_id == user_id)
        .order_by(HistorialAcceso.desde.desc())
    ):
        tramo = _tramo(fila, nombres, correos, de_aseguradora)
        tramo["donde"] = (
            modulos.get(fila.module_code, fila.module_code) if fila.ambito == "aplicacion"
            else ETIQUETA_ROL.get(fila.funcion, fila.funcion) if fila.ambito == "funcion"
            else "Supervisión de la compañía"
        )
        tramo["ambito"] = fila.ambito
        salida.append(tramo)
    return salida


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
    """A qué entra HOY: sus aplicaciones con su rol, su función, y un resumen."""
    aplicaciones = [
        {"module_code": c, "module_nombre": n, "rol": ROL_DE_CODIGO.get(code, code)}
        for c, n, code in db.execute(
            select(UserModuleAccess.module_code, Module.nombre, Role.code)
            .join(Module, Module.code == UserModuleAccess.module_code)
            .join(Role, Role.id == UserModuleAccess.role_id)
            .where(
                UserModuleAccess.user_id == user_id,
                UserModuleAccess.activo.is_(True),
                Module.activo.is_(True),
            )
            .order_by(Module.orden, Module.nombre)
        ).all()
    ]
    funcion = funcion_de(db, user_id)
    persona = db.get(User, user_id)
    de_aseguradora = persona is not None and persona.aseguradora_id is not None
    partes: dict[str, list[str]] = {}
    for a in aplicaciones:
        partes.setdefault(etiqueta_rol(a["rol"], de_aseguradora), []).append(a["module_nombre"])
    resumen = [f"{rol} de {', '.join(apps)}" for rol, apps in partes.items()]
    if funcion:
        resumen.append(ETIQUETA_FUNCION.get(funcion, funcion))
    return {
        "aplicaciones": aplicaciones,
        "funcion": funcion,
        "resumen": " · ".join(resumen) or "Sin acceso",
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
