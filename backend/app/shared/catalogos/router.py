from __future__ import annotations

from fastapi import APIRouter, Depends, Path, Query, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from app.core.db import get_db
from app.core.security.deps import (
    AuthContext,
    get_current_user,
    require_funcion,
    require_global_admin,
    require_personal_accumedical,
    verificar_csrf,
)
from app.shared.aseguradoras.service import COBERTURAS
from app.shared.catalogos.models import Ciudad, Module, Provincia, TipoDocumento, TipoPrestador
from app.shared.users.models import Role

router = APIRouter(prefix="/shared/catalogos", tags=["catalogos"])

# Quién puede ver el catálogo COMPLETO de módulos y sus coberturas: el
# administrador global y la función «contabilidad», que marca lo que cada
# compañía contrata. Se crea una sola vez: FastAPI cachea las dependencias por
# identidad y repetir la llamada consultaría la base dos veces por petición.
arma_la_ficha = require_funcion("contabilidad")


class OpcionCatalogo(BaseModel):
    codigo: str
    nombre: str


@router.get("/provincias", response_model=list[OpcionCatalogo])
def listar_provincias(
    _: AuthContext = Depends(get_current_user),
    db: DbSession = Depends(get_db),
) -> list[OpcionCatalogo]:
    filas = db.execute(
        select(Provincia.codigo, Provincia.nombre)
        .where(Provincia.activo.is_(True))
        .order_by(Provincia.nombre)
    ).all()
    return [OpcionCatalogo(codigo=c, nombre=n) for c, n in filas]


@router.get("/ciudades", response_model=list[OpcionCatalogo])
def listar_ciudades(
    provincia_codigo: str = Query(min_length=2, max_length=2),
    _: AuthContext = Depends(get_current_user),
    db: DbSession = Depends(get_db),
) -> list[OpcionCatalogo]:
    """
    Ciudades (cantones) de una provincia. El formulario las pide en cascada: sin
    provincia elegida no hay lista que mostrar, así que el parámetro es obligatorio.
    """
    filas = db.execute(
        select(Ciudad.codigo, Ciudad.nombre)
        .where(Ciudad.provincia_codigo == provincia_codigo, Ciudad.activo.is_(True))
        .order_by(Ciudad.nombre)
    ).all()
    return [OpcionCatalogo(codigo=c, nombre=n) for c, n in filas]


class ModuloCatalogo(BaseModel):
    codigo: str
    slug: str
    nombre: str
    color_acento: str
    orden: int
    # La familia comercial (suscripcion | siniestro): las pantallas agrupan con
    # esto. Presentación pura, jamás autorización.
    grupo: str | None = None
    # La rama dentro de la familia («siniestros_hospitalarios»…): el subtítulo.
    subgrupo: str | None = None
    # Si se le puede dar el rol «call_center» (14/10/2026; hoy solo Calificación).
    con_call_center: bool = False


@router.get("/modulos", response_model=list[ModuloCatalogo])
def listar_modulos(
    _: AuthContext = Depends(arma_la_ficha),
    db: DbSession = Depends(get_db),
) -> list[ModuloCatalogo]:
    """
    Catálogo completo de módulos vivos, para las casillas de la aseguradora.

    No lo abre cualquiera a propósito: `/shared/modulos` devuelve solo los
    módulos del propio usuario justamente para no filtrar cuáles existen, y este
    sí los lista todos. Lo ven quienes marcan lo que una compañía contrata: el
    administrador global y la función «contabilidad».
    """
    filas = db.execute(
        select(
            Module.code, Module.slug, Module.nombre, Module.color_acento, Module.orden,
            Module.grupo, Module.subgrupo,
        )
        .where(Module.activo.is_(True))
        .order_by(Module.orden, Module.nombre)
    ).all()
    con_call_center = set(
        db.scalars(
            select(Role.module_code).where(Role.code == "call_center", Role.activo.is_(True))
        )
    )
    return [
        ModuloCatalogo(
            codigo=f[0], slug=f[1], nombre=f[2], color_acento=f[3], orden=f[4],
            grupo=f[5], subgrupo=f[6], con_call_center=f[0] in con_call_center,
        )
        for f in filas
    ]


