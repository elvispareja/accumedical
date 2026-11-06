from __future__ import annotations

import io
import uuid
import zipfile
from decimal import Decimal
from pathlib import Path

import magic
from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Query,
    Request,
    UploadFile,
    status,
)
from fastapi.responses import FileResponse
from pydantic import ValidationError
from sqlalchemy import func, select
from sqlalchemy.orm import Session as DbSession

from app.core.config import settings
from app.core.db import get_db
from app.core.security.deps import (
    AuthContext,
    require_funcion,
    verificar_csrf,
)
from app.shared import personas
from app.shared.aseguradoras import service
from app.shared.aseguradoras import usuarios as usuarios_service
from app.shared.aseguradoras.logo import MIME_PERMITIDOS, respuesta_logo
from app.shared.aseguradoras.models import (
    CATEGORIAS_DOCUMENTO,
    AseguradoraContrato,
    AseguradoraPoliza,
)
from app.shared.aseguradoras.schemas import (
    AccesoSalida,
    AseguradoraActualizar,
    AseguradoraCrear,
    AseguradoraDetalle,
    AseguradoraPropiaOut,
    AseguradoraResumen,
    ContactoSalida,
    ContratoEntrada,
    ContratoSalida,
    ConvenioPrestadorOut,
    ConveniosFijar,
    ListadoPreciosSalida,
    PaginaAseguradoras,
    PolizaSalida,
    ProductoSalida,
    PuntoMapaAseguradora,
    RequerimientoOut,
    SlaFijar,
    SlaSalida,
    UsuarioActualizar,
    UsuarioCrear,
    UsuarioSalida,
)
from app.shared.audit import service as audit
from app.shared.auth import invitaciones
from app.shared.auth import service as auth_service
from app.shared.catalogos.models import Module
from app.shared.central import archivos as archivos_central
from app.shared.central import redes as redes_central
from app.shared.users import pendientes
from app.shared.users import service as plataforma_usuarios

# Las dependencias se crean UNA vez y se reutilizan —en el router y en los
# endpoints que necesitan el `AuthContext`—: FastAPI cachea por identidad, así
# que repetir `require_funcion(...)` consultaría la base dos veces por petición.
# Todas dejan pasar siempre al administrador global.
lleva_la_red = require_funcion("convenio")
gestiona_companias = require_funcion("contabilidad")
ve_companias = require_funcion("convenio", "contabilidad")

# La ficha de la compañía ENTERA: datos generales, módulos, SLA, pólizas,
# contactos y usuarios. La llevan el administrador global y la función
# «contabilidad», que es quien da de alta a las aseguradoras y las mantiene.
# Protegido a nivel de APIRouter: cualquier endpoint que se añada aquí nace
# exigiendo esa autorización (decisión D-10 de la iteración 1; hasta septiembre
# de 2026 exigía administrador global a secas).
router = APIRouter(
    prefix="/shared/aseguradoras",
    tags=["aseguradoras"],
    dependencies=[Depends(gestiona_companias)],
)

# Mirar la lista de compañías. La necesitan las dos funciones —Convenio para
# entrar a la red de cada una, Contabilidad para gestionarlas— y una ruta solo
# se registra una vez.
router_listado = APIRouter(
    prefix="/shared/aseguradoras",
    tags=["aseguradoras"],
    dependencies=[Depends(ve_companias)],
)

# La red de prestadores de una compañía: la lleva quien tiene la función
# «convenio». Es lo ÚNICO de la aseguradora que Contabilidad no toca.
router_convenios = APIRouter(
    prefix="/shared/aseguradoras",
    tags=["aseguradoras"],
    dependencies=[Depends(lleva_la_red)],
)

CHUNK = 64 * 1024


def _detalle(fila, modulos, contactos, productos) -> AseguradoraDetalle:
    a, provincia, ciudad = fila
    return AseguradoraDetalle(
        id=str(a.id),
        codigo_interno=a.codigo_interno,
        razon_social=a.razon_social,
        nombre_comercial=a.nombre_comercial,
        ruc=a.ruc,
        tipo=a.tipo,
        estado=a.estado,
        provincia_codigo=a.provincia_codigo,
        provincia_nombre=provincia,
        ciudad_codigo=a.ciudad_codigo,
        ciudad_nombre=ciudad,
        direccion_fiscal=a.direccion_fiscal,
        latitud=float(a.latitud),
        longitud=float(a.longitud),
        tiene_logo=bool(a.logo_path),
        modulos=modulos,
        contactos=contactos,
        productos=productos,
    )


def _detalle_completo(db: DbSession, aseguradora_id) -> AseguradoraDetalle:
    fila = service.obtener(db, aseguradora_id)
    modulos = service.modulos_de(db, fila[0].id)
    coberturas = service.coberturas_de(db, fila[0].id)
    for modulo in modulos:
        modulo["coberturas"] = coberturas.get(modulo["codigo"], [])

    nombres_tipo = service.nombres_tipos_documento(db)
    contactos = [
        ContactoSalida(
            id=str(c.id),
            **personas.partes_out(c),
            email=c.email,
            telefono=c.telefono,
            tipo_documento_codigo=c.tipo_documento_codigo,
            tipo_documento_nombre=nombres_tipo.get(c.tipo_documento_codigo or ""),
            numero_documento=c.numero_documento,
            cargo=c.cargo,
        )
        for c in service.contactos_de(db, fila[0].id)
    ]
    productos = [
        ProductoSalida(
            id=str(p.id),
            nombre=p.nombre,
            servicios=list(p.servicios),
            valor=float(p.valor),
            tope_unidad=p.tope_unidad,
            ventana_evento=p.ventana_evento,
            eventos_maximo=p.eventos_maximo,
            porcentaje=float(p.porcentaje),
            vigencia_receta_horas=p.vigencia_receta_horas,
            requiere_vademecum=p.requiere_vademecum,
            despacho_parcial=p.despacho_parcial,
            max_diagnosticos=p.max_diagnosticos,
            beneficiarios_incluidos=p.beneficiarios_incluidos,
            parentescos=list(p.parentescos),
            carencia_dias=p.carencia_dias,
            exclusiones=p.exclusiones,
        )
        for p in service.productos_de(db, fila[0].id)
    ]
    return _detalle(fila, modulos, contactos, productos)


