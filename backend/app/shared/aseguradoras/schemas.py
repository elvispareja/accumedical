from __future__ import annotations

import datetime as dt
import re
from decimal import Decimal
from typing import Annotated, Literal

from pydantic import BaseModel, EmailStr, Field, field_validator, model_validator

from app.shared import identificacion, personas
from app.shared.geo import Latitud, Longitud

ESTADOS = ("activo", "inactivo")
Estado = Literal["activo", "inactivo"]

Texto = Annotated[str, Field(min_length=1, max_length=200)]


class _ConRuc(BaseModel):
    @field_validator("ruc", check_fields=False)
    @classmethod
    def _ruc_valido(cls, v: str) -> str:
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
    # Opcionales. El documento va a medias o entero: lo comprueba el servicio
    # contra el catálogo, y la base lo garantiza con un CHECK.
    telefono: str | None = Field(default=None, max_length=25)
    tipo_documento_codigo: str | None = Field(default=None, max_length=10)
    numero_documento: str | None = Field(default=None, max_length=20)
    cargo: str | None = Field(default=None, max_length=100)

    _obligatorios = field_validator("nombre_principal", "apellido_paterno")(
        personas.validar_solo_letras
    )
    _opcionales = field_validator("nombre_secundario", "apellido_materno")(
        personas.opcional_o_nulo
    )
    _telefono = field_validator("telefono")(identificacion.normalizar_telefono)


class PuntoMapaAseguradora(BaseModel):
    """
    Una compañía sobre el mapa. Un solo punto por compañía: su domicilio. No
    lleva sedes, que es lo que hace que un prestador aparezca varias veces.
    """

    id: str
    codigo_interno: str
    razon_social: str
    nombre_comercial: str | None
    ruc: str
    estado: str
    direccion_fiscal: str | None
    provincia_codigo: str | None
    provincia_nombre: str | None
    ciudad_codigo: str | None
    ciudad_nombre: str | None
    latitud: float
    longitud: float


class ConvenioPrestadorOut(BaseModel):
    """Un prestador del catálogo, con la marca de si está en la red de ESTA aseguradora."""

    prestador_id: str
    codigo_interno: str
    nombre: str
    tipo_nombre: str
    ciudad_nombre: str | None
    marcado: bool
    # Solo cuando el convenio está guardado: habilita editar su detalle.
    convenio_id: str | None = None
    listado_precios_nombre: str | None = None
    # Qué red cubre el convenio. Sin convenio son los valores con los que
    # nacería, para que la casilla se pinte igual antes y después de guardar.
    red_privada: bool = True
    red_publica: bool = False


class PrestadorEnRed(BaseModel):
    """
    Un prestador marcado, con la red que cubre su convenio. Dos casillas y no
    un valor de tres: «ambas» es marcar las dos.
    """

    prestador_id: str
    red_privada: bool = True
    red_publica: bool = False

    @model_validator(mode="after")
    def _alguna_red(self) -> PrestadorEnRed:
        # El CHECK de la base lo impide igual; aquí sale con un mensaje legible.
        if not (self.red_privada or self.red_publica):
            raise ValueError(
                "Un convenio cubre al menos una red: marca privada, pública o las dos"
            )
        return self


class ConveniosFijar(BaseModel):
    """La red completa: los prestadores marcados. Reconciliación total."""

    prestadores: list[PrestadorEnRed] = Field(default_factory=list, max_length=5000)


class AseguradoraPropiaOut(BaseModel):
    """La ficha interna de Accumedical: solo lo que «Red convenio» necesita."""

    id: str
    nombre: str


class SlaEntrada(BaseModel):
    """
    Lo pactado para un módulo. Los dos valores son OBLIGATORIOS: un módulo
    contratado sin SLA es un acuerdo a medias, y el servicio además exige que
    lleguen TODOS los módulos activos de la compañía.
    """

    module_code: Annotated[str, Field(min_length=1, max_length=30)]
    horas: Annotated[Decimal, Field(ge=0, le=9999, decimal_places=2)]
    precio: Annotated[Decimal, Field(ge=0, decimal_places=2)]


class SlaFijar(BaseModel):
    """La tabla completa, un renglón por módulo contratado."""

    items: list[SlaEntrada] = Field(default_factory=list, max_length=50)


class SlaSalida(BaseModel):
    """Un módulo contratado con su SLA."""

    module_code: str
    module_nombre: str
    grupo: str | None
    # Nulos solo en fichas anteriores a que el SLA fuera obligatorio; toda
    # escritura nueva los exige.
    horas: float | None
    precio: float | None


class ListadoPreciosSalida(BaseModel):
    """Confirmación de la subida: el nombre visible con el que quedó el listado."""

    listado_precios_nombre: str


class PolizaSalida(BaseModel):
    """Un PDF de pólizas y planes; el archivo se pide a su propio endpoint."""

    id: str
    nombre: str
    creada_at: dt.datetime


class ContactoSalida(BaseModel):
    id: str
    nombre_principal: str
    nombre_secundario: str | None
    apellido_paterno: str
    apellido_materno: str | None
    # Ya compuesto por el servidor: quien solo enseña el nombre usa esto y no
    # vuelve a decidir el orden por su cuenta.
    nombre_completo: str
    email: str
    telefono: str | None
    tipo_documento_codigo: str | None
    tipo_documento_nombre: str | None
    numero_documento: str | None
    cargo: str | None


class CoberturaHabilitada(BaseModel):
    """Subrama de un módulo. Hoy solo calificación tiene."""

    codigo: str
    nombre: str
    activo: bool


