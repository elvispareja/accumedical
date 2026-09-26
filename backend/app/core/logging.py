from __future__ import annotations

import logging
import sys
import uuid
from contextvars import ContextVar

import structlog

from app.core.config import settings

# El request-id viaja por contextvar para que toda línea de log de una petición lo
# lleve sin pasarlo a mano, y se guarda también en audit_log.request_id: así un
# evento de auditoría y sus logs técnicos se correlacionan por ese campo.
request_id_ctx: ContextVar[uuid.UUID | None] = ContextVar("request_id", default=None)

# Nunca sale de aquí un secreto, ni siquiera por accidente en un dict de contexto.
CLAVES_PROHIBIDAS = {
    "password",
    "password_hash",
    "contrasena",
    "token",
    "token_hash",
    "csrf",
    "csrf_token",
    "csrf_token_hash",
    "mfa_secret",
    "secret_key",
    "authorization",
    "cookie",
}


def _redactar(_logger, _nombre, evento: dict) -> dict:
    for clave in list(evento.keys()):
        if clave.lower() in CLAVES_PROHIBIDAS:
            evento[clave] = "[redactado]"
    return evento


def _inyectar_request_id(_logger, _nombre, evento: dict) -> dict:
    rid = request_id_ctx.get()
    if rid is not None:
        evento["request_id"] = str(rid)
    return evento


def configurar_logging() -> None:
    nivel = getattr(logging, settings.log_level.upper(), logging.INFO)

    logging.basicConfig(format="%(message)s", stream=sys.stdout, level=nivel)
    for ruidoso in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        logging.getLogger(ruidoso).handlers.clear()
        logging.getLogger(ruidoso).propagate = True

    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso", utc=True),
            _inyectar_request_id,
            _redactar,
            structlog.processors.StackInfoRenderer(),
            structlog.processors.format_exc_info,
            structlog.processors.JSONRenderer(),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(nivel),
        logger_factory=structlog.PrintLoggerFactory(),
        cache_logger_on_first_use=True,
    )


log = structlog.get_logger()