# El listado lo comparten las dos funciones: sin él, quien lleva los convenios no
# podría elegir a qué compañía entrar, ni Contabilidad ver las que ha dado de
# alta. Es un resumen —nombre, RUC, ciudad, estado—, no la ficha.
@router_listado.get("", response_model=PaginaAseguradoras)
def listar(
    search: str | None = Query(default=None, max_length=120),
    estado: str | None = Query(default=None, pattern="^(activo|inactivo)$"),
    provincia_codigo: str | None = Query(default=None, min_length=2, max_length=2),
    tipo: str | None = Query(default=None, pattern="^(aseguradora|broker|cooperativa)$"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=service.MAX_PAGE_SIZE),
    db: DbSession = Depends(get_db),
) -> PaginaAseguradoras:
    filas, total = service.listar(
        db,
        search=search,
        estado=estado,
        provincia_codigo=provincia_codigo,
        tipo=tipo,
        page=page,
        page_size=page_size,
    )
    return PaginaAseguradoras(
        items=[
            AseguradoraResumen(
                id=str(a.id),
                codigo_interno=a.codigo_interno,
                razon_social=a.razon_social,
                nombre_comercial=a.nombre_comercial,
                ruc=a.ruc,
                tipo=a.tipo,
                estado=a.estado,
                provincia_nombre=prov,
                ciudad_nombre=ciu,
                tiene_logo=bool(a.logo_path),
            )
            for a, prov, ciu in filas
        ],
        total=total,
        page=page,
        page_size=page_size,
    )


@router_listado.get("/mapa", response_model=list[PuntoMapaAseguradora])
def mapa(db: DbSession = Depends(get_db)) -> list[PuntoMapaAseguradora]:
    """
    Las compañías sobre el mapa: una por punto, en su domicilio. Fuera la ficha
    propia de Accumedical, igual que en el listado.
    """
    return [PuntoMapaAseguradora(**punto) for punto in service.puntos_del_mapa(db)]


# Declarada ANTES de /{aseguradora_id}: la ruta literal debe ganar el match.
@router_convenios.get("/propia", response_model=AseguradoraPropiaOut)
def obtener_propia(db: DbSession = Depends(get_db)) -> AseguradoraPropiaOut:
    """La ficha interna de Accumedical: la dueña de la «Red convenio»."""
    fila = service.propia(db)
    return AseguradoraPropiaOut(
        id=str(fila.id), nombre=fila.nombre_comercial or fila.razon_social
    )


@router_convenios.get("/{aseguradora_id}/basico", response_model=AseguradoraPropiaOut)
def obtener_basico(
    aseguradora_id: uuid.UUID, db: DbSession = Depends(get_db)
) -> AseguradoraPropiaOut:
    """
    Lo mínimo para encabezar la pantalla: el nombre y nada más.

    Existe para que quien lleva los convenios pueda trabajar la red de una
    compañía sin recibir su ficha entera —módulos, contactos, documentos—, que
    no necesita y no le corresponde. Mínimo privilegio (A01), en una ruta en vez
    de en un `if`.
    """
    fila = service.obtener(db, aseguradora_id)[0]
    return AseguradoraPropiaOut(
        id=str(fila.id), nombre=fila.nombre_comercial or fila.razon_social
    )


@router.get("/{aseguradora_id}", response_model=AseguradoraDetalle)
def obtener(aseguradora_id: uuid.UUID, db: DbSession = Depends(get_db)) -> AseguradoraDetalle:
    return _detalle_completo(db, aseguradora_id)


@router.post("", response_model=AseguradoraDetalle, status_code=status.HTTP_201_CREATED)
def crear(
    request: Request,
    datos: AseguradoraCrear,
    ctx: AuthContext = Depends(gestiona_companias),
    _: None = Depends(verificar_csrf),
    db: DbSession = Depends(get_db),
) -> AseguradoraDetalle:
    cuerpo = datos.model_dump()
    modulos = cuerpo.pop("modulos", [])
    coberturas = cuerpo.pop("coberturas", {})
    contactos = cuerpo.pop("contactos", [])
    productos = cuerpo.pop("productos", [])
    aseguradora = service.crear(db, cuerpo, ctx.user.id)
    db.flush()
    accesos = service.fijar_accesos(db, aseguradora.id, modulos, coberturas, ctx.user.id)
    cambio_contactos = service.fijar_contactos(db, aseguradora.id, contactos, ctx.user.id)
    cambio_productos = service.fijar_productos(db, aseguradora.id, productos, ctx.user.id)
    audit.registrar(
        db,
        accion="crear",
        request=request,
        user_id=ctx.user.id,
        session_id=ctx.sesion.id,
        entidad="aseguradoras",
        entidad_id=str(aseguradora.id),
        detalle={
            "despues": {
                "codigo_interno": aseguradora.codigo_interno,
                "ruc": aseguradora.ruc,
                "tipo": aseguradora.tipo,
                "accesos": accesos,
                "contactos": cambio_contactos,
                "productos": cambio_productos,
            }
        },
    )
    db.commit()
    return _detalle_completo(db, aseguradora.id)


@router.patch("/{aseguradora_id}", response_model=AseguradoraDetalle)
def actualizar(
    request: Request,
    aseguradora_id: uuid.UUID,
    datos: AseguradoraActualizar,
    ctx: AuthContext = Depends(gestiona_companias),
    _: None = Depends(verificar_csrf),
    db: DbSession = Depends(get_db),
) -> AseguradoraDetalle:
    aseguradora, _prov, _ciu = service.obtener(db, aseguradora_id)
    cambios = datos.model_dump(exclude_unset=True)
    modulos = cambios.pop("modulos", None)
    coberturas = cambios.pop("coberturas", None)
    contactos = cambios.pop("contactos", None)
    cambios.pop("productos", None)
    # Cada producto va COMPLETO (con sus valores por omisión), no solo lo enviado.
    productos = (
        None if datos.productos is None else [p.model_dump() for p in datos.productos]
    )
    diff = service.actualizar(db, aseguradora, cambios, ctx.user.id)
    if modulos is not None or coberturas is not None:
        accesos = service.fijar_accesos(db, aseguradora_id, modulos, coberturas, ctx.user.id)
        if accesos:
            diff["despues"]["accesos"] = accesos
    if contactos is not None:
        cambio_contactos = service.fijar_contactos(db, aseguradora_id, contactos, ctx.user.id)
        if cambio_contactos:
            diff["despues"]["contactos"] = cambio_contactos
    if productos is not None:
        cambio_productos = service.fijar_productos(db, aseguradora_id, productos, ctx.user.id)
        if cambio_productos:
            diff["despues"]["productos"] = cambio_productos
    if diff["despues"]:
        audit.registrar(
            db,
            accion="actualizar",
            request=request,
            user_id=ctx.user.id,
            session_id=ctx.sesion.id,
            entidad="aseguradoras",
            entidad_id=str(aseguradora_id),
            detalle=diff,
        )
    db.commit()
    return _detalle_completo(db, aseguradora_id)