class ModuloHabilitado(BaseModel):
    """Un módulo de la plataforma y si esta aseguradora puede entrar en él."""

    codigo: str
    slug: str
    nombre: str
    color_acento: str
    orden: int
    activo: bool
    # Vacío en los módulos que no tienen subramas.
    coberturas: list[CoberturaHabilitada] = []


class AseguradoraCrear(_ConRuc):
    razon_social: Texto
    nombre_comercial: str | None = Field(default=None, max_length=200)
    ruc: str
    estado: Estado = "activo"
    provincia_codigo: str | None = Field(default=None, min_length=2, max_length=2)
    ciudad_codigo: str | None = Field(default=None, min_length=4, max_length=4)
    direccion_fiscal: str | None = Field(default=None, max_length=300)
    # Punto exacto en el mapa: obligatorio en el alta.
    latitud: Latitud
    longitud: Longitud
    # Códigos de los módulos marcados. Una aseguradora nueva nace sin ninguno:
    # deny by default, igual que en el resto de la plataforma.
    modulos: list[str] = Field(default_factory=list)
    # Coberturas marcadas, por código de módulo. Solo se aplican a los módulos
    # que vengan marcados; las de un módulo destildado se dejan intactas.
    coberturas: dict[str, list[str]] = Field(default_factory=dict)
    contactos: list[ContactoEntrada] = Field(default_factory=list)


class AseguradoraActualizar(_ConRuc):
    """Edición parcial: solo se toca lo que llega."""

    razon_social: Texto | None = None
    nombre_comercial: str | None = Field(default=None, max_length=200)
    ruc: str | None = None
    estado: Estado | None = None
    provincia_codigo: str | None = Field(default=None, min_length=2, max_length=2)
    ciudad_codigo: str | None = Field(default=None, min_length=4, max_length=4)
    direccion_fiscal: str | None = Field(default=None, max_length=300)
    # Se pueden mover, pero no vaciar: la columna es NOT NULL.
    latitud: Latitud | None = None
    longitud: Longitud | None = None
    # None = no se tocan los módulos; lista = se reconcilia contra ella.
    modulos: list[str] | None = None
    coberturas: dict[str, list[str]] | None = None
    contactos: list[ContactoEntrada] | None = None


class AseguradoraResumen(BaseModel):
    """Lo que necesita la tabla del listado, sin traer el registro entero."""

    id: str
    codigo_interno: str
    razon_social: str
    nombre_comercial: str | None
    ruc: str
    estado: str
    provincia_nombre: str | None
    ciudad_nombre: str | None
    tiene_logo: bool


class AseguradoraDetalle(BaseModel):
    id: str
    codigo_interno: str
    razon_social: str
    nombre_comercial: str | None
    ruc: str
    estado: str
    provincia_codigo: str | None
    provincia_nombre: str | None
    ciudad_codigo: str | None
    ciudad_nombre: str | None
    direccion_fiscal: str | None
    latitud: float
    longitud: float
    tiene_logo: bool
    modulos: list[ModuloHabilitado]
    contactos: list[ContactoSalida]


class PaginaAseguradoras(BaseModel):
    items: list[AseguradoraResumen]
    total: int
    page: int
    page_size: int


# ────────────────────────────── Usuarios ─────────────────────────────────────

Rol = Literal["supervisor", "operador"]


class RequerimientoOut(BaseModel):
    """Una hoja de lo contratado: un módulo sin coberturas, o una cobertura."""

    module_code: str
    module_nombre: str
    cobertura_codigo: str | None
    cobertura_nombre: str | None


class AccesoEntrada(BaseModel):
    """Un requerimiento marcado, con el rol que se le da a ESE requerimiento."""

    module_code: Annotated[str, Field(min_length=1, max_length=30)]
    cobertura_codigo: str | None = Field(default=None, max_length=30)
    rol: Rol


class AccesoSalida(BaseModel):
    module_code: str
    module_nombre: str
    cobertura_codigo: str | None
    cobertura_nombre: str | None
    rol: str


class AccesoUsuario(BaseModel):
    """
    A qué entra un usuario de la compañía. Un rol por persona:

    - **coordinador**: la compañía entera —todo lo que ella tenga contratado—,
      y uno solo por aseguradora. No lleva lista: su alcance se calcula.
    - **operador**: los requerimientos que se le marquen.
    """

    rol: Literal["coordinador", "operador"]
    accesos: list[AccesoEntrada] = Field(default_factory=list)

    @model_validator(mode="after")
    def _coherente(self):
        if self.rol == "coordinador":
            if self.accesos:
                raise ValueError(
                    "El coordinador abarca la compañía entera: no se le marcan requerimientos"
                )
        elif not self.accesos:
            raise ValueError("Marca al menos un requerimiento: sin ellos no entra a nada")
        return self


class UsuarioCrear(BaseModel):
    """El usuario sale de un contacto: no se teclean nombre ni correo."""

    contacto_id: str
    acceso: AccesoUsuario


class UsuarioActualizar(BaseModel):
    acceso: AccesoUsuario | None = None
    is_active: bool | None = None


class UsuarioSalida(BaseModel):
    id: str
    # El usuario de aseguradora no se teclea: sale de su contacto, así que aquí
    # el nombre solo se enseña.
    nombre_completo: str
    email: str
    is_active: bool
    contacto_id: str | None
    # Falso hasta que la persona usa su enlace y fija su contraseña.
    password_definida: bool
    invitacion_pendiente: bool
    ultimo_acceso: dt.datetime | None
    # El rol y, ya resueltos, los requerimientos a los que entra. Para el
    # coordinador salen de lo que la compañía tiene contratado hoy.
    rol: str
    accesos: list[AccesoSalida]
