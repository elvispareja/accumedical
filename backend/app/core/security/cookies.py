from __future__ import annotations

from fastapi import Response

from app.core.config import settings


def _comunes() -> dict:
    comunes = {
        "secure": bool(settings.cookie_secure),
        "samesite": "strict",
        "path": "/",
    }
    # Con COOKIE_DOMAIN (p. ej. pymes.ec) la sesión se comparte entre
    # admin.pymes.ec y el subdominio de cada módulo. Sin él, la cookie es solo
    # del host que la puso (el comportamiento de siempre).
    if settings.cookie_domain:
        comunes["domain"] = settings.cookie_domain
    return comunes


def poner_cookies_sesion(response: Response, token_sesion: str, token_csrf: str) -> None:
    max_age = settings.session_absolute_ttl_min * 60

    # httponly: el JavaScript no puede leerla ni aunque haya un XSS. Nunca localStorage.
    response.set_cookie(
        settings.nombre_cookie_sesion,
        token_sesion,
        httponly=True,
        max_age=max_age,
        **_comunes(),
    )
    # SIN httponly a propósito: el cliente debe leerla para reenviarla en la
    # cabecera X-CSRF-Token. Es el patrón double-submit.
    response.set_cookie(
        settings.nombre_cookie_csrf,
        token_csrf,
        httponly=False,
        max_age=max_age,
        **_comunes(),
    )


def poner_cookie_csrf(response: Response, token_csrf: str) -> None:
    response.set_cookie(
        settings.nombre_cookie_csrf,
        token_csrf,
        httponly=False,
        max_age=settings.session_absolute_ttl_min * 60,
        **_comunes(),
    )


def borrar_cookies_sesion(response: Response) -> None:
    for nombre in (settings.nombre_cookie_sesion, settings.nombre_cookie_csrf):
        response.delete_cookie(
            nombre,
            path="/",
            domain=settings.cookie_domain or None,
            samesite="strict",
            secure=bool(settings.cookie_secure),
        )