# Una aseguradora NO se elimina, ni siquiera de forma lógica: se desactiva con
# `PATCH ... {"estado": "inactivo"}`. Tiene expedientes, convenios y usuarios
# colgando, y el histórico de cada uno pierde sentido si su compañía desaparece.
# Por eso aquí no hay `@router.delete`: no es que esté oculto en la interfaz, es
# que no existe la ruta.


# ────────────────────────────── Logo (A08) ───────────────────────────────────


@router.post("/{aseguradora_id}/logo", response_model=AseguradoraDetalle)
async def subir_logo(
    request: Request,
    aseguradora_id: uuid.UUID,
    archivo: UploadFile = File(...),
    ctx: AuthContext = Depends(gestiona_companias),
    _: None = Depends(verificar_csrf),
    db: DbSession = Depends(get_db),
) -> AseguradoraDetalle:
    aseguradora, _prov, _ciu = service.obtener(db, aseguradora_id)

    maximo = settings.upload_max_size_mb * 1024 * 1024
    # Se lee por trozos y se corta al superar el límite: nunca se carga en memoria
    # un archivo entero solo para descubrir después que era demasiado grande.
    contenido = bytearray()
    while trozo := await archivo.read(CHUNK):
        contenido.extend(trozo)
        if len(contenido) > maximo:
            raise HTTPException(
                status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail=f"El logo no puede superar {settings.upload_max_size_mb} MB",
            )
    if not contenido:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="El archivo está vacío")

    # Tipo REAL leído del contenido. Ni la extensión ni el Content-Type del
    # cliente son de fiar: un .png puede ser un script.
    mime = magic.from_buffer(bytes(contenido[:2048]), mime=True)
    if mime not in MIME_PERMITIDOS:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="El logo debe ser una imagen PNG, JPEG o WebP",
        )

    # Nombre derivado del UUID de la fila: el nombre original del cliente se
    # descarta entero, porque puede traer rutas o payloads.
    destino_rel = f"aseguradoras/{aseguradora.id}{MIME_PERMITIDOS[mime]}"
    destino = Path(settings.upload_dir) / destino_rel
    destino.parent.mkdir(parents=True, exist_ok=True)

    anterior = aseguradora.logo_path
    destino.write_bytes(bytes(contenido))
    if anterior and anterior != destino_rel:
        (Path(settings.upload_dir) / anterior).unlink(missing_ok=True)

    aseguradora.logo_path = destino_rel
    aseguradora.updated_by = ctx.user.id
    audit.registrar(
        db,
        accion="logo_subido",
        request=request,
        user_id=ctx.user.id,
        session_id=ctx.sesion.id,
        entidad="aseguradoras",
        entidad_id=str(aseguradora_id),
        detalle={"mime": mime, "bytes": len(contenido)},
    )
    db.commit()
    return _detalle_completo(db, aseguradora_id)


@router_listado.get("/{aseguradora_id}/logo")
def obtener_logo(aseguradora_id: uuid.UUID, db: DbSession = Depends(get_db)) -> FileResponse:
    """
    El archivo se sirve solo después de autorizar. Va en el router del listado
    —admin global y las dos funciones— porque quien ve la lista de compañías ve
    el logo de cada fila; negárselo solo pintaría un icono roto sin ocultar nada
    que no tenga ya delante. Un usuario de compañía tiene su propia ruta —
    `GET /auth/mi-aseguradora/logo`— que no recibe id y solo sirve la suya.
    """
    aseguradora, _prov, _ciu = service.obtener(db, aseguradora_id)
    return respuesta_logo(aseguradora)


# ─────────────── Convenios: la red de prestadores, desde aquí ───────────────
#
# El admin marca desde la aseguradora qué prestadores están en su red. Marcar
# crea el convenio (vigente); desmarcar lo retira con borrado lógico. El
# detalle del convenio (FC, vigencias) se captura después, sobre la fila viva.


def _convenios_out(db: DbSession, aseguradora_id: uuid.UUID) -> list[ConvenioPrestadorOut]:
    return [
        ConvenioPrestadorOut(
            prestador_id=str(fila["prestador"].id),
            codigo_interno=fila["prestador"].codigo_interno,
            nombre=fila["prestador"].nombre,
            tipo_nombre=fila["tipo_nombre"],
            ciudad_nombre=fila["ciudad_nombre"],
            marcado=fila["marcado"],
            convenio_id=str(fila["convenio"].id) if fila["convenio"] else None,
            listado_precios_nombre=(
                fila["convenio"].listado_precios_nombre if fila["convenio"] else None
            ),
            # Sin convenio, los valores con los que nacería: la casilla se pinta
            # igual antes y después de guardar la red.
            red_privada=fila["convenio"].red_privada if fila["convenio"] else True,
            red_publica=fila["convenio"].red_publica if fila["convenio"] else False,
        )
        for fila in service.convenios_de_aseguradora(db, aseguradora_id)
    ]


@router_convenios.get("/{aseguradora_id}/convenios", response_model=list[ConvenioPrestadorOut])
def listar_convenios(
    aseguradora_id: uuid.UUID, db: DbSession = Depends(get_db)
) -> list[ConvenioPrestadorOut]:
    service.obtener(db, aseguradora_id)
    return _convenios_out(db, aseguradora_id)


@router_convenios.put("/{aseguradora_id}/convenios", response_model=list[ConvenioPrestadorOut])
def fijar_convenios(
    request: Request,
    aseguradora_id: uuid.UUID,
    datos: ConveniosFijar,
    ctx: AuthContext = Depends(lleva_la_red),
    _: None = Depends(verificar_csrf),
    db: DbSession = Depends(get_db),
) -> list[ConvenioPrestadorOut]:
    service.obtener(db, aseguradora_id)
    try:
        seleccion = [
            {
                "prestador_id": uuid.UUID(p.prestador_id),
                "red_privada": p.red_privada,
                "red_publica": p.red_publica,
            }
            for p in datos.prestadores
        ]
    except ValueError as error:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Hay un prestador no válido"
        ) from error

    diff = service.fijar_convenios(db, aseguradora_id, seleccion, ctx.user.id)
    if diff is not None:
        audit.registrar(
            db,
            accion="actualizar",
            request=request,
            user_id=ctx.user.id,
            session_id=ctx.sesion.id,
            entidad="aseguradora_prestador",
            entidad_id=str(aseguradora_id),
            detalle={"despues": diff},
        )
        db.commit()
    return _convenios_out(db, aseguradora_id)


