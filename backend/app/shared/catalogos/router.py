from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from app.core.db import get_db
from app.core.security.deps import AuthContext, get_current_user, require_funcion
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
