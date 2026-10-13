from __future__ import annotations

import logging
import re
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


# Enlaces cuya query ES la credencial (invitación, informe compartido D3): el
# access log de uvicorn escribe la ruta con la query, así que se tapa el valor.
_QUERY_SECRETA = re.compile(r"([?&](?:token|acceso)=)[^&\s]+", re.IGNORECASE)


class _TaparQuerySecreta(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        if isinstance(record.args, tuple) and len(record.args) >= 3:
            args = list(record.args)
            args[2] = _QUERY_SECRETA.sub(r"\1[redactado]", str(args[2]))
            record.args = tuple(args)
        return True


def configurar_logging() -> None:
    nivel = getattr(logging, settings.log_level.upper(), logging.INFO)

    logging.basicConfig(format="%(message)s", stream=sys.stdout, level=nivel)
    for ruidoso in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        logging.getLogger(ruidoso).handlers.clear()
        logging.getLogger(ruidoso).propagate = True
    acceso = logging.getLogger("uvicorn.access")
    if not any(isinstance(f, _TaparQuerySecreta) for f in acceso.filters):
        acceso.addFilter(_TaparQuerySecreta())

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