# ─────────────────────────── SLA por módulo ─────────────────────────────────
#
# Lo pactado con la compañía para cada módulo que tiene contratado: horas y
# precio. Solo se ofrecen —y solo se aceptan— los módulos ACTIVOS de esa
# aseguradora: no se pacta el nivel de servicio de algo que no está contratado.


@router.get("/{aseguradora_id}/sla", response_model=list[SlaSalida])
def listar_sla(
    aseguradora_id: uuid.UUID, db: DbSession = Depends(get_db)
) -> list[SlaSalida]:
    service.obtener(db, aseguradora_id)
    return [SlaSalida(**fila) for fila in service.sla_de(db, aseguradora_id)]


@router.put("/{aseguradora_id}/sla", response_model=list[SlaSalida])
def fijar_sla(
    request: Request,
    aseguradora_id: uuid.UUID,
    datos: SlaFijar,
    ctx: AuthContext = Depends(gestiona_companias),
    _: None = Depends(verificar_csrf),
    db: DbSession = Depends(get_db),
) -> list[SlaSalida]:
    service.obtener(db, aseguradora_id)
    cambios = service.fijar_sla(
        db, aseguradora_id, [i.model_dump() for i in datos.items], ctx.user.id
    )
    if cambios is not None:
        audit.registrar(
            db,
            accion="actualizar",
            request=request,
            user_id=ctx.user.id,
            session_id=ctx.sesion.id,
            entidad="aseguradora_sla",
            entidad_id=str(aseguradora_id),
            detalle={"despues": cambios},
        )
        db.commit()
    return [SlaSalida(**fila) for fila in service.sla_de(db, aseguradora_id)]


# ─────────────── Listado de precios del convenio (A08) ──────────────────────
#
# UN archivo por convenio, PDF o Excel: subir otro reemplaza al vigente (el
# anterior queda en el volumen como evidencia y el reemplazo se audita). El
# tipo se comprueba sobre el CONTENIDO: un xlsx real es un ZIP con
# xl/workbook.xml dentro, y así se distingue de un ZIP cualquiera renombrado.

MIME_LISTADO = {
    "application/pdf": ".pdf",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
    "application/vnd.ms-excel": ".xls",
    "application/x-ole-storage": ".xls",
    "application/CDFV2": ".xls",
}
MEDIA_LISTADO = {
    ".pdf": "application/pdf",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".xls": "application/vnd.ms-excel",
}


def _extension_listado(contenido: bytes) -> str:
    mime = magic.from_buffer(contenido[:2048], mime=True)
    if mime in MIME_LISTADO:
        return MIME_LISTADO[mime]
    if mime == "application/zip":
        try:
            with zipfile.ZipFile(io.BytesIO(contenido)) as zf:
                if "xl/workbook.xml" in zf.namelist():
                    return ".xlsx"
        except zipfile.BadZipFile:
            pass
    raise HTTPException(
        status.HTTP_422_UNPROCESSABLE_ENTITY,
        detail="El listado de precios debe ser un PDF o un Excel (.xlsx o .xls)",
    )


@router_convenios.get("/{aseguradora_id}/convenios/{prestador_id}/listado-precios")
def ver_listado_precios(
    aseguradora_id: uuid.UUID,
    prestador_id: uuid.UUID,
    db: DbSession = Depends(get_db),
) -> FileResponse:
    convenio = service.convenio_del_par(db, aseguradora_id, prestador_id)
    if not convenio.listado_precios_ruta:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="El convenio no tiene listado")
    if archivos_central.es_referencia(convenio.listado_precios_ruta):
        return archivos_central.respuesta(
            convenio.listado_precios_ruta, convenio.listado_precios_nombre or "listado-precios"
        )
    ruta = Path(settings.upload_dir) / convenio.listado_precios_ruta
    if not ruta.is_file():
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="El convenio no tiene listado")
    extension = ruta.suffix.lower()
    return FileResponse(
        ruta,
        media_type=MEDIA_LISTADO.get(extension, "application/octet-stream"),
        # attachment: el Excel se descarga con su nombre visible, nunca se
        # interpreta en el navegador.
        filename=f"{convenio.listado_precios_nombre or 'listado-precios'}{extension}",
        headers={"X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store"},
    )


@router_convenios.post(
    "/{aseguradora_id}/convenios/{prestador_id}/listado-precios",
    response_model=ListadoPreciosSalida,
    status_code=status.HTTP_201_CREATED,
)
async def subir_listado_precios(
    request: Request,
    aseguradora_id: uuid.UUID,
    prestador_id: uuid.UUID,
    archivo: UploadFile = File(...),
    ctx: AuthContext = Depends(lleva_la_red),
    _: None = Depends(verificar_csrf),
    db: DbSession = Depends(get_db),
) -> ListadoPreciosSalida:
    convenio = service.convenio_del_par(db, aseguradora_id, prestador_id)

    maximo = settings.upload_max_size_mb * 1024 * 1024
    contenido = bytearray()
    while trozo := await archivo.read(CHUNK):
        contenido.extend(trozo)
        if len(contenido) > maximo:
            raise HTTPException(
                status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail=f"El listado no puede superar {settings.upload_max_size_mb} MB",
            )
    if not contenido:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="El archivo está vacío")

    extension = _extension_listado(bytes(contenido))

    # Nombre visible: el del archivo sin extensión — texto para enseñar, nunca
    # una ruta. El almacenamiento va por UUID, como toda subida (A08).
    original = Path(archivo.filename or "").stem
    visible = " ".join(original.split())[:160] or "Listado de precios"

    anterior = convenio.listado_precios_nombre
    if archivos_central.activo() or redes_central.aplica(db, aseguradora_id):
        # Al almacén cifrado de la central (la Red convenio propia, siempre).
        destino_rel = archivos_central.referencia(
            archivos_central.subir(bytes(contenido), visible, ctx.user.id)
        )
    else:
        destino_rel = (
            f"aseguradoras/{aseguradora_id}/convenios/{convenio.id}/{uuid.uuid4()}{extension}"
        )
        destino = Path(settings.upload_dir) / destino_rel
        destino.parent.mkdir(parents=True, exist_ok=True)
        destino.write_bytes(bytes(contenido))
    convenio.listado_precios_ruta = destino_rel
    convenio.listado_precios_nombre = visible
    convenio.updated_by = ctx.user.id
    if redes_central.aplica(db, aseguradora_id):
        # Red propia: el archivo queda aquí, su ficha (ruta y nombre) en la central.
        redes_central.guardar_listado(convenio.id, destino_rel, visible, ctx.user.id)

    audit.registrar(
        db,
        accion="actualizar",
        request=request,
        user_id=ctx.user.id,
        session_id=ctx.sesion.id,
        entidad="aseguradora_prestador",
        entidad_id=str(convenio.id),
        detalle={
            "listado_precios": {
                "antes": anterior,
                "despues": visible,
                "bytes": len(contenido),
            }
        },
    )
    db.commit()
    return ListadoPreciosSalida(listado_precios_nombre=visible)


