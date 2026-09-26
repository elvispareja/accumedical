from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, EmailStr, Field


class LoginRequest(BaseModel):
    email: EmailStr
    # Sin longitud mínima aquí a propósito: validar el formato en el login filtraría
    # información sobre la política y daría respuestas distintas según el input.
    # El mínimo de 12 se exige al ESTABLECER la contraseña, no al usarla.
    password: str = Field(min_length=1, max_length=256)
    # «movil» pide el token de sesión EN EL CUERPO en lugar de cookies: la app
    # nativa no tiene navegador que las guarde. El navegador jamás manda esto.
    cliente: Literal["web", "movil"] = "web"


class UsuarioOut(BaseModel):
    id: str
    email: str
    # Quien inicia sesión solo necesita saber cómo se le saluda.
    nombre_completo: str
    es_admin_global: bool
    # La función transversal («convenio», «contabilidad») si la tiene. La usa el
    # armazón para pintar solo lo suyo; NO autoriza nada: cada request lo
    # revalida el servidor.
    funcion: str | None = None
    # La familia que coordina («siniestro», «suscripcion») si es coordinador de
    # PLATAFORMA. `None` en todos los demás, incluido el coordinador de una
    # aseguradora, que no coordina una familia sino una compañía. Mismo aviso:
    # sirve para pintar —su menú, el título de su pantalla de auditores— y NO
    # autoriza; el servidor lo resuelve otra vez en cada request.
    grupo_coordinado: str | None = None


class ModuloOut(BaseModel):
    codigo: str
    slug: str
    nombre: str
    icono: str
    color_acento: str
    orden: int
    rol: str


class AseguradoraDeSesionOut(BaseModel):
    """
    La compañía del usuario, lo justo para pintar su marca en el armazón: el
    nombre con el que se la conoce y si hay logo que pedir. Nada de RUC ni
    identificadores: el logo se sirve por una ruta sin id, la de «mi compañía».
    """

    nombre: str
    tiene_logo: bool


class SesionOut(BaseModel):
    user: UsuarioOut
    # None para el personal de plataforma (hoy, el administrador global).
    aseguradora: AseguradoraDeSesionOut | None = None
    modulos: list[ModuloOut]
    ultimo_modulo_usado: str | None = None
    modulo_activo: str | None = None
    permisos: list[str] = []
    redireccion: str
    # SOLO para el login con cliente «movil»: el token opaco de sesión, una única
    # vez, para que la app lo guarde en el llavero del sistema y lo mande por
    # Authorization. En el navegador siempre es None: ahí vive en la cookie
    # httpOnly y exponerlo en el cuerpo regalaría la sesión a cualquier XSS.
    token: str | None = None


class CambioModuloRequest(BaseModel):
    slug: str = Field(min_length=1, max_length=30)


class InvitacionOut(BaseModel):
    """Lo mínimo para saludar a quien abre el enlace. Nada más: es público."""

    nombre_completo: str
    email: str


class DefinirPasswordRequest(BaseModel):
    token: Annotated[str, Field(min_length=16, max_length=256)]
    # El mínimo real lo aplica el servicio contra PASSWORD_MIN_LENGTH; aquí se
    # corta lo evidente para no gastar un argon2 en una cadena de tres letras.
    password: Annotated[str, Field(min_length=12, max_length=256)]
