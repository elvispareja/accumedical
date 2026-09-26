# CLAUDE.md — referencia obligatoria del proyecto

Plataforma modular para el sector de seguros de salud.
**Lee este archivo al inicio de cada sesión antes de tocar nada.**

---

## Stack

**Backend:** Python 3.12 + FastAPI + SQLAlchemy 2.0 + Alembic + Pydantic v2.
**Base de datos:** PostgreSQL 16.
**Frontend:** React 18 + TypeScript + Vite + Tailwind + shadcn/ui + Framer Motion + TanStack Query + React Router v6 + Zustand (solo estado de UI).
**Infraestructura:** Docker + docker-compose (`api`, `web`, `db`, `nginx`). El frontend es un SPA estático (`vite build`) servido por nginx, con proxy de `/api` hacia FastAPI.

**PROHIBIDO:** Next.js, SSR y cualquier runtime Node en producción. El servidor es Python.

---

## Arquitectura

**Núcleo compartido** (una sola vez, lo usan todos los módulos): aseguradoras, prestadores, usuarios/roles/permisos/sesiones, auditoría (`AuditLog`), catálogos comunes y el sistema de diseño.

**Módulos independientes**, agrupados en dos familias comerciales (`modules.grupo`, pura presentación):
- **Suscripción**: `examen_asegurabilidad` (nombre público «Requisitos de Asegurabilidad», slug `requisitos-asegurabilidad`) y `calificacion_riesgo` — por construir. `declaracion_salud` (DST) está retirado (`activo = false`, fila conservada).
- **Siniestro**: 4 ramas (`modules.subgrupo`, presentación pura). **Siniestros hospitalarios**: `carta_credito` (nombre público «Central de Crédito», slug `central-credito`), `concurrencia` («Auditoría de Concurrencia», el único construido), `auditoria_alta` y `auditoria_credito_hospitalario`. **Ambulatorio**: `ambulatorio`. **Auditoría de vida**: `auditoria_vida`. **Reembolso**: `reembolso`.

Los módulos originales `suscripcion` y `calificacion` están retirados (`modules.activo = false`, filas conservadas).

**Reglas duras de arquitectura:**

- Un módulo **NUNCA** importa de otro. Lo común va en `shared/` o `core/`.
- Las tablas de módulo referencian al núcleo, **nunca al revés**. Ningún módulo referencia tablas de otro módulo.
- Toda tabla raíz de expediente lleva `aseguradora_id NOT NULL`: es la palanca de scoping y ownership.
- Tablas de módulo con prefijo propio: `susc_`, `calif_`, `conc_`, `cc_`.
- Debe escalar a 8 módulos **sin tocar la estructura**: agregar un módulo es una fila en `modules`, sus roles y permisos, sus tablas nuevas y su carpeta. Cero `ALTER` sobre tablas existentes.
- Doble identificador de módulo: `modules.code` en snake_case (`carta_credito`) es la identidad canónica —PK, FKs, paquete Python, prefijo de tablas—; `modules.slug` en kebab-case (`carta-credito`) es la identidad pública —ruta del frontend, segmento de la API, carpeta en `web/src/modules/`. La conversión `slug → code` ocurre en **un solo sitio**: la dependencia que resuelve el módulo de la ruta.

### Árbol de carpetas

```
backend/
  app/
    core/                config, seguridad (deps, cookies, csrf, hashing), sesión DB,
                         middlewares (request-id, logging, CORS), excepciones, cli
    shared/
      auth/              login, logout, sesiones, resolución de módulos, permisos, MFA (schema)
      users/
      aseguradoras/
      prestadores/
      catalogos/
      audit/
    modules/
      suscripcion/       models.py  schemas.py  service.py  router.py  permissions.py
      calificacion/      (misma estructura)
      concurrencia/      (misma estructura)
      carta_credito/     (misma estructura)
    main.py              monta los routers: /api/v1/{auth|shared|admin|<slug de módulo>}
  alembic/
  tests/

web/
  src/
    core/                cliente API, auth, guards de ruta, layout base (AppShell,
                         Sidebar, Topbar, ModuleSwitcher), tema, tokens,
                         pantallas de login, selección de módulo y sin accesos
    shared/              componentes, hooks, tipos y catálogos comunes
    modules/
      suscripcion/       pages/  components/  hooks/  api/  routes.tsx
      calificacion/      (misma estructura)
      concurrencia/      (misma estructura)
      carta-credito/     (misma estructura)
    app/                 router raíz que compone las rutas de cada módulo

infra/nginx/             dev.conf · prod.conf · includes/
docs/                    documentación viva (ver más abajo)
```