class CoberturaCatalogo(BaseModel):
    module_code: str
    codigo: str
    nombre: str


@router.get("/coberturas", response_model=list[CoberturaCatalogo])
def listar_coberturas(
    _: AuthContext = Depends(arma_la_ficha),
) -> list[CoberturaCatalogo]:
    """
    En qué coberturas se divide cada módulo (hoy, solo Calificación). Es lo que
    convierte la lista de módulos en hojas: los formularios de acceso no ofrecen
    «Calificación», ofrecen sus tres coberturas. Mismo requisito que el catálogo
    de módulos, y por el mismo motivo.
    """
    return [
        CoberturaCatalogo(module_code=module_code, codigo=codigo, nombre=nombre)
        for module_code, pares in COBERTURAS.items()
        for codigo, nombre in pares
    ]


@router.get("/tipos-documento", response_model=list[OpcionCatalogo])
def listar_tipos_documento(
    _: AuthContext = Depends(get_current_user),
    db: DbSession = Depends(get_db),
) -> list[OpcionCatalogo]:
    """Cédula, RUC y pasaporte. Alimenta el selector de documento del contacto."""
    filas = db.execute(
        select(TipoDocumento.codigo, TipoDocumento.nombre)
        .where(TipoDocumento.activo.is_(True))
        .order_by(TipoDocumento.nombre)
    ).all()
    return [OpcionCatalogo(codigo=c, nombre=n) for c, n in filas]


class TipoPrestadorCatalogo(BaseModel):
    codigo: str
    nombre: str
    # Gobierna la validación del formulario: una persona exige especialidad y
    # registro profesional; un establecimiento, registro sanitario.
    es_persona: bool


@router.get("/tipos-prestador", response_model=list[TipoPrestadorCatalogo])
def listar_tipos_prestador(
    _: AuthContext = Depends(get_current_user),
    db: DbSession = Depends(get_db),
) -> list[TipoPrestadorCatalogo]:
    filas = db.execute(
        select(TipoPrestador.codigo, TipoPrestador.nombre, TipoPrestador.es_persona)
        .where(TipoPrestador.activo.is_(True))
        .order_by(TipoPrestador.nombre)
    ).all()
    return [TipoPrestadorCatalogo(codigo=c, nombre=n, es_persona=e) for c, n, e in filas]


# ─────────────────────────────── CIE-10 ───────────────────────────────
#
# La CIE-10 vive en la central (D-centralización, 15/10/2026): aquí solo se
# pasa la consulta con la credencial de la plataforma (`catalogos:leer`). La usa
# el buscador de admin.pymes.ec/admin/cie10 (19/10/2026). Es catálogo público,
# pero se reserva al personal de Accumedical, como Pacientes.


class Cie10(BaseModel):
    codigo: str
    descripcion: str
    nivel: int
    categoria: str
    capitulo: str | None
    capitulo_titulo: str | None
    grupo: str | None
    grupo_titulo: str | None
    simbolo: str | None
    seleccionable: bool
    activo: bool
    origen: str
    sexo: str | None
    edad_min_dias: int | None
    edad_max_dias: int | None


class Cie10Capitulo(BaseModel):
    capitulo: str
    titulo: str
    desde: str
    hasta: str
    seleccionables: int


def _central_cie10(ruta: str) -> list[dict]:
    from fastapi import HTTPException, status

    from app.core.central import CentralError, cliente

    try:
        estado, r = cliente().llamar("GET", ruta)
    except CentralError as error:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE, detail="El catálogo CIE-10 no responde ahora"
        ) from error
    if estado == 422:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Búsqueda no válida")
    if estado != 200 or not isinstance(r, list):
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE, detail="El catálogo CIE-10 no responde ahora"
        )
    return r


@router.get("/cie10-capitulos", response_model=list[Cie10Capitulo])
def capitulos_cie10(_: AuthContext = Depends(require_personal_accumedical)) -> list[dict]:
    return _central_cie10("/api/catalogos/cie10-capitulos")


