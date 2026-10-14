from __future__ import annotations

import datetime as dt
import uuid
from pathlib import Path

import magic
from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    File,
    HTTPException,
    Query,
    Request,
    UploadFile,
    status,
)
from fastapi.responses import FileResponse, Response
from sqlalchemy.orm import Session as DbSession

from app.core.central import CentralError
from app.core.config import settings
from app.core.db import get_db
from app.core.logging import log
from app.core.security.deps import (
    AuthContext,
    require_module_access,
    require_permission,
    verificar_csrf,
)
from app.modules.concurrencia import central as central_conc
from app.modules.concurrencia import (
    firma,
    informes,
    notificaciones,
    nucleo,
    permissions,
    service,
    transcripcion,
)
from app.modules.concurrencia import informe as informe_ia
from app.modules.concurrencia import pdf as informe_pdf
from app.modules.concurrencia.schemas import (
    AseguradoraElegible,
    AsignarAuditorRequest,
    AuditorElegible,
    CifrasVisitasOut,
    ContactoElegible,
    CorregirInformeRequest,
    CorreoPorDefecto,
    CorreoVisita,
    DashboardOut,
    FiltrosSupervision,
    FotoOut,
    InformeOut,
    NotaCrear,
    NotaOut,
    OperadorElegible,
    PacienteConocido,
    PacienteRegistrado,
    PaginaPacientes,
    PaginaSupervision,
    PaginaVisitas,
    PanelAuditorOut,
    PersonaDelFiltro,
    PrestadorElegible,
    ProrrogaOut,
    ProrrogaRequest,
    ReprogramarRequest,
    SedeElegible,
    SlaDelModulo,
    VisitaActualizar,
    VisitaCrear,
    VisitaCrearSupervision,
    VisitaDetalle,
    VisitaResumen,
    VisitaSupervisionDetalle,
    VisitaSupervisionResumen,
)
from app.shared import personas
from app.shared.aseguradoras.logo import MIME_PERMITIDOS
from app.shared.audit import service as audit

# La dependencia va a nivel de APIRouter, no por endpoint: cualquier endpoint que
# se anada aqui nace protegido por el acceso al modulo. El slug es la identidad
# publica; la traduccion a `code` la hace la dependencia contra la tabla modules.
router = APIRouter(
    prefix="/concurrencia",
    tags=["concurrencia"],
    dependencies=[Depends(require_module_access("concurrencia"))],
)


def _aseguradora_de(ctx: AuthContext) -> uuid.UUID:
    """
    Todo lo de este módulo se acota a la compañía del usuario. Un administrador
    global no llega hasta aquí —no tiene acceso a módulos por implicación, D-10—,
    así que si alguien sin aseguradora se cuela es un fallo y se corta.
    """
    if ctx.user.aseguradora_id is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="No autorizado")
    return ctx.user.aseguradora_id


def _aseguradora_operadora(ctx: AuthContext) -> uuid.UUID:
    """
    Como `_aseguradora_de`, pero para tocar el expediente. El supervisor de la
    compañía solo mira y supervisa: crear y editar visitas es trabajo del
    operador. El permiso no basta para distinguirlos —la fila del rol
    `supervisor` es la misma que usa el supervisor de plataforma, que sí edita
    en sus rutas de supervisión—, así que aquí cuenta también quién es, igual
    que en `_solo_supervision`, y recibe el mismo 403 genérico.
    """
    aseguradora_id = _aseguradora_de(ctx)
    if ctx.rol == "supervisor":
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="No autorizado")
    return aseguradora_id


def _autor_forzado(ctx: AuthContext) -> uuid.UUID | None:
    """
    Cada operador ve SU bandeja: los casos que él creó, y nada más. Solo el
    supervisor de la compañía ve los de todos. Devuelve el autor a imponer en
    las consultas —el propio usuario— o None cuando no hay que acotar. El caso
    de un compañero responde igual que si no existiera.
    """
    return None if ctx.rol == "supervisor" else ctx.user.id


def _solo_supervisor_de_compania(ctx: AuthContext) -> None:
    """
    El panel y sus piezas —cifras globales, lista de operadores— son del
    supervisor de la compañía: enseñan lo de todo el equipo, que es justo lo
    que un operador no debe ver. 403 genérico para el resto.
    """
    if ctx.rol != "supervisor":
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="No autorizado")


def _resumen(fila, *, interno: bool = False) -> VisitaResumen:
    (
        visita,
        prestador_nombre,
        prestador_direccion,
        prestador_ciudad,
        prestador_provincia,
        sede_nombre,
        sede_direccion,
        sede_ciudad,
        sede_provincia,
        # La consulta común trae también la compañía y el auditor; a la vista de
        # compañía le sobran, y la de supervisión los toma en su propio mapeo.
        _aseguradora_razon_social,
        _aseguradora_nombre_comercial,
        _auditor_nombre,
        total_correos,
    ) = fila
    return VisitaResumen(
        id=str(visita.id),
        codigo_interno=visita.codigo_interno,
        paciente_nombre_completo=personas.de_fila(visita, "paciente_"),
        paciente_tipo_documento_codigo=visita.paciente_tipo_documento_codigo,
        paciente_numero_documento=visita.paciente_numero_documento,
        prestador_id=str(visita.prestador_id),
        prestador_nombre=prestador_nombre,
        sede_id=str(visita.sede_id) if visita.sede_id else None,
        # Sin sede el destino es la casa matriz, y la ubicación es la del propio
        # prestador. Que `sede_nombre` venga nulo es lo que distingue un caso del
        # otro. La dirección del prestador es opcional; la ciudad va aparte para
        # que, cuando no haya calle, siga sabiéndose a dónde se va.
        sede_nombre=sede_nombre,
        lugar=sede_direccion if visita.sede_id else prestador_direccion,
        # Se resuelve por el destino entero, no campo a campo: si la visita es a
        # una sede, la ciudad es la suya aunque venga vacía, nunca la del
        # prestador. Mezclarlas mandaría al auditor a la otra punta del país.
        ciudad_nombre=sede_ciudad if visita.sede_id else prestador_ciudad,
        provincia_nombre=sede_provincia if visita.sede_id else prestador_provincia,
        desde=visita.desde,
        hasta=visita.hasta,
        llegada_limite=visita.llegada_limite,
        # `no_auditado` es interno: a la compañía se le enseña el estado que el
        # caso tenía al vencer (`service.estado_visible`).
        estado=service.estado_visible(visita.estado, visita.auditor_id, interno=interno),
        total_correos=total_correos,
    )


def _resumen_supervision(fila) -> VisitaSupervisionResumen:
    visita = fila[0]
    razon_social, nombre_comercial, auditor_nombre = fila[9:12]
    return VisitaSupervisionResumen(
        **_resumen(fila, interno=True).model_dump(),
        aseguradora_nombre=nombre_comercial or razon_social,
        auditor_id=str(visita.auditor_id) if visita.auditor_id else None,
        # `concat_ws` sobre un LEFT JOIN sin fila da cadena vacía, no NULL: sin
        # auditor derivado el campo tiene que viajar nulo.
        # Con auditor pero sin nombre (alguien que ya no aparece en el
        # directorio): nunca «Sin asignar», que mentiría sobre quién auditó.
        auditor_nombre=auditor_nombre or ("(usuario retirado)" if visita.auditor_id else None),
        tiene_informe=bool(visita.informe),
    )


def _solo_supervision(ctx: AuthContext) -> None:
    """
    La bandeja global es del personal de PLATAFORMA con rol supervisor. Un
    usuario de compañía —aunque sea supervisor de la suya— o un auditor reciben
    el mismo 403 genérico: no se les confirma qué existe detrás.
    """
    if ctx.user.aseguradora_id is not None or ctx.rol != "supervisor":
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="No autorizado")


@router.get("/status")
def estado(
    ctx: AuthContext = Depends(require_permission(permissions.VER_DASHBOARD)),
) -> dict:
    """Placeholder del modulo. Cero logica de negocio en esta iteracion."""
    return {
        "modulo": ctx.module_code,
        "nombre": "Concurrencia",
        "rol": ctx.rol,
        "permisos": ctx.permisos,
    }


@router.get("/dashboard", response_model=DashboardOut)
def dashboard(
    ctx: AuthContext = Depends(require_permission(permissions.VER_DASHBOARD)),
    db: DbSession = Depends(get_db),
) -> DashboardOut:
    """El panel del supervisor de la compañía, acotado a SU aseguradora."""
    aseguradora_id = _aseguradora_de(ctx)
    _solo_supervisor_de_compania(ctx)
    datos = service.resumen_dashboard(db, aseguradora_id)
    return DashboardOut(
        programadas=datos["programadas"],
        asignadas=datos["asignadas"],
        auditando=datos["auditando"],
        canceladas=datos["canceladas"],
        culminadas=datos["culminadas"],
        no_auditadas=datos["no_auditadas"],
        hoy=datos["hoy"],
        proximas=[_resumen(f) for f in datos["proximas"]],
    )


