# Infraestructura Docker, nginx y configuración

Iteración 1 · Documento normativo. Incorpora las correcciones de la revisión adversarial de infraestructura.

---

## 1. Topología

```
                         ┌──────────── red: edge ────────────┐
  navegador ──127.0.0.1:8080──►  nginx  ──► web (vite dev, solo en desarrollo)
                                   │
                                   └──► api (uvicorn)
                                          │
                         ┌──────────── red: data ────────────┐
                                          └──► db (postgres 16)
```

Dos redes en lugar de una plana: `nginx` y `web` **no pueden alcanzar Postgres**. `api` pertenece a ambas; `db` solo a `data`.

- **Desarrollo**: `data` es una bridge normal, porque publicar `127.0.0.1:5432` requiere gateway (una red con `internal: true` no admite publicación de puertos).
- **Producción**: `data` lleva `internal: true` y `db` no publica ningún puerto.

En producción hay **un solo nginx** (decisión D-13): la misma imagen sirve el SPA estático, hace proxy de `/api`, termina TLS y emite las cabeceras de seguridad. No hay dos nginx encadenados (duplicarían cabeceras y acumularían saltos en `X-Forwarded-For`, rompiendo la IP del AuditLog).

---

## 2. `docker-compose.yml` — desarrollo

```yaml
# docker-compose.yml — DESARROLLO
# Compose v2 (sin clave `version`, deprecada). Docker Desktop con backend WSL2.
name: accumedical

networks:
  edge:
    driver: bridge
  data:
    driver: bridge          # en producción: internal: true

volumes:
  pgdata:                   # los datos de Postgres NUNCA en bind mount (permisos/locking rotos en NTFS)
  uploads:                  # archivos subidos, fuera del árbol de código

services:
  db:
    image: postgres:16.10-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: ${POSTGRES_USER:?definir en .env}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?definir en .env}
      POSTGRES_DB: ${POSTGRES_DB:?definir en .env}
    volumes:
      - pgdata:/var/lib/postgresql/data
    # SOLO DESARROLLO, y atado a loopback: DBeaver/psql desde la workstation.
    # El puerto del host es configurable porque es habitual tener ya un Postgres
    # local en el 5432. Dentro de la red `data` siempre es db:5432.
    # En docker-compose.prod.yml esta clave `ports` NO existe.
    ports:
      - "127.0.0.1:${POSTGRES_HOST_PORT:-55432}:5432"
    healthcheck:
      # -h 127.0.0.1 fuerza TCP: sin él, pg_isready usa el socket unix y reporta "healthy"
      # durante la ventana del servidor temporal de initdb, antes de que el definitivo escuche.
      # $$ escapa la interpolación de Compose: la variable la expande el shell del contenedor.
      test: ["CMD-SHELL", "pg_isready -h 127.0.0.1 -U $${POSTGRES_USER} -d $${POSTGRES_DB}"]
      interval: 5s
      timeout: 3s
      retries: 10
      start_period: 10s
    networks: [data]

  api:
    build:
      context: ./backend
      dockerfile: Dockerfile.dev
    restart: unless-stopped
    env_file: .env            # Compose lee .env del host e inyecta las claves como variables de entorno
    environment:
      # Windows: los eventos inotify no cruzan el bind mount desde NTFS → watchfiles debe hacer polling
      WATCHFILES_FORCE_POLLING: "true"
    volumes:
      - ./backend:/app        # bind mount del código para hot reload
      - uploads:/srv/uploads  # el venv vive en /opt/venv, fuera de /app: el mount no lo pisa
    depends_on:
      db:
        condition: service_healthy
    healthcheck:
      # python:3.12-slim no trae curl ni wget: se usa la stdlib
      test: ["CMD", "python", "-c",
             "import urllib.request,sys; r=urllib.request.urlopen('http://127.0.0.1:8000/api/v1/health', timeout=3); sys.exit(0 if r.status==200 else 1)"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 20s
    networks: [edge, data]

  web:
    build:
      context: ./web
      dockerfile: Dockerfile.dev
    restart: unless-stopped
    environment:
      VITE_HMR_CLIENT_PORT: "8080"   # el puerto por el que el navegador ve la app (nginx)
    volumes:
      - ./web:/app
      - /app/node_modules     # volumen anónimo: los binarios nativos (esbuild, rollup) compilados para
                              # Linux NO deben ser pisados por el node_modules de Windows del host
    depends_on:
      api:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "wget", "-q", "--spider", "http://127.0.0.1:5173"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 30s
    networks: [edge]

  nginx:
    image: nginx:1.27-alpine
    restart: unless-stopped
    ports:
      # loopback + 8080: el puerto 80 suele estar tomado en Windows (http.sys/IIS) y publicar en
      # todas las interfaces expondría la app de desarrollo a la LAN.
      - "127.0.0.1:8080:80"
    volumes:
      - ./infra/nginx/dev.conf:/etc/nginx/conf.d/default.conf:ro
      # Los fragmentos compartidos van FUERA de conf.d: nginx carga automáticamente
      # todo *.conf de conf.d, y montar ahí el directorio entero cargaría también
      # prod.conf (que escucha en 8443 con certificados inexistentes) y reventaría.
      - ./infra/nginx/includes:/etc/nginx/includes:ro
    depends_on:
      api:
        condition: service_healthy
      web:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "wget", "-q", "--spider", "http://127.0.0.1:80/api/v1/health"]
      interval: 10s
      timeout: 5s
      retries: 5
    networks: [edge]
```

