from __future__ import annotations

import asyncio
import contextlib
from collections.abc import AsyncIterator, Callable

from fastapi import APIRouter, FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi.errors import RateLimitExceeded
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

import app.modules  # noqa: F401  (registra los modelos de cada módulo)
import app.shared  # noqa: F401  (importarlo registra todos los modelos en la metadata)
from app.core.config import settings
from app.core.db import SessionLocal, engine
from app.core.limiter import limiter
from app.core.logging import configurar_logging, log
from app.core.middlewares import (
    CabecerasSeguridadMiddleware,
    OrigenMiddleware,
    RequestIdMiddleware,
)
from app.modules.calificacion.router import router as calificacion_router
from app.modules.carta_credito.router import router as carta_credito_router
from app.modules.concurrencia.informes import compartido as concurrencia_compartido_router
from app.modules.concurrencia.router import router as concurrencia_router
from app.modules.suscripcion.router import router as suscripcion_router
from app.shared.aseguradoras.router import router as aseguradoras_router
from app.shared.aseguradoras.router import router_convenios as aseguradoras_convenios_router
from app.shared.aseguradoras.router import router_listado as aseguradoras_listado_router
from app.shared.auth import service as auth_service
from app.shared.auth.router import router as auth_router
from app.shared.catalogos.parametros import router as parametros_router
from app.shared.catalogos.router import router as catalogos_router
from app.shared.central import fichas as fichas_central
from app.shared.configuracion.router import router as configuracion_router
from app.shared.notificaciones.router import router as notificaciones_router
from app.shared.pacientes.router import router as pacientes_router
from app.shared.prestadores.router import router as prestadores_router
from app.shared.users.router import router as usuarios_plataforma_router

configurar_logging()

# Allowlist de rutas públicas, en UN SOLO sitio. Todo lo demás es privado por
# definición; el test de CI recorre app.routes y falla si alguna ruta fuera de
# esta lista no exige get_current_user.
PUBLIC_PATHS = {
    "/api/v1/health",
    "/api/v1/auth/login",
    "/api/v1/auth/csrf",
    # Quien abre una invitación todavía no tiene contraseña, así que no puede
    # tener sesión: el token del enlace es la credencial, de un solo uso.
    "/api/v1/auth/invitacion",
    "/api/v1/auth/definir-password",
    # El informe entregado que otra app pidió a la central (D3): el enlace de un
    # solo uso que emitió la central ES la credencial, y se canjea allí.
    "/api/v1/concurrencia/compartido/informes/{entrega_id}",
}

INTERVALO_PURGA_SEG = 3600
# Un solo worker ejecuta la purga aunque uvicorn corra con --workers 4.
LOCK_PURGA = 815_243_001

# La regla del NO AUDITADO de Concurrencia: cada pocos minutos, toda visita
# programada cuya ventana venció sin llegada del auditor pasa a `no_auditado`.
INTERVALO_NO_AUDITADAS_SEG = 300
LOCK_NO_AUDITADAS = 815_243_002

# Publicación en la API central (pacientes → personas, visitas culminadas →
# eventos). Solo corre si CENTRAL_* está configurado; si la central cae, la
# app sigue y lo pendiente sale en la próxima pasada.
LOCK_CENTRAL = 815_243_003

# Réplica del núcleo (aseguradoras, prestadores, convenios, SLA, módulos
# contratados) hacia la central. Solo si CENTRAL_PLATAFORMA_* está configurado.
LOCK_REPLICACION = 815_243_004

# Paso 5b: el espejo local de las fichas (aseguradoras, prestadores, contactos,
# sedes) se compara con la central —su dueña— y se repara si difiere.
LOCK_FICHAS = 815_243_005


def _con_candado(clave: int, trabajo: Callable[[Session], None]) -> None:
    """
    Corre `trabajo(db)` bajo un advisory lock de Postgres con TODO —tomarlo, el
    trabajo y soltarlo— sobre UNA misma conexión. Con `SessionLocal()` a secas
    no hay garantía: la sesión devuelve su conexión al pool en cada commit y el
    unlock podría caer en otra, quedando soltado en falso y el candado pegado.
    El `rollback()` del finally limpia la transacción si el trabajo la dejó
    abortada; sin él, el unlock también fallaría y esa conexión del pool
    retendría el candado para siempre (pasó en QA: la primera pasada corrió
    contra una base aún sin migrar y la tarea quedó muda desde entonces).
    """
    with engine.connect() as conexion:
        tomado = conexion.execute(
            text("SELECT pg_try_advisory_lock(:k)"), {"k": clave}
        ).scalar()
        conexion.commit()
        if not tomado:
            return
        try:
            with SessionLocal(bind=conexion) as db:
                trabajo(db)
        finally:
            conexion.rollback()
            conexion.execute(text("SELECT pg_advisory_unlock(:k)"), {"k": clave})
            conexion.commit()