# ──────────────────────── Pólizas y planes (A08) ────────────────────────────
#
# Documentos PDF de la aseguradora. Mismas reglas que toda subida: tipo REAL
# leído del contenido, tope de tamaño, nombre de archivo por UUID (el del
# cliente se descarta; solo su texto sirve como nombre visible) y borrado
# lógico: retirar conserva quién y cuándo.


def _poliza_de(db: DbSession, aseguradora_id: uuid.UUID, poliza_id: uuid.UUID) -> AseguradoraPoliza:
    poliza = db.scalar(
        select(AseguradoraPoliza).where(
            AseguradoraPoliza.id == poliza_id,
            AseguradoraPoliza.aseguradora_id == aseguradora_id,
            AseguradoraPoliza.deleted_at.is_(None),
        )
    )
    if poliza is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Documento no encontrado")
    return poliza


def _categoria_valida(categoria: str) -> str:
    if categoria not in CATEGORIAS_DOCUMENTO:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Categoría de documento desconocida"
        )
    return categoria


def _contrato_out(c: AseguradoraContrato | None) -> ContratoSalida | None:
    if c is None:
        return None
    return ContratoSalida(
        vigencia_desde=c.vigencia_desde,
        vigencia_hasta=c.vigencia_hasta,
        tarifa=_tarifa_texto(c.tarifa),
        tarifa_unidad=c.tarifa_unidad,
        revision_tarifa=c.revision_tarifa,
        forma_pago_medicamentos=c.forma_pago_medicamentos,
        actualizado_at=c.updated_at,
    )


def _polizas_out(db: DbSession, aseguradora_id: uuid.UUID, categoria: str) -> list[PolizaSalida]:
    filas = db.execute(
        select(AseguradoraPoliza, AseguradoraContrato)
        .outerjoin(AseguradoraContrato, AseguradoraContrato.poliza_id == AseguradoraPoliza.id)
        .where(
            AseguradoraPoliza.aseguradora_id == aseguradora_id,
            AseguradoraPoliza.categoria == categoria,
            AseguradoraPoliza.deleted_at.is_(None),
        )
        .order_by(AseguradoraPoliza.created_at.desc())
    ).all()
    return [
        PolizaSalida(
            id=str(p.id), nombre=p.nombre, creada_at=p.created_at, contrato=_contrato_out(c)
        )
        for p, c in filas
    ]


# ─── Datos del contrato (6/11/2026, especificación de la Central, M1) ───────

_CUATRO_DECIMALES = Decimal("0.0001")
_CAMPOS_TARIFA = ("tarifa", "tarifa_unidad", "forma_pago_medicamentos")


def _tarifa_texto(tarifa: Decimal | None) -> str | None:
    return None if tarifa is None else f"{Decimal(tarifa).quantize(_CUATRO_DECIMALES)}"


def _con_farmacia_segun_tarifa(
    db: DbSession, aseguradora_id: uuid.UUID, datos: ContratoEntrada
) -> bool:
    """
    La tarifa, su unidad y la forma de pago de los medicamentos van en el
    contrato SOLO si el cliente tiene Farmacovigilancia (6/11/2026): en los
    demás módulos lo que cobra AccuMedical es el precio de la pestaña SLA.
    Mira lo GUARDADO, no lo marcado sin guardar. Devuelve si la tiene.
    """
    con_farmacia = service.tiene_modulo(db, aseguradora_id, service.MODULO_FARMACIA)
    if con_farmacia and not datos.con_tarifa:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                "Este cliente tiene Farmacovigilancia: falta la tarifa a AccuMedical, "
                "su unidad y la forma de pago de los medicamentos"
            ),
        )
    if not con_farmacia and datos.con_tarifa:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                "La tarifa y la forma de pago de los medicamentos solo van en el contrato "
                "de un cliente con Farmacovigilancia; el precio de sus módulos va en la "
                "pestaña SLA"
            ),
        )
    return con_farmacia
_CAMPOS_CONTRATO = {
    "vigencia_desde": "la fecha de inicio de la vigencia",
    "vigencia_hasta": "la fecha de fin de la vigencia",
    "tarifa": "la tarifa",
    "tarifa_unidad": "la unidad de la tarifa",
    "revision_tarifa": "la fecha de revisión de la tarifa",
    "forma_pago_medicamentos": "la forma de pago de los medicamentos",
}


def _contrato_auditado(c: AseguradoraContrato | None) -> dict[str, object] | None:
    """Lo que se guarda en AuditLog: texto comparable (fechas ISO, tarifa a 4 decimales)."""
    if c is None:
        return None
    return {
        "vigencia_desde": c.vigencia_desde.isoformat(),
        "vigencia_hasta": c.vigencia_hasta.isoformat(),
        "tarifa": _tarifa_texto(c.tarifa),
        "tarifa_unidad": c.tarifa_unidad,
        "revision_tarifa": c.revision_tarifa.isoformat() if c.revision_tarifa else None,
        "forma_pago_medicamentos": c.forma_pago_medicamentos,
    }