Levantar: `docker compose up --build` → la aplicación queda en **http://localhost:8080**.
Migraciones: `docker compose exec api /opt/venv/bin/alembic upgrade head`.
Superadmin: `docker compose exec api /opt/venv/bin/python -m app.cli create-superadmin`.

> Se invoca el binario por ruta absoluta a propósito. El `PATH` con `/opt/venv/bin` se fija con `ENV` en el Dockerfile, y `docker compose exec ... sh -lc` arranca un shell de login que lo reescribe desde `/etc/profile`: con esa forma, `alembic` y `python` del venv **no se encuentran**.

### 2.1 `backend/Dockerfile.dev`

```dockerfile
FROM python:3.12-slim
COPY --from=ghcr.io/astral-sh/uv:0.12.7 /uv /uvx /usr/local/bin/

# Venv FUERA de /app: el bind mount de ./backend:/app no debe destruir las dependencias instaladas
ENV UV_PROJECT_ENVIRONMENT=/opt/venv \
    PATH="/opt/venv/bin:$PATH" \
    UV_LINK_MODE=copy \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

# libmagic para la validación de MIME real de A08
RUN apt-get update && apt-get install -y --no-install-recommends libmagic1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-install-project      # incluye el grupo dev

RUN groupadd -r app && useradd -r -g app app \
    && mkdir -p /srv/uploads && chown -R app:app /srv/uploads /opt/venv
COPY --chown=app:app . .
USER app

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload", \
     "--proxy-headers", "--forwarded-allow-ips=*"]
```

`--proxy-headers` también en desarrollo: sin él, la IP del AuditLog y del rate limiting sería la del contenedor nginx (§4.2).

### 2.2 `web/Dockerfile.dev`

```dockerfile
FROM node:22-alpine

# /app lo crea WORKDIR como root. Hay que cedérselo a `node` ANTES de instalar.
WORKDIR /app
RUN chown node:node /app
USER node

COPY --chown=node:node package.json package-lock.json ./
RUN npm ci
COPY --chown=node:node . .

EXPOSE 5173
CMD ["npm", "run", "dev"]
```

`node:22-alpine`, no `node:20`: la 20 alcanzó fin de vida en abril de 2026 y quedaría sin parches (A06).

**El orden de `USER node` es crítico y no es cosmético.** Si `npm ci` corre como root y `USER node` viene después, `node_modules` queda con propietario root. En el arranque, Vite escribe su caché de dependencias en `node_modules/.vite/deps`, falla con `EACCES: permission denied`, el navegador no puede cargar los módulos preempaquetados y **la aplicación se queda en pantalla en blanco sin ningún error visible en la página**: el fallo solo aparece en los logs del contenedor. Por eso `USER node` va antes de la instalación.

Consecuencia operativa: al cambiar este Dockerfile no basta con reconstruir la imagen, porque el volumen anónimo de `node_modules` conserva el contenido y los permisos antiguos. Hay que recrearlo:

```bash
docker compose build web
docker compose rm -sfv web     # -v elimina el volumen anónimo
docker compose up -d web nginx
```

### 2.3 `web/vite.config.ts` — parte obligatoria

```ts
server: {
  host: true,
  port: 5173,
  strictPort: true,
  // Vite ≥5.4.12 rechaza Host desconocidos (fix de DNS rebinding). Sin esto, entrar por
  // un hostname que no sea localhost devuelve "Blocked request" y la app queda en blanco.
  allowedHosts: ['localhost'],
  watch: { usePolling: true, interval: 300 },   // NTFS → contenedor: sin polling no hay recarga
  // El navegador entra por nginx en el 8080; sin esto el cliente HMR intenta
  // ws://host:5173 y falla en silencio. Se toma de VITE_HMR_CLIENT_PORT, que fija
  // el compose: corriendo `npm run dev` a pelo (sin nginx) no se define y Vite
  // usa su comportamiento normal contra el 5173.
  hmr: puertoHmrCliente ? { clientPort: puertoHmrCliente } : true,
},
```

---

## 3. nginx

### 3.1 `infra/nginx/includes/security-headers.conf`