@router.get("/operadores", response_model=list[OperadorElegible])
def listar_operadores(
    ctx: AuthContext = Depends(require_permission(permissions.LEER_VISITA)),
    db: DbSession = Depends(get_db),
) -> list[OperadorElegible]:
    """Los operadores de MI aseguradora, para filtrar el historial por autor."""
    _solo_supervisor_de_compania(ctx)
    return [
        OperadorElegible(
            id=str(u.id),
            nombre_completo=personas.de_fila(u),
            email=u.email,
            # Vigente: activo Y operador de Concurrencia hoy. Quien ya no lo es
            # sigue en la lista (sus casos siguen a su nombre), marcado.
            activo=vigente,
        )
        for u, vigente in service.operadores_de_la_compania(db, _aseguradora_de(ctx))
    ]


@router.get("/prestadores", response_model=list[PrestadorElegible])
def listar_prestadores(
    search: str | None = Query(default=None, max_length=120),
    ctx: AuthContext = Depends(require_permission(permissions.LEER_VISITA)),
    db: DbSession = Depends(get_db),
) -> list[PrestadorElegible]:
    """
    Los prestadores de MI red, con sus sedes. Alimenta el formulario: se elige
    prestador y, si tiene sedes, a cuál de ellas va el médico auditor. Es
    lectura —permiso `visitas:leer`—: también lo necesita quien solo mira el
    caso, como el supervisor de la compañía, para pintar destino y contactos.
    """
    return _prestadores_elegibles(
        service.prestadores_de_la_red(db, _aseguradora_de(ctx), search=search)
    )


def _prestadores_elegibles(filas: list[dict]) -> list[PrestadorElegible]:
    """El mismo mapeo para la compañía y para la supervisión: no se duplica."""
    return [
        PrestadorElegible(
            id=str(fila["prestador"].id),
            codigo_interno=fila["prestador"].codigo_interno,
            nombre=fila["prestador"].nombre,
            tipo_nombre=fila["tipo_nombre"],
            direccion=fila["prestador"].direccion,
            ciudad_nombre=fila["ciudad_nombre"],
            provincia_nombre=fila["provincia_nombre"],
            sedes=[
                SedeElegible(
                    id=str(sede.id),
                    nombre=sede.nombre,
                    direccion=sede.direccion,
                    ciudad_nombre=ciudad,
                    provincia_nombre=provincia,
                    estado=sede.estado,
                )
                for sede, ciudad, provincia in fila["sedes"]
            ],
            contactos=[
                ContactoElegible(
                    id=str(c.id),
                    nombre_completo=personas.de_fila(c),
                    cargo=c.cargo,
                    email=c.email,
                )
                for c in fila["contactos"]
            ],
        )
        for fila in filas
    ]


@router.get("/pacientes", response_model=PaginaPacientes)
def listar_pacientes(
    search: str | None = Query(default=None, max_length=120),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=service.MAX_PAGE_SIZE),
    ctx: AuthContext = Depends(require_permission(permissions.LEER_VISITA)),
    db: DbSession = Depends(get_db),
) -> PaginaPacientes:
    """
    **Lo que este módulo aporta al listado de pacientes de la plataforma**: las
    personas que ha registrado, una por documento, de la A a la Z.

    Es de supervisión —la lista es de TODAS las compañías—, así que pasa por la
    misma puerta que la bandeja global: personal de plataforma con rol
    coordinador, o el administrador. Un usuario de compañía recibe el 403
    genérico de siempre.

    La lista común la compone `app/`: el núcleo no puede depender de las tablas
    de un módulo, así que cada uno expone la suya y la pantalla las junta.
    """
    _solo_supervision(ctx)
    filas, total = service.pacientes_registrados(
        db, search=search, page=page, page_size=page_size
    )
    return PaginaPacientes(
        items=[PacienteRegistrado(**f) for f in filas],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get("/pacientes/{tipo_documento}/{numero_documento}", response_model=PacienteRegistrado)
def obtener_paciente(
    tipo_documento: str,
    numero_documento: str,
    ctx: AuthContext = Depends(require_permission(permissions.LEER_VISITA)),
    db: DbSession = Depends(get_db),
) -> PacienteRegistrado:
    """
    Una persona en concreto, identificada por su documento: los mismos datos del
    listado. Si este módulo no la ha registrado nunca, `404` —que es lo que hay
    que decir: aquí no está—.
    """
    _solo_supervision(ctx)
    filas, _total = service.pacientes_registrados(
        db, documento=(tipo_documento, numero_documento), page_size=1
    )
    if not filas:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Paciente no encontrado")
    return PacienteRegistrado(**filas[0])


@router.get("/correos-por-defecto", response_model=list[CorreoPorDefecto])
def listar_correos_por_defecto(
    aseguradora_id: uuid.UUID | None = Query(default=None),
    ctx: AuthContext = Depends(require_permission(permissions.LEER_VISITA)),
    db: DbSession = Depends(get_db),
) -> list[CorreoPorDefecto]:
    """
    A quién se avisa SIEMPRE de un caso de esta compañía, además de los correos
    que se anoten: quien lo crea y las dos coordinaciones.

    Lo pide el formulario para enseñarlos al programar, deshabilitados. Sale de
    la MISMA función que usa el envío (`notificaciones.correos_por_defecto`), así
    que lo que se ve es exactamente lo que va a salir.

    `aseguradora_id` solo lo obedece la supervisión, que programa para
    cualquiera; a quien es de una compañía se le impone la suya, mire lo que mire.
    """
    if ctx.user.aseguradora_id is not None:
        aseguradora_id = ctx.user.aseguradora_id
    else:
        _solo_supervision(ctx)
        if aseguradora_id is None:
            return []
    return [
        CorreoPorDefecto(email=correo, quien=quien)
        for correo, quien in notificaciones.correos_por_defecto(db, aseguradora_id, ctx.user)
    ]


def _paciente_conocido(
    db: DbSession, ctx: AuthContext, aseguradora_id: uuid.UUID, tipo: str, numero: str
) -> PacienteConocido:
    """
    El paciente se busca PRIMERO en la central, que es el registro de pacientes
    de toda la plataforma (D49): si existe, su identidad autocompleta el
    formulario, venga de la app y la compañía que venga. La central solo
    devuelve nombres —nada de su historia— y audita quién buscó qué documento.

    Si la central no lo tiene (o no responde), se mira lo que ESTA compañía ya
    escribió en sus casos: un paciente aún no publicado, o la central caída.
    """
    if settings.central_configurada:
        try:
            identidad = central_conc.persona_en_central(tipo, numero, ctx.user.id)
        except CentralError as error:
            log.warning("paciente_central_sin_respuesta", estado=error.estado)
        else:
            if identidad is not None:
                return PacienteConocido(encontrado=True, origen="central", **identidad)
    visita = service.paciente_conocido(db, aseguradora_id, tipo, numero)
    if visita is None:
        return PacienteConocido(encontrado=False)
    return PacienteConocido(
        encontrado=True, origen="local", **personas.partes_de(visita, "paciente_")
    )


@router.get("/pacientes/buscar", response_model=PacienteConocido)
def buscar_paciente(
    tipo: str = Query(min_length=1, max_length=10),
    numero: str = Query(min_length=1, max_length=20),
    ctx: AuthContext = Depends(require_permission(permissions.LEER_VISITA)),
    db: DbSession = Depends(get_db),
) -> PacienteConocido:
    """
    ¿Este documento ya pasó por un caso de MI aseguradora? Autocompleta nombres
    y apellidos en el formulario. El ownership es el de siempre: solo se
    responde con lo que esta compañía ya escribió en sus propios casos.
    """
    return _paciente_conocido(db, ctx, _aseguradora_de(ctx), tipo, numero)


@router.get("/visitas", response_model=PaginaVisitas)
def listar_visitas(
    search: str | None = Query(default=None, max_length=120),
    estado: str | None = Query(
        default=None, pattern="^(programada|asignada|auditando|cancelada|culminada|no_auditado)$"
    ),
    desde: dt.date | None = Query(default=None),
    hasta: dt.date | None = Query(default=None),
    creado_por: uuid.UUID | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=service.MAX_PAGE_SIZE),
    ctx: AuthContext = Depends(require_permission(permissions.LEER_VISITA)),
    db: DbSession = Depends(get_db),
) -> PaginaVisitas:
    # Al operador se le impone su propia bandeja: el parámetro `creado_por` solo
    # obedece al supervisor de la compañía (su pestaña Operadores).
    forzado = _autor_forzado(ctx)
    if forzado is not None:
        creado_por = forzado
    filas, total = service.listar(
        db,
        _aseguradora_de(ctx),
        search=search,
        estado=estado,
        desde=desde,
        hasta=hasta,
        creado_por=creado_por,
        page=page,
        page_size=page_size,
    )
    return PaginaVisitas(
        items=[_resumen(f) for f in filas], total=total, page=page, page_size=page_size
    )


def _detalle(
    db: DbSession,
    aseguradora_id: uuid.UUID,
    visita_id: uuid.UUID,
    creado_por: uuid.UUID | None = None,
) -> VisitaDetalle:
    fila = service.obtener(db, aseguradora_id, visita_id, creado_por=creado_por)
    visita = fila[0]
    return VisitaDetalle(
        **_resumen(fila).model_dump(),
        # El detalle es lo que reabre el formulario: las cuatro partes, cada una
        # en su casilla.
        paciente_nombre_principal=visita.paciente_nombre_principal,
        paciente_nombre_secundario=visita.paciente_nombre_secundario,
        paciente_apellido_paterno=visita.paciente_apellido_paterno,
        paciente_apellido_materno=visita.paciente_apellido_materno,
        observaciones=fila[0].observaciones,
        correos=_correos_out(db, visita_id),
        tiene_informe=bool(fila[0].informe),
    )