def _contrato_valido(crudo: dict[str, object]) -> ContratoEntrada:
    """Valida los datos del contrato llegados por formulario; 422 en palabras si fallan."""
    try:
        return ContratoEntrada.model_validate(crudo)
    except ValidationError as error:
        primero = error.errors()[0]
        campo = str(primero["loc"][0]) if primero.get("loc") else ""
        if primero["type"] == "missing":
            detalle = f"Falta {_CAMPOS_CONTRATO.get(campo, campo)}"
        elif primero["type"] == "value_error":
            detalle = str(primero["msg"]).removeprefix("Value error, ")
        else:
            detalle = f"Revisa {_CAMPOS_CONTRATO.get(campo, 'los datos del contrato')}"
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail=detalle) from None


@router.get("/{aseguradora_id}/polizas", response_model=list[PolizaSalida])
def listar_polizas(
    aseguradora_id: uuid.UUID,
    categoria: str = Query(default="polizas", max_length=30),
    db: DbSession = Depends(get_db),
) -> list[PolizaSalida]:
    service.obtener(db, aseguradora_id)
    return _polizas_out(db, aseguradora_id, _categoria_valida(categoria))


@router.post(
    "/{aseguradora_id}/polizas",
    response_model=list[PolizaSalida],
    status_code=status.HTTP_201_CREATED,
)
async def subir_poliza(
    request: Request,
    aseguradora_id: uuid.UUID,
    archivo: UploadFile = File(...),
    nombre: str = Form(default=""),
    categoria: str = Form(default="polizas"),
    vigencia_desde: str | None = Form(default=None, max_length=10),
    vigencia_hasta: str | None = Form(default=None, max_length=10),
    tarifa: str | None = Form(default=None, max_length=20),
    tarifa_unidad: str | None = Form(default=None, max_length=20),
    revision_tarifa: str | None = Form(default=None, max_length=10),
    forma_pago_medicamentos: str | None = Form(default=None, max_length=30),
    ctx: AuthContext = Depends(gestiona_companias),
    _: None = Depends(verificar_csrf),
    db: DbSession = Depends(get_db),
) -> list[PolizaSalida]:
    aseguradora, _prov, _ciu = service.obtener(db, aseguradora_id)
    categoria = _categoria_valida(categoria)

    # Un contrato o póliza se sube CON sus datos (M1): nunca un PDF a medias.
    # Se valida antes de leer el archivo: si faltan datos, nada llega al almacén.
    crudo = {
        k: v
        for k, v in {
            "vigencia_desde": vigencia_desde,
            "vigencia_hasta": vigencia_hasta,
            "tarifa": tarifa,
            "tarifa_unidad": tarifa_unidad,
            "revision_tarifa": revision_tarifa,
            "forma_pago_medicamentos": forma_pago_medicamentos,
        }.items()
        if v not in (None, "")
    }
    if categoria == "polizas":
        datos_contrato: ContratoEntrada | None = _contrato_valido(crudo)
        _con_farmacia_segun_tarifa(db, aseguradora.id, datos_contrato)
    elif crudo:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Solo un contrato o póliza lleva vigencia, tarifa y forma de pago",
        )
    else:
        datos_contrato = None

    maximo = settings.upload_max_size_mb * 1024 * 1024
    contenido = bytearray()
    while trozo := await archivo.read(CHUNK):
        contenido.extend(trozo)
        if len(contenido) > maximo:
            raise HTTPException(
                status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail=f"El documento no puede superar {settings.upload_max_size_mb} MB",
            )
    if not contenido:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="El archivo está vacío")

    mime = magic.from_buffer(bytes(contenido[:2048]), mime=True)
    if mime != "application/pdf":
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="El documento debe ser un PDF",
        )

    # El nombre visible: lo tecleado o, si no, el nombre del archivo SIN su
    # extensión — texto para enseñar, jamás una ruta de almacenamiento.
    visible = " ".join(nombre.split())[:160]
    if not visible:
        original = Path(archivo.filename or "").stem
        visible = " ".join(original.split())[:160] or "Documento"

    poliza = AseguradoraPoliza(
        aseguradora_id=aseguradora.id,
        nombre=visible,
        categoria=categoria,
        created_by=ctx.user.id,
        updated_by=ctx.user.id,
        ruta="",
    )
    db.add(poliza)
    db.flush()
    contrato: AseguradoraContrato | None = None
    if datos_contrato is not None:
        contrato = AseguradoraContrato(
            poliza_id=poliza.id,
            **datos_contrato.model_dump(),
            created_by=ctx.user.id,
            updated_by=ctx.user.id,
        )
        db.add(contrato)
        # Los CHECK de la base se prueban ANTES de mandar el archivo al almacén.
        db.flush()
    if archivos_central.activo():
        # El archivo vive en el almacén cifrado de la central; aquí, la referencia.
        archivo_id = archivos_central.subir(bytes(contenido), visible, ctx.user.id)
        poliza.ruta = archivos_central.referencia(archivo_id)
    else:
        destino_rel = f"aseguradoras/{aseguradora.id}/polizas/{poliza.id}.pdf"
        destino = Path(settings.upload_dir) / destino_rel
        destino.parent.mkdir(parents=True, exist_ok=True)
        destino.write_bytes(bytes(contenido))
        poliza.ruta = destino_rel

    audit.registrar(
        db,
        accion="crear",
        request=request,
        user_id=ctx.user.id,
        session_id=ctx.sesion.id,
        entidad="aseguradora_polizas",
        entidad_id=str(poliza.id),
        detalle={
            "despues": {
                "nombre": visible,
                "categoria": categoria,
                "bytes": len(contenido),
                "contrato": _contrato_auditado(contrato),
            }
        },
    )
    db.commit()
    return _polizas_out(db, aseguradora_id, categoria)


