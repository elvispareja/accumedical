from __future__ import annotations

from slowapi import Limiter
from slowapi.util import get_remote_address

# La IP la resuelve el middleware de proxy de uvicorn (--proxy-headers) a partir del
# X-Forwarded-For que nginx SOBRESCRIBE con $remote_addr. Nunca se parsea esa
# cabecera a mano: con el patrón de "append" el cliente podría elegir la IP que ve
# la aplicación y el límite se evaporaría.
#
# Es almacenamiento en memoria y por proceso: con 4 workers el límite efectivo por
# IP se multiplica por 4 y se pierde al reiniciar. Es la segunda capa; la primera es
# `limit_req` de nginx y la que de verdad frena el credential stuffing dirigido es
# el bloqueo por cuenta, que vive en PostgreSQL.
limiter = Limiter(key_func=get_remote_address)