Archivo aparte porque **en nginx un `add_header` en un nivel inferior reemplaza todos los heredados del nivel superior**. Como cada `location` necesita su propio `Cache-Control`, declarar las cabeceras solo en el bloque `server` haría que `index.html` y los assets se sirvieran sin CSP, HSTS ni nosniff — y el fallo sería silencioso. Por eso este archivo se `include` **dentro de cada `location`**.

**La única fuente externa de toda la CSP es `https://*.tile.openstreetmap.org`, y solo en `img-src`.** El mapa de ubicación —aseguradoras, prestadores y cada sede— carga las teselas de OpenStreetMap como imágenes **desde el navegador**; el servidor no hace ninguna petición saliente, así que A10/SSRF sigue sin aplicar. Leaflet y su hoja de estilos van en el bundle propio, instalados por npm y nunca desde una CDN, para que `script-src` y `style-src` se queden en `'self'`.

El precio, dicho claramente: OpenStreetMap ve la IP del usuario y qué zonas del mapa mira. Si eso llega a molestar, la alternativa es un `location` de nginx que haga de proxy con caché hacia OSM; devuelve la CSP a `'self'` a cambio de introducir peticiones salientes del servidor y disco para la caché.

```nginx
# infra/nginx/includes/security-headers.conf
add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: https://*.tile.openstreetmap.org; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'" always;
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
add_header X-Frame-Options "DENY" always;
add_header X-Content-Type-Options "nosniff" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header Cross-Origin-Opener-Policy "same-origin" always;
```

**Verificación en CI**, no confianza: tras el despliegue, `curl -sI` contra `/`, `/assets/<hash>.js` y `/api/v1/health`; si falta alguna cabecera en alguna de las tres, el pipeline falla.

### 3.2 `infra/nginx/dev.conf`

```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

# A04: primera capa de rate limiting, antes de tocar la aplicación
limit_req_zone $binary_remote_addr zone=login:10m rate=10r/m;
limit_req_status 429;

server {
    listen 80;
    server_name _;
    client_max_body_size 10m;

    # Misma CSP que producción pero en modo informe: las violaciones aparecen en la consola
    # del navegador durante el desarrollo, no en el peor momento del despliegue.
    add_header Content-Security-Policy-Report-Only "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://*.tile.openstreetmap.org; font-src 'self' data:; connect-src 'self' ws://localhost:8080; object-src 'none'; frame-ancestors 'none'" always;

    location = /api/v1/auth/login {
        limit_req zone=login burst=5 nodelay;
        proxy_pass http://api:8000;
        include /etc/nginx/includes/proxy-api.inc;
    }

    # proxy_pass SIN URI final: la ruta llega intacta a FastAPI (que monta /api/v1). Cero rewrites.
    location /api/ {
        proxy_pass http://api:8000;
        include /etc/nginx/includes/proxy-api.inc;
    }

    # proxy-api.inc fija además proxy_read/send_timeout en 300 s: el informe
    # con IA (notas + fotos) tarda 2-3 minutos y el default de 60 s lo cortaba
    # con un 504 mientras la API seguía trabajando. CLAUDE_TIMEOUT_SEC (240)
    # queda por debajo a propósito: la API rinde el error legible antes de que
    # nginx corte a ciegas.

    # Vite dev server + websocket de HMR
    location / {
        proxy_pass http://web:5173;
        proxy_http_version 1.1;                          # obligatorio para websockets
        proxy_set_header Upgrade    $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_set_header Host       $host;
        proxy_read_timeout 86400s;   # el ws de HMR es de larga vida; sin esto nginx lo corta a los 60 s
        proxy_send_timeout 86400s;
    }
}
```

`infra/nginx/includes/proxy-api.inc` (compartido por dev y prod):

```nginx
proxy_http_version 1.1;
proxy_set_header Host              $host;
proxy_set_header X-Real-IP         $remote_addr;
# SOBRESCRIBE, no $proxy_add_x_forwarded_for (append). Con append, un cliente que envía
# su propio X-Forwarded-For elige la IP que verá la app: el rate limit por IP se evapora
# y el AuditLog queda envenenado con IPs falsas.
proxy_set_header X-Forwarded-For   $remote_addr;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_redirect off;
```

Los tres modos de fallo típicos del HMR quedan cubiertos: `proxy_http_version 1.1` + cabeceras `Upgrade`/`Connection` en `location /`; `hmr.clientPort` alineado con el puerto publicado (8080); `proxy_read_timeout` largo.

### 3.3 `infra/nginx/prod.conf`

