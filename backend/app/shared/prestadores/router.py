from __future__ import annotations

import uuid
from pathlib import Path

import magic
from fastapi import (
    APIRouter,
    Depends,
    File,
    HTTPException,
    Query,
    Request,
    Response,
    UploadFile,
    status,
)
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session as DbSession

from app.core.config import settings
from app.core.db import get_db
from app.core.security.deps import AuthContext, require_funcion, verificar_csrf
from app.shared import personas
from app.shared.aseguradoras.models import CONCEPTOS_FC
from app.shared.audit import service as audit
from app.shared.prestadores import convenios as convenios_service
from app.shared.prestadores import service
from app.shared.prestadores.schemas import (
    ConceptoFCSalida,
    ContactoSalida,
    ConvenioAseguradoraOut,
    ConvenioSalida,
    ConveniosDePrestadorFijar,
    PaginaPrestadores,
    PrestadorActualizar,
    PrestadorCrear,
    PrestadorDetalle,
    PrestadorResumen,
    PuntoMapa,
    SedeSalida,
    ValoresFC,
    ValoresFCSalida,
)

# Router protegido a nivel de APIRouter: cualquier endpoint que se añada aquí
# nace protegido (decisión D-10 de la iteración 1). Entran el administrador
# global y quien lleva la función «convenio», que gestiona la red entera: los
# prestadores son con quienes se pactan los convenios, así que aquí tiene
# acceso completo.
router = APIRouter(
    prefix="/shared/prestadores",
    tags=["prestadores"],
    dependencies=[Depends(require_funcion("convenio"))],
)

MIME_PERMITIDOS = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/webp": ".webp",
}
CHUNK = 64 * 1024


def _resumen(fila) -> PrestadorResumen:
    p, provincia, ciudad, tipo_nombre = fila
    return PrestadorResumen(
        id=str(p.id),
        codigo_interno=p.codigo_interno,
        nombre=p.nombre,
        tipo_codigo=p.tipo_codigo,
        tipo_nombre=tipo_nombre,
        ruc=p.ruc,
        estado=p.estado,
        provincia_nombre=provincia,
        ciudad_nombre=ciudad,
        tiene_logo=bool(p.logo_path),
    )


def _detalle_completo(db: DbSession, prestador_id) -> PrestadorDetalle:
    fila = service.obtener(db, prestador_id)
    p = fila[0]
    nombres_tipo = service.nombres_tipos_documento(db)
    sedes = service.sedes_de(db, p.id)
    # Un solo viaje por catálogo para todas las sedes, no uno por sede.
    nombres_provincia, nombres_ciudad = service.nombres_de_ubicacion(
        db, [(s.provincia_codigo, s.ciudad_codigo) for s in sedes]
    )
    return PrestadorDetalle(
        **_resumen(fila).model_dump(),
        provincia_codigo=p.provincia_codigo,
        ciudad_codigo=p.ciudad_codigo,
        direccion=p.direccion,
        latitud=float(p.latitud),
        longitud=float(p.longitud),
        contactos=[
            ContactoSalida(
                id=str(c.id),
                **personas.partes_out(c),
                email=c.email,
                telefono=c.telefono,
                tipo_documento_codigo=c.tipo_documento_codigo,
                tipo_documento_nombre=nombres_tipo.get(c.tipo_documento_codigo or ""),
                numero_documento=c.numero_documento,
                sede_id=str(c.sede_id) if c.sede_id else None,
                cargo=c.cargo,
            )
            for c in service.contactos_de(db, p.id)
        ],
        sedes=[
            SedeSalida(
                id=str(s.id),
                nombre=s.nombre,
                provincia_codigo=s.provincia_codigo,
                provincia_nombre=nombres_provincia.get(s.provincia_codigo),
                ciudad_codigo=s.ciudad_codigo,
                ciudad_nombre=nombres_ciudad.get(s.ciudad_codigo),
                direccion=s.direccion,
                telefono=s.telefono,
                email=s.email,
                latitud=float(s.latitud),
                longitud=float(s.longitud),
                estado=s.estado,
            )
            for s in sedes
        ],
        aseguradoras=[
            ConvenioSalida(
                id=str(convenio.id),
                aseguradora_id=str(convenio.aseguradora_id),
                aseguradora_razon_social=razon_social,
                aseguradora_nombre_comercial=nombre_comercial,
                aseguradora_ruc=ruc,
                codigo_convenio=convenio.codigo_convenio,
                fecha_inicio=convenio.fecha_inicio,
                fecha_fin=convenio.fecha_fin,
                estado=convenio.estado,
                observaciones=convenio.observaciones,
            )
            for convenio, razon_social, nombre_comercial, ruc in service.aseguradoras_de(db, p.id)
        ],
    )