def _correos_out(db: DbSession, visita_id: uuid.UUID) -> list[CorreoVisita]:
    """Los correos del caso con su etiqueta de quién es, para cualquier detalle."""
    return [
        CorreoVisita(email=c.email, etiqueta=c.etiqueta)
        for c in service.correos_detallados_de(db, visita_id)
    ]


@router.get("/visitas/{visita_id}", response_model=VisitaDetalle)
def obtener_visita(
    visita_id: uuid.UUID,
    ctx: AuthContext = Depends(require_permission(permissions.LEER_VISITA)),
    db: DbSession = Depends(get_db),
) -> VisitaDetalle:
    return _detalle(db, _aseguradora_de(ctx), visita_id, _autor_forzado(ctx))


@router.post("/visitas", response_model=VisitaDetalle, status_code=status.HTTP_201_CREATED)
def crear_visita(
    request: Request,
    datos: VisitaCrear,
    background: BackgroundTasks,
    ctx: AuthContext = Depends(require_permission(permissions.CREAR_VISITA)),
    _: None = Depends(verificar_csrf),
    db: DbSession = Depends(get_db),
) -> VisitaDetalle:
    aseguradora_id = _aseguradora_operadora(ctx)
    cuerpo = datos.model_dump()
    correos = [(c["email"], c["etiqueta"]) for c in cuerpo.pop("correos", [])]

    visita = service.crear(db, aseguradora_id, cuerpo, ctx.user.id)
    cambio_correos = service.fijar_correos(db, visita.id, correos, ctx.user.id)
    audit.registrar(
        db,
        accion="crear",
        request=request,
        user_id=ctx.user.id,
        session_id=ctx.sesion.id,
        module_code=ctx.module_code,
        entidad="conc_visitas",
        entidad_id=str(visita.id),
        detalle={
            "despues": {
                "codigo_interno": visita.codigo_interno,
                "prestador_id": str(visita.prestador_id),
                "sede_id": str(visita.sede_id) if visita.sede_id else None,
                "correos": cambio_correos,
            }
        },
    )
    # La campana del coordinador, en la MISMA transacción que el caso: si el
    # guardado se cae, tampoco queda el aviso de algo que no existe. El correo,
    # en cambio, sale después de responder: es irreversible y lento.
    notificaciones.avisar_en_campana(db, visita)
    db.commit()
    # El paciente queda en la central (registro de pacientes, D49) en el momento.
    background.add_task(central_conc.publicar_ya, visita.id)

    # DESPUÉS de responder, y solo en el alta: el aviso con los datos exactos va
    # a cada correo de la visita —marcados y tecleados por igual— y al supervisor
    # de Concurrencia, que la verá en su bandeja para derivarla. Editar no
    # reenvía nada, y como el caso ya está creado y confirmado, ni un buzón que
    # rebote ni un SMTP caído tienen respuesta que romper.
    background.add_task(notificaciones.en_fondo, notificaciones.notificar_creacion, visita.id)
    return _detalle(db, aseguradora_id, visita.id)


# ─────────────────────── La bandeja del médico auditor ──────────────────────


@router.get("/auditor/visitas", response_model=list[VisitaSupervisionDetalle])
def mis_casos(
    ctx: AuthContext = Depends(require_permission(permissions.LEER_VISITA)),
    db: DbSession = Depends(get_db),
) -> list[VisitaSupervisionDetalle]:
    """
    Los casos derivados AL PROPIO usuario, completos —correos y observaciones—,
    para la app móvil del auditor. El ownership es `auditor_id = su id`: no
    recibe parámetros, así que no hay forma de pedir los casos de otro. Solo
    personal de plataforma: un usuario de compañía no tiene casos derivados y
    recibe el 403 genérico de siempre.
    """
    if ctx.user.aseguradora_id is not None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="No autorizado")
    filas = service.listar_del_auditor(db, ctx.user.id)
    # El punto exacto del destino viaja con cada caso: la app abre el mapa con
    # él, sin adivinar por la dirección escrita.
    coordenadas = service.coordenadas_de_destinos(db, [f[0] for f in filas])
    salida: list[VisitaSupervisionDetalle] = []
    for fila in filas:
        visita = fila[0]
        punto = coordenadas.get(visita.id)
        salida.append(
            VisitaSupervisionDetalle(
                **_resumen_supervision(fila).model_dump(),
                **personas.partes_prefijadas(visita, "paciente_"),
                observaciones=visita.observaciones,
                correos=_correos_out(db, visita.id),
                tiene_comprobante=bool(visita.comprobante_horario_path),
                destino_latitud=punto[0] if punto else None,
                destino_longitud=punto[1] if punto else None,
            )
        )
    return salida


def _caso_del_auditor(ctx: AuthContext, db: DbSession, visita_id: uuid.UUID):
    """
    La doble puerta del panel del auditor: personal de plataforma y caso
    derivado A ÉL. El de otro auditor —o el de nadie— es un 404 idéntico.
    """
    if ctx.user.aseguradora_id is not None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="No autorizado")
    return service.visita_del_auditor(db, visita_id, ctx.user.id)


def _nota_out(nota) -> NotaOut:
    return NotaOut(
        id=str(nota.id), tipo=nota.tipo, texto=nota.texto, creada_at=nota.created_at
    )


@router.get("/auditor/visitas/{visita_id}/panel", response_model=PanelAuditorOut)
def panel_del_caso(
    visita_id: uuid.UUID,
    ctx: AuthContext = Depends(require_permission(permissions.LEER_VISITA)),
    db: DbSession = Depends(get_db),
) -> PanelAuditorOut:
    """El panel del caso en la app: las notas dictadas y el informe vigente."""
    visita = _caso_del_auditor(ctx, db, visita_id)
    return PanelAuditorOut(
        notas=[_nota_out(n) for n in service.notas_de(db, visita.id)],
        fotos=[
            FotoOut(id=str(f.id), creada_at=f.created_at)
            for f in service.fotos_de(db, visita.id)
        ],
        informe=visita.informe,
        informe_actualizado_at=visita.informe_actualizado_at,
        llegada_at=visita.llegada_at,
    )


@router.post("/auditor/visitas/{visita_id}/llegada")
def registrar_llegada(
    request: Request,
    visita_id: uuid.UUID,
    ctx: AuthContext = Depends(require_permission(permissions.LEER_VISITA)),
    _: None = Depends(verificar_csrf),
    db: DbSession = Depends(get_db),
) -> dict[str, dt.datetime]:
    """
    El botón «Ya llegué» de la app: deja constancia en el servidor de que el
    auditor llegó al hospital. Es lo que evita que la tarea periódica marque el
    caso como no_auditado al vencer la ventana. Idempotente: la primera llegada
    es la que vale.
    """
    visita = _caso_del_auditor(ctx, db, visita_id)
    # `auditando` entra aquí para que siga siendo IDEMPOTENTE: pulsar dos veces
    # «Ya llegué» —o reintentar con mala cobertura— no puede dar error, porque
    # la primera llegada ya dejó el caso en ese estado. Lo demás sí se corta.
    if visita.estado not in ("asignada", "auditando"):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail="El caso ya no está pendiente: no se puede registrar la llegada",
        )
    if visita.llegada_at is None:
        visita.llegada_at = dt.datetime.now(dt.UTC)
        # Llegar ES empezar a auditar: el estado lo pone esta acción, nadie lo
        # elige. A partir de aquí el caso ya no puede cancelarse ni vencer.
        visita.estado = "auditando"
        visita.updated_by = ctx.user.id
        # Y se entera todo el mundo: el operador que lo programó y las dos
        # coordinaciones. En la misma transacción, como todos los avisos de
        # campana. Al auditor no: lo acaba de hacer él.
        notificaciones.avisar_llegada_en_campana(db, visita)
        audit.registrar(
            db,
            accion="llegada_registrada",
            request=request,
            user_id=ctx.user.id,
            session_id=ctx.sesion.id,
            module_code=ctx.module_code,
            entidad="conc_visitas",
            entidad_id=str(visita.id),
            detalle={"visita": visita.codigo_interno},
        )
        db.commit()
    return {"llegada_at": visita.llegada_at}


@router.post(
    "/auditor/visitas/{visita_id}/notas",
    response_model=NotaOut,
    status_code=status.HTTP_201_CREATED,
)
def crear_nota(
    request: Request,
    visita_id: uuid.UUID,
    datos: NotaCrear,
    ctx: AuthContext = Depends(require_permission(permissions.LEER_VISITA)),
    _: None = Depends(verificar_csrf),
    db: DbSession = Depends(get_db),
) -> NotaOut:
    """Un dictado más del auditor. El texto NUNCA viaja al log: es dato clínico."""
    visita = _caso_del_auditor(ctx, db, visita_id)
    nota = service.crear_nota(db, visita.id, datos.tipo, datos.texto, ctx.user.id)
    audit.registrar(
        db,
        accion="nota_creada",
        request=request,
        user_id=ctx.user.id,
        session_id=ctx.sesion.id,
        module_code=ctx.module_code,
        entidad="conc_visita_notas",
        entidad_id=str(nota.id),
        detalle={"visita": visita.codigo_interno, "tipo": nota.tipo, "longitud": len(nota.texto)},
    )
    db.commit()
    return _nota_out(nota)