```nginx
map $http_upgrade $connection_upgrade { default upgrade; '' close; }
limit_req_zone $binary_remote_addr zone=login:10m rate=10r/m;
limit_req_status 429;

# HTTP: solo challenge ACME y redirección permanente a HTTPS
server {
    listen 8080;
    server_name ${SERVER_NAME};
    location /.well-known/acme-challenge/ { root /var/www/certbot; }
    location / { return 301 https://$host$request_uri; }
}

server {
    listen 8443 ssl;
    http2 on;
    server_name ${SERVER_NAME};

    ssl_certificate     /etc/letsencrypt/live/${SERVER_NAME}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${SERVER_NAME}/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers off;

    root /usr/share/nginx/html;
    client_max_body_size 5m;          # debe moverse junto con UPLOAD_MAX_SIZE_MB

    location = /api/v1/auth/login {
        limit_req zone=login burst=5 nodelay;
        include /etc/nginx/includes/security-headers.conf;
        include /etc/nginx/includes/proxy-api.inc;
        proxy_pass http://api:8000;
    }

    location /api/ {
        include /etc/nginx/includes/security-headers.conf;
        include /etc/nginx/includes/proxy-api.inc;
        proxy_pass http://api:8000;
    }

    # Descarga de archivos subidos: la location es INTERNAL. El navegador nunca la pide
    # directamente; llega aquí solo por X-Accel-Redirect emitido por FastAPI DESPUÉS de
    # autorizar (RBAC + módulo + ownership). nginx transfiere el byte stream; el permiso
    # siempre lo decide el backend (A01 + A08).
    location /_uploads/ {
        internal;
        alias /srv/uploads/;
        include /etc/nginx/includes/security-headers.conf;
        default_type application/octet-stream;
        add_header Content-Disposition "attachment" always;
        add_header X-Content-Type-Options "nosniff" always;
        autoindex off;
    }

    location /assets/ {
        include /etc/nginx/includes/security-headers.conf;
        add_header Cache-Control "public, max-age=31536000, immutable" always;
        try_files $uri =404;
    }

    location / {
        include /etc/nginx/includes/security-headers.conf;
        add_header Cache-Control "no-cache" always;
        try_files $uri $uri/ /index.html;    # rutas profundas de React Router
    }
}
```

**Nota sobre `add_header` e `include`:** cada `location` que define su propio `add_header` (los cuatro de arriba) incluye explícitamente `security-headers.conf`. Añadir una `location` nueva sin ese `include` es un bug de seguridad, y el chequeo `curl -sI` de CI está para atraparlo.

### 3.4 Compatibilidad de la CSP estricta con el build de producción

Es viable **sin `unsafe-inline`**:

- El build de producción de Vite emite todo el JS como archivos externos con hash; no inyecta `<script>` inline en `index.html`. → `script-src 'self'` funciona.
- Tailwind compila a un `.css` externo. → `style-src 'self'` funciona.
- React y Framer Motion aplican estilos vía la API DOM (`element.style.x = …`), que la CSP **no** bloquea: CSP restringe atributos `style=""` parseados del HTML y elementos `<style>`, no la manipulación por JS. → las animaciones funcionan bajo `style-src 'self'`.
- **Prohibido `@vitejs/plugin-legacy`** (inyecta snippets inline). Si algún día hiciera falta, se pasan sus hashes SHA-256 a `script-src`, nunca `unsafe-inline`.
- **Leaflet cumple la política**: su hoja de estilos se importa y Vite la empaqueta como `.css` externo, y el propio Leaflet posiciona teselas y marcadores con `element.style.transform`, que es API DOM y la CSP no toca.
- **Pendiente, y es un incumplimiento real**: el pin del mapa se construye con `L.divIcon({html})` y ese HTML lleva un atributo `style="filter: drop-shadow(...)"`. Los atributos `style` parseados del HTML **sí** los gobierna `style-src` (vía `style-src-attr`), así que en producción el navegador descartará esa sombra y anotará una violación. No rompe el mapa —el pin se dibuja igual—, pero hay que moverlo a una clase de Tailwind antes de desplegar. En desarrollo no se ve porque la CSP va en modo informe y con `'unsafe-inline'` para Vite.
- **Gate de CI**: tras `vite build`, un chequeo greppea `dist/index.html` en busca de `<script>`/`<style>` inline; si aparece alguno, el pipeline falla y se resuelve con hashes, no relajando la política.

---

## 4. Producción

### 4.1 `backend/Dockerfile` (multi-stage, no-root)

```dockerfile
# ---- builder ----
FROM python:3.12-slim AS builder
COPY --from=ghcr.io/astral-sh/uv:0.12.7 /uv /usr/local/bin/
ENV UV_PROJECT_ENVIRONMENT=/opt/venv UV_LINK_MODE=copy
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY app/ ./app/
RUN uv sync --frozen --no-dev

# ---- runtime ----
FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends libmagic1 \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd -r app && useradd -r -g app -d /nonexistent -s /usr/sbin/nologin app
COPY --from=builder /opt/venv /opt/venv
COPY --from=builder --chown=app:app /app /app
ENV PATH=/opt/venv/bin:$PATH PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
# El volumen `uploads` se monta vacío y Docker lo inicializaría root:root si la ruta no
# existiera en la imagen; creándola con el ownership correcto, el primer montaje lo hereda.
# Sin esto, la primera subida de archivo falla con PermissionError.
RUN mkdir -p /srv/uploads && chown app:app /srv/uploads
USER app
WORKDIR /app
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "4", \
     "--proxy-headers", "--forwarded-allow-ips=*"]
```

