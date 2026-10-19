from __future__ import annotations

import datetime as dt
from typing import Annotated, Literal

from pydantic import BaseModel, EmailStr, Field, field_validator, model_validator

from app.shared import identificacion, personas

# Los roles del personal de plataforma, y lo que alcanza cada uno:
#
#   coordinador  → una FAMILIA entera (toda Suscripción o todo Siniestro), y
#                  solo puede haber uno por familia.
#   auditor      → los módulos que se le marquen, uno a uno.
#   convenio     → lleva la red de convenios. Uno solo.
#   contabilidad → su sección está por definir. Uno solo.
#
# Los dos últimos son funciones transversales: no entran por módulo ni por
# familia, así que no marcan nada. Qué ve cada una se decidirá después; hoy el
# rol se asigna y ya.
#
# `operador` y `consulta` siguen sembrados, pero son de los usuarios de
# aseguradora. El code del coordinador sigue siendo `supervisor` en la base
# (identidad congelada); «Coordinador» es su nombre visible.
# Las que viven en `user_funcion`, cada una con UNA sola persona a la vez.
FUNCIONES = ("convenio", "contabilidad")

# Desde el 14/10/2026 cada persona tiene un rol EN CADA aplicación (o ninguno)
# y, aparte, puede llevar una función transversal. Ejemplo: Mario es
# coordinador de Calificación y además Convenio; un auditor de Concurrencia
# puede ser coordinador de Vida. «call_center» solo donde la app lo admite.
RolEnApp = Literal["auditor", "coordinador", "call_center"]
FuncionPlataforma = Literal["convenio", "contabilidad"]


class AsignacionApp(BaseModel):
    """Su rol en UNA aplicación."""

    module_code: Annotated[str, Field(min_length=1, max_length=30)]
    rol: RolEnApp


class AccesoPlataforma(BaseModel):
    """
    A qué entra el personal propio: sus aplicaciones, cada una con su rol, y su
    función transversal si la tiene. Quitar algo NUNCA lo borra: la fila queda
    inactiva y su tramo se cierra en `historial_accesos`.
    """

    aplicaciones: list[AsignacionApp] = Field(default_factory=list, max_length=50)
    funcion: FuncionPlataforma | None = None

    @model_validator(mode="after")
    def _coherente(self):
        codigos = [a.module_code for a in self.aplicaciones]
        if len(set(codigos)) != len(codigos):
            raise ValueError("Una aplicación solo puede tener un rol por persona")
        if not self.aplicaciones and self.funcion is None:
            raise ValueError(
                "Marca al menos una aplicación con su rol, o una función (Convenio o Contabilidad)"
            )
        return self


class _ConDocumento(BaseModel):
    @model_validator(mode="after")
    def _documento_coherente(self):
        # El CHECK de la base lo impide igual; aquí sale con un mensaje legible.
        tipo = getattr(self, "tipo_documento_codigo", None)
        numero = getattr(self, "numero_documento", None)
        if (tipo is None) != (numero is None):
            raise ValueError(
                "El tipo y el número de identificación van juntos: o los dos, o ninguno"
            )
        return self


class UsuarioPlataformaCrear(_ConDocumento):
    """
    El personal del propio administrador: coordinadores y médicos auditores. No
    sale de ningún contacto, así que aquí sí se teclea la identidad completa.
    Obligatorios solo el primer nombre, el apellido paterno y el correo.
    """

    nombre_principal: personas.NombreObligatorio
    nombre_secundario: personas.NombreOpcional = None
    apellido_paterno: personas.NombreObligatorio
    apellido_materno: personas.NombreOpcional = None
    email: EmailStr
    tipo_documento_codigo: str | None = Field(default=None, max_length=10)
    numero_documento: str | None = Field(default=None, max_length=20)
    telefono: str | None = Field(default=None, max_length=25)
    # Dónde está: alimenta la cercanía al derivar casos. Opcional.
    provincia_codigo: str | None = Field(default=None, max_length=2)
    ciudad_codigo: str | None = Field(default=None, max_length=4)
    acceso: AccesoPlataforma

    _obligatorios = field_validator("nombre_principal", "apellido_paterno")(
        personas.validar_solo_letras
    )
    _opcionales = field_validator("nombre_secundario", "apellido_materno")(
        personas.opcional_o_nulo
    )
    _telefono = field_validator("telefono")(identificacion.normalizar_telefono)

    @field_validator("email", mode="before")
    @classmethod
    def _correo_en_minusculas(cls, v):  # noqa: ANN001, ANN206
        # 19/10/2026: el correo es el usuario con el que se entra; va en
        # minúsculas siempre, como se escriba (lo pidió el cliente).
        return v.strip().lower() if isinstance(v, str) else v