@router.delete(
    "/auditor/visitas/{visita_id}/notas/{nota_id}", status_code=status.HTTP_204_NO_CONTENT
)
def eliminar_nota(
    request: Request,
    visita_id: uuid.UUID,
    nota_id: uuid.UUID,
    ctx: AuthContext = Depends(require_permission(permissions.LEER_VISITA)),
    _: None = Depends(verificar_csrf),
    db: DbSession = Depends(get_db),
) -> None:
    visita = _caso_del_auditor(ctx, db, visita_id)
    nota = service.eliminar_nota(db, visita.id, nota_id, ctx.user.id)
    audit.registrar(
        db,
        accion="nota_eliminada",
        request=request,
        user_id=ctx.user.id,
        session_id=ctx.sesion.id,
        module_code=ctx.module_code,
        entidad="conc_visita_notas",
        entidad_id=str(nota.id),
        detalle={"visita": visita.codigo_interno, "tipo": nota.tipo, "longitud": len(nota.texto)},
    )
    db.commit()


@router.post(
    "/auditor/visitas/{visita_id}/fotos",
    response_model=FotoOut,
    status_code=status.HTTP_201_CREATED,
)
async def subir_foto(
    request: Request,
    visita_id: uuid.UUID,
    archivo: UploadFile = File(...),
    ctx: AuthContext = Depends(require_permission(permissions.LEER_VISITA)),
    _: None = Depends(verificar_csrf),
    db: DbSession = Depends(get_db),
) -> FotoOut:
    """
    Una foto tomada en el hospital: expediente, resultados, estado de cuenta.
    Mismas reglas que toda subida (A08): MIME real con python-magic, tope de
    tamaño, nombre propio con UUID y archivo fuera del árbol ejecutable. El
    tope además garantiza que la imagen quepa tal cual en la API de Claude,
    que admite hasta 5 MB por imagen.
    """
    visita = _caso_del_auditor(ctx, db, visita_id)

    maximo = min(settings.upload_max_size_mb, 5) * 1024 * 1024
    contenido = bytearray()
    while trozo := await archivo.read(64 * 1024):
        contenido.extend(trozo)
        if len(contenido) > maximo:
            raise HTTPException(
                status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail="La foto no puede superar 5 MB",
            )
    if not contenido:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="El archivo está vacío")

    mime = magic.from_buffer(bytes(contenido[:2048]), mime=True)
    if mime not in MIME_PERMITIDOS:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="La foto debe ser una imagen PNG, JPEG o WebP",
        )

    destino_rel = f"concurrencia/fotos/{visita.id}/{uuid.uuid4()}{MIME_PERMITIDOS[mime]}"
    destino = Path(settings.upload_dir) / destino_rel
    destino.parent.mkdir(parents=True, exist_ok=True)
    destino.write_bytes(bytes(contenido))

    foto = service.crear_foto(db, visita.id, destino_rel, ctx.user.id)
    audit.registrar(
        db,
        accion="foto_subida",
        request=request,
        user_id=ctx.user.id,
        session_id=ctx.sesion.id,
        module_code=ctx.module_code,
        entidad="conc_visita_fotos",
        entidad_id=str(foto.id),
        detalle={"visita": visita.codigo_interno, "mime": mime, "bytes": len(contenido)},
    )
    db.commit()
    return FotoOut(id=str(foto.id), creada_at=foto.created_at)


@router.get("/auditor/visitas/{visita_id}/fotos/{foto_id}")
def ver_foto(
    visita_id: uuid.UUID,
    foto_id: uuid.UUID,
    ctx: AuthContext = Depends(require_permission(permissions.LEER_VISITA)),
    db: DbSession = Depends(get_db),
) -> FileResponse:
    """La imagen para las miniaturas de la app, con su ownership de siempre."""
    visita = _caso_del_auditor(ctx, db, visita_id)
    foto = next((f for f in service.fotos_de(db, visita.id) if f.id == foto_id), None)
    if foto is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Foto no encontrada")
    ruta = Path(settings.upload_dir) / foto.ruta
    if not ruta.is_file():
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Foto no encontrada")
    tipo = next(
        (m for m, ext in MIME_PERMITIDOS.items() if ruta.suffix == ext),
        "application/octet-stream",
    )
    return FileResponse(
        ruta,
        media_type=tipo,
        headers={"X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store"},
    )


@router.delete(
    "/auditor/visitas/{visita_id}/fotos/{foto_id}", status_code=status.HTTP_204_NO_CONTENT
)
def eliminar_foto(
    request: Request,
    visita_id: uuid.UUID,
    foto_id: uuid.UUID,
    ctx: AuthContext = Depends(require_permission(permissions.LEER_VISITA)),
    _: None = Depends(verificar_csrf),
    db: DbSession = Depends(get_db),
) -> None:
    visita = _caso_del_auditor(ctx, db, visita_id)
    foto = service.eliminar_foto(db, visita.id, foto_id, ctx.user.id)
    audit.registrar(
        db,
        accion="foto_eliminada",
        request=request,
        user_id=ctx.user.id,
        session_id=ctx.sesion.id,
        module_code=ctx.module_code,
        entidad="conc_visita_fotos",
        entidad_id=str(foto.id),
        detalle={"visita": visita.codigo_interno},
    )
    db.commit()


# Lo que graba el teléfono (m4a/aac) y lo que podría llegar de otros clientes.
# libmagic ve el contenedor MP4 de un m4a como audio/mp4 o video/mp4.
MIMES_DICTADO = {
    "audio/mp4",
    "video/mp4",
    "audio/aac",
    "audio/x-m4a",
    "audio/mpeg",
    "audio/wav",
    "audio/x-wav",
    "audio/webm",
    "video/webm",
    "audio/ogg",
}


@router.post("/auditor/visitas/{visita_id}/dictado")
def transcribir_dictado(
    visita_id: uuid.UUID,
    archivo: UploadFile = File(...),
    ctx: AuthContext = Depends(require_permission(permissions.LEER_VISITA)),
    _: None = Depends(verificar_csrf),
    db: DbSession = Depends(get_db),
) -> dict[str, str]:
    """
    El micrófono de la app: recibe el audio dictado y devuelve su texto,
    transcrito LOCALMENTE con Whisper —el audio clínico no sale del servidor y
    no se conserva: se borra apenas transcrito—. No persiste nada por sí mismo:
    la nota se guarda cuando el auditor la confirma en su endpoint.
    """
    _caso_del_auditor(ctx, db, visita_id)

    tope = settings.upload_max_size_mb * 1024 * 1024
    datos = archivo.file.read(tope + 1)
    if len(datos) > tope:
        raise HTTPException(
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"El dictado supera el máximo de {settings.upload_max_size_mb} MB",
        )
    mime = magic.from_buffer(datos, mime=True)
    if mime not in MIMES_DICTADO:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="El archivo no es un audio válido",
        )

    # A un archivo temporal propio, nunca con el nombre que mandó el cliente.
    ruta = Path(settings.upload_dir) / f"dictado-{uuid.uuid4()}.tmp"
    ruta.write_bytes(datos)
    try:
        texto = transcripcion.transcribir(str(ruta))
    finally:
        ruta.unlink(missing_ok=True)
    return {"texto": texto}


@router.post("/auditor/visitas/{visita_id}/informe", response_model=InformeOut)
def generar_informe(
    request: Request,
    visita_id: uuid.UUID,
    ctx: AuthContext = Depends(require_permission(permissions.LEER_VISITA)),
    _: None = Depends(verificar_csrf),
    db: DbSession = Depends(get_db),
) -> InformeOut:
    """
    Redacta (o reescribe) el informe del caso con la IA a partir de las notas
    dictadas. La regla: el informe exige LAS TRES notas —historial clínico,
    charla con médico y observación—; sin el cuadro completo no hay análisis
    que valga. Primero se habla con Claude y solo si
    responde se guarda: un fallo de la IA no deja nada a medias.
    """
    visita = _caso_del_auditor(ctx, db, visita_id)
    notas = service.notas_de(db, visita.id)
    presentes = {n.tipo for n in notas}
    faltantes = [t for t in informe_ia.ETIQUETA_TIPO if t not in presentes]
    if faltantes:
        nombres = ", ".join(informe_ia.ETIQUETA_TIPO[t] for t in faltantes)
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"El informe exige las tres notas del caso. Falta dictar: {nombres}",
        )

    # Las fotos del caso acompañan a las notas: la IA las lee e incorpora al
    # análisis lo que se vea con claridad. Cada una se normaliza al tamaño que
    # la API de visión usa de verdad (informe.preparar_foto): sin eso, varias
    # fotos grandes del teléfono tumbaban el request entero. Una borrada del
    # disco, o rota, no frena nada.
    fotos: list[tuple[str, str]] = []
    for foto in service.fotos_de(db, visita.id):
        ruta = Path(settings.upload_dir) / foto.ruta
        if not ruta.is_file():
            continue
        preparada = informe_ia.preparar_foto(ruta.read_bytes())
        if preparada is not None:
            fotos.append(preparada)

    # Los mismos datos exactos que viajan en los correos del caso.
    fila = service.fila_supervision(db, visita.id)
    datos_caso = "\n".join(notificaciones._datos_del_caso(fila))  # noqa: SLF001 - mismo módulo
    texto = informe_ia.redactar(datos_caso, [(n.tipo, n.texto) for n in notas], fotos)
    # La firma la pone el sistema con la identidad REAL del auditor, no la IA.
    texto += (
        "\n\nResponsable de Auditoría Concurrente\n"
        f"{personas.de_fila(ctx.user)} / Médico Auditor."
    )

    visita.informe = texto
    visita.informe_actualizado_at = dt.datetime.now(dt.UTC)
    visita.updated_by = ctx.user.id
    audit.registrar(
        db,
        accion="informe_generado",
        request=request,
        user_id=ctx.user.id,
        session_id=ctx.sesion.id,
        module_code=ctx.module_code,
        entidad="conc_visitas",
        entidad_id=str(visita.id),
        detalle={
            "visita": visita.codigo_interno,
            "notas": len(notas),
            "fotos": len(fotos),
            "longitud": len(texto),
            "modelo": settings.claude_model,
        },
    )
    db.commit()
    return InformeOut(informe=texto, informe_actualizado_at=visita.informe_actualizado_at)


