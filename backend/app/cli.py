from __future__ import annotations

import sys

from sqlalchemy import select

import app.shared  # noqa: F401  (registra los modelos)
from app.core.config import settings
from app.core.db import SessionLocal
from app.core.security import passwords
from app.shared.users.models import User

AYUDA = """Comandos disponibles:
  create-superadmin    Crea (o reactiva) el administrador global desde SUPERADMIN_EMAIL
                       y SUPERADMIN_PASSWORD. Es idempotente.
  sincronizar-central  Publica en la API central lo pendiente de Concurrencia
                       (pacientes → personas, visitas culminadas → eventos).
                       Idempotente: lo ya publicado no se repite.
"""


def sincronizar_central() -> int:
    if not settings.central_configurada:
        print(
            "La central no está configurada (CENTRAL_API_URL / CENTRAL_CLIENT_*)", file=sys.stderr
        )
        return 2
    import app.modules  # noqa: F401  (registra los modelos de los módulos)
    from app.core.central import cliente
    from app.modules.concurrencia import central

    total_ok = total_mal = 0
    with SessionLocal() as db:
        while True:
            ok, mal = central.sincronizar_pendientes(db, cliente(), limite=100)
            total_ok += ok
            total_mal += mal
            if ok == 0:  # nada nuevo salió bien en esta pasada: lo que queda está atascado
                break
    print(f"Sincronizadas: {total_ok} · con error: {total_mal}")
    return 0 if total_mal == 0 else 1


def create_superadmin() -> int:
    """
    El superadmin NO se siembra en la migración: un hash de contraseña en el
    historial de migraciones es un secreto filtrado y además idéntico en todos los
    despliegues. Se crea aquí, leyendo credenciales del entorno ya validado.
    """
    email = settings.superadmin_email.strip()
    password = settings.superadmin_password.get_secret_value()

    if not email or not password:
        print("ERROR: define SUPERADMIN_EMAIL y SUPERADMIN_PASSWORD en el .env", file=sys.stderr)
        return 2

    if len(password) < settings.password_min_length:
        print(
            f"ERROR: la contraseña debe tener al menos {settings.password_min_length} "
            f"caracteres (tiene {len(password)}).",
            file=sys.stderr,
        )
        return 2

    with SessionLocal() as db:
        existente = db.scalar(select(User).where(User.email == email))
        if existente is not None:
            existente.password_hash = passwords.hashear(password)
            existente.is_superadmin = True
            existente.is_active = True
            existente.deleted_at = None
            existente.failed_login_attempts = 0
            existente.locked_until = None
            db.commit()
            print(f"Administrador global actualizado: {email}")
            return 0

        usuario = User(
            email=email,
            password_hash=passwords.hashear(password),
            nombre_principal="Administrador",
            apellido_paterno="General",
            is_superadmin=True,
            is_active=True,
            created_by=None,  # bootstrap: no hay nadie que lo haya creado
        )
        db.add(usuario)
        db.commit()
        print(f"Administrador global creado: {email}")
        return 0


def main() -> int:
    if len(sys.argv) < 2:
        print(AYUDA, file=sys.stderr)
        return 2
    comando = sys.argv[1]
    if comando == "create-superadmin":
        return create_superadmin()
    if comando == "sincronizar-central":
        return sincronizar_central()
    print(f"Comando desconocido: {comando}\n\n{AYUDA}", file=sys.stderr)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