@router.get("/cie10", response_model=list[Cie10])
def buscar_cie10(
    q: str | None = Query(default=None, min_length=2, max_length=80),
    capitulo: str | None = Query(default=None, pattern=r"^[IVX]{1,5}$"),
    # Las categorías de 3 caracteres que agrupan (E11) no se usan en un
    # diagnóstico; se pueden ver para orientarse.
    incluir_agrupadores: bool = False,
    incluir_inactivos: bool = False,
    limit: int = Query(default=30, ge=1, le=50),
    offset: int = Query(default=0, ge=0, le=20000),
    _: AuthContext = Depends(require_personal_accumedical),
) -> list[dict]:
    from urllib.parse import urlencode

    from fastapi import HTTPException, status

    if not q and not capitulo:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Escriba un código o una palabra")
    parametros = {
        "solo_seleccionables": str(not incluir_agrupadores).lower(),
        "incluir_inactivos": str(incluir_inactivos).lower(),
        "limit": limit,
        "offset": offset,
    }
    if q:
        parametros["q"] = q
    if capitulo:
        parametros["capitulo"] = capitulo
    return _central_cie10("/api/catalogos/cie10?" + urlencode(parametros))


# ─────────────────────── Vademécum maestro (6/11/2026) ───────────────────────
# Vive en la central; aquí se pasa la consulta. Para el personal de Accumedical:
# lo usa el admin para armar el vademécum de cada producto y ver el maestro.


class VademecumCodigos(BaseModel):
    codigos: list[str] = Field(max_length=3000)


@router.get("/vademecum")
def buscar_vademecum(
    q: str | None = Query(default=None, min_length=2, max_length=80),
    forma: str | None = Query(default=None, max_length=120),
    via: str | None = Query(default=None, max_length=120),
    nivel_prescripcion: str | None = Query(default=None, max_length=30),
    limit: int = Query(default=50, ge=1, le=1000),
    offset: int = Query(default=0, ge=0, le=10000),
    _: AuthContext = Depends(require_personal_accumedical),
) -> list[dict]:
    from app.shared.central import vademecum

    return vademecum.buscar({"q": q, "forma": forma, "via": via,
                             "nivel_prescripcion": nivel_prescripcion,
                             "limit": limit, "offset": offset})


@router.get("/vademecum-filtros")
def filtros_vademecum(_: AuthContext = Depends(require_personal_accumedical)) -> dict:
    from app.shared.central import vademecum

    return vademecum.filtros()


@router.post("/vademecum/codigos")
def vademecum_por_codigos(
    datos: VademecumCodigos,
    _: AuthContext = Depends(require_personal_accumedical),
) -> list[dict]:
    """Los medicamentos de esos códigos (para mostrar lo elegido en un producto)."""
    from app.shared.central import vademecum

    return list(vademecum.por_codigos(datos.codigos).values())