# La firma que agrega el sistema; también es el marcador para quitarla antes de
# mandar el informe a corregir y volver a ponerla con el nombre real.
_MARCA_FIRMA = "Responsable de Auditoría Concurrente"


@router.post("/auditor/visitas/{visita_id}/informe/corregir", response_model=InformeOut)
def corregir_informe(
    request: Request,
    visita_id: uuid.UUID,
    datos: CorregirInformeRequest,
    ctx: AuthContext = Depends(require_permission(permissions.LEER_VISITA)),
    _: None = Depends(verificar_csrf),
    db: DbSession = Depends(get_db),
) -> InformeOut:
    """
    Corrige el informe con lo que el auditor dicta tras revisarlo: «la edad es
    54», «que diga X en vez de Y». Sus correcciones son la autoridad —vienen del
    médico— y la IA cambia SOLO lo pedido; el resto queda palabra por palabra.
    """
    visita = _caso_del_auditor(ctx, db, visita_id)
    if not visita.informe:
        raise HTTPException(
            status.HTTP_409_CONFLICT, detail="El caso aún no tiene informe que corregir"
        )
    instrucciones = datos.instrucciones.strip()
    if not instrucciones:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY, detail="No dictaste ninguna corrección"
        )

    # La firma no viaja a la IA: se quita aquí y se vuelve a poner con el
    # nombre real, para que ninguna corrección pueda tocarla.
    cuerpo_informe = visita.informe
    pos = cuerpo_informe.rfind(_MARCA_FIRMA)
    if pos != -1:
        cuerpo_informe = cuerpo_informe[:pos].rstrip()

    texto = informe_ia.corregir(cuerpo_informe, instrucciones)
    texto += (
        f"\n\n{_MARCA_FIRMA}\n"
        f"{personas.de_fila(ctx.user)} / Médico Auditor."
    )

    visita.informe = texto
    visita.informe_actualizado_at = dt.datetime.now(dt.UTC)
    visita.updated_by = ctx.user.id
    audit.registrar(
        db,
        accion="informe_corregido",
        request=request,
        user_id=ctx.user.id,
        session_id=ctx.sesion.id,
        module_code=ctx.module_code,
        entidad="conc_visitas",
        entidad_id=str(visita.id),
        # Solo longitudes: las correcciones son dato clínico y no van al log.
        detalle={
            "visita": visita.codigo_interno,
            "longitud_correcciones": len(instrucciones),
            "longitud": len(texto),
            "modelo": settings.claude_model,
        },
    )
    db.commit()
    return InformeOut(informe=texto, informe_actualizado_at=visita.informe_actualizado_at)


def _pdf_del_caso(db: DbSession, visita) -> bytes:
    """
    El informe vigente como PDF con —si el certificado de la empresa está
    configurado— la firma electrónica PAdES y su sello QR.
    Todos los PDF del informe salen por aquí, así que todos salen firmados.
    Sin informe, 404.
    """
    if not visita.informe:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="El caso aún no tiene informe")
    informe = informe_pdf.generar_pdf(visita.informe, visita.codigo_interno)
    return firma.firmar(informe.contenido, caja=informe.caja_sello)


def _respuesta_pdf(contenido: bytes, codigo_interno: str) -> Response:
    return Response(
        content=contenido,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'inline; filename="informe-{codigo_interno}.pdf"',
            "X-Content-Type-Options": "nosniff",
            "Cache-Control": "private, no-store",
        },
    )


@router.get("/auditor/visitas/{visita_id}/informe.pdf")
def informe_en_pdf(
    visita_id: uuid.UUID,
    ctx: AuthContext = Depends(require_permission(permissions.LEER_VISITA)),
    db: DbSession = Depends(get_db),
) -> Response:
    """
    El informe vigente como PDF con la marca, renderizado AL VUELO desde el
    texto guardado: no se persiste ningún archivo. Sin informe todavía, 404.
    """
    visita = _caso_del_auditor(ctx, db, visita_id)
    return _respuesta_pdf(_pdf_del_caso(db, visita), visita.codigo_interno)


@router.post("/auditor/visitas/{visita_id}/informe/enviar")
def enviar_informe(
    request: Request,
    visita_id: uuid.UUID,
    background: BackgroundTasks,
    ctx: AuthContext = Depends(require_permission(permissions.LEER_VISITA)),
    _: None = Depends(verificar_csrf),
    db: DbSession = Depends(get_db),
) -> dict[str, int]:
    """
    El botón «Enviar informe» del auditor: manda el PDF adjunto a TODOS los
    correos marcados del caso. Las validaciones responden al instante; los
    correos salen DESPUÉS de responder, como todos los avisos —mandarlos dentro
    del request retenía la respuesta hasta el 504 de nginx en redes con el SMTP
    lento, y cada reintento del botón duplicaba el envío—. Primero queda la
    huella en AuditLog; cada correo va aislado y deja la suya en el log.
    """
    visita = _caso_del_auditor(ctx, db, visita_id)
    contenido = _pdf_del_caso(db, visita)
    correos = service.correos_de(db, visita.id)
    if not correos:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="El caso no tiene correos marcados a los que enviar el informe",
        )
    # La cuenta que se responde es la REAL: correos del caso + operador creador
    # + supervisores, ya sin repetidos — la misma lista que usará el envío.
    destinatarios, _ = notificaciones._destinatarios_del_caso(db, visita)  # noqa: SLF001

    # Enviar el informe ES terminar el trabajo: el caso que se estaba auditando
    # —o el que se derivó y se audita sin haber marcado la llegada— pasa a
    # culminada aquí mismo, y así la ve la aseguradora en su panel. Los otros
    # estados no se tocan: enviar no resucita una cancelada ni una no auditada.
    estado_anterior = visita.estado
    if visita.estado in ("asignada", "auditando"):
        visita.estado = "culminada"
        visita.updated_by = ctx.user.id
        # Y se enteran los tres: el operador que lo programó y las dos
        # coordinaciones. En la misma transacción, como todos los avisos de
        # campana; el correo con el PDF sale después y a más gente.
        notificaciones.avisar_culminacion_en_campana(db, visita)

    # Lo entregado queda guardado TAL CUAL (D3): el correo adjunta estos mismos
    # bytes, y es lo único del caso que otra app podrá ver (enlace de la central).
    entrega = informes.guardar_entrega(db, visita, contenido, ctx.user.id)

    audit.registrar(
        db,
        accion="informe_enviado",
        request=request,
        user_id=ctx.user.id,
        session_id=ctx.sesion.id,
        module_code=ctx.module_code,
        entidad="conc_visitas",
        entidad_id=str(visita.id),
        detalle={
            "visita": visita.codigo_interno,
            "destinatarios": len(destinatarios),
            "longitud": len(visita.informe or ""),
            "estado": {"antes": estado_anterior, "despues": visita.estado},
            "entrega": {"id": str(entrega.id), "numero": entrega.numero, "sha256": entrega.sha256},
        },
    )
    db.commit()

    background.add_task(
        notificaciones.en_fondo, notificaciones.enviar_informe, visita.id, contenido
    )
    return {"destinatarios": len(destinatarios)}


@router.get("/visitas/{visita_id}/informe.pdf")
def informe_pdf_compania(
    visita_id: uuid.UUID,
    ctx: AuthContext = Depends(require_permission(permissions.LEER_VISITA)),
    db: DbSession = Depends(get_db),
) -> Response:
    """El PDF para la compañía, con su ownership de siempre: el operador solo
    el de sus casos; el supervisor de la compañía, todos los suyos."""
    fila = service.obtener(db, _aseguradora_de(ctx), visita_id, creado_por=_autor_forzado(ctx))
    return _respuesta_pdf(_pdf_del_caso(db, fila[0]), fila[0].codigo_interno)