@router.get("", response_model=PaginaPrestadores)
def listar(
    search: str | None = Query(default=None, max_length=120),
    estado: str | None = Query(default=None, pattern="^(activo|inactivo|suspendido)$"),
    tipo_codigo: str | None = Query(default=None, max_length=20),
    provincia_codigo: str | None = Query(default=None, min_length=2, max_length=2),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=service.MAX_PAGE_SIZE),
    db: DbSession = Depends(get_db),
) -> PaginaPrestadores:
    filas, total = service.listar(
        db,
        search=search,
        estado=estado,
        tipo_codigo=tipo_codigo,
        provincia_codigo=provincia_codigo,
        page=page,
        page_size=page_size,
    )
    return PaginaPrestadores(
        items=[_resumen(f) for f in filas], total=total, page=page, page_size=page_size
    )


# Declarado ANTES de `/{prestador_id}`: si fuera después, «mapa» entraría por
# esa ruta y moriría como uuid mal formado.
@router.get("/mapa", response_model=list[PuntoMapa])
def mapa(
    aseguradora_id: uuid.UUID | None = Query(default=None),
    db: DbSession = Depends(get_db),
) -> list[PuntoMapa]:
    """
    Los puntos del mapa: el del prestador y el de cada sede activa. Con
    `aseguradora_id`, solo los prestadores con convenio vivo con esa compañía.
    """
    puntos = service.puntos_del_mapa(db, aseguradora_id=aseguradora_id)
    return [PuntoMapa(**punto) for punto in puntos]


@router.get("/{prestador_id}", response_model=PrestadorDetalle)
def obtener(prestador_id: uuid.UUID, db: DbSession = Depends(get_db)) -> PrestadorDetalle:
    return _detalle_completo(db, prestador_id)


@router.post("", response_model=PrestadorDetalle, status_code=status.HTTP_201_CREATED)
def crear(
    request: Request,
    datos: PrestadorCrear,
    ctx: AuthContext = Depends(require_funcion("convenio")),
    _: None = Depends(verificar_csrf),
    db: DbSession = Depends(get_db),
) -> PrestadorDetalle:
    cuerpo = datos.model_dump()
    contactos = cuerpo.pop("contactos", [])
    sedes = cuerpo.pop("sedes", [])
    prestador = service.crear(db, cuerpo, ctx.user.id)
    db.flush()
    cambio_contactos = service.fijar_contactos(db, prestador.id, contactos, ctx.user.id)
    cambio_sedes = service.fijar_sedes(db, prestador.id, sedes, ctx.user.id)
    audit.registrar(
        db,
        accion="crear",
        request=request,
        user_id=ctx.user.id,
        session_id=ctx.sesion.id,
        entidad="prestadores",
        entidad_id=str(prestador.id),
        detalle={
            "despues": {
                "codigo_interno": prestador.codigo_interno,
                "ruc": prestador.ruc,
                "contactos": cambio_contactos,
                "sedes": cambio_sedes,
            }
        },
    )
    db.commit()
    return _detalle_completo(db, prestador.id)


@router.patch("/{prestador_id}", response_model=PrestadorDetalle)
def actualizar(
    request: Request,
    prestador_id: uuid.UUID,
    datos: PrestadorActualizar,
    ctx: AuthContext = Depends(require_funcion("convenio")),
    _: None = Depends(verificar_csrf),
    db: DbSession = Depends(get_db),
) -> PrestadorDetalle:
    prestador = service.obtener(db, prestador_id)[0]
    cambios = datos.model_dump(exclude_unset=True)
    contactos = cambios.pop("contactos", None)
    sedes = cambios.pop("sedes", None)
    diff = service.actualizar(db, prestador, cambios, ctx.user.id)
    if contactos is not None:
        cambio_contactos = service.fijar_contactos(db, prestador_id, contactos, ctx.user.id)
        if cambio_contactos:
            diff["despues"]["contactos"] = cambio_contactos
    if sedes is not None:
        cambio_sedes = service.fijar_sedes(db, prestador_id, sedes, ctx.user.id)
        if cambio_sedes:
            diff["despues"]["sedes"] = cambio_sedes
    if diff["despues"]:
        audit.registrar(
            db,
            accion="actualizar",
            request=request,
            user_id=ctx.user.id,
            session_id=ctx.sesion.id,
            entidad="prestadores",
            entidad_id=str(prestador_id),
            detalle=diff,
        )
    db.commit()
    return _detalle_completo(db, prestador_id)


