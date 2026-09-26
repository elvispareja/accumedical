# Plan de la iteración 1

Plataforma modular de seguros de salud · Núcleo compartido + 4 módulos esqueleto

Este documento resume qué se construye, en qué orden, y **las 16 decisiones** que gobiernan el resto. El detalle técnico vive en:

- [`01-esquema-bd.md`](01-esquema-bd.md) — esquema PostgreSQL completo (autoritativo)
- [`02-infraestructura.md`](02-infraestructura.md) — docker-compose, nginx, Dockerfiles, configuración
- [`03-auth-y-api.md`](03-auth-y-api.md) — autenticación, autorización y contrato de endpoints
- [`04-estado-implementacion.md`](04-estado-implementacion.md) — **qué está construido y verificado hoy, y qué falta**
- [`05-catalogo-geografico.md`](05-catalogo-geografico.md) — de dónde salen provincias y ciudades, y cómo rehacerlas
- [`06-operacion-de-datos.md`](06-operacion-de-datos.md) — cómo se toca la base de desarrollo, y qué no se toca nunca
- [`07-convenciones-de-interfaz.md`](07-convenciones-de-interfaz.md) — cómo se capturan los datos y cómo se comportan los componentes compartidos
- [`modulos/concurrencia.md`](modulos/concurrencia.md) — entidades, reglas, roles y endpoints del módulo de Concurrencia

> Los hitos 1, 2 y 3 están terminados y verificados contra el entorno real, y las 16 decisiones quedaron aplicadas tal como están descritas. Este documento sigue siendo el plan; el estado real vive en el documento 04.

---

## 1. Stack: aprobado sin cambios

Python 3.12 + FastAPI + SQLAlchemy 2.0 + Alembic + Pydantic v2 · PostgreSQL 16 · React 18 + TypeScript + Vite + Tailwind + shadcn/ui + Framer Motion + TanStack Query + React Router v6 + Zustand · Docker Compose con `api`, `web`, `db`, `nginx`. SPA estática servida por nginx con proxy `/api`, sin Next.js, sin SSR, sin runtime Node en producción. **No propongo ninguna desviación del stack.**

Adiciones menores dentro del stack aprobado, todas justificadas en los documentos técnicos: `argon2-cffi` (A02), `slowapi` (A04), `structlog` (A09), `uv` como gestor de dependencias con lockfile (A06). El UUIDv7 se implementó a mano en `app/core/ids.py` en lugar de añadir `uuid-utils`, y `python-magic` (A08) entra con el hito 4, que es cuando aparece la primera subida de archivos; `libmagic` ya está en la imagen para no rehacerla entonces.

---

## 2. Decisiones que requieren tu aprobación

Las cuatro primeras son las que más condicionan el resto.

