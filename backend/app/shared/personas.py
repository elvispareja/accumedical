"""
Cómo se llama una persona en toda la plataforma, en un solo sitio.

Cuatro partes, iguales para el usuario, el contacto y el paciente:

    nombre_principal   (obligatorio)   nombre_secundario  (opcional)
    apellido_paterno   (obligatorio)   apellido_materno   (opcional)

Aquí viven las dos reglas que se repetirían en cada formulario si no: qué se
admite escribir (solo letras) y en qué orden se lee el nombre completo. Las
pantallas y los correos NO recomponen el nombre por su cuenta: llaman a
`completo()`, y así «SHIRLEY MARIA PAREJA VEGA» se escribe igual en la bandeja,
en el PDF y en el aviso.
"""

from __future__ import annotations

import re
from typing import Annotated

from pydantic import Field
from sqlalchemy import func

# SOLO letras (con tildes y eñes) y espacios. Ni números ni símbolos: un nombre
# no los lleva, y de aquí salen papeles que se firman.
_SOLO_LETRAS = re.compile(r"[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+(?: [A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+)*\Z")


def validar_solo_letras(valor: str | None) -> str | None:
    """
    Normaliza espacios y exige letras. Vale como validador de Pydantic para las
    partes obligatorias y para las opcionales: `None` pasa, pero una cadena de
    espacios no —quien manda «   » está mandando basura, no un campo vacío.
    """
    if valor is None:
        return valor
    limpio = " ".join(valor.split())
    if not limpio or not _SOLO_LETRAS.fullmatch(limpio):
        raise ValueError("solo se admiten letras y espacios")
    return limpio


def opcional_o_nulo(valor: str | None) -> str | None:
    """
    Igual que el anterior, pero un campo opcional que llega vacío se guarda como
    NULL en vez de como cadena vacía: «no tiene segundo nombre» y «tiene un
    segundo nombre que es la nada» no son lo mismo para la base.
    """
    if valor is None or not valor.strip():
        return None
    return validar_solo_letras(valor)


# Los tipos que usan los schemas. El obligatorio nunca admite vacío.
NombreObligatorio = Annotated[str, Field(min_length=1, max_length=100)]
NombreOpcional = Annotated[str, Field(max_length=100)] | None


def nombres(principal: str | None, secundario: str | None = None) -> str:
    """Los nombres de pila, en orden. Sin segundo nombre devuelve solo el primero."""
    return " ".join(p for p in (principal, secundario) if p)


def apellidos(paterno: str | None, materno: str | None = None) -> str:
    """Los apellidos, paterno primero. Sin materno devuelve solo el paterno."""
    return " ".join(p for p in (paterno, materno) if p)


def completo(
    nombre_principal: str | None,
    nombre_secundario: str | None = None,
    apellido_paterno: str | None = None,
    apellido_materno: str | None = None,
) -> str:
    """
    El nombre como se lee y se dice: nombres y después apellidos. Es el orden
    que eligió el negocio, y por eso está escrito UNA vez.
    """
    return " ".join(
        p
        for p in (
            nombres(nombre_principal, nombre_secundario),
            apellidos(apellido_paterno, apellido_materno),
        )
        if p
    )


PARTES = ("nombre_principal", "nombre_secundario", "apellido_paterno", "apellido_materno")


def partes_de(obj, prefijo: str = "") -> dict:
    """Las cuatro partes de una fila, con sus nombres sin prefijo."""
    return {campo: getattr(obj, f"{prefijo}{campo}", None) for campo in PARTES}


def partes_prefijadas(obj, prefijo: str) -> dict:
    """
    Las cuatro partes CON su prefijo en la clave: `{"paciente_nombre_principal":
    ...}`. Para los schemas que nombran los campos prefijados, como los de la
    visita —donde la persona es el paciente y no «la» persona de la fila—.

    `partes_de` devuelve las claves limpias, que es lo que necesitan los schemas
    de contactos y usuarios. Mezclarlas cuesta un 500 por cuatro campos que
    llegan «missing», que es exactamente como se descubrió esto.
    """
    return {f"{prefijo}{campo}": getattr(obj, f"{prefijo}{campo}", None) for campo in PARTES}


def partes_out(obj, prefijo: str = "") -> dict:
    """
    Las cuatro partes MÁS el nombre ya compuesto, listas para desempaquetar en
    un schema de salida: `ContactoSalida(id=..., **personas.partes_out(c))`.
    Evita repetir cinco campos —y el riesgo de componer distinto— en cada
    endpoint que devuelve una persona.
    """
    datos = partes_de(obj, prefijo)
    return {**datos, "nombre_completo": completo(**datos)}


def sql_completo(tabla, prefijo: str = ""):
    """
    El mismo nombre compuesto, pero calculado por Postgres: para ordenar y
    buscar sin traerse las filas. `concat_ws` ignora los NULL, así que quien no
    tiene segundo nombre no arrastra un espacio de más.

    Vive aquí, junto a `completo()`, para que el orden se decida UNA vez: si
    algún día se invierte, se invierte en este archivo y en ningún otro.
    """
    return func.concat_ws(" ", *(getattr(tabla, f"{prefijo}{campo}") for campo in PARTES))


def de_fila(obj, prefijo: str = "") -> str:
    """
    El nombre completo de cualquier fila con las cuatro columnas —usuario,
    contacto o visita (con prefijo `paciente_`)—, sin repetir los cuatro
    `getattr` en cada llamada.
    """
    return completo(
        getattr(obj, f"{prefijo}nombre_principal", None),
        getattr(obj, f"{prefijo}nombre_secundario", None),
        getattr(obj, f"{prefijo}apellido_paterno", None),
        getattr(obj, f"{prefijo}apellido_materno", None),
    )
