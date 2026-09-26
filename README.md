# Accumedical

Plataforma modular para el sector de seguros de salud. Núcleo compartido (aseguradoras, prestadores, usuarios, roles, permisos, sesiones, auditoría y catálogos) más cuatro módulos independientes: suscripción, calificación, concurrencia y carta de crédito.

La arquitectura, las reglas de seguridad y las convenciones están en [`CLAUDE.md`](CLAUDE.md). El detalle técnico vive en [`docs/`](docs/).

---

## Requisitos

Docker Desktop con backend WSL2. No hace falta Python ni Node en la máquina: todo corre en contenedores.

## Puesta en marcha

```bash
cp .env.example .env        # y rellena los valores (ver más abajo)
docker compose up --build   # levanta db, api, web y nginx
```

Con los cuatro servicios en `healthy`, aplica la migración y crea el administrador:

```bash
docker compose exec api /opt/venv/bin/alembic upgrade head
docker compose exec api /opt/venv/bin/python -m app.cli create-superadmin
```

La aplicación queda en **http://localhost:8080**.

> El `8080` en lugar del `80` es deliberado: en Windows el 80 suele estar tomado por `http.sys` o IIS, y publicar en todas las interfaces expondría el entorno de desarrollo a la red local. Solo `nginx` publica puerto; `api` y `web` no son alcanzables desde fuera.

## Qué rellenar en el `.env`

Todas las claves están documentadas en [`.env.example`](.env.example). Las que no tienen valor por defecto:

| Variable | Cómo obtenerla |
|---|---|
| `POSTGRES_PASSWORD` | Cualquier contraseña; mantenla URL-safe (sin `@ / # % :`) |
| `SECRET_KEY` | `python -c "import secrets; print(secrets.token_urlsafe(48))"` |
| `MFA_ENCRYPTION_KEY` | `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"` |
| `SUPERADMIN_EMAIL` / `SUPERADMIN_PASSWORD` | Credenciales del primer administrador. La contraseña necesita 12 caracteres como mínimo |

La configuración se valida al arrancar con pydantic-settings: si falta algo o es inválido, el contenedor `api` **no llega a `healthy`** en lugar de arrancar a medias.

## Comandos de uso diario

```bash
docker compose ps                         # estado y salud de los servicios
docker compose logs -f api                # logs JSON estructurados de la API
docker compose exec api /opt/venv/bin/alembic upgrade head      # aplicar migraciones
docker compose exec api /opt/venv/bin/alembic downgrade base    # vaciar el esquema
docker compose exec db psql -U accumedical -d accumedical       # consola SQL
docker compose down                       # parar (los datos persisten en el volumen)
docker compose down -v                    # parar y BORRAR la base de datos
```

Para conectar psql o DBeaver desde tu máquina: `127.0.0.1:55432` (configurable con `POSTGRES_HOST_PORT`). Ese puerto **no existe** en el compose de producción.

## Estructura

```
backend/    FastAPI · SQLAlchemy · Alembic        (docs/01, docs/03)
web/        React · TypeScript · Vite · Tailwind
infra/      configuración de nginx                (docs/02)
docs/       plan, esquema, infraestructura, API
```

## Estado actual

Funciona de punta a punta: infraestructura, migración inicial con sus catálogos, autenticación completa (sesión en servidor, CSRF, rate limiting, bloqueo de cuenta, auditoría), el login, y el área de administración con menú lateral y el **CRUD de aseguradoras** —listado con búsqueda y filtros del servidor, alta y edición con provincia y ciudad en cascada, y subida de logo.

Pendiente: pantallas de selección de módulo y sin accesos, gestión de accesos por usuario, y la lógica de negocio de los cuatro módulos, que hoy son esqueletos protegidos.

El plan por hitos está en [`docs/00-plan-iteracion-1.md`](docs/00-plan-iteracion-1.md), y **el estado real, con lo verificado y las cuestiones abiertas, en [`docs/04-estado-implementacion.md`](docs/04-estado-implementacion.md)**.