`uv` no está en la imagen final (solo el venv copiado). Sin `--reload`, sin compiladores, sin caché de paquetes.

### 4.2 `--forwarded-allow-ips=*`: por qué es seguro aquí

Fijar la IP de nginx no es implementable de forma fiable (las IPs de contenedor son dinámicas) y, si no coincide, **uvicorn ignora `X-Forwarded-For` en silencio**: el rate limiting por IP se colapsaría sobre la IP de nginx (un atacante bloquearía el login de toda la plataforma) y el AuditLog registraría siempre la misma IP. El comodín es correcto porque en esta topología `api` **no publica ningún puerto** y solo es alcanzable desde la red `edge`, donde el único servicio que la enruta es nginx — que sobrescribe `X-Forwarded-For` con `$remote_addr` (§3.2). La cadena de confianza es completa.

**Test de humo obligatorio:** un request con `X-Forwarded-For` falsificado debe auditarse y rate-limitarse por la IP real del cliente, no por la enviada.

### 4.3 Imagen del SPA + edge (multi-stage)

```
Etapa 1 — node:22-alpine ("build"):
  COPY package.json package-lock.json → npm ci → COPY fuentes → npm run build  (sale /app/dist)
Etapa 2 — nginxinc/nginx-unprivileged:1.27-alpine:
  COPY --from=build /app/dist /usr/share/nginx/html
  COPY infra/nginx/prod.conf → /etc/nginx/conf.d/default.conf
  COPY infra/nginx/includes/    → /etc/nginx/includes/
```

Node **no existe** en la imagen final: se cumple la prohibición de runtime Node en producción. `nginx-unprivileged` corre como usuario `nginx` y escucha en 8080/8443, de ahí los mapeos `80:8080` y `443:8443`.

### 4.4 `docker-compose.prod.yml` — diferencias

```yaml
name: accumedical
networks:
  edge:
    driver: bridge
  data:
    driver: bridge
    internal: true            # db inalcanzable desde fuera de la red de datos
volumes: { pgdata: , uploads: }

services:
  db:
    image: postgres:16.10-alpine
    restart: always
    environment: { POSTGRES_USER: ..., POSTGRES_PASSWORD: ..., POSTGRES_DB: ... }
    volumes: [pgdata:/var/lib/postgresql/data]
    # SIN clave `ports`
    healthcheck: { test: [...pg_isready -h 127.0.0.1...], interval: 10s, retries: 5 }
    networks: [data]

  migrate:                    # job one-shot; NUNCA migraciones en el arranque de cada réplica
    image: accumedical/api:${TAG}
    command: ["alembic", "upgrade", "head"]
    env_file: .env.prod
    depends_on: { db: { condition: service_healthy } }
    restart: "no"
    networks: [data]

  api:
    image: accumedical/api:${TAG}
    restart: always
    env_file: .env.prod
    volumes: [uploads:/srv/uploads]
    depends_on:
      db: { condition: service_healthy }
      migrate: { condition: service_completed_successfully }
    healthcheck: { test: [...urllib /api/v1/health...], interval: 10s, retries: 5 }
    read_only: true
    tmpfs: [/tmp]
    networks: [edge, data]

  nginx:                      # único edge: SPA + proxy /api + TLS + cabeceras
    image: accumedical/web:${TAG}
    restart: always
    ports: ["80:8080", "443:8443"]
    volumes:
      - uploads:/srv/uploads:ro        # solo para X-Accel-Redirect
      - certs:/etc/letsencrypt:ro
    depends_on: { api: { condition: service_healthy } }
    healthcheck: { test: ["CMD","wget","-q","--spider","http://127.0.0.1:8080/api/v1/health"] }
    networks: [edge]
```

Sin bind mounts de código: todo horneado en imágenes inmutables etiquetadas por versión. Secretos inyectados por el orquestador/CI, jamás en la imagen ni en el repo. Backup: `pg_dump` programado a almacenamiento externo.

---

## 5. Dependencias (A06)

**Python — uv con lockfile.** `pyproject.toml` declara dependencias (grupo `dev` para pytest, ruff, mypy); `uv.lock` versionado en git es la única fuente de versiones exactas. El binario `uv` se copia desde `ghcr.io/astral-sh/uv` **con versión fijada** y se instala con `uv sync --frozen` (falla si el lock está desactualizado; nunca resuelve versiones dentro de un build). En producción `--no-dev`. CI: `uv run pip-audit` bloqueante.