@router.put(
    "/{aseguradora_id}/polizas/{poliza_id}/contrato", response_model=list[PolizaSalida]
)
def fijar_contrato(
    request: Request,
    aseguradora_id: uuid.UUID,
    poliza_id: uuid.UUID,
    datos: ContratoEntrada,
    ctx: AuthContext = Depends(gestiona_companias),
    _: None = Depends(verificar_csrf),
    db: DbSession = Depends(get_db),
) -> list[PolizaSalida]:
    """
    Completa o corrige los datos del contrato de un PDF. El PDF no cambia
    (otro contrato = otro PDF); el antes y el después quedan en AuditLog.
    """
    poliza = _poliza_de(db, aseguradora_id, poliza_id)
    if poliza.categoria != "polizas":
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Solo un contrato o póliza lleva vigencia, tarifa y forma de pago",
        )
    con_farmacia = _con_farmacia_segun_tarifa(db, aseguradora_id, datos)
    contrato = db.get(AseguradoraContrato, poliza.id, with_for_update=True)
    antes = _contrato_auditado(contrato)
    if contrato is None:
        contrato = AseguradoraContrato(poliza_id=poliza.id, created_by=ctx.user.id)
        db.add(contrato)
    campos = datos.model_dump()
    if not con_farmacia:
        # Sin Farmacovigilancia la tarifa no se edita aquí, pero la que quedó de
        # cuando la tenía se conserva: en medicina no se borra nada.
        for campo in _CAMPOS_TARIFA:
            campos.pop(campo)
    for campo, valor in campos.items():
        setattr(contrato, campo, valor)
    despues = _contrato_auditado(contrato)
    if despues != antes:
        contrato.updated_by = ctx.user.id
        db.flush()
        audit.registrar(
            db,
            accion="crear" if antes is None else "actualizar",
            request=request,
            user_id=ctx.user.id,
            session_id=ctx.sesion.id,
            entidad="aseguradora_contratos",
            entidad_id=str(poliza.id),
            detalle={"documento": poliza.nombre, "antes": antes, "despues": despues},
        )
        db.commit()
    else:
        db.rollback()
    return _polizas_out(db, aseguradora_id, "polizas")


@router.get("/{aseguradora_id}/polizas/{poliza_id}")
def ver_poliza(
    aseguradora_id: uuid.UUID,
    poliza_id: uuid.UUID,
    db: DbSession = Depends(get_db),
) -> FileResponse:
    """El PDF, solo tras autorizar (el router exige admin), sin sniffing."""
    poliza = _poliza_de(db, aseguradora_id, poliza_id)
    if archivos_central.es_referencia(poliza.ruta):
        return archivos_central.respuesta(poliza.ruta, poliza.nombre)
    ruta = Path(settings.upload_dir) / poliza.ruta
    if not ruta.is_file():
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Documento no encontrado")
    return FileResponse(
        ruta,
        media_type="application/pdf",
        headers={"X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store"},
    )


@router.delete(
    "/{aseguradora_id}/polizas/{poliza_id}", status_code=status.HTTP_204_NO_CONTENT
)
def eliminar_poliza(
    request: Request,
    aseguradora_id: uuid.UUID,
    poliza_id: uuid.UUID,
    ctx: AuthContext = Depends(gestiona_companias),
    _: None = Depends(verificar_csrf),
    db: DbSession = Depends(get_db),
) -> None:
    """Borrado lógico; el archivo queda en el volumen, como toda evidencia."""
    poliza = _poliza_de(db, aseguradora_id, poliza_id)
    contrato = _contrato_auditado(db.get(AseguradoraContrato, poliza.id))
    poliza.deleted_at = func.now()
    poliza.deleted_by = ctx.user.id
    audit.registrar(
        db,
        accion="eliminar",
        request=request,
        user_id=ctx.user.id,
        session_id=ctx.sesion.id,
        entidad="aseguradora_polizas",
        entidad_id=str(poliza.id),
        detalle={"antes": {"nombre": poliza.nombre, "contrato": contrato}},
    )
    db.commit()


# ────────────────────────────── Usuarios ─────────────────────────────────────
#
# Un usuario de aseguradora sale de uno de SUS contactos y solo puede acceder a
# los requerimientos que ESA aseguradora tiene contratados. Ambas cosas las
# comprueba el servidor contra la base en cada llamada, no contra lo que mande el
# navegador.


def _nombres_de_requerimiento(db: DbSession) -> tuple[dict[str, str], dict[str, str]]:
    modulos = dict(db.execute(select(Module.code, Module.nombre)).all())
    coberturas = {
        codigo: nombre
        for propias in service.COBERTURAS.values()
        for codigo, nombre in propias
    }
    return modulos, coberturas


def _accesos_out(db: DbSession, accesos: list[dict]) -> list[AccesoSalida]:
    modulos, coberturas = _nombres_de_requerimiento(db)
    return [
        AccesoSalida(
            module_code=a["module_code"],
            module_nombre=modulos.get(a["module_code"], a["module_code"]),
            cobertura_codigo=a["cobertura_codigo"],
            cobertura_nombre=coberturas.get(a["cobertura_codigo"] or ""),
            rol=a["rol"],
        )
        for a in accesos
    ]


def _usuario_out(db: DbSession, usuario, contacto) -> UsuarioSalida:
    # El alcance ya resuelto: el del coordinador se calcula de lo que la
    # compañía tiene contratado hoy, no de filas guardadas.
    acceso = usuarios_service.acceso_de(db, usuario)
    return UsuarioSalida(
        id=str(usuario.id),
        nombre_completo=personas.de_fila(usuario),
        email=usuario.email,
        is_active=usuario.is_active,
        contacto_id=str(contacto.id) if contacto else None,
        password_definida=usuario.last_login_at is not None
        or usuario.password_changed_at > usuario.created_at,
        invitacion_pendiente=usuarios_service.invitacion_viva(db, usuario.id),
        ultimo_acceso=usuario.last_login_at,
        rol=acceso["rol"],
        accesos=_accesos_out(db, acceso["accesos"]),
    )


@router.get("/{aseguradora_id}/requerimientos", response_model=list[RequerimientoOut])
def listar_requerimientos(
    aseguradora_id: uuid.UUID, db: DbSession = Depends(get_db)
) -> list[RequerimientoOut]:
    """Las hojas contratadas. Es la única lista sobre la que se concede acceso."""
    service.obtener(db, aseguradora_id)
    modulos, coberturas = _nombres_de_requerimiento(db)
    return [
        RequerimientoOut(
            module_code=h["module_code"],
            module_nombre=modulos.get(h["module_code"], h["module_code"]),
            cobertura_codigo=h["cobertura_codigo"],
            cobertura_nombre=coberturas.get(h["cobertura_codigo"] or ""),
        )
        for h in usuarios_service.requerimientos_de(db, aseguradora_id)
    ]


@router.get("/{aseguradora_id}/usuarios", response_model=list[UsuarioSalida])
def listar_usuarios(
    aseguradora_id: uuid.UUID, db: DbSession = Depends(get_db)
) -> list[UsuarioSalida]:
    service.obtener(db, aseguradora_id)
    return [
        _usuario_out(db, usuario, contacto)
        for usuario, contacto in usuarios_service.listar(db, aseguradora_id)
    ]


