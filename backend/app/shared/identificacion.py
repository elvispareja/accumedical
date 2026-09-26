"""
Identificación y teléfono: las reglas del Ecuador, en un solo sitio.

Un regex dice si un número TIENE la forma correcta; no dice si EXISTE. La cédula
y el RUC ecuatorianos llevan dígito verificador, y comprobarlo es la diferencia
entre aceptar «0912345678» —que parece una cédula y no lo es— y aceptar solo
documentos que el Registro Civil podría haber emitido. Por eso el catálogo
`tipos_documento` sigue guardando el formato y la aritmética vive aquí.

El pasaporte no se puede verificar así: es un documento extranjero, cada país lo
numera a su manera y el número impreso no lleva checksum (los dígitos de control
viven en la banda MRZ, que aquí nadie teclea). Se valida su forma —alfanumérico,
sin símbolos— y nada más, que es lo honesto.
"""

from __future__ import annotations

import re

# Provincias del Ecuador: 01–24, más 30 para quien se cedula en el exterior.
PROVINCIAS_VALIDAS = set(range(1, 25)) | {30}

# El tercer dígito dice qué es el documento.
#   0–5 → persona natural      6 → sociedad pública      9 → sociedad privada
_COEF_CEDULA = (2, 1, 2, 1, 2, 1, 2, 1, 2)
_COEF_RUC_PUBLICO = (3, 2, 7, 6, 5, 4, 3, 2)
_COEF_RUC_PRIVADO = (4, 3, 2, 7, 6, 5, 4, 3, 2)

# Pasaporte: letras y números, sin espacios ni guiones. El rango cubre desde los
# de 6 caracteres hasta los más largos que emiten algunos países.
_PASAPORTE = re.compile(r"[A-Z0-9]{6,15}\Z")

# Teléfono: los dígitos y, como mucho, un «+» delante para el código de país.
# El tope de 15 es el de E.164, que es el estándar del que cuelga todo el mundo.
_TELEFONO = re.compile(r"\+?[0-9]{7,15}\Z")


def _provincia_valida(numero: str) -> bool:
    return int(numero[:2]) in PROVINCIAS_VALIDAS


def _modulo_10(base: str) -> int:
    """
    El verificador de la cédula (y del RUC de persona natural): cada dígito por
    su coeficiente, restando 9 a los productos de dos cifras.
    """
    suma = 0
    for digito, coeficiente in zip(base, _COEF_CEDULA, strict=True):
        producto = int(digito) * coeficiente
        suma += producto - 9 if producto > 9 else producto
    return (10 - suma % 10) % 10


def _modulo_11(base: str, coeficientes: tuple[int, ...]) -> int:
    """El verificador de las sociedades: módulo 11, con 11 y 10 colapsando a 0."""
    suma = sum(int(d) * c for d, c in zip(base, coeficientes, strict=True))
    residuo = suma % 11
    return 0 if residuo == 0 else 11 - residuo


def cedula_valida(numero: str) -> bool:
    """Diez dígitos, provincia real, persona natural y dígito verificador correcto."""
    if len(numero) != 10 or not numero.isdigit():
        return False
    if not _provincia_valida(numero):
        return False
    # El tercer dígito de una cédula siempre es menor que 6: del 6 en adelante
    # ya no es una persona, es una sociedad, y eso es un RUC.
    if int(numero[2]) >= 6:
        return False
    return _modulo_10(numero[:9]) == int(numero[9])


def ruc_valido(numero: str) -> bool:
    """
    Trece dígitos. Qué se comprueba depende del tercer dígito: la persona natural
    lleva su cédula dentro, la sociedad pública verifica en la posición 9 y la
    privada en la 10. El resto es el número de establecimiento, que nunca es cero.
    """
    if len(numero) != 13 or not numero.isdigit():
        return False
    if not _provincia_valida(numero):
        return False

    tercero = int(numero[2])
    if tercero < 6:
        # Persona natural con RUC: es su cédula + el establecimiento.
        return cedula_valida(numero[:10]) and numero[10:] != "000"
    if tercero == 6:
        # Sociedad pública: el verificador va en la novena posición y el
        # establecimiento ocupa cuatro dígitos, no tres.
        return (
            _modulo_11(numero[:8], _COEF_RUC_PUBLICO) == int(numero[8])
            and numero[9:] != "0000"
        )
    if tercero == 9:
        return (
            _modulo_11(numero[:9], _COEF_RUC_PRIVADO) == int(numero[9])
            and numero[10:] != "000"
        )
    # 7 y 8 no los emite nadie.
    return False


def pasaporte_valido(numero: str) -> bool:
    """Letras y números, de 6 a 15. Sin dígito verificador: no existe tal cosa."""
    return bool(_PASAPORTE.fullmatch(numero.upper()))


# Cada tipo del catálogo con su comprobación y con qué decir cuando falla.
VALIDADORES = {
    "cedula": (cedula_valida, "La cédula no es válida: revisa el número"),
    "ruc": (ruc_valido, "El RUC no es válido: revisa el número"),
    "pasaporte": (
        pasaporte_valido,
        "El pasaporte admite solo letras y números, entre 6 y 15 caracteres",
    ),
}


def problema_con(tipo: str, numero: str) -> str | None:
    """
    El motivo por el que ese número no puede ser ese documento, o `None` si está
    bien. Un tipo que no conocemos no se inventa validación: pasa.
    """
    validador = VALIDADORES.get(tipo)
    if validador is None:
        return None
    comprobar, mensaje = validador
    return None if comprobar(numero.strip()) else mensaje


def normalizar_telefono(valor: str | None) -> str | None:
    """
    Solo dígitos y, como mucho, un «+» delante. Los espacios, guiones y
    paréntesis con que la gente escribe un teléfono se quitan aquí en vez de
    rechazarlos: nadie debería pelear con un formulario por un guion.
    """
    if valor is None:
        return None
    limpio = re.sub(r"[\s()\-.]", "", valor.strip())
    if not limpio:
        return None
    if not _TELEFONO.fullmatch(limpio):
        raise ValueError(
            "El teléfono admite solo números, con un «+» delante para el código de país"
        )
    return limpio
