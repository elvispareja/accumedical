"""
La garantía estructural de A01: ninguna ruta queda sin autenticación por descuido.

Este test recorre las rutas registradas y falla si alguna que no esté en la
allowlist pública carece de `get_current_user` en su árbol de dependencias. Es lo
que convierte el deny-by-default en una propiedad verificable en vez de una
cuestión de disciplina en la revisión de código.

Ojo con el recorrido: las versiones recientes de FastAPI NO aplanan los routers
dentro de `app.routes`, los anidan. Un test que solo mire `app.routes` buscando
APIRoute no encuentra ninguna y pasa en vacío, que es la peor forma de fallar:
en verde. De ahí que aquí se recorra el árbol y que exista el test de abajo, que
comprueba que se encontró algo.
"""

from __future__ import annotations

from collections.abc import Iterator

from fastapi.routing import APIRoute

from app.core.security.deps import get_current_user
from app.main import PUBLIC_PATHS, app

# Rutas que monta FastAPI por su cuenta y que no forman parte de la API.
RUTAS_DE_FRAMEWORK = {
    "/api/v1/openapi.json",
    "/api/v1/docs",
    "/docs/oauth2-redirect",
    "/redoc",
}


def _recorrer(nodo: object, prefijo: str = "") -> Iterator[tuple[str, APIRoute]]:
    """
    Devuelve (ruta completa, APIRoute) recorriendo routers anidados.

    `route.path` ya incluye el prefijo de SU router, así que solo se acumulan los
    prefijos de los routers antecesores.
    """
    if isinstance(nodo, APIRoute):
        yield prefijo + nodo.path, nodo
        return

    router = getattr(nodo, "original_router", None)
    if router is not None:
        propio = getattr(router, "prefix", "")
        for hijo in router.routes:
            if isinstance(hijo, APIRoute):
                yield prefijo + hijo.path, hijo
            else:
                yield from _recorrer(hijo, prefijo + propio)


def _rutas_de_la_api() -> list[tuple[str, APIRoute]]:
    encontradas: list[tuple[str, APIRoute]] = []
    for ruta in app.routes:
        encontradas.extend(_recorrer(ruta))
    return encontradas


def _dependencias_de(ruta: APIRoute) -> set:
    """Aplana el árbol de dependencias de una ruta, incluidas las anidadas."""
    encontradas = set()
    pendientes = list(ruta.dependant.dependencies)
    while pendientes:
        dep = pendientes.pop()
        if dep.call is not None:
            encontradas.add(dep.call)
        pendientes.extend(dep.dependencies)
    return encontradas


def test_el_recorrido_encuentra_rutas() -> None:
    """Guarda contra el falso verde: si el recorrido no encuentra nada, el test
    de deny-by-default no está comprobando absolutamente nada."""
    rutas = _rutas_de_la_api()
    assert len(rutas) >= 10, f"El recorrido solo encontró {len(rutas)} rutas; algo va mal"


def test_toda_ruta_privada_exige_sesion() -> None:
    desprotegidas = [
        f"{sorted(ruta.methods)} {path}"
        for path, ruta in _rutas_de_la_api()
        if path not in PUBLIC_PATHS
        and path not in RUTAS_DE_FRAMEWORK
        and get_current_user not in _dependencias_de(ruta)
    ]

    assert not desprotegidas, (
        "Estas rutas no exigen sesión y no están en PUBLIC_PATHS:\n  "
        + "\n  ".join(desprotegidas)
    )


def test_la_allowlist_publica_solo_contiene_rutas_reales() -> None:
    """Una entrada obsoleta en PUBLIC_PATHS dejaría un agujero silencioso el día
    que alguien registrara esa ruta de verdad."""
    registradas = {path for path, _ in _rutas_de_la_api()}
    fantasmas = PUBLIC_PATHS - registradas
    assert not fantasmas, f"PUBLIC_PATHS referencia rutas inexistentes: {sorted(fantasmas)}"
