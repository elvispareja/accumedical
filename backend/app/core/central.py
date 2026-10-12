"""
Cliente de la API central de Accumedical (elvispareja/accumedical-central).

La central es la fuente única de personas, aseguradoras, prestadores y eventos.
Este cliente solo sabe hablar HTTP con ella: pedir el token (OAuth2 client
credentials), reutilizarlo hasta que venza y hacer GET/POST con JSON. Qué se
envía y cómo se traduce lo decide cada módulo (p. ej. concurrencia/central.py).

Biblioteca estándar a propósito (urllib): no suma dependencias a la imagen.
"""

from __future__ import annotations

import json
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from typing import Any

from app.core.config import settings


class CentralError(Exception):
    """La central respondió con error o no respondió. `estado` es None si no hubo respuesta."""

    def __init__(self, estado: int | None, detalle: Any) -> None:
        super().__init__(f"central {estado}: {detalle}")
        self.estado = estado
        self.detalle = detalle


class ClienteCentral:
    def __init__(self, client_id: str, client_secret: str) -> None:
        self._client_id = client_id
        self._client_secret = client_secret
        self._base = settings.central_api_url.rstrip("/")
        # Solo http(s): urlopen también abriría file:// u otros esquemas (S310).
        if urllib.parse.urlsplit(self._base).scheme not in ("http", "https"):
            raise ValueError("CENTRAL_API_URL debe empezar por http:// o https://")
        self._token: str | None = None
        self._vence: float = 0.0
        self._candado = threading.Lock()

    # ── HTTP crudo ───────────────────────────────────────────────────────────
    def _http(
        self,
        metodo: str,
        ruta: str,
        cuerpo: Any = None,
        *,
        token: str | None = None,
        usuario: uuid.UUID | None = None,
    ) -> tuple[int, Any]:
        datos = json.dumps(cuerpo, default=str).encode() if cuerpo is not None else None
        peticion = urllib.request.Request(  # noqa: S310 - esquema validado en __init__
            self._base + ruta, data=datos, method=metodo
        )
        peticion.add_header("Content-Type", "application/json")
        peticion.add_header("Accept", "application/json")
        if token:
            peticion.add_header("Authorization", f"Bearer {token}")
        if usuario:
            peticion.add_header("X-Usuario-Id", str(usuario))
        try:
            with urllib.request.urlopen(peticion, timeout=settings.central_timeout_sec) as r:  # noqa: S310 - URL de configuración
                return r.status, json.loads(r.read() or b"null")
        except urllib.error.HTTPError as error:
            crudo = error.read()
            try:
                return error.code, json.loads(crudo)
            except ValueError:
                return error.code, crudo[:200].decode(errors="replace")
        except (urllib.error.URLError, TimeoutError, OSError) as error:
            raise CentralError(None, type(error).__name__) from error

    # ── Token ────────────────────────────────────────────────────────────────
    def _token_vigente(self, *, renovar: bool = False) -> str:
        with self._candado:
            if renovar or not self._token or time.monotonic() >= self._vence:
                estado, r = self._http(
                    "POST",
                    "/api/auth/token",
                    {
                        "grant_type": "client_credentials",
                        "client_id": self._client_id,
                        "client_secret": self._client_secret,
                    },
                )
                if estado != 200:
                    raise CentralError(estado, "no se obtuvo token")
                self._token = r["access_token"]
                # Se renueva un minuto antes de que venza.
                self._vence = time.monotonic() + max(int(r.get("expires_in", 900)) - 60, 30)
            return self._token

    def llamar(
        self, metodo: str, ruta: str, cuerpo: Any = None, *, usuario: uuid.UUID | None = None
    ) -> tuple[int, Any]:
        """Petición autenticada. Un 401 renueva el token y reintenta una sola vez."""
        estado, r = self._http(metodo, ruta, cuerpo, token=self._token_vigente(), usuario=usuario)
        if estado == 401:
            estado, r = self._http(
                metodo, ruta, cuerpo, token=self._token_vigente(renovar=True), usuario=usuario
            )
        return estado, r


_clientes: dict[str, ClienteCentral] = {}
_clientes_candado = threading.Lock()


def _unico(nombre: str, client_id: str, client_secret: str) -> ClienteCentral:
    """Un cliente por credencial y por proceso: así el token se reutiliza."""
    with _clientes_candado:
        if nombre not in _clientes:
            _clientes[nombre] = ClienteCentral(client_id, client_secret)
        return _clientes[nombre]


def cliente() -> ClienteCentral:
    """Credencial de Concurrencia (perfil «app»): personas y eventos."""
    return _unico(
        "concurrencia",
        settings.central_client_id,
        settings.central_client_secret.get_secret_value(),
    )


def cliente_plataforma() -> ClienteCentral:
    """Credencial del núcleo (perfil «admin» + replicacion:escribir)."""
    return _unico(
        "plataforma",
        settings.central_plataforma_client_id,
        settings.central_plataforma_client_secret.get_secret_value(),
    )