**Frontend — npm con package-lock.** Instalar es siempre `npm ci`, jamás `npm install`: `ci` reproduce el lock exacto y `install` lo muta. La excepción es **añadir** una dependencia nueva, que por definición cambia el lock: ahí se usa `npm install <paquete>@<rango>` una vez, y `package-lock.json` actualizado se versiona en el mismo commit. Así se añadieron `leaflet`, `react-leaflet` y `@types/leaflet` para el mapa de ubicación. CI: `npm audit --audit-level=high` **completo, sin `--omit=dev`**: en un SPA de Vite la toolchain de build (vite, plugins, postcss) produce el bundle público y es precisamente donde han ocurrido los ataques recientes de cadena de suministro.

**Regla transversal:** toda imagen base y toda herramienta copiada va con etiqueta de versión explícita; nada de `latest`.

### 5.1 `.dockerignore`

`backend/.dockerignore`:
```
.git
.env
.env.*
__pycache__/
*.py[cod]
.venv/
.pytest_cache/
.ruff_cache/
.mypy_cache/
tests/
htmlcov/
*.md
```

`web/.dockerignore`:
```
.git
.env
.env.*
node_modules/
dist/
coverage/
*.md
```

`.gitattributes` en la raíz con `*.sh text eol=lf` y `Dockerfile`/`*.conf` en LF, para que los scripts no revienten con `\r` en Windows.

---

## 5.2 Correo saliente (invitaciones)

El único tráfico saliente que hace el servidor. Se envía con `smtplib` de la
biblioteca estándar: no se añade ningún cliente de correo y con él su superficie.
**No es SSRF**: el servidor de correo es configuración del despliegue, nunca una
URL que suministre el usuario.

| Variable | Para qué |
|---|---|
| `SMTP_HOST`, `SMTP_PORT` | El servidor. Sin `SMTP_HOST` no se envía nada |
| `SMTP_USER`, `SMTP_PASSWORD` | Credenciales. Solo por entorno, jamás en el repositorio |
| `SMTP_STARTTLS` / `SMTP_SSL` | STARTTLS en el 587 (lo normal) o TLS directo en el 465 |
| `MAIL_FROM`, `MAIL_FROM_NOMBRE` | El remitente |
| `APP_BASE_URL` | Base pública del enlace de la invitación |
| `INVITACION_TTL_HORAS` | Caducidad del enlace (72 por defecto) |

Tres guardas, validadas al arranque:

1. **En producción, `SMTP_HOST` y `MAIL_FROM` son obligatorios.** Sin ellos las
   invitaciones se perderían en silencio, que es peor que no arrancar.
2. **En producción el cifrado es obligatorio**: sin STARTTLS ni SSL el proceso no
   arranca. El correo lleva un enlace que fija una contraseña. En desarrollo se
   permite en claro **a propósito**: los capturadores locales (MailHog, Mailpit)
   hablan SMTP sin cifrar y no tienen certificado, así que exigirlo allí impediría
   probar el envío.
3. **`APP_BASE_URL` debe ser `https` en producción**, y el enlace se arma siempre
   desde ella, nunca desde la cabecera `Host` de la petición: esa es suplantable y
   mandaría a la víctima a otro dominio.

El envío está configurado y verificado contra el servidor real: `smtp-mail.outlook.com`
en el 587 con STARTTLS, autenticando con la cuenta del remitente. Las credenciales
viven **solo** en el `.env`, que está en `.gitignore`; en `.env.example` figuran los
nombres de las variables y ningún valor.

**Membrete de marca.** Todo correo que nace como texto (los avisos de casos y
el envío de informes de Concurrencia) sale también en HTML: el aviso dentro de
una tarjeta blanca con la banda azul de la marca y, al pie, el **membrete de
firma** —logo de Accumedical incrustado en el propio mensaje (adjunto
relacionado con CID: los clientes bloquean imágenes remotas y así no se depende
de ningún hosting), línea divisoria, y nombre/cargo/empresa/contactos—. Quién
firma es de tres líneas: nombre, cargo y correo | web — sin línea de razón
social. Por defecto firma la gerencia (`MAIL_FIRMA_NOMBRE`, `MAIL_FIRMA_CARGO`,
`MAIL_FIRMA_CORREO`, `MAIL_FIRMA_WEB`); **el aviso de creación de un caso lo
firma QUIEN lo creó**: su nombre, «Operador · {su aseguradora}» o
«Supervisor · Accumedical» si lo programó nuestro coordinador o el admin, y su
correo de login (la web sigue siendo la de Accumedical). Sin creador rastreable
cae a la firma de la gerencia sin fallar. El texto plano queda como alternativa
para clientes sin HTML; la invitación conserva su propio HTML de siempre.

