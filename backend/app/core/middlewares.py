from __future__ import annotations

import time

from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse, Response

from app.core.config import settings
from app.core.ids import uuid7
from app.core.logging import log, request_id_ctx

METODOS_MUTANTES = {"POST", "PUT", "PATCH", "DELETE"}


class RequestIdMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        rid = uuid7()
        token = request_id_ctx.set(rid)
        request.state.request_id = rid
        inicio = time.perf_counter()
        try:
            respuesta = await call_next(request)
        finally:
            request_id_ctx.reset(token)
        duracion_ms = round((time.perf_counter() - inicio) * 1000, 2)
        respuesta.headers["X-Request-ID"] = str(rid)
        log.info(
            "http",
            method=request.method,
            path=request.url.path,
            status=respuesta.status_code,
            duration_ms=duracion_ms,
            ip=request.client.host if request.client else None,
            request_id=str(rid),
        )
        return respuesta


# Rutas que solo aceptan JSON. Va en middleware y no en el endpoint porque FastAPI
# parsea el cuerpo ANTES de ejecutar la función: una comprobación dentro del
# endpoint llegaría tarde y sería código muerto.
SOLO_JSON = {"/api/v1/auth/login"}


class OrigenMiddleware(BaseHTTPMiddleware):
    """
    Defensa en profundidad contra CSRF: toda mutación debe traer un Origin de la
    allowlist. No sustituye al token CSRF, lo complementa, y cubre el caso del
    login (que es público y por tanto está exento del token).

    Además fuerza `application/json` en el login: es lo que cierra el CSRF de
    login, porque un formulario HTML cross-site puede enviar urlencoded o
    multipart, pero nunca JSON.
    """

    async def dispatch(self, request: Request, call_next):
        if request.method in METODOS_MUTANTES:
            if settings.allowed_origins:
                origen = request.headers.get("origin")
                if origen is not None and origen.rstrip("/") not in settings.allowed_origins:
                    log.warning("origen_rechazado", origen=origen, path=request.url.path)
                    return JSONResponse(status_code=403, content={"detail": "No autorizado"})

            if request.url.path in SOLO_JSON:
                tipo = (request.headers.get("content-type") or "").split(";")[0].strip().lower()
                if tipo != "application/json":
                    return JSONResponse(
                        status_code=415,
                        content={"detail": "Content-Type debe ser application/json"},
                    )
        return await call_next(request)


class CabecerasSeguridadMiddleware(BaseHTTPMiddleware):
    """
    Cabeceras que emite la propia API. Las de la SPA las pone nginx; estas van
    aquí para que las respuestas JSON también estén cubiertas aunque alguien
    llegue a la API sin pasar por el proxy.
    """

    async def dispatch(self, request: Request, call_next) -> Response:
        respuesta = await call_next(request)
        respuesta.headers.setdefault("X-Content-Type-Options", "nosniff")
        respuesta.headers.setdefault("X-Frame-Options", "DENY")
        respuesta.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
        respuesta.headers.setdefault("Cache-Control", "no-store")
        return respuesta