| # | Decisión | Qué se decidió y por qué |
|---|---|---|
| **D-01** | **Doble identificador de módulo** | `modules.code` en snake_case (`carta_credito`) es la identidad canónica: PK, destino de todas las FKs, nombre del paquete Python y prefijo de sus tablas. `modules.slug` en kebab-case (`carta-credito`) es la identidad pública: ruta del frontend, segmento de la API y carpeta de `web/src/modules/`. Se modelan como dos columnas explícitas, no como una traducción implícita dispersa por el código, porque la conversión `slug → code` ocurre en **un solo sitio** y ahí es donde puede auditarse |
| **D-02** | **La tabla `modules` es la única fuente de verdad en runtime** | No hay registro de módulos en código Python que autorice nada; el catálogo Python existe solo como semilla de la migración. Consecuencia: apagar un módulo (`activo=false`) surte efecto inmediato en login, selector y autorización, sin desplegar |
| **D-03** | **CSRF con token aleatorio guardado en `sessions`**, no HMAC derivado de `SECRET_KEY` | Un HMAC determinista ata todos los tokens CSRF a la clave maestra (rotarla invalidaría en silencio todas las mutaciones) y reutiliza esa clave para un segundo propósito criptográfico |
| **D-04** | **Sesión opaca server-side, no JWT** | El requisito de revocación *inmediata* obliga a consultar la DB en cada request, lo que anula la única ventaja del JWT y deja solo su superficie de ataque |
| **D-05** | Códigos de permiso **en español** (`aseguradoras:leer`) | Coherencia con el dominio y la UI. Se comparan por string, así que la lista canónica queda congelada en el esquema |
| **D-06** | Acciones de auditoría en español y columna `detalle jsonb` | Catálogo cerrado de 15 acciones; para CRUD el shape es `{"antes":…, "despues":…}` |
| **D-07** | La DB **sí** publica un puerto en `127.0.0.1`, pero **solo en desarrollo** | Para psql/DBeaver desde tu máquina. El puerto es `POSTGRES_HOST_PORT`, hoy `55432`, porque el 5432 y el 5433 ya estaban ocupados por otros Postgres en la máquina de desarrollo. Atado a loopback: inalcanzable desde la LAN. En producción la clave `ports` no existe, y son archivos compose separados para que no se herede por accidente |
| **D-08** | nginx de desarrollo publica en **`127.0.0.1:8080`**, no en `:80` | El 80 suele estar ocupado en Windows (http.sys/IIS) y publicar en todas las interfaces expondría el entorno de desarrollo a la red local |
| **D-09** | **Desactivar ≠ eliminar** en aseguradoras | La especificación las nombra como una sola cosa. Se separan: *Cambiar estado* (`PATCH`, mueve `estado` entre **activo e inactivo**, sigue visible y filtrable) y *Eliminar* (`DELETE`, soft delete, desaparece de listado y detalle). Nunca hay DELETE físico. Evita el estado incoherente "eliminada pero listable" |
| **D-10** | En la iteración 1, `/admin/**` y el CRUD de aseguradoras se protegen **solo con `require_global_admin`** | Los roles son por módulo, así que `require_permission` no tiene contexto en rutas de núcleo. Los permisos del núcleo quedan sembrados pero inertes, listos para delegar. La maquinaria RBAC completa **sí** se ejerce en el endpoint placeholder de cada módulo (`dashboard:ver`). *(Enmendada en sep 2026: aseguradoras y prestadores se delegan hoy en las funciones transversales vía `require_funcion`; los permisos del núcleo siguen inertes. Ver `03-auth-y-api.md`, «Las funciones transversales».)*, para que quede probada de punta a punta |
| **D-11** | **CIE-10 diferido** al primer módulo que lo consuma | La especificación lo nombra como catálogo del núcleo, pero ninguna tabla de la iteración 1 lo referencia: sería una tabla muerta y congelaría su modelo de versionado sin caso de uso delante. Añadirlo después es puramente aditivo |
| **D-12** | Lockout por cuenta: 5 intentos → 15 min, **con DoS dirigido aceptado** | Quien conozca un email corporativo puede mantener esa cuenta bloqueada. Se acepta para la iteración 1 (frenar fuerza bruta pesa más en una aplicación interna) con alerta operativa sobre `cuenta_bloqueada` repetido; CAPTCHA y aviso al titular en la siguiente |
| **D-13** | Un **único** nginx de borde en producción | La misma imagen sirve el SPA, hace proxy de `/api`, termina TLS y emite cabeceras. Dos nginx encadenados duplicarían cabeceras y acumularían saltos en `X-Forwarded-For`, rompiendo la IP del AuditLog |
| **D-14** | API de aseguradoras en `/api/v1/shared/aseguradoras`, **UI** en `/admin/aseguradoras` | La entidad es del núcleo compartido (la usarán los cuatro módulos); solo su pantalla de gestión vive bajo admin |
| **D-15** | El **ciclo de vida de usuarios entra en el alcance** (alta, edición, desactivación, reset de contraseña) | La pantalla de asignación de módulos no puede asignar accesos a usuarios que no existen, y la desactivación es el único mecanismo que mata todas las sesiones de un usuario comprometido |
| **D-16** | El **logo se implementa completo** en la iteración 1 | Es un campo del CRUD que pide la especificación. Se hace con todos los controles A08 (MIME real, tamaño, UUID, almacenamiento fuera del árbol ejecutable, servido con autorización) en lugar de dejarlo a improvisación posterior |

---

## 3. Cómo se relacionan las entidades del núcleo con los módulos

Es la pregunta explícita del encargo, y la respuesta gobierna toda la extensibilidad.

**Entre sí:** `aseguradoras` y `prestadores` se relacionan por `aseguradora_prestador`, que **no es una M2M simple** sino la tabla del **convenio**: lleva `codigo_convenio`, `fecha_inicio`, `fecha_fin`, `estado` (vigente/suspendido/terminado) y PK propia. Un prestador pertenece a la red de N aseguradoras y una aseguradora tiene red de N prestadores, cada par bajo un convenio con vigencia. Solo puede haber un convenio *vivo* por par (índice único parcial), pero el histórico de convenios terminados se conserva.

**Con los módulos, en una sola dirección:** las tablas de módulo referencian al núcleo; el núcleo **jamás** referencia a un módulo, y ningún módulo referencia a otro. Toda tabla raíz de expediente lleva `aseguradora_id NOT NULL` (es la palanca de scoping y ownership de A01), normalmente `prestador_id`, y opcionalmente `convenio_id → aseguradora_prestador(id)` cuando el expediente debe conservar bajo qué convenio se emitió — así una carta de crédito sigue apuntando al convenio vigente el día de su emisión aunque después se renegocie.