Cada módulo se autocontiene y expone su propio archivo de rutas.

---

## Autenticación

**Un solo `/login`** para toda la plataforma. Una sola tabla de usuarios, una sola sesión, un solo motor de permisos. No existen logins por módulo.

El backend resuelve los módulos del usuario y devuelve la redirección en la respuesta del login:

| Situación | Destino |
|---|---|
| Un módulo | Redirección directa a `/{slug}`, sin selector |
| Varios módulos | `/seleccionar-modulo` con tarjetas (icono, nombre, color de acento, rol) |
| Administrador global | `/admin` |
| Ningún módulo activo | Pantalla de sin accesos; no entra a ninguna ruta interna |

Dentro de un módulo, un selector en el topbar permite cambiar de módulo **sin reautenticar**. Al volver a entrar se recuerda el último módulo usado, guardado en la base de datos (`users.last_module_code`), no en el navegador; si ese módulo fue revocado o apagado, se cae al selector.

**Reglas de seguridad del flujo:**

- La lista de módulos la calcula y devuelve **SIEMPRE** el backend. El frontend nunca la deduce ni la guarda como fuente de verdad.
- La sesión registra el módulo activo, pero eso **no autoriza nada**: es estado de navegación. **Cada request revalida contra `UserModuleAccess`**, y el módulo se toma de la ruta, nunca de la sesión.
- Acceso manual a un módulo sin permiso → **403 genérico**, sin filtrar si el módulo existe, si el usuario existe ni qué accesos tiene.
- **Revocar el acceso a un módulo tiene efecto inmediato** sobre sesiones ya abiertas. Por eso está prohibido cachear permisos entre peticiones.
- Sesión opaca en servidor (tabla `sessions`), no JWT: la revocación inmediata obliga a consultar la base de datos en cada request.

---

## Reglas duras (no se rompen nunca)

- Autorización **solo en backend**, con dependencia en **CADA** endpoint, **deny by default**. Las dependencias se declaran a nivel de `APIRouter`, no por endpoint suelto, para que un endpoint nuevo nazca protegido. El frontend solo oculta UI, nunca autoriza.
- **Nunca token en localStorage.** Cookie `httpOnly` + `Secure` + `SameSite=Strict`.
- **Nunca DELETE físico.** Soft delete siempre (`deleted_at`/`deleted_by`), y toda unicidad de negocio como índice único parcial `WHERE deleted_at IS NULL`.
- **Nunca SQL crudo ni f-strings en consultas.** Solo ORM parametrizado.
- **Nunca `dangerouslySetInnerHTML`.**
- **Validación con Pydantic en el servidor**, no solo en el cliente.
- **Nunca loguear contraseñas, tokens ni datos clínicos.** Hay un único serializador de auditoría con lista de denegación.
- **Todo CRUD, login, logout, intento fallido y cambio de módulo escribe en `AuditLog`**, en la misma transacción que la mutación de negocio.
- **Antes de modificar el esquema de base de datos, PIDES APROBACIÓN y muestras la migración.**

---

## Seguridad (OWASP Top 10 2021)