@router.get("/supervision/visitas/{visita_id}/informe.pdf")
def informe_pdf_supervision(
    visita_id: uuid.UUID,
    ctx: AuthContext = Depends(require_permission(permissions.LEER_VISITA)),
    db: DbSession = Depends(get_db),
) -> Response:
    """El PDF para la supervisión de plataforma (y el panel de Auditorías)."""
    _solo_supervision(ctx)
    fila = service.fila_supervision(db, visita_id)
    return _respuesta_pdf(_pdf_del_caso(db, fila[0]), fila[0].codigo_interno)


# ────────────────── Supervisión de plataforma: derivar casos ─────────────────


@router.get("/supervision/visitas", response_model=PaginaSupervision)
def listar_supervision(
    search: str | None = Query(default=None, max_length=120),
    estado: str | None = Query(
        default=None, pattern="^(programada|asignada|auditando|cancelada|culminada|no_auditado)$"
    ),
    sin_asignar: bool = Query(default=False),
    desde: dt.date | None = Query(default=None),
    hasta: dt.date | None = Query(default=None),
    # Los casos de UNA persona, para su ficha de paciente. Los dos juntos o
    # ninguno: media identificación no identifica a nadie.
    paciente_tipo_documento: str | None = Query(default=None, max_length=10),
    paciente_numero_documento: str | None = Query(default=None, max_length=20),
    # Trazabilidad: los casos de UNA compañía y/o en los que intervino UNA
    # persona del personal, aunque ya no esté en Concurrencia.
    aseguradora_id: uuid.UUID | None = Query(default=None),
    persona_id: uuid.UUID | None = Query(default=None),
    usuario_id: uuid.UUID | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=service.MAX_PAGE_SIZE),
    ctx: AuthContext = Depends(require_permission(permissions.LEER_VISITA)),
    db: DbSession = Depends(get_db),
) -> PaginaSupervision:
    """
    Los casos de TODAS las aseguradoras, para derivarlos. Solo supervisión.

    `desde` y `hasta` acotan por la ventana de la visita y con las mismas reglas
    que en la bandeja de la compañía: entra la que toque cualquier día del rango.
    """
    _solo_supervision(ctx)
    documento = (
        (paciente_tipo_documento, paciente_numero_documento)
        if paciente_tipo_documento and paciente_numero_documento
        else None
    )
    filas, total = service.listar_supervision(
        db,
        search=search,
        estado=estado,
        sin_asignar=sin_asignar,
        desde=desde,
        hasta=hasta,
        documento=documento,
        aseguradora_id=aseguradora_id,
        persona_id=persona_id,
        usuario_id=usuario_id,
        page=page,
        page_size=page_size,
    )
    return PaginaSupervision(
        items=[_resumen_supervision(f) for f in filas],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get("/supervision/filtros", response_model=FiltrosSupervision)
def filtros_supervision(
    ctx: AuthContext = Depends(require_permission(permissions.LEER_VISITA)),
    db: DbSession = Depends(get_db),
) -> FiltrosSupervision:
    """
    Los selectores de trazabilidad de la bandeja: **todo el personal que está o
    estuvo en Concurrencia** (coordinadores, auditores, call center y el
    administrador si intervino), y las compañías con Concurrencia o con casos.
    En medicina no se borra nada: quien se fue sigue en la lista, marcado.
    """
    _solo_supervision(ctx)
    from app.shared.users.service import ETIQUETA_ROL

    tramos = service.tramos_en_concurrencia(db)
    con_tramo, intervinieron = service.ids_del_personal(db)
    personal: list[PersonaDelFiltro] = []
    for u in nucleo.usuarios_por_ids(db, sorted(con_tramo | intervinieron)):
        # El personal de las compañías no entra: para eso está el filtro de aseguradora.
        if u.aseguradora_id is not None:
            continue
        # Las cuentas dadas de baja (las de las pruebas automáticas) solo salen
        # si tocaron algún caso; un desactivado sale siempre.
        if u.deleted_at is not None and u.id not in intervinieron:
            continue
        suyos = tramos.get(u.id, [])
        activo = bool(u.is_active) and u.deleted_at is None
        abiertos = [t for t in suyos if t.hasta is None]
        vigente = activo and (bool(abiertos) or bool(u.is_superadmin))
        roles = list(dict.fromkeys(ETIQUETA_ROL.get(t.rol, t.rol) for t in (abiertos or suyos)))
        if u.is_superadmin:
            roles.insert(0, "Administrador")
        if vigente:
            detalle = " · ".join(roles) or "Personal"
        else:
            ultimo = max((t.hasta for t in suyos if t.hasta), default=None)
            cuando = f" hasta {ultimo:%d/%m/%Y}" if ultimo else ""
            detalle = f"{' · '.join(roles) or 'Personal'} · ya no está{cuando}"
        personal.append(
            PersonaDelFiltro(
                id=str(u.id),
                nombre_completo=personas.de_fila(u),
                detalle=detalle,
                vigente=vigente,
            )
        )
    personal.sort(key=lambda p: (not p.vigente, p.nombre_completo))

    aseguradoras = {
        a.id: a.nombre_comercial or a.razon_social
        for a in service.aseguradoras_con_concurrencia(db)
    }
    for aseguradora_id in service.aseguradoras_con_casos(db):
        if aseguradora_id not in aseguradoras:
            a = nucleo.aseguradora(db, aseguradora_id)
            if a is not None:
                aseguradoras[aseguradora_id] = a.nombre_comercial or a.razon_social
    return FiltrosSupervision(
        personal=personal,
        aseguradoras=sorted(
            (AseguradoraElegible(id=str(i), nombre=n) for i, n in aseguradoras.items()),
            key=lambda a: a.nombre,
        ),
    )


@router.get(
    "/supervision/filtros/aseguradoras/{aseguradora_id}/usuarios",
    response_model=list[PersonaDelFiltro],
)
def usuarios_de_aseguradora_supervision(
    aseguradora_id: uuid.UUID,
    ctx: AuthContext = Depends(require_permission(permissions.LEER_VISITA)),
    db: DbSession = Depends(get_db),
) -> list[PersonaDelFiltro]:
    """
    El tercer selector de trazabilidad: los usuarios de ESA compañía que
    participaron en sus casos, aunque ya no estén (solo se les desactiva).
    """
    _solo_supervision(ctx)
    return [
        PersonaDelFiltro(
            id=str(u.id),
            nombre_completo=personas.de_fila(u),
            detalle=rol if vigente else f"{rol} · ya no está",
            vigente=vigente,
        )
        for u, vigente, rol in service.usuarios_de_la_aseguradora(db, aseguradora_id)
    ]


@router.get("/supervision/dashboard", response_model=CifrasVisitasOut)
def dashboard_supervision(
    ctx: AuthContext = Depends(require_permission(permissions.LEER_VISITA)),
    db: DbSession = Depends(get_db),
) -> CifrasVisitasOut:
    """
    Los cuadros del panel de supervisión: las mismas cifras que ve el supervisor
    de una compañía, pero de TODAS las aseguradoras. Misma puerta que el resto
    de la supervisión, ni una más.
    """
    _solo_supervision(ctx)
    return CifrasVisitasOut(**service.cifras_de_visitas(db))


@router.get("/supervision/visitas/{visita_id}", response_model=VisitaSupervisionDetalle)
def obtener_supervision(
    visita_id: uuid.UUID,
    ctx: AuthContext = Depends(require_permission(permissions.LEER_VISITA)),
    db: DbSession = Depends(get_db),
) -> VisitaSupervisionDetalle:
    """El caso entero, tal como lo capturó la compañía, para verlo tal cual."""
    _solo_supervision(ctx)
    fila = service.fila_supervision(db, visita_id)
    return VisitaSupervisionDetalle(
        **_resumen_supervision(fila).model_dump(),
        **personas.partes_prefijadas(fila[0], "paciente_"),
        observaciones=fila[0].observaciones,
        correos=_correos_out(db, visita_id),
        # `tiene_informe` ya viene del resumen de supervisión: repetirlo aquí
        # reventaba el alta del coordinador con un «multiple values».
        tiene_comprobante=bool(fila[0].comprobante_horario_path),
    )


@router.get("/supervision/auditores", response_model=list[AuditorElegible])
def listar_auditores(
    ctx: AuthContext = Depends(require_permission(permissions.EDITAR_VISITA)),
    db: DbSession = Depends(get_db),
) -> list[AuditorElegible]:
    """A quién se puede derivar: auditores de plataforma activos del módulo."""
    _solo_supervision(ctx)
    return [
        AuditorElegible(
            id=str(a.id),
            nombre_completo=personas.de_fila(a),
            ciudad_nombre=ciudad,
            provincia_nombre=provincia,
        )
        for a, ciudad, provincia in service.auditores_disponibles(db)
    ]


@router.get("/supervision/aseguradoras", response_model=list[AseguradoraElegible])
def listar_aseguradoras_supervision(
    ctx: AuthContext = Depends(require_permission(permissions.LEER_VISITA)),
    db: DbSession = Depends(get_db),
) -> list[AseguradoraElegible]:
    """
    Las compañías sobre las que el coordinador puede programar: activas y con
    Concurrencia habilitado. Primer paso de su formulario de alta.
    """
    _solo_supervision(ctx)
    return [
        AseguradoraElegible(id=str(a.id), nombre=a.nombre_comercial or a.razon_social)
        for a in service.aseguradoras_con_concurrencia(db)
    ]


@router.get(
    "/supervision/aseguradoras/{aseguradora_id}/prestadores",
    response_model=list[PrestadorElegible],
)
def prestadores_de_aseguradora(
    aseguradora_id: uuid.UUID,
    search: str | None = Query(default=None, max_length=120),
    ctx: AuthContext = Depends(require_permission(permissions.LEER_VISITA)),
    db: DbSession = Depends(get_db),
) -> list[PrestadorElegible]:
    """La red de ESA aseguradora, con sedes y contactos: el segundo paso."""
    _solo_supervision(ctx)
    return _prestadores_elegibles(
        service.prestadores_de_la_red(db, aseguradora_id, search=search)
    )


@router.get("/supervision/pacientes/buscar", response_model=PacienteConocido)
def buscar_paciente_supervision(
    aseguradora_id: uuid.UUID,
    tipo: str = Query(min_length=1, max_length=10),
    numero: str = Query(min_length=1, max_length=20),
    ctx: AuthContext = Depends(require_permission(permissions.LEER_VISITA)),
    db: DbSession = Depends(get_db),
) -> PacienteConocido:
    """Lo mismo para el alta del coordinador, acotado a la aseguradora elegida."""
    _solo_supervision(ctx)
    return _paciente_conocido(db, ctx, aseguradora_id, tipo, numero)


@router.post(
    "/supervision/visitas",
    response_model=VisitaSupervisionDetalle,
    status_code=status.HTTP_201_CREATED,
)
def crear_visita_supervision(
    request: Request,
    datos: VisitaCrearSupervision,
    background: BackgroundTasks,
    ctx: AuthContext = Depends(require_permission(permissions.CREAR_VISITA)),
    _: None = Depends(verificar_csrf),
    db: DbSession = Depends(get_db),
) -> VisitaSupervisionDetalle:
    """
    El alta desde plataforma: al coordinador los pedidos le llegan por correo,
    así que elige la aseguradora y programa igual que un operador. El caso nace
    de esa compañía —su `aseguradora_id` es el ownership de siempre— y las
    validaciones son las mismas: prestador con convenio vigente de ESA red,
    sede suya, paciente completo. Avisa por correo igual que el alta de
    compañía, con el coordinador etiquetado como quien creó el caso.
    """
    _solo_supervision(ctx)
    try:
        aseguradora_id = uuid.UUID(datos.aseguradora_id)
    except ValueError as error:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY, detail="La aseguradora no es válida"
        ) from error
    if not service.aseguradoras_con_concurrencia(db, aseguradora_id):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="La aseguradora no existe, está inactiva o no tiene Concurrencia",
        )

    cuerpo = datos.model_dump()
    cuerpo.pop("aseguradora_id")
    correos = [(c["email"], c["etiqueta"]) for c in cuerpo.pop("correos", [])]

    visita = service.crear(db, aseguradora_id, cuerpo, ctx.user.id)
    cambio_correos = service.fijar_correos(db, visita.id, correos, ctx.user.id)
    audit.registrar(
        db,
        accion="crear",
        request=request,
        user_id=ctx.user.id,
        session_id=ctx.sesion.id,
        module_code=ctx.module_code,
        entidad="conc_visitas",
        entidad_id=str(visita.id),
        detalle={
            "despues": {
                "codigo_interno": visita.codigo_interno,
                "aseguradora_id": str(aseguradora_id),
                "prestador_id": str(visita.prestador_id),
                "sede_id": str(visita.sede_id) if visita.sede_id else None,
                "correos": cambio_correos,
                "origen": "supervision",
            }
        },
    )
    db.commit()
    background.add_task(central_conc.publicar_ya, visita.id)  # paciente a la central (D49)

    # El mismo aviso del alta de compañía, en tarea de fondo tras responder.
    background.add_task(notificaciones.en_fondo, notificaciones.notificar_creacion, visita.id)
    return _detalle_supervision(db, visita.id)


