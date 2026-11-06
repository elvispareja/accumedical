from __future__ import annotations

import datetime as dt
import re
import unicodedata
from decimal import Decimal
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator, model_validator

from app.shared import identificacion, personas
from app.shared.geo import Latitud, Longitud

ESTADOS = ("activo", "inactivo")
Estado = Literal["activo", "inactivo"]
#: Qué clase de cliente es (5/11/2026). Mismos valores que el CHECK y la central.
TipoAseguradora = Literal["aseguradora", "broker", "cooperativa"]
#: Condiciones del producto (M2, 6/11/2026): mismos valores que los CHECK.
SERVICIOS_PRODUCTO = ("farmacia", "teleconsulta", "consulta_ambulatoria", "hospitalaria")
ServicioProducto = Literal["farmacia", "teleconsulta", "consulta_ambulatoria", "hospitalaria"]
UnidadTope = Literal["evento", "persona_mes", "persona_anio", "receta"]
VentanaEvento = Literal["mes_calendario", "dias_moviles_30", "vigencia_poliza"]
PARENTESCOS = ("conyuge", "hijos", "padres")
Parentesco = Literal["conyuge", "hijos", "padres"]
#: Datos del contrato (6/11/2026): mismos valores que los CHECK de la tabla.
UnidadTarifa = Literal["asegurado_mes", "evento", "fija_mensual"]
FormaPagoMedicamentos = Literal["reembolso_aparte", "incluido_en_tarifa"]
# Una fecha fuera de este rango es un error de tecleo («0226» por «2026»).
_FECHA_MINIMA = dt.date(2000, 1, 1)
_FECHA_MAXIMA = dt.date(2100, 12, 31)

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

    @field_validator("email", mode="after")
    @classmethod
    def _correo_en_mayusculas(cls, v):  # noqa: ANN001, ANN206
        # 19/10/2026 (regla del cliente): el correo va en MAYÚSCULAS, como el
        # resto del expediente; la contraseña es lo único que queda libre. El
        # login compara sin distinguir mayúsculas (CITEXT).
        return v.strip().upper() if isinstance(v, str) else v


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
    # True en Farmacovigilancia (6/11/2026): su SLA es la vigencia de la receta
    # y va en cada producto; aquí no lleva horas ni precio.
    sla_en_producto: bool = False


class ListadoPreciosSalida(BaseModel):
    """Confirmación de la subida: el nombre visible con el que quedó el listado."""

    listado_precios_nombre: str


class ContratoEntrada(BaseModel):
    """
    Los datos del contrato o póliza (especificación de la Central, M1). La
    vigencia, siempre. La tarifa, su unidad y la forma de pago de los
    medicamentos van juntas, y solo en un cliente con Farmacovigilancia: eso lo
    decide el router, que sabe qué tiene contratado (6/11/2026).
    """

    model_config = ConfigDict(extra="forbid")

    vigencia_desde: dt.date
    vigencia_hasta: dt.date
    tarifa: Decimal | None = Field(default=None, ge=0, max_digits=14, decimal_places=4)
    tarifa_unidad: UnidadTarifa | None = None
    revision_tarifa: dt.date | None = None
    forma_pago_medicamentos: FormaPagoMedicamentos | None = None

    @model_validator(mode="after")
    def _fechas_coherentes(self) -> ContratoEntrada:
        for fecha in (self.vigencia_desde, self.vigencia_hasta, self.revision_tarifa):
            if fecha is not None and not _FECHA_MINIMA <= fecha <= _FECHA_MAXIMA:
                raise ValueError("Las fechas del contrato deben estar entre el año 2000 y el 2100")
        if self.vigencia_hasta < self.vigencia_desde:
            raise ValueError("La vigencia del contrato termina antes de empezar")
        if self.revision_tarifa is not None and self.revision_tarifa < self.vigencia_desde:
            raise ValueError(
                "La revisión de la tarifa no puede ser antes del inicio de la vigencia"
            )
        tarifa = {
            "la tarifa": self.tarifa,
            "la unidad de la tarifa": self.tarifa_unidad,
            "la forma de pago de los medicamentos": self.forma_pago_medicamentos,
        }
        if any(v is not None for v in tarifa.values()):
            falta = next((k for k, v in tarifa.items() if v is None), None)
            if falta:
                raise ValueError(
                    f"Falta {falta}: la tarifa, su unidad y la forma de pago van juntas"
                )
        return self

    @property
    def con_tarifa(self) -> bool:
        return self.tarifa is not None