@router.get("/vademecum/plantilla-precios")
def plantilla_precios(_: AuthContext = Depends(require_personal_accumedical)) -> Response:
    """El Excel que llena cada farmacia con sus precios (todo el maestro activo)."""
    from app.shared.central import vademecum

    return Response(
        content=vademecum.plantilla_precios(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={
            "Content-Disposition": 'attachment; filename="lista-de-precios-plantilla.xlsx"',
            "X-Content-Type-Options": "nosniff",
            "Cache-Control": "private, no-store",
        },
    )


# ──────────────── Diagnósticos agrupadores de la CIE-10 (6/11/2026) ────────────────
# Viven en la central: el código que une diagnósticos equivalentes para que la
# misma enfermedad sea UN evento (especificación de la Central, págs. 3 y 12–13).
# Los ve el personal de Accumedical; los ajusta solo el administrador global
# (cambian cómo se cuentan los topes de TODOS los clientes). La central guarda
# quién lo hizo; aquí queda además en la AuditLog de la plataforma.

PATRON_AGRUPADOR = r"^AGR-[0-9]{5}$"


class AgrupadorRenombrar(BaseModel):
    model_config = {"extra": "forbid"}

    nombre: str = Field(min_length=1, max_length=300)
    motivo: str | None = Field(default=None, max_length=600)


class AgrupadorMover(BaseModel):
    model_config = {"extra": "forbid"}

    codigos: list[str] = Field(min_length=1, max_length=3000)
    destino: str | None = Field(default=None, pattern=PATRON_AGRUPADOR)
    nombre_nuevo: str | None = Field(default=None, max_length=300)
    motivo: str | None = Field(default=None, max_length=600)


class AgrupadorJuntar(BaseModel):
    model_config = {"extra": "forbid"}

    otros: list[str] = Field(min_length=1, max_length=50)
    motivo: str | None = Field(default=None, max_length=600)


def _auditar_agrupador(
    db: DbSession, request: Request, ctx: AuthContext, codigo: str, detalle: dict
) -> None:
    from app.shared.audit import service as audit

    audit.registrar(
        db,
        accion="actualizar",
        request=request,
        user_id=ctx.user.id,
        session_id=ctx.sesion.id,
        entidad="cie10_agrupador",
        entidad_id=codigo,
        detalle=detalle,
    )
    db.commit()


@router.get("/cie10-agrupadores")
def buscar_agrupadores(
    q: str | None = Query(default=None, min_length=2, max_length=80),
    capitulo: str | None = Query(default=None, pattern=r"^[IVX]{1,5}$"),
    solo_ajustados: bool = False,
    incluir_inactivos: bool = False,
    offset: int = Query(default=0, ge=0, le=20000),
    _: AuthContext = Depends(require_personal_accumedical),
) -> dict:
    from app.shared.central import agrupadores

    return agrupadores.buscar({
        "q": q,
        "capitulo": capitulo,
        "solo_ajustados": "true" if solo_ajustados else None,
        "incluir_inactivos": "true" if incluir_inactivos else None,
        "offset": offset or None,
    })


@router.get("/cie10-agrupadores/{codigo}")
def ver_agrupador(
    codigo: str = Path(pattern=PATRON_AGRUPADOR),
    _: AuthContext = Depends(require_personal_accumedical),
) -> dict:
    from app.shared.central import agrupadores

    return agrupadores.ver(codigo)


@router.put("/cie10-agrupadores/{codigo}")
def renombrar_agrupador(
    request: Request,
    datos: AgrupadorRenombrar,
    codigo: str = Path(pattern=PATRON_AGRUPADOR),
    ctx: AuthContext = Depends(require_global_admin),
    _: None = Depends(verificar_csrf),
    db: DbSession = Depends(get_db),
) -> dict:
    from app.shared.central import agrupadores

    salida = agrupadores.renombrar(codigo, datos.model_dump(), ctx.user.id)
    _auditar_agrupador(db, request, ctx, codigo, {"renombrar": salida.get("nombre"),
                                                  "motivo": datos.motivo})
    return salida


@router.post("/cie10-agrupadores/mover")
def mover_a_agrupador(
    request: Request,
    datos: AgrupadorMover,
    ctx: AuthContext = Depends(require_global_admin),
    _: None = Depends(verificar_csrf),
    db: DbSession = Depends(get_db),
) -> dict:
    from app.shared.central import agrupadores

    salida = agrupadores.mover(datos.model_dump(), ctx.user.id)
    _auditar_agrupador(db, request, ctx, salida.get("codigo", ""), {
        "mover": len(datos.codigos), "codigos": datos.codigos[:300], "nuevo": datos.destino is None,
        "motivo": datos.motivo,
    })
    return salida


@router.post("/cie10-agrupadores/{codigo}/juntar")
def juntar_agrupadores(
    request: Request,
    datos: AgrupadorJuntar,
    codigo: str = Path(pattern=PATRON_AGRUPADOR),
    ctx: AuthContext = Depends(require_global_admin),
    _: None = Depends(verificar_csrf),
    db: DbSession = Depends(get_db),
) -> dict:
    from app.shared.central import agrupadores

    salida = agrupadores.juntar(codigo, datos.model_dump(), ctx.user.id)
    _auditar_agrupador(db, request, ctx, codigo, {"juntar": datos.otros, "motivo": datos.motivo})
    return salida


@router.post("/cie10-agrupadores/{codigo}/sugerencias")
def sugerir_agrupacion(
    codigo: str = Path(pattern=PATRON_AGRUPADOR),
    ctx: AuthContext = Depends(require_global_admin),
    _: None = Depends(verificar_csrf),
) -> list[dict]:
    """La IA propone; no cambia nada (cada propuesta se junta a mano)."""
    from app.shared.central import agrupadores

    return agrupadores.sugerencias(codigo, ctx.user.id)