@router.patch("/supervision/visitas/{visita_id}/auditor", response_model=VisitaSupervisionResumen)
def asignar_auditor(
    request: Request,
    visita_id: uuid.UUID,
    datos: AsignarAuditorRequest,
    background: BackgroundTasks,
    ctx: AuthContext = Depends(require_permission(permissions.EDITAR_VISITA)),
    _: None = Depends(verificar_csrf),
    db: DbSession = Depends(get_db),
) -> VisitaSupervisionResumen:
    _solo_supervision(ctx)
    visita = service.obtener_para_supervision(db, visita_id)

    auditor_id = None
    if datos.auditor_id:
        try:
            auditor_id = uuid.UUID(datos.auditor_id)
        except ValueError as error:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY, detail="El auditor no es válido"
            ) from error

    diff = service.asignar_auditor(db, visita, auditor_id, ctx.user.id)
    if diff["despues"]:
        audit.registrar(
            db,
            accion="visita_derivada",
            request=request,
            user_id=ctx.user.id,
            session_id=ctx.sesion.id,
            module_code=ctx.module_code,
            entidad="conc_visitas",
            entidad_id=str(visita_id),
            detalle=diff,
        )
        # La campana de la COMPAÑÍA, en la misma transacción que la derivación:
        # su coordinación es quien esperaba saber que el caso ya tiene médico.
        # Quitar la asignación no avisa: no hay nada que celebrar ahí.
        if auditor_id is not None:
            notificaciones.avisar_derivacion_en_campana(db, visita)
    db.commit()

    # DESPUÉS de responder y solo si la derivación CAMBIÓ hacia un auditor: se le
    # avisa por correo con los datos exactos. Desasignar no manda nada.
    if diff["despues"] and datos.auditor_id:
        background.add_task(notificaciones.en_fondo, notificaciones.notificar_derivacion, visita_id)
    # La fila recién derivada, releída con sus joins para devolverla entera.
    return _resumen_supervision(service.fila_supervision(db, visita_id))


@router.patch(
    "/supervision/visitas/{visita_id}/horario", response_model=VisitaSupervisionDetalle
)
def reprogramar(
    request: Request,
    visita_id: uuid.UUID,
    datos: ReprogramarRequest,
    background: BackgroundTasks,
    ctx: AuthContext = Depends(require_permission(permissions.EDITAR_VISITA)),
    _: None = Depends(verificar_csrf),
    db: DbSession = Depends(get_db),
) -> VisitaSupervisionDetalle:
    """
    Cambia la ventana de la visita. Nace del pedido que llega por correo: el
    supervisor sube el comprobante, fija la fecha nueva y todos los involucrados
    reciben el aviso con la ventana vieja y la nueva.
    """
    _solo_supervision(ctx)
    visita = service.obtener_para_supervision(db, visita_id)
    # La entrega se recalcula con el SLA de la compañía, y el plazo de llegada
    # vuelve a la hora nueva: las prórrogas de la cita anterior no valen para
    # una cita distinta.
    nueva_entrega = service.entrega_por_sla(db, visita.aseguradora_id, datos.desde)

    desde_anterior, hasta_anterior = visita.desde, visita.hasta
    if desde_anterior != datos.desde:
        visita.desde = datos.desde
        visita.hasta = nueva_entrega
        visita.llegada_limite = datos.desde
        visita.updated_by = ctx.user.id
        # Reprogramar un caso vencido lo devuelve a la agenda: misma regla que
        # cuando lo reprograma el operador desde su ficha (ver el servicio).
        estado_anterior = visita.estado
        revivido = service.revivir_al_reprogramar(visita)
        detalle = {
            # ISO explícito: la columna es JSONB y un datetime crudo no se escribe.
            "antes": {
                "desde": desde_anterior.isoformat(),
                "hasta": hasta_anterior.isoformat(),
            },
            "despues": {
                "desde": datos.desde.isoformat(),
                "hasta": nueva_entrega.isoformat(),
            },
        }
        if revivido is not None:
            detalle["antes"]["estado"] = estado_anterior
            detalle["despues"]["estado"] = revivido
        audit.registrar(
            db,
            accion="visita_reprogramada",
            request=request,
            user_id=ctx.user.id,
            session_id=ctx.sesion.id,
            module_code=ctx.module_code,
            entidad="conc_visitas",
            entidad_id=str(visita_id),
            detalle=detalle,
        )
        db.commit()
        # DESPUÉS de responder, como todos los avisos.
        background.add_task(
            notificaciones.en_fondo,
            notificaciones.notificar_reprogramacion,
            visita_id,
            desde_anterior,
            hasta_anterior,
        )
    return _detalle_supervision(db, visita_id)


def _detalle_supervision(db: DbSession, visita_id: uuid.UUID) -> VisitaSupervisionDetalle:
    fila = service.fila_supervision(db, visita_id)
    return VisitaSupervisionDetalle(
        **_resumen_supervision(fila).model_dump(),
        **personas.partes_prefijadas(fila[0], "paciente_"),
        observaciones=fila[0].observaciones,
        correos=_correos_out(db, visita_id),
        # `tiene_informe` ya viene del resumen de supervisión: repetirlo aquí
        # reventaba el alta del coordinador con un «multiple values».
        tiene_comprobante=bool(fila[0].comprobante_horario_path),
    )


