from __future__ import annotations

import base64

from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

from app.core.config import settings

# Cifrado simétrico para los secretos que la plataforma guarda en disco (hoy:
# la contraseña del .p12 de la firma). NO es hashing: estos secretos hay que
# poder leerlos de vuelta para usarlos. La llave se deriva del SECRET_KEY del
# servidor con HKDF, así que el archivo cifrado solo se abre con el entorno:
# robarse el volumen no basta, y el SECRET_KEY jamás se usa a pelo como llave.


def _fernet() -> Fernet:
    llave = HKDF(
        algorithm=hashes.SHA256(),
        length=32,
        salt=b"accumedical-configuracion",
        info=b"secretos de configuracion guardados en el volumen",
    ).derive(settings.secret_key.get_secret_value().encode())
    return Fernet(base64.urlsafe_b64encode(llave))


def cifrar(texto: str) -> bytes:
    return _fernet().encrypt(texto.encode())


def descifrar(datos: bytes) -> str:
    """Lanza `cryptography.fernet.InvalidToken` si el archivo fue manipulado."""
    return _fernet().decrypt(datos).decode()
