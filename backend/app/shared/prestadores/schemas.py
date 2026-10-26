from __future__ import annotations

import datetime as dt
import re
import uuid
from decimal import Decimal
from typing import Annotated, Literal

from pydantic import BaseModel, EmailStr, Field, field_validator, model_validator

from app.shared import identificacion, personas
from app.shared.geo import Latitud, Longitud

Estado = Literal["activo", "inactivo", "suspendido"]
Texto = Annotated[str, Field(min_length=1, max_length=200)]


class _ConRuc(BaseModel):
    @field_validator("ruc", check_fields=False)
    @classmethod
    def _ruc_valido(cls, v: str | None) -> str | None:
        if v is None:
            return v
        v = v.strip()
        # Mismo formato que el CHECK de la base. Se valida aquí también para
        # devolver un error legible en lugar de un fallo de integridad.
        if not re.fullmatch(r"[0-9]{13}", v):
            raise ValueError("El RUC debe tener exactamente 13 dígitos")
        # Y su dígito verificador: trece dígitos cualesquiera no son un RUC.
        if not identificacion.ruc_valido(v):
            raise ValueError("El RUC no es válido: revisa el número")
        return v


class ContactoEntrada(BaseModel):
    """Un contacto tal como llega del formulario. Sin `id` = alta nueva."""

    id: str | None = None
    # Cuatro partes; obligatorios el primer nombre y el apellido paterno.
    nombre_principal: personas.NombreObligatorio
    nombre_secundario: personas.NombreOpcional = None
    apellido_paterno: personas.NombreObligatorio
    apellido_materno: personas.NombreOpcional = None
    email: EmailStr
    telefono: str | None = Field(default=None, max_length=25)
    tipo_documento_codigo: str | None = Field(default=None, max_length=10)
    numero_documento: str | None = Field(default=None, max_length=20)
    cargo: str | None = Field(default=None, max_length=100)
    # La sede a la que pertenece; None = la casa matriz.
    sede_id: uuid.UUID | None = None

    _obligatorios = field_validator("nombre_principal", "apellido_paterno")(
        personas.validar_solo_letras
    )
    _opcionales = field_validator("nombre_secundario", "apellido_materno")(
        personas.opcional_o_nulo
    )
    _telefono = field_validator("telefono")(identificacion.normalizar_telefono)

    @field_validator("email", mode="after")
    @classmethod
    def _correo_en_mayusculas(cls, v):  # noqa: ANN001, ANN206
        # 19/10/2026 (regla del cliente): el correo va en MAYÚSCULAS, como el
        # resto del expediente; la contraseña es lo único que queda libre. El
        # login compara sin distinguir mayúsculas (CITEXT).
        return v.strip().upper() if isinstance(v, str) else v


class ContactoSalida(BaseModel):
    id: str
    nombre_principal: str
    nombre_secundario: str | None
    apellido_paterno: str
    apellido_materno: str | None
    # Ya compuesto por el servidor: ver app/shared/personas.py.
    nombre_completo: str
    email: str
    telefono: str | None
    tipo_documento_codigo: str | None
    tipo_documento_nombre: str | None
    numero_documento: str | None
    cargo: str | None
    sede_id: str | None = None


EstadoSede = Literal["activa", "inactiva"]


class SedeEntrada(BaseModel):
    """
    Una sede tal como llega del formulario. Sin `id` = alta nueva.

    Tener sedes es opcional; la sede que se manda va entera, coordenadas
    incluidas: una sede sin punto no sirve para saber dónde está.
    """

    id: str | None = None
    nombre: Annotated[str, Field(min_length=1, max_length=150)]
    provincia_codigo: Annotated[str, Field(min_length=2, max_length=2)]
    ciudad_codigo: Annotated[str, Field(min_length=4, max_length=4)]
    direccion: Annotated[str, Field(min_length=1, max_length=300)]
    telefono: str | None = Field(default=None, max_length=25)
    email: EmailStr | None = None
    latitud: Latitud
    longitud: Longitud
    estado: EstadoSede = "activa"

    _telefono = field_validator("telefono")(identificacion.normalizar_telefono)

    @field_validator("email", mode="after")
    @classmethod
    def _correo_en_mayusculas(cls, v):  # noqa: ANN001, ANN206
        # 19/10/2026 (regla del cliente): el correo va en MAYÚSCULAS, como el
        # resto del expediente; la contraseña es lo único que queda libre. El
        # login compara sin distinguir mayúsculas (CITEXT).
        return v.strip().upper() if isinstance(v, str) else v