@router.post(
    "/supervision/visitas/{visita_id}/comprobante",
    response_model=VisitaSupervisionDetalle,
)
async def subir_comprobante(
    request: Request,
    visita_id: uuid.UUID,
    archivo: UploadFile = File(...),
    ctx: AuthContext = Depends(require_permission(permissions.EDITAR_VISITA)),
    _: None = Depends(verificar_csrf),
    db: DbSession = Depends(get_db),
) -> VisitaSupervisionDetalle:
    """
    La imagen que comprueba el cambio de horario pedido por correo. Mismas
    defensas que el logo: tipo REAL leído del contenido, tope de tamaño, nombre
    derivado de la visita (el del cliente se descarta) y almacenada fuera del
    árbol ejecutable. Subir otra reemplaza la anterior.
    """
    _solo_supervision(ctx)
    visita = service.obtener_para_supervision(db, visita_id)

    maximo = settings.upload_max_size_mb * 1024 * 1024
    contenido = bytearray()
    while trozo := await archivo.read(64 * 1024):
        contenido.extend(trozo)
        if len(contenido) > maximo:
            raise HTTPException(
                status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail=f"El comprobante no puede superar {settings.upload_max_size_mb} MB",
            )
    if not contenido:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="El archivo está vacío")

    mime = magic.from_buffer(bytes(contenido[:2048]), mime=True)
    if mime not in MIME_PERMITIDOS:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="El comprobante debe ser una imagen PNG, JPEG o WebP",
        )

    destino_rel = f"concurrencia/comprobantes/{visita.id}{MIME_PERMITIDOS[mime]}"
    destino = Path(settings.upload_dir) / destino_rel
    destino.parent.mkdir(parents=True, exist_ok=True)
    anterior = visita.comprobante_horario_path
    destino.write_bytes(bytes(contenido))
    if anterior and anterior != destino_rel:
        (Path(settings.upload_dir) / anterior).unlink(missing_ok=True)

    visita.comprobante_horario_path = destino_rel
    visita.updated_by = ctx.user.id
    audit.registrar(
        db,
        accion="comprobante_subido",
        request=request,
        user_id=ctx.user.id,
        session_id=ctx.sesion.id,
        module_code=ctx.module_code,
        entidad="conc_visitas",
        entidad_id=str(visita_id),
        detalle={"mime": mime, "bytes": len(contenido)},
    )
    db.commit()
    return _detalle_supervision(db, visita_id)


@router.get("/supervision/visitas/{visita_id}/comprobante")
def ver_comprobante(
    visita_id: uuid.UUID,
    ctx: AuthContext = Depends(require_permission(permissions.LEER_VISITA)),
    db: DbSession = Depends(get_db),
) -> FileResponse:
    """El archivo, solo tras autorizar, con el Content-Type fijado y sin sniffing."""
    _solo_supervision(ctx)
    visita = service.obtener_para_supervision(db, visita_id)
    if not visita.comprobante_horario_path:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Sin comprobante")
    ruta = Path(settings.upload_dir) / visita.comprobante_horario_path
    if not ruta.is_file():
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Sin comprobante")
    tipo = next(
        (m for m, ext in MIME_PERMITIDOS.items() if ruta.suffix == ext),
        "application/octet-stream",
    )
    return FileResponse(
        ruta,
        media_type=tipo,
        headers={"X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store"},
    )


@router.patch("/visitas/{visita_id}", response_model=VisitaDetalle)
def actualizar_visita(
    request: Request,
    visita_id: uuid.UUID,
    datos: VisitaActualizar,
    ctx: AuthContext = Depends(require_permission(permissions.EDITAR_VISITA)),
    _: None = Depends(verificar_csrf),
    db: DbSession = Depends(get_db),
) -> VisitaDetalle:
    aseguradora_id = _aseguradora_operadora(ctx)
    # El operador solo edita lo suyo: el caso de un compañero es un 404.
    visita = service.obtener(db, aseguradora_id, visita_id, creado_por=_autor_forzado(ctx))[0]

    cambios = datos.model_dump(exclude_unset=True)
    correos = cambios.pop("correos", None)
    diff = service.actualizar(db, visita, cambios, ctx.user.id)
    if correos is not None:
        cambio_correos = service.fijar_correos(
            db, visita_id, [(c["email"], c["etiqueta"]) for c in correos], ctx.user.id
        )
        if cambio_correos:
            diff["despues"]["correos"] = cambio_correos

    if diff["despues"]:
        audit.registrar(
            db,
            accion="actualizar",
            request=request,
            user_id=ctx.user.id,
            session_id=ctx.sesion.id,
            module_code=ctx.module_code,
            entidad="conc_visitas",
            entidad_id=str(visita_id),
            detalle=diff,
        )
    db.commit()
    return _detalle(db, aseguradora_id, visita_id)


@router.post("/visitas/{visita_id}/cancelar", response_model=VisitaDetalle)
def cancelar_visita(
    request: Request,
    visita_id: uuid.UUID,
    ctx: AuthContext = Depends(require_permission(permissions.EDITAR_VISITA)),
    _: None = Depends(verificar_csrf),
    db: DbSession = Depends(get_db),
) -> VisitaDetalle:
    """
    Cancelar el caso: la única forma de mover su estado desde la compañía.

    Es un endpoint propio y no un campo del PATCH a propósito. El estado no es
    un dato que se teclea —no hay desplegable en ninguna pantalla—: es la
    consecuencia de algo que pasó, y esto es ese algo. Así queda además una
    acción con nombre en la auditoría, en vez de un `estado: cancelada` perdido
    entre los otros campos editados.

    Se puede hasta que el caso termina, con el auditor ya dentro incluido; el
    servicio corta lo acabado con un 409.
    """
    aseguradora_id = _aseguradora_operadora(ctx)
    # El operador solo cancela lo suyo: el caso de un compañero es un 404.
    visita = service.obtener(db, aseguradora_id, visita_id, creado_por=_autor_forzado(ctx))[0]

    estado_anterior = visita.estado
    service.cancelar(db, visita, ctx.user.id)
    audit.registrar(
        db,
        accion="visita_cancelada",
        request=request,
        user_id=ctx.user.id,
        session_id=ctx.sesion.id,
        module_code=ctx.module_code,
        entidad="conc_visitas",
        entidad_id=str(visita_id),
        detalle={
            "visita": visita.codigo_interno,
            "antes": {"estado": estado_anterior},
            "despues": {"estado": "cancelada"},
        },
    )
    db.commit()
    return _detalle(db, aseguradora_id, visita_id)


@router.get("/sla", response_model=SlaDelModulo)
def sla_del_modulo(
    ctx: AuthContext = Depends(require_permission(permissions.LEER_VISITA)),
    db: DbSession = Depends(get_db),
) -> SlaDelModulo:
    """
    Las horas de SLA de MI compañía para Concurrencia: de ahí sale la entrega
    del informe, y el formulario la enseña calculada mientras se elige la hora
    de llegada.
    """
    return SlaDelModulo(horas=float(service.horas_de_sla(db, _aseguradora_de(ctx))))


@router.get("/supervision/sla", response_model=SlaDelModulo)
def sla_del_modulo_supervision(
    aseguradora_id: uuid.UUID,
    ctx: AuthContext = Depends(require_permission(permissions.LEER_VISITA)),
    db: DbSession = Depends(get_db),
) -> SlaDelModulo:
    """Lo mismo para el coordinador, que elige de qué compañía nace el caso."""
    _solo_supervision(ctx)
    return SlaDelModulo(horas=float(service.horas_de_sla(db, aseguradora_id)))


@router.post("/supervision/visitas/{visita_id}/prorroga", response_model=ProrrogaOut)
def prorrogar_visita(
    request: Request,
    visita_id: uuid.UUID,
    datos: ProrrogaRequest,
    ctx: AuthContext = Depends(require_permission(permissions.EDITAR_VISITA)),
    _: None = Depends(verificar_csrf),
    db: DbSession = Depends(get_db),
) -> ProrrogaOut:
    """
    **La prórroga es de Accumedical**, no de la compañía: es quien coordina a
    los auditores y quien ve el `no_auditado` que la compañía no ve. Le da al
    auditor más tiempo para llegar, contado desde AHORA, y devuelve el caso a la
    agenda si ya había vencido.
    """
    _solo_supervision(ctx)
    visita = service.obtener_para_supervision(db, visita_id)
    limite_anterior, estado_anterior = visita.llegada_limite, visita.estado
    limite = service.extender(db, visita, datos.horas, ctx.user.id)
    audit.registrar(
        db,
        accion="visita_prorrogada",
        request=request,
        user_id=ctx.user.id,
        session_id=ctx.sesion.id,
        module_code=ctx.module_code,
        entidad="conc_visitas",
        entidad_id=str(visita_id),
        detalle={
            "visita": visita.codigo_interno,
            "horas": str(datos.horas),
            # ISO explícito: la columna es JSONB y un datetime crudo no se escribe.
            "antes": {"llegada_limite": limite_anterior.isoformat(), "estado": estado_anterior},
            "despues": {"llegada_limite": limite.isoformat(), "estado": visita.estado},
        },
    )
    db.commit()
    return ProrrogaOut(llegada_limite=limite, estado=visita.estado)