class ContratoSalida(BaseModel):
    vigencia_desde: dt.date
    vigencia_hasta: dt.date
    # Como texto («0.0500»): con cuatro decimales, un float podría redondear.
    # Las tres nulas en el contrato de un cliente sin Farmacovigilancia.
    tarifa: str | None
    tarifa_unidad: str | None
    revision_tarifa: dt.date | None
    forma_pago_medicamentos: str | None
    actualizado_at: dt.datetime


class PolizaSalida(BaseModel):
    """
    Un PDF de la aseguradora; el archivo se pide a su propio endpoint. En la
    pestaña «Contratos y pólizas» lleva los datos del contrato (`None` en un PDF
    subido antes del 6/11/2026 al que aún no se le completaron).
    """

    id: str
    nombre: str
    creada_at: dt.datetime
    contrato: ContratoSalida | None = None


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


class ProductoEntrada(BaseModel):
    """
    Un producto del cliente (5/11/2026) con sus condiciones de cobertura (M2,
    6/11/2026). Con `id` se actualiza; sin él, se crea. Llega SIEMPRE completo.
    """

    id: str | None = None
    nombre: Annotated[str, Field(min_length=1, max_length=300)]
    servicios: list[ServicioProducto] = Field(min_length=1, max_length=4)
    # El tope de cobertura (USD) y su unidad.
    valor: Annotated[Decimal, Field(ge=0, max_digits=12, decimal_places=2)]
    tope_unidad: UnidadTope
    ventana_evento: VentanaEvento
    # Nulo = ilimitados.
    eventos_maximo: Annotated[int, Field(ge=1, le=1000)] | None = None
    # El porcentaje de cobertura; el copago es 100 − porcentaje.
    porcentaje: Annotated[Decimal, Field(ge=0, le=100, max_digits=5, decimal_places=2)]
    # Solo con Farmacia (obligatorios entonces). Un año como tope de la receta.
    vigencia_receta_horas: Annotated[int, Field(ge=1, le=8760)] | None = None
    requiere_vademecum: bool | None = None
    despacho_parcial: bool | None = None
    # Solo con teleconsulta o consulta ambulatoria. Nulo = sin límite.
    max_diagnosticos: Annotated[int, Field(ge=1, le=20)] | None = None
    beneficiarios_incluidos: bool
    parentescos: list[Parentesco] = Field(default_factory=list, max_length=3)
    carencia_dias: Annotated[int, Field(ge=0, le=3650)]
    exclusiones: str | None = Field(default=None, max_length=4000)

    @field_validator("exclusiones")
    @classmethod
    def _exclusiones(cls, valor: str | None) -> str | None:
        if valor is None:
            return None
        normal = (
            unicodedata.normalize("NFKC", valor)
            .replace("\r\n", "\n")
            .replace("\r", "\n")
            .replace("\t", " ")
        )
        if any(unicodedata.category(c)[0] == "C" and c != "\n" for c in normal):
            raise ValueError("Las exclusiones tienen caracteres no válidos")
        lineas = (" ".join(linea.split()) for linea in normal.split("\n"))
        limpio = "\n".join(linea for linea in lineas if linea).upper()
        if len(limpio) > 2000:
            raise ValueError("Las exclusiones admiten hasta 2000 caracteres")
        return limpio or None

    @model_validator(mode="after")
    def _condiciones_coherentes(self) -> ProductoEntrada:
        # Orden fijo y sin repetidos: la misma lista se compara igual en las dos bases.
        self.servicios = [s for s in SERVICIOS_PRODUCTO if s in set(self.servicios)]  # type: ignore[misc]
        self.parentescos = [p for p in PARENTESCOS if p in set(self.parentescos)]  # type: ignore[misc]
        nombre = self.nombre
        de_farmacia = (self.vigencia_receta_horas, self.requiere_vademecum, self.despacho_parcial)
        if "farmacia" in self.servicios:
            if self.vigencia_receta_horas is None:
                raise ValueError(f"{nombre}: incluye Farmacia, falta la vigencia de la receta")
            if self.requiere_vademecum is None:
                raise ValueError(f"{nombre}: incluye Farmacia, falta decir si requiere vademécum")
            if self.despacho_parcial is None:
                raise ValueError(
                    f"{nombre}: incluye Farmacia, falta decir si permite despacho parcial"
                )
        elif any(v is not None for v in de_farmacia):
            raise ValueError(
                f"{nombre}: la vigencia de la receta, el vademécum y el despacho parcial "
                "son solo de un producto con Farmacia"
            )
        if self.max_diagnosticos is not None and not (
            {"teleconsulta", "consulta_ambulatoria"} & set(self.servicios)
        ):
            raise ValueError(
                f"{nombre}: el máximo de diagnósticos por consulta es solo de un producto "
                "con teleconsulta o consulta ambulatoria"
            )
        if self.beneficiarios_incluidos and not self.parentescos:
            raise ValueError(f"{nombre}: incluye beneficiarios, elige sus parentescos")
        if not self.beneficiarios_incluidos and self.parentescos:
            raise ValueError(f"{nombre}: sin beneficiarios no lleva parentescos")
        return self

    @field_validator("nombre")
    @classmethod
    def _nombre_en_mayusculas(cls, valor: str) -> str:
        # Unicode en su forma compuesta y compatible (NFKC): «Ó» tecleado y «Ó»
        # pegado de un PDF son la misma letra, y una ligadura «ﬁ» es «fi». Nada
        # invisible ni de control: dos nombres que se ven iguales serían el mismo.
        normal = unicodedata.normalize("NFKC", valor)
        if any(unicodedata.category(c)[0] == "C" for c in normal):
            raise ValueError("El nombre del producto tiene caracteres no válidos")
        # Todo en MAYÚSCULAS (regla del usuario) y sin espacios de sobra.
        limpio = " ".join(normal.split()).upper()
        if not limpio:
            raise ValueError("El nombre del producto es obligatorio")
        # El largo se mide DESPUÉS: pasar a mayúsculas puede alargar («ß» → «SS»).
        if len(limpio) > 150:
            raise ValueError("El nombre del producto admite hasta 150 caracteres")
        return limpio