**Resiliencia ante redes inestables** (aprendido en una red que dejaba caer
conexiones al 587 al azar): cada conexión lleva `SMTP_TIMEOUT_SEC` (15 s) —ojo:
`smtplib` lo aplica **por cada dirección IP** que resuelva el host, y Outlook
resuelve varias, así que un servidor inalcanzable puede costar minutos, no
segundos—, y un envío que falla **por conexión** se reintenta UNA vez
(`correo_reintento` en el log; los errores de credenciales o protocolo no se
reintentan porque repetirlos no cambia nada). Además, los avisos de Concurrencia
—alta, derivación, reprogramación— corren como **tareas de fondo de FastAPI,
después de responder**: antes se enviaban dentro del request y un SMTP colgado
retenía la respuesta hasta el 504 de nginx con el caso ya creado. Cada
destinatario deja su huella en el log: `correo_enviado`, `correo_reintento` o
`correo_fallido`, y la tanda cierra con `visita_notificada` (total y enviados).

Sin SMTP configurado en desarrollo el mensaje no se pierde: se registra en el log
del contenedor `api` con su enlace.

> **Aviso.** Ese enlace lleva el token de la invitación, así que ese log escribe un
> token en claro. Contradice la regla «nunca loguear tokens» de `CLAUDE.md` y está
> anotado como cuestión abierta 18 en `docs/04-estado-implementacion.md`. Solo
> ocurre fuera de producción —allí la configuración se valida al arrancar y ese
> camino no existe—, pero es una excepción consciente, no un descuido: sin ella no
> habría forma de probar el alta de usuarios mientras no haya SMTP.

---

## 6. Configuración y variables de entorno

**Cómo llega la configuración al contenedor.** Compose lee `.env` **del host** y lo inyecta como variables de entorno; `pydantic-settings` **no** declara `env_file` (dentro del contenedor el cwd es `/app` y el `.env` de la raíz del repo no existe allí: sería código muerto). `extra="ignore"`, no `extra="forbid"`: el mismo `.env` lleva `POSTGRES_*`, `VITE_*` y `WATCHFILES_*`, que no son campos del modelo y harían fallar el arranque.

**El DSN se construye en código desde variables discretas**, no por interpolación de una URL en el compose: una contraseña con `@`, `/`, `#`, `%` o `:` produciría un DSN inválido o conectaría al host equivocado con un error críptico.

### 6.1 Tabla canónica de variables

| Servicio | Variable | Notas |
|---|---|---|
| **db / api** | `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | obligatorias, sin defaults |
| | `POSTGRES_HOST` (`db`), `POSTGRES_PORT` (`5432`) | el DSN se arma con `quote_plus` sobre la contraseña |
| **solo dev** | `POSTGRES_HOST_PORT` (`55432`) | puerto publicado en `127.0.0.1` para psql/DBeaver; no lo lee la API |
| **api** | `ENVIRONMENT` | `development` \| `production` (Literal) |
| | `DEBUG` | bool; **prohibido `True` si production** |
| | `SECRET_KEY` | `SecretStr`, ≥ 32 caracteres |
| | `MFA_ENCRYPTION_KEY` | `SecretStr`, clave Fernet para cifrar `users.mfa_secret` (A07) |
| | `ALLOWED_ORIGINS` | `list[str]`, allowlist CORS explícita, sin wildcard y **sin barra final** |
| | `COOKIE_SECURE` | bool; derivada por defecto de `ENVIRONMENT`; en production `False` **impide arrancar** |
| | `COOKIE_PREFIX` | `""` en dev, `__Host-` en producción |
| | `SESSION_IDLE_TTL_MIN` (30), `SESSION_ABSOLUTE_TTL_MIN` (720), `SESSION_ACTIVITY_THROTTLE_SEC` (60), `SESSION_PURGE_AFTER_DAYS` (30) | A07 |
| | `LOGIN_MAX_FAILED_ATTEMPTS` (5), `LOGIN_LOCKOUT_MIN` (15), `LOGIN_RATE_LIMIT_IP` (`5/minute`) | A04 |
| | `UPLOAD_DIR` (`/srv/uploads`), `UPLOAD_MAX_SIZE_MB` (5) | A08; se mueve junto con `client_max_body_size` |
| | `SMTP_HOST`, `SMTP_PORT` (587), `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_STARTTLS` (true), `SMTP_SSL` (false), `SMTP_TIMEOUT_SEC` (15) | correo de invitaciones (§5.2). En production, `SMTP_HOST` vacío o sin cifrado **impiden arrancar** |
| | `FIRMA_P12_PATH`, `FIRMA_P12_PASSWORD` | la firma electrónica PAdES de los PDF de informes (Concurrencia), **por entorno**. Es opcional: el camino normal es subir el `.p12` desde **Configuración** del admin (la contraseña queda cifrada en el volumen — `docs/03`); si estas variables están puestas, mandan y el panel se bloquea. Vacío en ambos sitios = PDF sin firmar, todo lo demás igual |
| | `MAIL_FROM`, `MAIL_FROM_NOMBRE` (`Accumedical`) | remitente; `MAIL_FROM` obligatorio en production |
| | `APP_BASE_URL` (`http://localhost:8080`), `INVITACION_TTL_HORAS` (72) | base del enlace de invitación; **https obligatorio en production** |
| | `SUPERADMIN_EMAIL`, `SUPERADMIN_PASSWORD` | solo los lee el comando CLI de bootstrap |
| | `LOG_LEVEL` (`INFO`) | logs JSON estructurados (A09) |
| | `WATCHFILES_FORCE_POLLING` | solo dev (Windows) |
| **web (dev)** | `VITE_HMR_CLIENT_PORT` (`8080`) | puerto por el que el navegador ve la app; sin él el cliente HMR apunta al 5173 y falla en silencio tras nginx |
| **web (build)** | `VITE_*` | se hornean en el bundle; **jamás secretos** |
| **nginx (prod)** | `SERVER_NAME`, rutas de certificados | vía `envsubst` sobre la plantilla |

