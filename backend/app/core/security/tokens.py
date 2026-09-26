from __future__ import annotations

import hashlib
import hmac
import secrets

# 32 bytes = 256 bits de entropía CSPRNG.
_BYTES_TOKEN = 32


def generar_token() -> str:
    return secrets.token_urlsafe(_BYTES_TOKEN)


def hashear_token(token: str) -> str:
    """
    SHA-256 y no argon2, deliberadamente: el token ya tiene entropía plena, no es un
    secreto adivinable por fuerza bruta offline, y el lookup por request debe ser un
    index lookup y no 100 ms de KDF. Buscar por hash elimina además la comparación
    byte a byte del token y con ella el canal de temporización.
    """
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def comparar_hashes(a: str, b: str) -> bool:
    return hmac.compare_digest(a, b)