class SedeSalida(BaseModel):
    id: str
    nombre: str
    provincia_codigo: str
    provincia_nombre: str | None
    ciudad_codigo: str
    ciudad_nombre: str | None
    direccion: str
    telefono: str | None
    email: str | None
    latitud: float
    longitud: float
    estado: str


EstadoConvenio = Literal["vigente", "suspendido", "terminado"]


class ConvenioAseguradoraOut(BaseModel):
    """
    Una compañía del catálogo, con la marca de si tiene convenio con ESTE
    prestador. Espejo de `ConvenioPrestadorOut`: la misma tabla leída desde el
    otro lado, así que la pantalla del prestador y la de la aseguradora hacen
    lo mismo con la misma pieza.
    """

    aseguradora_id: str
    codigo_interno: str
    razon_social: str
    nombre_comercial: str | None
    ruc: str
    ciudad_nombre: str | None
    marcado: bool
    # Solo cuando el convenio está guardado: habilita editar su detalle.
    convenio_id: str | None = None
    listado_precios_nombre: str | None = None
    # Qué red cubre el convenio. Sin convenio, los valores con los que nacería.
    red_privada: bool = True
    red_publica: bool = False


class AseguradoraEnRed(BaseModel):
    """Una compañía marcada, con la red que cubre su convenio."""

    aseguradora_id: str
    red_privada: bool = True
    red_publica: bool = False

    @model_validator(mode="after")
    def _alguna_red(self) -> AseguradoraEnRed:
        # El CHECK de la base lo impide igual; aquí sale con un mensaje legible.
        if not (self.red_privada or self.red_publica):
            raise ValueError(
                "Un convenio cubre al menos una red: marca privada, pública o las dos"
            )
        return self


class ConveniosDePrestadorFijar(BaseModel):
    """La red completa del prestador: las compañías marcadas. Reconciliación total."""

    aseguradoras: list[AseguradoraEnRed] = Field(default_factory=list, max_length=5000)


class ConvenioSalida(BaseModel):
    id: str
    aseguradora_id: str
    aseguradora_razon_social: str
    aseguradora_nombre_comercial: str | None
    aseguradora_ruc: str
    codigo_convenio: str | None
    fecha_inicio: dt.date
    fecha_fin: dt.date | None
    estado: str
    observaciones: str | None


class PuntoMapa(BaseModel):
    """
    Un sitio donde se atiende, con su punto. El prestador aporta el suyo y cada
    sede activa el propio: por eso `sede_nombre` distingue unos de otros y un
    mismo `prestador_id` puede aparecer en varias ciudades.
    """

    prestador_id: str
    codigo_interno: str
    nombre: str
    tipo_nombre: str
    estado: str
    sede_nombre: str | None
    direccion: str | None
    provincia_codigo: str | None
    provincia_nombre: str | None
    ciudad_codigo: str | None
    ciudad_nombre: str | None
    latitud: float
    longitud: float


class PrestadorCrear(_ConRuc):
    tipo_codigo: Annotated[str, Field(min_length=1, max_length=20)]
    nombre: Texto
    # La identidad del prestador. No hay elección: solo RUC.
    ruc: str
    estado: Estado = "activo"
    # Obligatorias (pedido del usuario, 26/10/2026).
    provincia_codigo: Annotated[str, Field(min_length=2, max_length=2)]
    ciudad_codigo: Annotated[str, Field(min_length=4, max_length=4)]
    direccion: str | None = Field(default=None, max_length=300)
    # Punto exacto en el mapa: obligatorio en el alta.
    latitud: Latitud
    longitud: Longitud
    contactos: list[ContactoEntrada] = Field(default_factory=list)
    # Lista vacía = sin sedes, que es un estado válido.
    sedes: list[SedeEntrada] = Field(default_factory=list)
    # Aseguradoras con las que el prestador tiene convenio. También opcional.


