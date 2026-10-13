from __future__ import annotations

from fastapi import Request, Response

from app.core.config import settings

# Dos alcances de sesión (D53, pedido del usuario: «cada app con su login; el
# único que pasa entre apps sin volver a loguearse es el admin»):
#
#   · APP (todos): cookie SOLO del subdominio donde se inició sesión (`__Host-`:
#     sin Domain, el navegador no la manda a ninguna otra app). Abrir otra app
#     pide usuario y contraseña de nuevo.
#   · PLATAFORMA (solo el administrador global): cookie del dominio padre
#     (COOKIE_DOMAIN, `__Secure-`), la misma en todas las apps.
#
# El servidor lo impone también: una cookie de PLATAFORMA de alguien que no es
# administrador se rechaza (`deps.get_current_user`). Sin COOKIE_DOMAIN (local)
# solo existe el alcance APP.


def _nombres_app() -> tuple[str, str]:
    prefijo = "__Host-" if settings.cookie_secure else ""
    return f"{prefijo}session", f"{prefijo}csrf_token"


def _nombres_plataforma() -> tuple[str, str]:
    return settings.nombre_cookie_sesion, settings.nombre_cookie_csrf


def hay_alcance_plataforma() -> bool:
    return bool(settings.cookie_domain) and _nombres_plataforma() != _nombres_app()


def _comunes(plataforma: bool) -> dict:
    comunes = {"secure": bool(settings.cookie_secure), "samesite": "strict", "path": "/"}
    if plataforma:
        comunes["domain"] = settings.cookie_domain
    return comunes


def leer_token(request: Request) -> tuple[str | None, bool]:
    """(token, es_de_plataforma). Manda la cookie de la APP si existe."""
    sesion_app, _ = _nombres_app()
    token = request.cookies.get(sesion_app)
    if token:
        return token, False
    if hay_alcance_plataforma():
        token = request.cookies.get(_nombres_plataforma()[0])
        if token:
            return token, True
    return None, False


def poner_cookies_sesion(
    response: Response, token_sesion: str, token_csrf: str, *, plataforma: bool
) -> None:
    plataforma = plataforma and hay_alcance_plataforma()
    nombre_sesion, nombre_csrf = _nombres_plataforma() if plataforma else _nombres_app()
    max_age = settings.session_absolute_ttl_min * 60
    response.set_cookie(
        nombre_sesion, token_sesion, httponly=True, max_age=max_age, **_comunes(plataforma)
    )
    response.set_cookie(
        nombre_csrf, token_csrf, httponly=False, max_age=max_age, **_comunes(plataforma)
    )
    if plataforma:
        # Que una sesión vieja de app en este subdominio no tape la de plataforma.
        _borrar(response, _nombres_app(), plataforma=False)


def poner_cookie_csrf(response: Response, token_csrf: str, *, plataforma: bool) -> None:
    plataforma = plataforma and hay_alcance_plataforma()
    nombre = (_nombres_plataforma() if plataforma else _nombres_app())[1]
    response.set_cookie(
        nombre,
        token_csrf,
        httponly=False,
        max_age=settings.session_absolute_ttl_min * 60,
        **_comunes(plataforma),
    )


def _borrar(response: Response, nombres: tuple[str, str], *, plataforma: bool) -> None:
    for nombre in nombres:
        response.delete_cookie(
            nombre,
            path="/",
            domain=settings.cookie_domain if plataforma else None,
            samesite="strict",
            secure=bool(settings.cookie_secure),
        )


def borrar_cookies_sesion(response: Response) -> None:
    """Salir: se borran las dos, la de esta app y (si la hay) la de plataforma."""
    _borrar(response, _nombres_app(), plataforma=False)
    if hay_alcance_plataforma():
        _borrar(response, _nombres_plataforma(), plataforma=True)
