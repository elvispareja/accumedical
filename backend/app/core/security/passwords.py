from __future__ import annotations

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError

_hasher = PasswordHasher()

# Hash señuelo, calculado una sola vez al importar el módulo. Se verifica contra él
# cuando el email no existe, para que ese camino tarde lo mismo que el resto y no
# se pueda enumerar cuentas midiendo el tiempo de respuesta.
_HASH_SENUELO = _hasher.hash("señuelo-de-tiempo-constante-no-es-una-credencial")


def hashear(password: str) -> str:
    return _hasher.hash(password)


def verificar(password: str, hash_almacenado: str | None) -> bool:
    """
    Verifica la contraseña. Si no hay hash (email inexistente) verifica igualmente
    contra el señuelo y devuelve False: el coste en tiempo es el mismo.
    """
    objetivo = hash_almacenado or _HASH_SENUELO
    try:
        _hasher.verify(objetivo, password)
    except (VerifyMismatchError, InvalidHashError):
        return False
    return hash_almacenado is not None


def necesita_rehash(hash_almacenado: str) -> bool:
    return _hasher.check_needs_rehash(hash_almacenado)