**Prueba de fuego:** agregar el módulo 8 no ejecuta ni un solo `ALTER` sobre tablas existentes. Es una fila en `modules`, sus roles y permisos como INSERTs, y sus tablas nuevas con prefijo propio.

---

## 4. Estructura de carpetas

Exactamente la que fijaste. Cada módulo se autocontiene y expone su propio archivo de rutas; ningún módulo importa de otro.

```
backend/app/
  core/        config, seguridad (deps, cookies, csrf, hashing), sesión DB, middlewares
               (request-id, logging, CORS), excepciones, cli
  shared/      auth/  users/  aseguradoras/  prestadores/  catalogos/  audit/
  modules/     suscripcion/  calificacion/  concurrencia/  carta_credito/
               (cada uno: models.py schemas.py service.py router.py permissions.py)
  main.py      monta /api/v1/{auth|shared|admin|<slug de módulo>}
backend/alembic/ · backend/tests/

web/src/
  core/        api (cliente axios + interceptores), auth (guards, RequireSession,
               RequireModule), layout (AppShell, Sidebar, Topbar, ModuleSwitcher),
               theme (tokens, dark mode), pages (Login, SeleccionarModulo, SinAccesos)
  shared/      componentes de UI, hooks y tipos comunes, más las entidades del
               núcleo con pantalla propia: aseguradoras/ (pages/ components/ hooks/ api)
  modules/     suscripcion/  calificacion/  concurrencia/  carta-credito/
               (cada uno: pages/ components/ hooks/ api/ routes.tsx)
  app/         router raíz que compone las rutas de cada módulo
infra/nginx/   dev.conf · includes/{security-headers.conf, proxy-api.inc}
               (prod.conf entra con el hito 9)
docs/          este plan y los documentos técnicos
```

---

## 5. Plan de trabajo por hitos

Cada hito termina con algo verificable; los tests indicados son parte del hito, no un añadido posterior.

| Hito | Contenido | Verificable con |
|---|---|---|
| **H1 ✅ — Andamiaje e infraestructura** | Estructura de carpetas completa, `pyproject.toml` + `uv.lock`, `package.json` + `package-lock.json`, Dockerfiles dev, `docker-compose.yml`, nginx dev, `.dockerignore`, `.gitattributes`, `.env.example`, `GET /api/v1/health`, config con pydantic-settings | `docker compose up` levanta los cuatro servicios *healthy*; hot reload real en api y web; la app responde en `localhost:8080` |
| **H2 ✅ — Modelos y migración inicial** | Los 14 modelos SQLAlchemy con mixins, `MetaData` con naming convention, migración Alembic inicial con extensiones, tablas, trigger de inmutabilidad de la auditoría y seeds; comando `create-superadmin` | `alembic upgrade head` en limpio; `alembic revision --autogenerate` produce diff vacío; `downgrade base` deja la DB limpia |
| **H3 ✅ — Autenticación y autorización** | Hashing argon2id, ciclo de sesión, cookies, CSRF, rate limiting, las cuatro dependencias, `/auth/*`, middleware de request-id, logging JSON, servicio de auditoría | Tests: login de tiempo constante, deny-by-default por introspección de rutas, revocación inmediata de módulo, CSRF ausente/erróneo, XFF falsificado, rotación de sesión, expiración idle y absoluta |
| **H4 ✅ — Aseguradoras (backend)** | CRUD completo con búsqueda trigram, filtros y paginación server-side, soft delete, subida y servicio del logo con controles A08, auditoría de cada mutación | Tests de contrato del CRUD, de unicidad de RUC entre vivas, de rechazo de MIME falsificado, de traversal en nombre de archivo |
| **H5 — Administración (backend)** | Usuarios (alta, edición, desactivación con revocación de sesiones, reset), `user_module_access` (asignar/revocar/reactivar), `GET /admin/modulos` con roles | Tests: revocar un módulo expulsa en el siguiente request; desactivar un usuario mata sus sesiones; rol de otro módulo rechazado por la FK compuesta |
| **H6 — Módulos esqueleto (backend)** | Cuatro paquetes con `router.py` y `permissions.py`, montados en `main.py`, protegidos por acceso al módulo + `dashboard:ver` | Un usuario sin acceso recibe `403` genérico y queda registrado `acceso_denegado` |
| **H7 — Base del frontend** | Design tokens y dark mode, `AppShell` (sidebar + topbar + contenido), cliente axios con interceptores 401/403, guards, pantallas de **login**, **selección de módulo**, **sin accesos**, selector de módulo del topbar, estados de carga/vacío/error, toasts | Recorrido manual de los ocho pasos del flujo de entrada, incluidos redirección automática con un módulo y cambio de módulo sin reautenticar |
| **H8 ◐ — Pantallas de gestión** (aseguradoras hecha) | `/admin/aseguradoras` (tabla con búsqueda, filtros y paginación server-side) más `/admin/aseguradoras/nueva` y `/admin/aseguradoras/{id}/editar` como páginas propias con subida de logo, cambio de estado y eliminación y `/admin/usuarios/{id}` (asignar y revocar módulos con su rol); páginas placeholder de los cuatro módulos | Recorrido manual del CRUD y de la asignación/revocación, comprobando el efecto inmediato de revocar |
| **H9 — Endurecimiento y entrega** | `docker-compose.prod.yml`, `prod.conf` con TLS y cabeceras, pipeline de CI (ruff, mypy, pytest, `pip-audit`, `npm audit`, gate de CSP, verificación de cabeceras con `curl`), `CLAUDE.md`, `SECURITY.md`, `README.md`, ADR, `.env.example` definitivo | CI en verde; `curl -sI` muestra las cinco cabeceras en `/`, `/assets/*` y `/api/*` |