class PrestadorActualizar(_ConRuc):
    """Edición parcial: solo se toca lo que llega."""

    tipo_codigo: str | None = Field(default=None, min_length=1, max_length=20)
    nombre: Texto | None = None
    ruc: str | None = None
    estado: Estado | None = None
    provincia_codigo: str | None = Field(default=None, min_length=2, max_length=2)
    ciudad_codigo: str | None = Field(default=None, min_length=4, max_length=4)
    direccion: str | None = Field(default=None, max_length=300)
    # Se pueden mover, pero no vaciar: la columna es NOT NULL.
    latitud: Latitud | None = None
    longitud: Longitud | None = None
    contactos: list[ContactoEntrada] | None = None
    # None = no se tocan las sedes; lista = se reconcilia contra ella.
    sedes: list[SedeEntrada] | None = None

    @field_validator("provincia_codigo", "ciudad_codigo")
    @classmethod
    def _ubicacion_no_se_vacia(cls, valor: str | None) -> str:
        # Se pueden cambiar, pero no vaciar: son obligatorias.
        if valor is None:
            raise ValueError("La provincia y la ciudad son obligatorias")
        return valor


class PrestadorResumen(BaseModel):
    """Lo que necesita la tabla del listado, sin traer el registro entero."""

    id: str
    codigo_interno: str
    nombre: str
    tipo_codigo: str
    tipo_nombre: str
    ruc: str
    estado: str
    provincia_nombre: str | None
    ciudad_nombre: str | None
    tiene_logo: bool


class PrestadorDetalle(PrestadorResumen):
    provincia_codigo: str | None
    ciudad_codigo: str | None
    direccion: str | None
    latitud: float
    longitud: float
    contactos: list[ContactoSalida]
    sedes: list[SedeSalida]
    aseguradoras: list[ConvenioSalida]


class PaginaPrestadores(BaseModel):
    items: list[PrestadorResumen]
    total: int
    page: int
    page_size: int


# ──────────────────── Valores del convenio (Factor de Cobertura) ─────────────

ModoFC = Literal["punto", "porcentaje", "fijo"]


class ConceptoFC(BaseModel):
    """
    Un concepto del convenio tal como llega del formulario: **cómo se pacta y
    con qué cifra**.

    El valor es opcional porque un concepto puede estar pactado sin cifra
    todavía. Su rango no se declara con un tipo fijo —un porcentaje llega hasta
    100 y un importe no— sino en el servicio, que conoce el modo y puede nombrar
    el concepto en el mensaje.
    """

    concepto: Annotated[str, Field(min_length=1, max_length=30)]
    modo: ModoFC
    valor: Annotated[Decimal, Field(ge=0, max_digits=12, decimal_places=2)] | None = None
    # De qué concepto sale, cuando es un porcentaje. Nulo en los otros modos.
    base: Annotated[str, Field(min_length=1, max_length=30)] | None = None


class ValoresFC(BaseModel):
    """Lo pactado en el convenio: la lista COMPLETA de conceptos."""

    conceptos: list[ConceptoFC] = Field(default_factory=list, max_length=20)


class ConceptoFCSalida(BaseModel):
    concepto: str
    # Cómo se lee. Lo manda el servidor para que la pantalla no mantenga su
    # propio diccionario de nombres.
    nombre: str
    modo: ModoFC
    valor: float | None
    base: str | None
    # Calculado, no guardado: `valor de la base × porcentaje / 100`. Solo lo
    # tienen los porcentajes, y solo si su base ya tiene cifra.
    importe: float | None
    # False mientras el concepto no se ha guardado nunca: la pantalla lo enseña
    # igual, con el modo con el que nacería.
    pactado: bool


class ValoresFCSalida(BaseModel):
    convenio_id: str
    aseguradora_nombre: str
    # Los conceptos del convenio, en el orden de la pantalla, pactados o no.
    conceptos: list[ConceptoFCSalida]
