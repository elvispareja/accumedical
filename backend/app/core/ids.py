from __future__ import annotations

import os
import time
import uuid

_ULTIMO_MS = 0
_SECUENCIA = 0


def uuid7() -> uuid.UUID:
    """
    UUID versión 7 (RFC 9562): 48 bits de timestamp en milisegundos + aleatorio.

    Se usa en lugar de v4 porque es monotónico y se inserta en un índice B-tree con
    la misma localidad que un entero secuencial; v4 dispersa las escrituras por todo
    el índice y amplifica el WAL. PostgreSQL 16 no trae uuidv7() nativo (llega en 18),
    así que se genera aquí. El contador de secuencia evita colisiones y conserva el
    orden cuando se generan varios en el mismo milisegundo.
    """
    global _ULTIMO_MS, _SECUENCIA

    ms = time.time_ns() // 1_000_000
    if ms == _ULTIMO_MS:
        _SECUENCIA += 1
    else:
        _ULTIMO_MS = ms
        _SECUENCIA = 0

    aleatorio = int.from_bytes(os.urandom(8), "big")

    valor = (ms & 0xFFFFFFFFFFFF) << 80
    valor |= 0x7 << 76  # versión 7
    valor |= (_SECUENCIA & 0xFFF) << 64  # rand_a: secuencia intra-milisegundo
    valor |= 0b10 << 62  # variante RFC 4122
    valor |= aleatorio & ((1 << 62) - 1)

    return uuid.UUID(int=valor)