### 6.2 Validación al arranque (`backend/app/core/config.py`)

```python
class Settings(BaseSettings):
    model_config = SettingsConfigDict(extra="ignore", case_sensitive=False)

    environment: Literal["development", "production"]
    debug: bool = False
    secret_key: SecretStr = Field(min_length=32)
    mfa_encryption_key: SecretStr
    allowed_origins: list[str] = []
    cookie_secure: bool | None = None
    # ... resto de la tabla

    @field_validator("allowed_origins")
    @classmethod
    def _sin_barra_final(cls, v: list[str]) -> list[str]:
        # pydantic HttpUrl normaliza añadiendo "/" y entonces JAMÁS coincide con la
        # cabecera Origin del navegador: la allowlist de CORS nunca haría match.
        return [o.rstrip("/") for o in v]

    @model_validator(mode="after")
    def _guardas_de_produccion(self):
        if self.cookie_secure is None:
            self.cookie_secure = self.environment == "production"
        if self.environment == "production":
            if self.debug:
                raise ValueError("DEBUG=True está prohibido en producción")
            if not self.cookie_secure:
                raise ValueError("COOKIE_SECURE=False está prohibido en producción")
        return self

settings = Settings()   # importado en main.py: configuración inválida ⇒ el proceso muere al arrancar
```

Fallo inmediato y ruidoso: el contenedor `api` nunca llega a `healthy` con configuración inválida. `SecretStr` evita que los secretos aparezcan en logs o `repr`.

**`Secure` en desarrollo.** El flag se deriva del entorno: en desarrollo la cookie sale **sin** `Secure` porque el acceso es `http://localhost:8080`. Safari no acepta cookies `Secure` en localhost y ningún navegador las acepta por IP de LAN: forzarlo produciría un bucle de login sin error visible. `SameSite=Strict` y `HttpOnly` se mantienen siempre.

---

## 7. Logging estructurado (A09)

`structlog` con `JSONRenderer` sobre `logging` estándar; uvicorn y SQLAlchemy se reencaminan al mismo pipeline para que **toda** línea de log sea un objeto JSON. Un middleware genera un `request_id` (UUIDv7) por petición, lo mete en el contexto de structlog y lo propaga a `audit_log.request_id`, de modo que un evento de auditoría y sus líneas de log técnico se correlacionan por ese campo. Campos fijos: `timestamp`, `level`, `event`, `request_id`, `method`, `path`, `status`, `duration_ms`, `user_id` (si hay sesión). **Denylist**: nunca se emiten contraseñas, tokens, cookies ni datos clínicos.

---

## 8. Trampas de Windows + Docker (ya mitigadas)

1. **File watching a través de bind mounts NTFS**: los eventos inotify no cruzan de Windows al contenedor. Mitigado con `WATCHFILES_FORCE_POLLING` (uvicorn) y `watch.usePolling` (Vite). Recomendación de rendimiento: mover el clon dentro del filesystem de WSL2, donde el watching nativo funciona y los builds son varias veces más rápidos.
2. **`node_modules` y venv pisados por el bind mount**: binarios nativos compilados para Linux (esbuild, rollup, argon2-cffi) no pueden mezclarse con instalaciones hechas desde Windows. Mitigado con el volumen anónimo `/app/node_modules` y el venv en `/opt/venv`.
3. **Datos de Postgres**: siempre en volumen con nombre; un bind mount de `PGDATA` sobre NTFS falla por permisos y locking.
4. **Puerto 80 ocupado** por `http.sys`/IIS: por eso nginx publica en `127.0.0.1:8080`.
5. **CRLF**: `.gitattributes` con LF forzado en scripts y configuraciones.
</content>