@router.post(
    "/{aseguradora_id}/usuarios",
    response_model=UsuarioSalida,
    status_code=status.HTTP_201_CREATED,
)
def crear_usuario(
    request: Request,
    aseguradora_id: uuid.UUID,
    datos: UsuarioCrear,
    ctx: AuthContext = Depends(gestiona_companias),
    _: None = Depends(verificar_csrf),
    db: DbSession = Depends(get_db),
) -> UsuarioSalida:
    service.obtener(db, aseguradora_id)
    try:
        contacto_id = uuid.UUID(datos.contacto_id)
    except ValueError as error:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Contacto no válido"
        ) from error

    usuario, token = usuarios_service.crear_desde_contacto(
        db,
        aseguradora_id,
        contacto_id,
        datos.acceso.model_dump(),
        ctx.user.id,
    )
    audit.registrar(
        db,
        accion="usuario_creado",
        request=request,
        user_id=ctx.user.id,
        session_id=ctx.sesion.id,
        entidad="users",
        entidad_id=str(usuario.id),
        detalle={
            "aseguradora_id": str(aseguradora_id),
            "rol": datos.acceso.rol,
            "accesos": [
                {"modulo": a.module_code, "cobertura": a.cobertura_codigo}
                for a in datos.acceso.accesos
            ],
        },
    )
    db.commit()

    # DESPUÉS del commit: un correo enviado no se puede deshacer, así que primero
    # se asegura que el usuario existe de verdad. Si el envío falla, el usuario
    # queda creado y se reenvía la invitación desde la pantalla.
    invitaciones.enviar_invitacion(usuario, token)
    return _usuario_out(db, usuario, None)


@router.patch("/{aseguradora_id}/usuarios/{user_id}", response_model=UsuarioSalida)
def actualizar_usuario(
    request: Request,
    aseguradora_id: uuid.UUID,
    user_id: uuid.UUID,
    datos: UsuarioActualizar,
    ctx: AuthContext = Depends(gestiona_companias),
    _: None = Depends(verificar_csrf),
    db: DbSession = Depends(get_db),
) -> UsuarioSalida:
    usuario = usuarios_service.obtener(db, aseguradora_id, user_id)
    detalle: dict = {}

    # No se desactiva a quien tiene casos abiertos, ni se le quita la app donde
    # los tiene (14/10/2026): primero deben culminar, cancelarse o no auditarse.
    if datos.is_active is False and usuario.is_active:
        pendientes.validar(db, usuario.id, accion="desactivar a este usuario")
    # Supervisor y ejecutivo van por módulo (19/10/2026): quitarle un módulo
    # donde tiene casos abiertos no se puede. El supervisor «de toda la
    # compañía» de antes abarcaba todos los que tienen regla.
    if datos.acceso is not None and usuario.is_active:
        nuevas = {a.module_code for a in datos.acceso.accesos}
        actuales = (
            pendientes.con_regla()
            if usuarios_service.es_coordinador_de_compania(db, usuario.id)
            else pendientes.modulos_vigentes(db, usuario.id)
        )
        quitadas = actuales - nuevas
        if quitadas:
            pendientes.validar(db, usuario.id, quitadas, accion="quitarle esa aplicación")

    if datos.acceso is not None:
        usuarios_service.fijar_acceso(db, usuario, datos.acceso.model_dump(), ctx.user.id)
        detalle["rol"] = datos.acceso.rol
        detalle["accesos"] = [
            {"modulo": a.module_code, "cobertura": a.cobertura_codigo}
            for a in datos.acceso.accesos
        ]
    if datos.is_active is not None and datos.is_active != usuario.is_active:
        # Reactivar a un supervisor: si otro tomó alguno de sus módulos
        # mientras estaba desactivado, no caben dos y se corta aquí.
        if datos.is_active and usuarios_service.es_coordinador(db, usuario.id):
            if usuarios_service.es_coordinador_de_compania(db, usuario.id):
                usuarios_service.validar_coordinador_unico(
                    db, usuario.aseguradora_id, salvo_user_id=usuario.id
                )
            usuarios_service.validar_supervisores_unicos(
                db, usuario.aseguradora_id,
                usuarios_service.modulos_supervisados(db, usuario.id),
                salvo_user_id=usuario.id,
            )
        usuario.is_active = datos.is_active
        detalle["is_active"] = datos.is_active
        # Desactivar mata TODAS sus sesiones vivas, no solo impide entrar de nuevo.
        if not datos.is_active:
            detalle["sesiones_revocadas"] = auth_service.revocar_sesiones_de_usuario(
                db, usuario.id, "user_deactivated"
            )
            # Libera su puesto de coordinador de la compañía para el reemplazo.
            plataforma_usuarios.liberar_puestos(db, usuario, ctx.user.id)
        # Trazabilidad (historial_accesos): nada se borra, los tramos se cierran.
        db.flush()
        plataforma_usuarios.sincronizar_historial(db, usuario, ctx.user.id)

    if detalle:
        usuario.updated_by = ctx.user.id
        audit.registrar(
            db,
            accion="usuario_actualizado" if datos.is_active is not False else "usuario_desactivado",
            request=request,
            user_id=ctx.user.id,
            session_id=ctx.sesion.id,
            entidad="users",
            entidad_id=str(user_id),
            detalle=detalle,
        )
    db.commit()
    return _usuario_out(db, usuario, None)


@router.post(
    "/{aseguradora_id}/usuarios/{user_id}/invitacion",
    status_code=status.HTTP_202_ACCEPTED,
)
def reenviar_invitacion(
    request: Request,
    aseguradora_id: uuid.UUID,
    user_id: uuid.UUID,
    ctx: AuthContext = Depends(gestiona_companias),
    _: None = Depends(verificar_csrf),
    db: DbSession = Depends(get_db),
) -> dict:
    """Emite una invitación nueva e invalida la anterior."""
    usuario = usuarios_service.obtener(db, aseguradora_id, user_id)
    if not usuario.is_active:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail="El usuario está desactivado: actívalo antes de invitarlo",
        )
    token = invitaciones.emitir(db, usuario, ctx.user.id)
    audit.registrar(
        db,
        accion="invitacion_enviada",
        request=request,
        user_id=ctx.user.id,
        session_id=ctx.sesion.id,
        entidad="users",
        entidad_id=str(user_id),
        detalle={"reenvio": True},
    )
    db.commit()
    invitaciones.enviar_invitacion(usuario, token)
    return {"detail": "Invitación enviada"}