@router.delete("/{prestador_id}", status_code=status.HTTP_204_NO_CONTENT)
def eliminar(
    request: Request,
    prestador_id: uuid.UUID,
    ctx: AuthContext = Depends(require_funcion("convenio")),
    _: None = Depends(verificar_csrf),
    db: DbSession = Depends(get_db),
) -> Response:
    prestador = service.obtener(db, prestador_id)[0]
    service.eliminar(db, prestador, ctx.user.id)
    audit.registrar(
        db,
        accion="eliminar",
        request=request,
        user_id=ctx.user.id,
        session_id=ctx.sesion.id,
        entidad="prestadores",
        entidad_id=str(prestador_id),
        detalle={"antes": {"codigo_interno": prestador.codigo_interno}},
    )
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ────────────────────────────── Logo (A08) ───────────────────────────────────


@router.post("/{prestador_id}/logo", response_model=PrestadorDetalle)
async def subir_logo(
    request: Request,
    prestador_id: uuid.UUID,
    archivo: UploadFile = File(...),
    ctx: AuthContext = Depends(require_funcion("convenio")),
    _: None = Depends(verificar_csrf),
    db: DbSession = Depends(get_db),
) -> PrestadorDetalle:
    prestador = service.obtener(db, prestador_id)[0]

    maximo = settings.upload_max_size_mb * 1024 * 1024
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

    # Tipo REAL leído del contenido, no la extensión ni el Content-Type del cliente.
    mime = magic.from_buffer(bytes(contenido[:2048]), mime=True)
    if mime not in MIME_PERMITIDOS:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="El logo debe ser una imagen PNG, JPEG o WebP",
        )

    destino_rel = f"prestadores/{prestador.id}{MIME_PERMITIDOS[mime]}"
    destino = Path(settings.upload_dir) / destino_rel
    destino.parent.mkdir(parents=True, exist_ok=True)

    anterior = prestador.logo_path
    destino.write_bytes(bytes(contenido))
    if anterior and anterior != destino_rel:
        (Path(settings.upload_dir) / anterior).unlink(missing_ok=True)

    prestador.logo_path = destino_rel
    prestador.updated_by = ctx.user.id
    audit.registrar(
        db,
        accion="logo_subido",
        request=request,
        user_id=ctx.user.id,
        session_id=ctx.sesion.id,
        entidad="prestadores",
        entidad_id=str(prestador_id),
        detalle={"mime": mime, "bytes": len(contenido)},
    )
    db.commit()
    return _detalle_completo(db, prestador_id)


@router.get("/{prestador_id}/logo")
def obtener_logo(prestador_id: uuid.UUID, db: DbSession = Depends(get_db)) -> FileResponse:
    """Se sirve solo después de autorizar; el router entero exige admin global."""
    prestador = service.obtener(db, prestador_id)[0]
    if not prestador.logo_path:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Sin logo")

    ruta = Path(settings.upload_dir) / prestador.logo_path
    if not ruta.is_file():
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Sin logo")

    tipo = next(
        (m for m, ext in MIME_PERMITIDOS.items() if ruta.suffix == ext),
        "application/octet-stream",
    )
    return FileResponse(
        ruta,
        media_type=tipo,
        headers={"X-Content-Type-Options": "nosniff", "Cache-Control": "private, max-age=60"},
    )


# ─────────── Convenios del prestador: su red, desde este lado ───────────────
#
# Espejo de `/shared/aseguradoras/{id}/convenios`: la MISMA tabla y la misma
# mecánica —marcar crea el convenio, desmarcar lo retira—, leída desde el
# prestador. Que existan los dos lados no abre dos verdades: es la misma fila.


def _convenios_del_prestador_out(
    db: DbSession, prestador_id: uuid.UUID
) -> list[ConvenioAseguradoraOut]:
    return [
        ConvenioAseguradoraOut(
            aseguradora_id=str(fila["aseguradora"].id),
            codigo_interno=fila["aseguradora"].codigo_interno,
            razon_social=fila["aseguradora"].razon_social,
            nombre_comercial=fila["aseguradora"].nombre_comercial,
            ruc=fila["aseguradora"].ruc,
            ciudad_nombre=fila["ciudad_nombre"],
            marcado=fila["marcado"],
            convenio_id=str(fila["convenio"].id) if fila["convenio"] else None,
            listado_precios_nombre=(
                fila["convenio"].listado_precios_nombre if fila["convenio"] else None
            ),
            red_privada=fila["convenio"].red_privada if fila["convenio"] else True,
            red_publica=fila["convenio"].red_publica if fila["convenio"] else False,
        )
        for fila in service.convenios_de_prestador(db, prestador_id)
    ]


@router.get("/{prestador_id}/convenios", response_model=list[ConvenioAseguradoraOut])
def listar_convenios(
    prestador_id: uuid.UUID, db: DbSession = Depends(get_db)
) -> list[ConvenioAseguradoraOut]:
    service.obtener(db, prestador_id)
    return _convenios_del_prestador_out(db, prestador_id)