class ProductoSalida(BaseModel):
    id: str
    nombre: str
    servicios: list[str]
    valor: float
    tope_unidad: str | None
    ventana_evento: str | None
    eventos_maximo: int | None
    porcentaje: float
    vigencia_receta_horas: int | None
    requiere_vademecum: bool | None
    despacho_parcial: bool | None
    max_diagnosticos: int | None
    beneficiarios_incluidos: bool
    parentescos: list[str]
    carencia_dias: int
    exclusiones: str | None


class AseguradoraCrear(_ConRuc):
    razon_social: Texto
    nombre_comercial: str | None = Field(default=None, max_length=200)
    ruc: str
    # Obligatorio también en la API, no solo en la pantalla (5/11/2026).
    tipo: TipoAseguradora
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
    # Productos del cliente, de cualquier tipo (6/11/2026). Con tope: una lista
    # sin límite es consumo sin límite (OWASP), y 200 caben en un solo envío a la
    # central (lotes de 500), que la aplica en una sola transacción.
    productos: list[ProductoEntrada] = Field(default_factory=list, max_length=200)


class AseguradoraActualizar(_ConRuc):
    """Edición parcial: solo se toca lo que llega."""

    razon_social: Texto | None = None
    nombre_comercial: str | None = Field(default=None, max_length=200)
    ruc: str | None = None
    # Se cambia, pero no se vacía: la columna es NOT NULL (lo corta el servicio).
    tipo: TipoAseguradora | None = None
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
    # None = no se tocan; lista = se reconcilia contra ella, como los contactos.
    productos: list[ProductoEntrada] | None = Field(default=None, max_length=200)


class AseguradoraResumen(BaseModel):
    """Lo que necesita la tabla del listado, sin traer el registro entero."""

    id: str
    codigo_interno: str
    razon_social: str
    nombre_comercial: str | None
    ruc: str
    tipo: str
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
    tipo: str
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
    productos: list[ProductoSalida] = []


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
    A qué entra un usuario de la compañía. Un rol por persona (19/10/2026):

    - **coordinador** («Supervisor»): supervisa los módulos que se le marquen;
      uno por módulo en cada aseguradora.
    - **operador** («Ejecutivo»): los requerimientos que se le marquen.

    Los dos llevan su lista; el rol de cada acceso lo fija el servidor.
    """

    rol: Literal["coordinador", "operador"]
    accesos: list[AccesoEntrada] = Field(default_factory=list)

    @model_validator(mode="after")
    def _coherente(self):
        if not self.accesos:
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