async def _purga_periodica() -> None:
    while True:
        await asyncio.sleep(INTERVALO_PURGA_SEG)
        try:
            await asyncio.to_thread(_purgar)
        except Exception:  # noqa: BLE001 - la purga nunca debe tumbar la app
            log.exception("purga_sesiones_fallo")


def _purgar() -> None:
    def trabajo(db: Session) -> None:
        borradas = auth_service.purgar_sesiones_vencidas(db)
        db.commit()
        if borradas:
            log.info("purga_sesiones", borradas=borradas)

    _con_candado(LOCK_PURGA, trabajo)


async def _no_auditadas_periodica() -> None:
    # La primera pasada va de inmediato: un arranque tras horas apagado debe
    # poner al día los casos vencidos sin esperar al primer intervalo.
    while True:
        try:
            await asyncio.to_thread(_marcar_no_auditadas)
        except Exception:  # noqa: BLE001 - la tarea nunca debe tumbar la app
            log.exception("no_auditadas_fallo")
        await asyncio.sleep(INTERVALO_NO_AUDITADAS_SEG)


def _marcar_no_auditadas() -> None:
    from app.modules.concurrencia import service as concurrencia_service

    def trabajo(db: Session) -> None:
        casos = concurrencia_service.marcar_no_auditadas(db)
        db.commit()
        if casos:
            log.info("visitas_no_auditadas", casos=casos)

    _con_candado(LOCK_NO_AUDITADAS, trabajo)


async def _central_periodica() -> None:
    while True:
        try:
            await asyncio.to_thread(_sincronizar_central)
        except Exception:  # noqa: BLE001 - la tarea nunca debe tumbar la app
            log.exception("central_sincronizacion_fallo")
        await asyncio.sleep(settings.central_intervalo_sec)


def _sincronizar_central() -> None:
    from app.core.central import cliente
    from app.modules.concurrencia import central as concurrencia_central

    def trabajo(db: Session) -> None:
        hechas, fallidas = concurrencia_central.sincronizar_pendientes(db, cliente())
        if hechas or fallidas:
            log.info("central_sincronizacion", sincronizadas=hechas, fallidas=fallidas)

    _con_candado(LOCK_CENTRAL, trabajo)


async def _replicacion_periodica() -> None:
    while True:
        try:
            await asyncio.to_thread(_replicar_central)
        except Exception:  # noqa: BLE001 - la tarea nunca debe tumbar la app
            log.exception("central_replicacion_fallo")
        await asyncio.sleep(settings.central_replicacion_intervalo_sec)


def _replicar_central() -> None:
    from app.core.central import cliente_plataforma
    from app.shared.central import replicacion

    def trabajo(db: Session) -> None:
        resultado = replicacion.replicar(db, cliente_plataforma())
        if resultado:
            log.info("central_replicacion", **resultado)

    _con_candado(LOCK_REPLICACION, trabajo)


async def _fichas_periodica() -> None:
    while True:
        await asyncio.sleep(settings.central_fichas_verificar_sec)
        try:
            await asyncio.to_thread(_verificar_fichas)
        except Exception:  # noqa: BLE001 - la tarea nunca debe tumbar la app
            log.exception("central_fichas_fallo")


def _verificar_fichas() -> None:
    from app.core.central import CentralError, cliente_plataforma

    def trabajo(db: Session) -> None:
        try:
            fichas_central.verificar(db, cliente_plataforma(), reparar=True)
        except CentralError as error:  # central reiniciando o caída: se reintenta luego
            log.warning("central_fichas_sin_respuesta", estado=error.estado)

    _con_candado(LOCK_FICHAS, trabajo)