- **A01 Control de acceso.** Autorización en backend con dependencias FastAPI a nivel de router; RBAC + verificación de acceso al módulo + ownership por `aseguradora_id`; deny by default; allowlist pública en un solo lugar y test de CI que recorre `app.routes` y falla la construcción si alguna ruta queda sin autenticar.
- **A02 Criptografía.** Contraseñas con argon2id (`argon2-cffi`); token de sesión opaco de 256 bits guardado solo como SHA-256; cookie `httpOnly` + `Secure` + `SameSite=Strict` con prefijo `__Host-` en producción; HTTPS forzado en nginx.
- **A03 Inyección.** Solo ORM parametrizado, cero f-strings en SQL; búsqueda por trigram también parametrizada; validación Pydantic de todo input; sin `dangerouslySetInnerHTML`.
- **A04 Diseño seguro.** Tres capas en el login: `limit_req` de nginx por IP, slowapi en el endpoint y bloqueo por cuenta en Postgres con un único `UPDATE` atómico; respuesta idéntica en todos los fallos y verificación argon2 siempre ejecutada para que no haya enumeración por tiempo.
- **A05 Configuración.** `DEBUG=False` en producción validado al arranque; contenedores no root también en desarrollo; imágenes multi-stage slim; `.dockerignore`; secretos por variables de entorno validadas con pydantic-settings; cabeceras en nginx (CSP estricta sin `unsafe-inline`, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy) incluidas dentro de **cada** `location`; CORS con allowlist explícita.
- **A06 Dependencias.** `uv.lock` y `package-lock.json` como únicas rutas de instalación (`uv sync --frozen`, `npm ci`); `pip-audit` y `npm audit --audit-level=high` bloqueantes en CI; imágenes base con etiqueta fijada y vigente.
- **A07 Autenticación.** Rotación del identificador de sesión al iniciar sesión, solo tras verificar credenciales; expiración por inactividad (30 min) y absoluta (12 h); logout que invalida en servidor; contraseña mínima de 12 caracteres; columna `mfa_secret` cifrada y lista.
- **A08 Integridad.** CSRF en todas las mutaciones con token propio ligado a la sesión; login que solo acepta `application/json`; subidas validadas por MIME real con `python-magic`, con límite de tamaño, renombradas con UUID, almacenadas fuera del árbol ejecutable y servidas sin posibilidad de ejecución.
- **A09 Logging.** `AuditLog` con usuario, módulo, acción, entidad, timestamp, IP y user-agent; logs estructurados en JSON correlacionados por `request_id`; nunca contraseñas, tokens ni datos clínicos.
- **A10 SSRF.** No se realiza ninguna petición saliente a URLs suministradas por el usuario. Si alguna vez hace falta, se valida contra allowlist antes de cualquier fetch. El logo por URL está prohibido: solo subida de archivo.

---

## UI/UX

Sistema de **design tokens** coherente (colores, tipografía, espaciado, radios, sombras) con **dark mode**. Cada módulo tiene su color de acento, dato que viene de `modules.color_acento`, nunca hardcodeado; el sistema base es el mismo: **los componentes se comparten, no se duplican por módulo**.

**Framer Motion con criterio:** transiciones de página, entrada escalonada de filas y tarjetas, animación de modales y drawers, microinteracciones en botones. Duraciones **150–300 ms**, easing natural, nada rebotón ni exagerado.

**Estados completos** en cada vista: skeleton en carga, estado vacío con acción, estado de error con reintento, toast de éxito.

**Accesible:** focus visible, navegación completa por teclado (drawer con foco atrapado y `Esc`), roles y etiquetas ARIA, contraste AA en ambos temas.

**Responsive real desde 360 px** y **respeta `prefers-reduced-motion`**.

---

## Documentación viva (obligatorio)

`docs/` debe reflejar **SIEMPRE** el estado real del código:

| Cambio | Documento a actualizar |
|---|---|
| Esquema de base de datos | `docs/01-esquema-bd.md` |
| Endpoints o autenticación | `docs/03-auth-y-api.md` |
| Docker o nginx | `docs/02-infraestructura.md` |
| Módulo nuevo | `docs/modulos/{nombre}.md` |

`docs/modulos/{nombre}.md` contiene entidades, estados y transiciones, roles, endpoints y reglas de negocio, y se actualiza con cada modificación del módulo.

**Dejar documentación desactualizada = trabajo incompleto.**

---

## Cómo trabajamos

- Implementa **solo lo que se pide**, nada más.
- Si un cambio implica decisiones de arquitectura o una migración, **consulta antes**.
- **Nada de workflows ni subagentes** salvo petición explícita.
</content>