@router.put("/{prestador_id}/convenios", response_model=list[ConvenioAseguradoraOut])
def fijar_convenios(
    request: Request,
    prestador_id: uuid.UUID,
    datos: ConveniosDePrestadorFijar,
    ctx: AuthContext = Depends(require_funcion("convenio")),
    _: None = Depends(verificar_csrf),
    db: DbSession = Depends(get_db),
) -> list[ConvenioAseguradoraOut]:
    service.obtener(db, prestador_id)
    try:
        seleccion = [
            {
                "aseguradora_id": uuid.UUID(a.aseguradora_id),
                "red_privada": a.red_privada,
                "red_publica": a.red_publica,
            }
            for a in datos.aseguradoras
        ]
    except ValueError as error:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Hay una aseguradora no válida"
        ) from error

    diff = service.fijar_convenios_de_prestador(db, prestador_id, seleccion, ctx.user.id)
    if diff is not None:
        audit.registrar(
            db,
            accion="actualizar",
            request=request,
            user_id=ctx.user.id,
            session_id=ctx.sesion.id,
            entidad="aseguradora_prestador",
            entidad_id=str(prestador_id),
            detalle={"despues": diff},
        )
        db.commit()
    return _convenios_del_prestador_out(db, prestador_id)


# ──────────────── Valores del convenio (Factor de Cobertura) ────────────────
#
# Cuelgan del prestador y no de una ruta suelta: así el convenio se comprueba
# siempre contra SU prestador, y el identificador de un convenio ajeno no abre
# los valores de otra compañía.


# Con qué modo nace un concepto que todavía no se ha pactado. No es un
# capricho: es cómo se venía pactando cada uno antes de que el modo fuera
# elegible, así que un convenio nuevo arranca en lo habitual y se cambia si toca.
MODO_INICIAL = {
    "cirugia": ("punto", None),
    "anestesia": ("porcentaje", "cirugia"),
    "evaluacion_manejo": ("punto", None),
    "uci": ("punto", None),
    "ucin": ("punto", None),
    "recien_nacido": ("punto", None),
    "medicina": ("punto", None),
    "imagenologia": ("punto", None),
    "ayudante": ("porcentaje", "cirugia"),
}


def _valores_out(db: DbSession, convenio_id: uuid.UUID, aseguradora_nombre: str) -> ValoresFCSalida:
    """
    Los conceptos del convenio, **todos**, pactados o no: la pantalla los pinta
    igual y no tiene que conocer ni el catálogo ni con qué modo nace cada uno.
    """
    pactados = {fila.concepto: fila for fila in convenios_service.fc_de(db, convenio_id)}
    importes = convenios_service.importes_derivados(list(pactados.values()))

    def num(valor) -> float | None:
        return float(valor) if valor is not None else None

    conceptos = []
    for concepto in CONCEPTOS_FC:
        fila = pactados.get(concepto)
        modo, base = MODO_INICIAL[concepto]
        conceptos.append(
            ConceptoFCSalida(
                concepto=concepto,
                nombre=convenios_service.NOMBRES_FC[concepto],
                modo=fila.modo if fila else modo,
                valor=num(fila.valor) if fila else None,
                base=(fila.base if fila else base),
                importe=num(importes.get(concepto)),
                pactado=fila is not None,
            )
        )
    return ValoresFCSalida(
        convenio_id=str(convenio_id),
        aseguradora_nombre=aseguradora_nombre,
        conceptos=conceptos,
    )


@router.get(
    "/{prestador_id}/convenios/{convenio_id}/valores", response_model=ValoresFCSalida
)
def obtener_valores(
    prestador_id: uuid.UUID,
    convenio_id: uuid.UUID,
    db: DbSession = Depends(get_db),
) -> ValoresFCSalida:
    _, aseguradora = convenios_service.obtener_convenio(db, prestador_id, convenio_id)
    return _valores_out(db, convenio_id, aseguradora)


@router.put(
    "/{prestador_id}/convenios/{convenio_id}/valores", response_model=ValoresFCSalida
)
def guardar_valores(
    request: Request,
    prestador_id: uuid.UUID,
    convenio_id: uuid.UUID,
    datos: ValoresFC,
    ctx: AuthContext = Depends(require_funcion("convenio")),
    _: None = Depends(verificar_csrf),
    db: DbSession = Depends(get_db),
) -> ValoresFCSalida:
    _, aseguradora = convenios_service.obtener_convenio(db, prestador_id, convenio_id)
    conceptos = [c.model_dump() for c in datos.conceptos]
    convenios_service.fijar_fc(db, convenio_id, conceptos, ctx.user.id)
    audit.registrar(
        db,
        accion="actualizar",
        request=request,
        user_id=ctx.user.id,
        session_id=ctx.sesion.id,
        entidad="aseguradora_prestador_fc",
        entidad_id=str(convenio_id),
        detalle={"despues": {"conceptos": conceptos}},
    )
    db.commit()
    return _valores_out(db, convenio_id, aseguradora)