class UsuarioPlataformaActualizar(BaseModel):
    """
    Edición parcial: solo se toca lo que llega. La coherencia del documento se
    comprueba en el servicio sobre el estado RESULTANTE, no sobre el payload:
    mandar solo el número, con el tipo ya guardado, es perfectamente válido.
    """

    nombre_principal: personas.NombreObligatorio | None = None
    nombre_secundario: personas.NombreOpcional = None
    apellido_paterno: personas.NombreObligatorio | None = None
    apellido_materno: personas.NombreOpcional = None
    email: EmailStr | None = None
    tipo_documento_codigo: str | None = Field(default=None, max_length=10)
    numero_documento: str | None = Field(default=None, max_length=20)
    telefono: str | None = Field(default=None, max_length=25)
    provincia_codigo: str | None = Field(default=None, max_length=2)
    ciudad_codigo: str | None = Field(default=None, max_length=4)
    acceso: AccesoPlataforma | None = None
    is_active: bool | None = None

    # En la edición parcial, `None` significa «no lo toques» y por eso pasa; lo
    # que no pasa es un nombre con números, venga en el campo que venga.
    _obligatorios = field_validator("nombre_principal", "apellido_paterno")(
        personas.validar_solo_letras
    )
    _opcionales = field_validator("nombre_secundario", "apellido_materno")(
        personas.opcional_o_nulo
    )
    _telefono = field_validator("telefono")(identificacion.normalizar_telefono)

    @field_validator("email", mode="before")
    @classmethod
    def _correo_en_minusculas(cls, v):  # noqa: ANN001, ANN206
        # 19/10/2026: el correo es el usuario con el que se entra; va en
        # minúsculas siempre, como se escriba (lo pidió el cliente).
        return v.strip().lower() if isinstance(v, str) else v


class AsignacionSalida(BaseModel):
    """Una aplicación a la que entra HOY, con su rol."""

    module_code: str
    module_nombre: str
    rol: str


class AccesoPlataformaSalida(BaseModel):
    """A qué entra HOY: sus aplicaciones con su rol, y su función si tiene."""

    aplicaciones: list[AsignacionSalida]
    funcion: str | None
    #: «Coordinador de Calificación de Riesgo · Convenio», para el listado.
    resumen: str


class UsuarioPlataformaSalida(BaseModel):
    id: str
    nombre_principal: str
    nombre_secundario: str | None
    apellido_paterno: str
    apellido_materno: str | None
    # Ya compuesto por el servidor: ver app/shared/personas.py.
    nombre_completo: str
    email: str
    tipo_documento_codigo: str | None
    tipo_documento_nombre: str | None
    numero_documento: str | None
    telefono: str | None
    provincia_codigo: str | None
    provincia_nombre: str | None
    ciudad_codigo: str | None
    ciudad_nombre: str | None
    is_active: bool
    # Los mismos dos semáforos que en los usuarios de aseguradora: si ya definió
    # su contraseña y si tiene una invitación viva esperando.
    password_definida: bool
    invitacion_pendiente: bool
    ultimo_acceso: dt.datetime | None
    acceso: AccesoPlataformaSalida