@contextlib.asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    log.info("arranque", environment=settings.environment, debug=settings.debug)
    # El modelo de voz del dictado se calienta en un hilo aparte: la primera
    # descarga son cientos de MB y no debe retrasar el arranque.
    from app.modules.concurrencia import transcripcion

    transcripcion.precalentar()
    tarea = asyncio.create_task(_purga_periodica())
    tarea_no_auditadas = asyncio.create_task(_no_auditadas_periodica())
    tareas = [tarea, tarea_no_auditadas]
    # La réplica va primero: los eventos de Concurrencia referencian aseguradoras
    # y prestadores que deben existir ya en la central.
    if settings.replicacion_central_configurada:
        tareas.append(asyncio.create_task(_replicacion_periodica()))
    if settings.central_configurada:
        tareas.append(asyncio.create_task(_central_periodica()))
    if fichas_central.activo():
        tareas.append(asyncio.create_task(_fichas_periodica()))
    log.info(
        "central",
        configurada=settings.central_configurada,
        replicacion=settings.replicacion_central_configurada,
    )
    try:
        yield
    finally:
        for pendiente in tareas:
            pendiente.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await pendiente


app = FastAPI(
    title="Accumedical API",
    version="0.1.0",
    lifespan=lifespan,
    # Sin documentación pública en producción: no se regala el mapa de la API.
    docs_url="/api/v1/docs" if settings.environment == "development" else None,
    redoc_url=None,
    openapi_url="/api/v1/openapi.json" if settings.environment == "development" else None,
)

app.state.limiter = limiter


@app.exception_handler(RateLimitExceeded)
async def _rate_limit(_request, _exc):  # noqa: ANN001
    return JSONResponse(
        status_code=429,
        content={"detail": "Demasiados intentos. Inténtalo más tarde."},
        headers={"Retry-After": "60"},
    )


@app.exception_handler(IntegrityError)
async def _integridad(_request, exc: IntegrityError):  # noqa: ANN001
    """
    Última red de la base. Casi todo se valida antes y sale con un mensaje
    propio; lo que llegue aquí —por ejemplo intercambiar en un solo guardado los
    nombres de dos sedes, que el índice único comprueba fila a fila— se responde
    como conflicto, sin devolver jamás el texto del error de Postgres: lleva
    nombres de tablas, columnas y valores.
    """
    log.warning("integridad_violada", error=type(exc.orig).__name__)
    return JSONResponse(
        status_code=409,
        content={
            "detail": "El cambio choca con un dato ya guardado. Revísalo y vuelve a intentarlo."
        },
    )


@app.exception_handler(RequestValidationError)
async def _validacion(_request, exc: RequestValidationError):  # noqa: ANN001
    """
    El manejador por defecto de FastAPI devuelve el cuerpo recibido dentro del
    error, así que un login mal formado respondería con la contraseña enviada
    escrita en el JSON de respuesta. Aquí se devuelven solo tipo, campo y mensaje.
    """
    errores = [
        {"tipo": e.get("type"), "campo": ".".join(str(x) for x in e.get("loc", [])[1:]),
         "mensaje": e.get("msg")}
        for e in exc.errors()
    ]
    return JSONResponse(status_code=422, content={"detail": errores})


# El orden importa: el último añadido es el más externo.
app.add_middleware(CabecerasSeguridadMiddleware)
app.add_middleware(OrigenMiddleware)
app.add_middleware(RequestIdMiddleware)

if settings.allowed_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.allowed_origins,  # allowlist explícita, jamás "*"
        allow_credentials=True,
        allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Content-Type", "X-CSRF-Token"],
    )

api = APIRouter(prefix="/api/v1")

salud = APIRouter(tags=["infra"])


@salud.get("/health")
def health() -> dict:
    """Objetivo del healthcheck de Docker. Sin tocar la base y sin información interna."""
    return {"status": "ok"}


api.include_router(salud)
api.include_router(auth_router)
api.include_router(catalogos_router)
api.include_router(parametros_router)
api.include_router(notificaciones_router)
# Los tres routers de aseguradoras comparten prefijo y se diferencian por su
# dependencia. El de la ficha va SIEMPRE EL ÚLTIMO: tiene `/{aseguradora_id}`,
# que se tragaría las rutas literales de los otros —`/propia`, `/{id}/basico`—.
# FastAPI resuelve por orden de registro, no por especificidad.
api.include_router(aseguradoras_listado_router)
api.include_router(aseguradoras_convenios_router)
api.include_router(aseguradoras_router)
api.include_router(prestadores_router)
api.include_router(usuarios_plataforma_router)
api.include_router(pacientes_router)
api.include_router(configuracion_router)
api.include_router(suscripcion_router)
api.include_router(calificacion_router)
api.include_router(concurrencia_router)
api.include_router(concurrencia_compartido_router)
api.include_router(carta_credito_router)

app.include_router(api)
