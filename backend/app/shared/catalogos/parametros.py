from __future__ import annotations

import re
import unicodedata
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session as DbSession

from app.core.db import get_db
from app.core.security.deps import AuthContext, require_funcion, verificar_csrf
from app.shared.audit import service as audit
from app.shared.catalogos.models import TipoPrestador
from app.shared.prestadores.models import Prestador

# Los parámetros del sistema: los catálogos que la propia gente mantiene, en vez
# de tener que pedir una migración para añadir «Centro de imágenes».
#
# Entra quien puede crear prestadores —administrador global y la función
# «convenio»—, y por el mismo motivo: si alguien da de alta prestadores, tiene
# que poder nombrar su tipo. MISMA dependencia que el router de prestadores, no
# una parecida: es la misma puerta.
puede_gestionar = require_funcion("convenio")

router = APIRouter(
    prefix="/shared/parametros",
    tags=["parametros"],
    dependencies=[Depends(puede_gestionar)],
)

NOMBRE_MAX = 100
CODIGO_MAX = 20


class TipoPrestadorOut(BaseModel):
    codigo: str
    nombre: str
    es_persona: bool
    activo: bool
    # Cuántos prestadores VIVOS lo usan. Es lo que decide si se puede retirar, y
    # la pantalla lo enseña para que se entienda por qué.
    en_uso: int


class TipoPrestadorCrear(BaseModel):
    nombre: Annotated[str, Field(min_length=2, max_length=NOMBRE_MAX)]
    es_persona: bool = False


class TipoPrestadorActualizar(BaseModel):
    """Edición parcial: solo se toca lo que llega."""

    nombre: Annotated[str, Field(min_length=2, max_length=NOMBRE_MAX)] | None = None
    es_persona: bool | None = None
    activo: bool | None = None


def _codigo_desde(nombre: str) -> str:
    """
    El código lo genera el sistema a partir del nombre, no lo teclea nadie: es
    identidad técnica —la FK que llevan los prestadores— y pedirlo solo invita a
    inventarse uno que después no se puede cambiar.

    «Centro de imágenes» -> `centro_de_imagenes`.
    """
    sin_tildes = "".join(
        c for c in unicodedata.normalize("NFD", nombre) if unicodedata.category(c) != "Mn"
    )
    limpio = re.sub(r"[^a-z0-9]+", "_", sin_tildes.lower()).strip("_")
    return (limpio or "tipo")[:CODIGO_MAX]


def _codigo_libre(db: DbSession, nombre: str) -> str:
    """El código de arriba, con un sufijo si ya existe —aunque esté retirado—."""
    base = _codigo_desde(nombre)
    candidato = base
    for n in range(2, 100):
        if db.get(TipoPrestador, candidato) is None:
            return candidato
        sufijo = f"_{n}"
        candidato = f"{base[: CODIGO_MAX - len(sufijo)]}{sufijo}"
    raise HTTPException(
        status.HTTP_409_CONFLICT, detail="No pudimos generar un código para ese nombre"
    )


def _en_uso(db: DbSession, codigo: str) -> int:
    return (
        db.scalar(
            select(func.count())
            .select_from(Prestador)
            .where(Prestador.tipo_codigo == codigo, Prestador.deleted_at.is_(None))
        )
        or 0
    )


def _nombre_libre(db: DbSession, nombre: str, salvo: str | None = None) -> None:
    """Dos tipos con el mismo nombre serían indistinguibles en el desplegable."""
    consulta = select(TipoPrestador.codigo).where(
        func.lower(TipoPrestador.nombre) == nombre.strip().lower()
    )
    if salvo is not None:
        consulta = consulta.where(TipoPrestador.codigo != salvo)
    if db.scalar(consulta) is not None:
        raise HTTPException(
            status.HTTP_409_CONFLICT, detail="Ya existe un tipo de prestador con ese nombre"
        )


def _salida(db: DbSession, tipo: TipoPrestador) -> TipoPrestadorOut:
    return TipoPrestadorOut(
        codigo=tipo.codigo,
        nombre=tipo.nombre,
        es_persona=tipo.es_persona,
        activo=tipo.activo,
        en_uso=_en_uso(db, tipo.codigo),
    )