---

## 6. Estrategia de pruebas

Los tests de seguridad no son opcionales: cada uno corresponde a un fallo concreto que la revisión adversarial encontró en el diseño.

**Backend (pytest + httpx + Postgres efímero):** contrato de cada endpoint; deny-by-default por introspección de `app.routes`; tiempo constante en los cuatro caminos de login; carrera del contador de intentos fallidos; revocación inmediata de módulo, de sesión y de usuario; CSRF ausente, erróneo y de otra sesión; `X-Forwarded-For` falsificado; rechazo de `Content-Type` de formulario en login; expiración idle y absoluta; FK compuesta rol-módulo; unicidad parcial con filas soft-borradas; validación de MIME real y de traversal en la subida; redacción del serializador de auditoría (ningún campo sensible en `detalle`).

**Frontend (Vitest + Testing Library):** guards que no autorizan por estado local; interceptor 403 que distingue permiso faltante de acceso revocado; redirección automática con un solo módulo; pantalla de sin accesos; `prefers-reduced-motion` respetado.

**Infraestructura (CI):** `alembic upgrade`/`downgrade` en limpio; `autogenerate` sin diff; cabeceras verificadas con `curl -sI`; gate de CSP sobre `dist/index.html`; `pip-audit` y `npm audit --audit-level=high` bloqueantes.

---

## 7. UI/UX — criterios de la iteración 1

**Sistema de tokens** en CSS variables sobre Tailwind: color, tipografía, espaciado, radios, sombras, con dark mode por `class` y por `prefers-color-scheme`. Cada módulo aporta **solo** su color de acento (`emerald`, `violet`, `sky`, `amber` — dato de `modules.color_acento`, no hardcodeado); todo lo demás es el mismo sistema: **los componentes se comparten, no se duplican por módulo**.

**Pantalla de selección de módulo:** tarjetas con entrada escalonada (stagger de 60 ms), hover con elevación sutil, borde y glow en el color de acento del módulo, icono lucide, nombre y rol del usuario en ese módulo.

**Framer Motion con criterio:** transiciones de página, entrada escalonada de filas de tabla y tarjetas, animación de drawer y modal, microinteracciones de botón. Duraciones 150–300 ms, easing natural, nada rebotón. `prefers-reduced-motion` desactiva el movimiento y deja solo el fundido.

**Estados completos** en cada vista: skeleton de carga, estado vacío con acción, estado de error con reintento, toasts de éxito y de error.

**Accesibilidad:** foco visible en todo elemento interactivo, navegación completa por teclado (incluido el drawer, con foco atrapado y `Esc`), roles y etiquetas ARIA, contraste AA en ambos temas. **Responsive real desde 360 px**: el sidebar colapsa a off-canvas y la tabla de aseguradoras pasa a tarjetas apiladas.

---

## 8. Entregables de documentación

`CLAUDE.md` en la raíz con las reglas de arquitectura, seguridad y UI para que se respeten en todas las sesiones siguientes · `SECURITY.md` recorriendo los diez puntos de OWASP con lo que se implementó en cada uno y **los riesgos aceptados** (D-12 entre ellos) · `README.md` con los comandos de levantado · `.env.example` completo · ADR justificando la separación núcleo/módulos y el login único con resolución de módulos en backend.

---

## 9. Qué NO se construye en esta iteración

Ninguna lógica de negocio de los cuatro módulos: quedan como carpeta, router registrado, ruta protegida por acceso al módulo y página placeholder. Tampoco: MFA funcional (solo la columna preparada), CRUD de prestadores y de convenios (las tablas existen; sus pantallas no estaban en el alcance), catálogo CIE-10, exportaciones, notificaciones por correo ni Redis.
</content>