def _obtener(db: DbSession, codigo: str) -> TipoPrestador:
    tipo = db.get(TipoPrestador, codigo)
    if tipo is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Tipo de prestador no encontrado")
    return tipo


@router.get("/tipos-prestador", response_model=list[TipoPrestadorOut])
def listar_tipos_prestador(db: DbSession = Depends(get_db)) -> list[TipoPrestadorOut]:
    """
    TODOS, ofrecidos y retirados, que es lo que hay que administrar. El
    desplegable del formulario de prestadores sigue pidiendo los suyos a
    `/shared/catalogos/tipos-prestador`, que devuelve solo los vivos.
    """
    filas = db.scalars(select(TipoPrestador).order_by(TipoPrestador.nombre)).all()
    return [_salida(db, t) for t in filas]


@router.post(
    "/tipos-prestador", response_model=TipoPrestadorOut, status_code=status.HTTP_201_CREATED
)
def crear_tipo_prestador(
    request: Request,
    datos: TipoPrestadorCrear,
    ctx: AuthContext = Depends(puede_gestionar),
    _: None = Depends(verificar_csrf),
    db: DbSession = Depends(get_db),
) -> TipoPrestadorOut:
    nombre = datos.nombre.strip()
    _nombre_libre(db, nombre)
    tipo = TipoPrestador(
        codigo=_codigo_libre(db, nombre), nombre=nombre, es_persona=datos.es_persona
    )
    db.add(tipo)
    audit.registrar(
        db,
        accion="crear",
        request=request,
        user_id=ctx.user.id,
        session_id=ctx.sesion.id,
        entidad="tipos_prestador",
        entidad_id=tipo.codigo,
        detalle={"despues": {"nombre": nombre, "es_persona": datos.es_persona}},
    )
    db.commit()
    return _salida(db, tipo)


@router.patch("/tipos-prestador/{codigo}", response_model=TipoPrestadorOut)
def actualizar_tipo_prestador(
    request: Request,
    codigo: str,
    datos: TipoPrestadorActualizar,
    ctx: AuthContext = Depends(puede_gestionar),
    _: None = Depends(verificar_csrf),
    db: DbSession = Depends(get_db),
) -> TipoPrestadorOut:
    """
    Cambia el nombre, la naturaleza o si se sigue ofreciendo.

    **Retirar uno EN USO no se permite.** El código es la FK que llevan los
    prestadores ya registrados: si desapareciera del desplegable, al reabrir la
    ficha de uno de ellos su tipo no estaría en la lista y el primer guardado lo
    cambiaría por otro. La base impide el borrado físico (FK RESTRICT), pero aquí
    no se borra nada —se retira—, así que este aviso lo tiene que dar el
    servicio.

    El NOMBRE sí se puede cambiar siempre: corregir «Hosipital» no toca a nadie,
    porque lo que guarda el prestador es el código.
    """
    tipo = _obtener(db, codigo)
    cambios = datos.model_dump(exclude_unset=True)
    antes = {"nombre": tipo.nombre, "es_persona": tipo.es_persona, "activo": tipo.activo}

    if cambios.get("activo") is False and tipo.activo:
        usos = _en_uso(db, codigo)
        if usos:
            cuantos = "prestador" if usos == 1 else "prestadores"
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                detail=(
                    f"«{tipo.nombre}» lo usan {usos} {cuantos}: no se puede retirar. "
                    "Cámbiales el tipo primero."
                ),
            )

    if cambios.get("nombre") is not None:
        nombre = cambios["nombre"].strip()
        _nombre_libre(db, nombre, salvo=codigo)
        tipo.nombre = nombre
    if cambios.get("es_persona") is not None:
        tipo.es_persona = cambios["es_persona"]
    if cambios.get("activo") is not None:
        tipo.activo = cambios["activo"]

    despues = {"nombre": tipo.nombre, "es_persona": tipo.es_persona, "activo": tipo.activo}
    diff = {k: v for k, v in despues.items() if antes[k] != v}
    if diff:
        audit.registrar(
            db,
            accion="actualizar",
            request=request,
            user_id=ctx.user.id,
            session_id=ctx.sesion.id,
            entidad="tipos_prestador",
            entidad_id=codigo,
            detalle={"antes": {k: antes[k] for k in diff}, "despues": diff},
        )
    db.commit()
    return _salida(db, tipo)
