# Autenticación, sesión, autorización y contrato de API

Iteración 1 · Documento normativo. Incorpora las correcciones de la revisión adversarial de seguridad.
Ante discrepancias con `01-esquema-bd.md`, manda el esquema.

---

## 1. Decisión: sesiones opacas server-side. JWT queda descartado.

**Cookie `httpOnly` con token opaco + tabla `sessions` en PostgreSQL.** Contra los requisitos concretos de la especificación:

| Requisito | Sesión opaca server-side | JWT access 15 min + refresh |
|---|---|---|
| Tabla `Session` en DB (modelo obligatorio) | La tabla **es** la sesión | Solo almacenaría refresh tokens; la tabla queda infrautilizada |
| Revocación de módulo con efecto **inmediato** | Automática: cada request consulta `sessions` + `user_module_access` | Un access token sigue válido hasta 15 min tras la revocación, salvo que se consulte la DB en cada request… lo que anula la única ventaja del JWT |
| Cookie httpOnly + Secure + SameSite=Strict, nunca localStorage | Un solo valor opaco en una sola cookie | Dos tokens, rotación de refresh, detección de reuso, carreras en el refresh desde la SPA |
| SPA y API tras el **mismo nginx** (mismo origen) | No hace falta token portable | El caso que justifica JWT (múltiples audiencias, cross-domain) no existe aquí |

En esta arquitectura el JWT solo añade superficie de ataque sin aportar nada.

---

## 2. Ciclo de vida de la sesión

### 2.1 Creación

1. Token: `secrets.token_urlsafe(32)` → 256 bits CSPRNG. En DB se guarda solo `sha256(token)` (`sessions.token_hash`). Un volcado de la tabla no permite secuestrar sesiones. SHA-256 y no argon2: el token ya tiene entropía plena y el lookup por request debe ser un index lookup, no 100 ms de KDF.
2. Token CSRF: otro valor aleatorio de 256 bits; se guarda `sha256` en `sessions.csrf_token_hash`.
3. Cookies emitidas:
   ```
   Set-Cookie: {prefix}session=<token>;      HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=<absoluto>
   Set-Cookie: {prefix}csrf_token=<csrf>;              Secure; SameSite=Strict; Path=/   ← SIN HttpOnly: el JS debe leerla
   ```
   `{prefix}` es `__Host-` en producción y vacío en desarrollo (el prefijo exige `Secure`, que en `http://localhost` no aplica). `__Host-` impide *cookie tossing* desde un subdominio comprometido, que de otro modo permitiría fijar la cookie de sesión de la víctima.

### 2.2 Rotación al login (A07)

Cada login exitoso crea una fila nueva y revoca la anterior con `revoke_reason='rotation'`, encadenada por `rotated_from_id`. **El orden importa: primero se verifican las credenciales, y solo si son correctas se revoca la sesión de la cookie entrante.** Revocar antes de verificar convierte cualquier POST fallido a `/login` en un auto-DoS que destruye la sesión válida del usuario en otra pestaña. La protección anti-fijación se conserva íntegra porque jamás se reutiliza un identificador.

### 2.3 Flujo de login de trabajo constante (anti-enumeración)

El orden es normativo, no una sugerencia de implementación:

1. Buscar el usuario por email. Si no existe, usar un **hash dummy** precomputado.
2. **Ejecutar siempre `argon2.verify`**, en todos los caminos: usuario inexistente, usuario desactivado, cuenta bloqueada y contraseña incorrecta. Nunca se salta la verificación.
3. **Solo después** evaluar `locked_until`, `is_active` y `deleted_at` y decidir la respuesta.
4. Ejecutar una escritura equivalente en todos los caminos (o ninguna), para que el path de email inexistente no sea medible por la ausencia del `UPDATE` de contadores.
5. Respuesta **idéntica** en todos los fallos: `401 {"detail": "Credenciales inválidas"}`. El motivo real (`email_inexistente`, `password_incorrecto`, `cuenta_bloqueada`, `usuario_inactivo`) va **solo** a `audit_log`.

Sin el punto 3, comprobar el bloqueo antes de argon2 haría que una cuenta bloqueada respondiera en ~2 ms frente a ~150 ms del resto: un atacante mide y enumera cuentas existentes. **Test obligatorio**: la diferencia de tiempo media entre los cuatro caminos debe quedar bajo umbral.

### 2.4 Expiración doble

- **Inactividad (sliding)**: `SESSION_IDLE_TTL_MIN = 30`. Se comprueba en la query de autorización; `last_activity_at` se actualiza solo si tiene más de 60 s (throttle de escritura, para no convertir cada GET en un UPDATE).
- **Absoluta**: `SESSION_ABSOLUTE_TTL_MIN = 720` (12 h) desde `created_at`, sin excepción ni extensión.

Ambos TTL son configuración, no columnas materializadas: cambiarlos no exige migración.

### 2.5 Logout y revocación

`POST /auth/logout` marca `revoked_at` **en servidor** (no basta con borrar la cookie), escribe `audit_log` y responde con cookies expiradas. Un token robado deja de servir en ese instante. Desactivar un usuario (`is_active=false`) revoca todas sus sesiones con `revoke_reason='user_deactivated'`; cambiar la contraseña, con `password_change`.

### 2.6 Limpieza

Revocación oportunista de las sesiones vencidas del usuario en cada login, más una tarea periódica horaria que purga físicamente las sesiones revocadas o vencidas con más de `SESSION_PURGE_AFTER_DAYS = 30`. Es la **única excepción documentada** a la regla de no borrado físico, justificada porque es dato técnico efímero cuya evidencia perdura en `audit_log`. Como producción corre `uvicorn --workers 4`, la tarea toma un **advisory lock de PostgreSQL** (`pg_try_advisory_lock`) para que solo un worker la ejecute.

Las tareas periódicas del arranque son dos —esta purga y el marcado de visitas `no_auditado` de Concurrencia (ver `docs/modulos/concurrencia.md`)— y ambas pasan por el mismo ayudante `_con_candado` de `main.py`: tomar el candado, el trabajo y soltarlo ocurren **sobre una misma conexión** del pool (con `SessionLocal()` a secas no hay garantía: la sesión devuelve su conexión en cada commit y el unlock podría caer en otra, quedando el candado pegado), y antes del unlock se hace `rollback()` por si el trabajo dejó la transacción abortada — sin eso, un fallo en la tarea retendría el candado para siempre y la dejaría muda, que es exactamente lo que se observó en QA.

---

### 2.7 La vía móvil: el mismo token, otro sobre

La app nativa del auditor (`movil/`, ver `docs/08-app-movil.md`) usa **la misma
sesión opaca**, entregada de otra forma: `POST /auth/login` con
`"cliente": "movil"` responde el token una única vez en el cuerpo y no emite
cookies; la app lo guarda en el llavero del sistema y lo manda por
`Authorization: Bearer`. `get_current_user` acepta cookie o Bearer contra la
misma tabla —misma expiración, misma revocación inmediata—, y la vía Bearer
queda **exenta del CSRF a propósito**: sin cookie no hay credencial ambiental
que un tercero pueda disparar. La exención se decide por cómo llegó el token
(`AuthContext.via_bearer`), jamás por quién es el usuario. Con `"web"` —el valor
por defecto— nada cambia: `token: null` en el cuerpo y cookies como siempre.

---

## 3. CSRF (A08)

`SameSite=Strict` es la primera barrera; el **double-submit con token propio de sesión** es la segunda (cubre bugs de navegador, subdominios futuros y errores de configuración).

- Toda mutación (`POST`/`PUT`/`PATCH`/`DELETE`) exige la cabecera `X-CSRF-Token`. El servidor calcula `sha256(header)` y lo compara con `sessions.csrf_token_hash` usando `hmac.compare_digest`. Fallo → `403` genérico.
- Un atacante cross-site no puede leer la cookie (same-origin policy) ni fijar la cabecera, y el token está ligado a **esa** sesión, así que tampoco sirve el de otra víctima.
- `GET /auth/csrf` **rota** el token de la sesión actual y reemite la cookie (caso real: cookie CSRF perdida con sesión viva). Sin sesión válida responde `204` sin `Set-Cookie`; el login siempre emite la cookie, así que no hay otro caso legítimo.
- **`POST /auth/login` acepta exclusivamente `Content-Type: application/json`** y responde `415` a `application/x-www-form-urlencoded` o `multipart/form-data`. Es lo que impide el *login CSRF*: un formulario HTML cross-site no puede emitir JSON. Como defensa adicional, todas las mutaciones validan la cabecera `Origin` contra `ALLOWED_ORIGINS`.

  **Dónde vive esta comprobación:** en el middleware, no en el endpoint. FastAPI parsea el cuerpo *antes* de ejecutar la función, así que una comprobación dentro del endpoint llegaría tarde y sería código muerto: el cliente recibiría un `422` de validación en lugar del `415`.

- **Los errores de validación no devuelven el cuerpo recibido.** El manejador por defecto de FastAPI incluye el input en la respuesta, de modo que un login mal formado respondería con la contraseña enviada escrita en el JSON. Un manejador propio de `RequestValidationError` devuelve solo tipo, campo y mensaje.

Integración con la SPA — un único cliente axios en `web/src/core/api/client.ts`, usado por todos los hooks de TanStack Query, de modo que la protección es transparente:

```ts
const api = axios.create({ baseURL: "/api/v1", withCredentials: true });

api.interceptors.request.use((config) => {
  const m = (config.method ?? "get").toUpperCase();
  if (["POST", "PUT", "PATCH", "DELETE"].includes(m)) {
    const csrf = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/)?.[1];
    if (csrf) config.headers["X-CSRF-Token"] = decodeURIComponent(csrf);
  }
  return config;
});
```

---

## 4. Rate limiting de login sin Redis (A04)

Tres capas, de fuera hacia dentro:

1. **nginx `limit_req`** sobre `/api/v1/auth/login`: `10r/m` por IP con `burst=5`, `429`. Actúa antes de tocar la aplicación y es la única capa que sobrevive a un reinicio del proceso.
2. **`slowapi` in-memory** en el endpoint: `5/minute` por IP (valor de `LOGIN_RATE_LIMIT_IP`), con `Retry-After`. La IP la resuelve el middleware de proxy de uvicorn (`request.client.host`); **nunca se parsea `X-Forwarded-For` a mano**.
3. **Lockout por cuenta en PostgreSQL**: `failed_login_attempts` y `locked_until` en `users`, en el UPDATE atómico único de `01-esquema-bd.md` §3.2. Durable, compartido entre los 4 workers y superviviente a reinicios: es la defensa real contra credential stuffing dirigido.

**Límites aceptados y documentados en `SECURITY.md`:**

- El contador de `slowapi` es por proceso: con 4 workers el límite efectivo por IP es ~4×5/min. Por eso la capa de nginx es la que cuenta para IP.
- El lockout por cuenta habilita un **DoS dirigido**: quien conozca un email corporativo puede mantener esa cuenta bloqueada con 5 intentos cada 15 minutos desde IPs rotativas. Es un intercambio consciente para la iteración 1 (bloquear fuerza bruta pesa más que el riesgo de molestia dirigida en una aplicación interna). Mitigación operativa: alerta sobre eventos `cuenta_bloqueada` repetidos. Siguiente iteración: CAPTCHA tras N fallos y notificación por correo al titular. **Es una decisión que conviene confirmar (D-12).**
- **Cuándo introducir Redis**: al escalar `api` a más de una réplica o exigir límites por IP exactos y compartidos. `slowapi` cambia su storage sin tocar los endpoints.

---

## 5. Resolución de módulos

**La tabla `modules` es la única fuente de verdad en runtime** (decisión D-02). No existe ningún registro de módulos en código Python que valide accesos: el catálogo Python solo aparece como *dato semilla* de la migración inicial. Consecuencia práctica: apagar un módulo con `modules.activo = false` surte efecto inmediato en logins, en el selector y en la autorización por request, sin desplegar código.

### `POST /api/v1/auth/login` — respuesta exacta

```json
{
  "user": {
    "id": "018f2c1a-...",
    "email": "ana@aseguradora.ec",
    "nombre_completo": "Ana María Cordero Vega",
    "es_admin_global": false
  },
  "aseguradora": { "nombre": "LA UNION", "tiene_logo": true },
  "modulos": [
    { "codigo": "carta_credito", "slug": "central-credito", "nombre": "Central de Crédito",
      "icono": "credit-card",    "color_acento": "amber", "orden": 4, "rol": "supervisor" },
    { "codigo": "concurrencia",  "slug": "concurrencia", "nombre": "Auditoría de Concurrencia",
      "icono": "activity",       "color_acento": "sky",   "orden": 5, "rol": "operador" }
  ],
  "ultimo_modulo_usado": "concurrencia",
  "redireccion": "/concurrencia"
}
```

- `modulos` lo calcula **siempre** el backend con la query de `01-esquema-bd.md` §3.7 sin filtro de módulo. El frontend jamás decide qué módulos existen ni cuáles ve el usuario.
- `redireccion` la resuelve el backend con la regla exacta de la especificación:

  | Situación | `redireccion` |
  |---|---|
  | 0 módulos y no admin global | `/sin-accesos` |
  | admin global | `/admin` |
  | exactamente 1 módulo | `/{slug}` — sin selector |
  | varios y `ultimo_modulo_usado` sigue vigente | `/{slug del último}` |
  | varios sin último válido | `/seleccionar-modulo` |

  Si `users.last_module_code` apunta a un módulo revocado o apagado, **no** se usa: se cae al selector. La validación es contra la lista recién calculada, no contra el campo.
- `aseguradora` es la compañía del usuario, lo justo para pintar su marca en el
  armazón de los módulos: el nombre con el que se la conoce (`nombre_comercial` o,
  si no hay, `razon_social`) y si tiene logo que pedir. `null` para el personal de
  plataforma. **Sin identificadores**: el logo se pide a una ruta que no recibe id.
- `GET /auth/me` devuelve el mismo shape más `modulo_activo` y `permisos` (§6.4).

---

## 6. Autorización

Todas las dependencias viven en `backend/app/core/security/deps.py`.

### 6.1 `get_current_user`

Cookie ausente → `401`. `sha256(token)` → busca la sesión no revocada, valida expiración absoluta y de inactividad (vencida ⇒ revoca + `401`), actualiza `last_activity_at` con throttle, carga el usuario y verifica `is_active` y `deleted_at` (fallo ⇒ revoca sesión + `401`). Devuelve `AuthContext(user, session)`.

### 6.2 `require_module_access(slug)`

Factory que se aplica **a nivel de `APIRouter`**. Resuelve `slug → code` contra `modules` (único punto de traducción de toda la plataforma) y ejecuta, **en cada request**, la consulta contra `user_module_access` de `01-esquema-bd.md` §3.7. Sin fila → `403 {"detail":"No autorizado"}`, sin revelar si el módulo existe, si el usuario existe o qué accesos tiene, y con evento `acceso_denegado` en `audit_log`.

Como la comprobación va a DB en cada request, **revocar un acceso tiene efecto inmediato sobre sesiones vivas** sin ningún mecanismo adicional. Decisión explícita: **el admin global no entra a los módulos por implicación**; necesita su propia fila en `user_module_access` (deny by default sin atajos).

### 6.3 `require_permission(codigo)` y `require_global_admin`

`require_permission` se apila tras `require_module_access` y comprueba el código contra los permisos del rol del usuario **en ese módulo**. `require_global_admin` comprueba `users.is_superadmin`; fallo → `403` genérico.

**Alcance del RBAC en la iteración 1 (decisión D-10).** Los roles son por módulo, así que `require_permission` solo tiene contexto dentro de un router de módulo. En consecuencia:

- Los endpoints de `/admin/**` y el CRUD de aseguradoras se protegen **solo** con `require_global_admin`. Los códigos de permiso del núcleo quedan sembrados en DB pero **inertes**, listos para el día que se delegue sin admin global.
  - *(Enmienda, sep 2026: ese día llegó a medias. El CRUD de aseguradoras y el de prestadores se delegan hoy en las funciones transversales —`require_funcion`— y no en los códigos de permiso, que siguen inertes. Es una delegación por función, no por permiso: la maquinaria RBAC no cambió.)*
- `require_permission` sí se ejerce de verdad en el endpoint placeholder de cada módulo (`dashboard:ver`), de modo que la maquinaria RBAC completa queda probada de punta a punta desde la iteración 1 en lugar de ser código sin ejecutar.

**Enmienda a D-10 — el panel de Auditorías.** El administrador global ahora SÍ
entra a los routers de módulo: `require_module_access` le abre la puerta **como
coordinador de plataforma** (`rol = "supervisor"` en la base, «Coordinador» de
cara al usuario, con todos los permisos del módulo), sin fila de acceso propia.
Es lo que alimenta el menú «Auditorías» del admin
(`/admin/auditorias/concurrencia`: la misma bandeja de supervisión que ve el
coordinador de Concurrencia, con derivar incluido). Las puertas por
pertenencia siguen intactas donde deben: las rutas de compañía le responden 403
—no tiene aseguradora— y la bandeja del auditor le devuelve vacío o 404 —ningún
caso está derivado a él—. Todo lo que hace queda en `AuditLog` con su usuario.

### 6.4 Permisos en `/auth/me`

`/auth/me` devuelve `permisos: ["dashboard:ver", ...]` — los códigos del rol del usuario en su **módulo activo**. Es lo que permite al frontend ocultar botones según permisos reales (requisito del punto 4 del alcance). Sigue siendo solo presentación: la autorización la ejerce el backend en cada request.

Con el mismo criterio viajan dos datos más en `user`, y valen para **pintar**, no
para autorizar: `funcion` —la transversal, si la tiene— y `grupo_coordinado` —la
familia que coordina, si es coordinador de **plataforma**; `null` en el de una
aseguradora, que coordina una compañía y no una familia—. El servidor los vuelve
a resolver en cada request.

### 6.5 Deny by default — garantía estructural, no disciplinaria

1. **Dependencia a nivel de `APIRouter`**, nunca por endpoint suelto:
   `APIRouter(prefix="/suscripcion", dependencies=[Depends(require_module_access("suscripcion"))])`,
   `APIRouter(prefix="/admin", dependencies=[Depends(require_global_admin)])`.
   Un endpoint nuevo dentro del router nace protegido; olvidarlo es imposible.
2. **Allowlist pública explícita en un solo lugar**: `PUBLIC_PATHS = {"/api/v1/health", "/api/v1/auth/login", "/api/v1/auth/csrf", "/api/v1/auth/invitacion", "/api/v1/auth/definir-password"}`. Las dos últimas entraron con las invitaciones y por un motivo estructural, no por comodidad: quien abre una invitación **todavía no tiene contraseña**, así que no puede haber sesión que comprobar. Añadir una ruta a esta lista es la única forma de dejarla pública, y el test del punto 3 obliga a que sea deliberado.
3. **Test por introspección** (`backend/tests/test_deny_by_default.py`): recorre las rutas registradas y **falla** si alguna fuera de `PUBLIC_PATHS` no tiene `get_current_user` en su árbol de dependencias. La garantía deja de depender de la revisión humana.

   **Cuidado con el recorrido, porque aquí hay una trampa real.** Las versiones actuales de FastAPI **no aplanan** los routers dentro de `app.routes`: los anidan en objetos `_IncludedRouter`. La implementación evidente del test —iterar `app.routes` buscando `APIRoute`— no encuentra ni una sola ruta y **pasa en verde sin comprobar nada**, que es la peor forma posible de fallar. El test recorre el árbol de forma recursiva, acumulando solo los prefijos de los routers *antecesores* (`route.path` ya incluye el de su propio router), y lleva un tercer test que verifica que el recorrido encuentra al menos diez rutas, precisamente para que ese falso verde no pueda repetirse.

---

## 7. Contrato de endpoints — `/api/v1`

Convenciones: paginación `?page=1&page_size=20` (máx. 100), respuesta `{"items": [...], "total": n, "page": p, "page_size": s}`. Toda mutación exige `X-CSRF-Token`. Los errores de autorización son siempre `403 {"detail": "No autorizado"}`.

> **Estado de implementación.** Este contrato es el objetivo de la iteración 1 completa. Hoy están construidos y verificados **auth**, **infraestructura**, los **placeholders de módulo**, los **catálogos de ubicación** y el **CRUD de aseguradoras con su logo**; el bloque de **administración de usuarios y accesos** está especificado pero todavía no existe como código. El detalle, con lo verificado y lo pendiente, está en [`04-estado-implementacion.md`](04-estado-implementacion.md).

### Auth

| Método | Path | Protección | Descripción |
|---|---|---|---|
| POST | `/auth/login` | Pública · solo JSON · rate limit · lockout | Body `{email, password}`. Respuesta de §5. Crea sesión y emite ambas cookies |
| POST | `/auth/logout` | Sesión + CSRF | Revoca en DB, limpia cookies |
| GET | `/auth/me` | Sesión | Shape de login + `modulo_activo` + `permisos` |
| GET | `/auth/csrf` | Pública | Rota y reemite la cookie CSRF si hay sesión viva; `204` si no |
| GET | `/auth/mi-aseguradora/logo` | Sesión | El logo de la compañía del **propio** usuario, para el armazón de los módulos. La autorización es la pertenencia: la ruta no recibe id, así que no existe forma de pedir el de otra. Admin global o compañía sin logo → `404` |
| POST | `/auth/modulo-activo` | Sesión + CSRF + acceso al módulo del body | `{"slug": "..."}`. Actualiza `sessions.active_module_code` y `users.last_module_code`. Cambio de módulo **sin reautenticación** |

`POST /auth/modulo-activo` no puede usar la factory `require_module_access` (el módulo llega en el body, no en el path). Usa una dependencia dedicada que llama **a la misma función interna** para que no existan dos implementaciones divergentes. Test obligatorio: con un módulo sin acceso → `403` genérico y `active_module_code` sin cambiar.

### Compartido

| Método | Path | Protección | Descripción |
|---|---|---|---|
| GET | `/shared/modulos` | Sesión | Solo los módulos **del usuario** (mismo cálculo que el login). Nunca el catálogo completo: eso filtraría la existencia de módulos a los que no tiene acceso |
| GET | `/shared/catalogos/provincias` | Sesión | Las 24 provincias, ordenadas por nombre |
| GET | `/shared/catalogos/ciudades?provincia_codigo=NN` | Sesión | Cantones de esa provincia. El parámetro es obligatorio: el formulario los pide en cascada y sin provincia no hay lista que mostrar |
| GET | `/shared/catalogos/tipos-documento` | Sesión | Cédula, RUC y pasaporte. Alimenta el selector de documento del contacto y el del propio prestador. El número se comprueba en el servidor con el **dígito verificador** ecuatoriano (§2.1c de `01-esquema-bd.md`), no solo con el regex del catálogo |
| GET | `/shared/catalogos/tipos-prestador` | Sesión | Tipos vivos con su `es_persona`. El formulario lo usa para decidir si pide especialidad y registro profesional, o registro sanitario |
| GET | `/shared/catalogos/modulos` | **Admin global y Contabilidad** | Catálogo completo de módulos vivos, para las casillas de la aseguradora. Cerrado a los demás a propósito: `/shared/modulos` devuelve solo los del usuario justamente para no filtrar cuáles existen. Lo abre quien marca lo que una compañía contrata |
| GET | `/shared/catalogos/coberturas` | **Admin global y Contabilidad** | En qué coberturas se divide cada módulo. Mismo criterio y mismo motivo que el anterior |
| GET | `/health` | Pública | Healthcheck; sin información interna |

### Aseguradoras — API en `/shared/aseguradoras`, UI en `/admin/aseguradoras`

**Tres routers, un solo prefijo.** Ninguna ruta va suelta: cada una nace con la
dependencia de su router, y el reparto es el que decide quién entra.

| Marca | Dependencia | Quién entra |
|---|---|---|
| *(sin marca)* | `require_funcion("contabilidad")` | admin global y **Contabilidad**: la ficha de la compañía entera |
| ⬡ | `require_funcion("convenio")` | admin global y **Convenio**: la red de prestadores |
| ⬡⬢ | `require_funcion("convenio", "contabilidad")` | admin global y **las dos** |

Hasta septiembre de 2026 el router de la ficha exigía administrador global a
secas (D-10); ahora lo comparte con Contabilidad, que es quien da de alta a las
compañías y las mantiene. **Los convenios son lo único que no toca.**

| Método | Path | Descripción |
|---|---|---|
| GET ⬡⬢ | `/shared/aseguradoras` | `?search=` (razón social, nombre comercial, RUC o código interno; trigram), `?estado=activo\|inactivo`, `?provincia_codigo=`, `?page=`, `?page_size=`. Excluye siempre las eliminadas |
| GET ⬡⬢ | `/shared/aseguradoras/mapa` | Las compañías sobre el mapa: **una por punto, en su domicilio** —no llevan sedes—, con provincia, ciudad, dirección fiscal y coordenadas. Fuera la ficha propia de Accumedical, igual que en el listado. Cuelga del router del listado: quien puede listarlas puede verlas en el mapa |
| GET | `/shared/aseguradoras/{id}` | Detalle; `404` si está eliminada |
| GET ⬡ | `/shared/aseguradoras/{id}/basico` | **Solo `{id, nombre}`**. Es la ficha que recibe quien lleva los convenios: entra a la pantalla de la compañía por su red, así que no se le sirve el detalle entero. Mínimo privilegio (A01), no cortesía de interfaz |
| POST | `/shared/aseguradoras` | Alta: razón social, nombre comercial, RUC (único entre vivas), estado, provincia, ciudad, dirección fiscal, **`latitud` y `longitud` (obligatorias)**, `modulos` (códigos marcados; vacío por defecto) `coberturas` (`{"calificacion": ["vida", ...]}`) y `contactos` (lista completa). El código interno lo genera la base |
| PATCH | `/shared/aseguradoras/{id}` | Edición parcial, incluido `estado`, `modulos` y `coberturas`. Las coordenadas se pueden mover pero no vaciar: un `null` explícito devuelve `422`. Omitir ambos deja los accesos intactos. **`modulos` gobierna solo los módulos sin coberturas**; el acceso a los que las tienen se deriva: activo si queda al menos una cobertura marcada. Enviar solo `coberturas` recalcula el módulo que las agrupa sin tocar los demás. `contactos` se reconcilia como lista completa: los que traen `id` se actualizan, los que no lo traen se crean, y los ausentes se borran lógicamente. Cada contacto lleva además un `cargo` opcional |
| POST | `/shared/aseguradoras/{id}/logo` | `multipart/form-data`. Controles A08 completos, §8 |
| GET ⬡⬢ | `/shared/aseguradoras/{id}/logo` | Sirve el archivo tras autorizar, vía `X-Accel-Redirect`. Lo ven las dos funciones: su listado de compañías pinta el logo de cada fila, y negárselo solo dibujaría un icono roto sin ocultarles nada que no tengan ya delante |
| GET ⬡ | `/shared/aseguradoras/propia` | **La ficha interna de Accumedical** (`es_propia`), dueña de la «Red convenio» del superadmin: `{id, nombre}`. Declarada ANTES de `/{aseguradora_id}` para que la ruta literal gane el match. La ficha se excluye del listado de aseguradoras y de todo selector |
| GET ⬡ | `/shared/aseguradoras/{id}/convenios` | **La red de la compañía**: todos los prestadores vivos con la marca de convenio vivo. Elegir y marcar; el detalle (FC, vigencias) vendrá después. Con el `id` de la ficha propia, es la «Red convenio» de Accumedical — misma maquinaria |
| PUT ⬡ | `/shared/aseguradoras/{id}/convenios` | Reconcilia la red completa (`{"prestadores": [{prestador_id, red_privada, red_publica}]}`): marcar crea el convenio `vigente` con la red elegida, desmarcar lo retira con borrado lógico y cambiar las casillas de un marcado corrige su red. **Al menos una red**: ninguna marcada se rechaza con 422 y mensaje legible, antes de que hable el CHECK. Audita `actualizar` sobre `aseguradora_prestador` con habilitados, retirados y aquellos a los que cambió la red. **La misma red se maneja también desde el prestador** (`/shared/prestadores/{id}/convenios`): es la misma fila, así que da igual por dónde se entre |
| GET ⬡ | `/shared/aseguradoras/{id}/convenios/{prestador_id}/listado-precios` | El listado de precios del convenio, como **attachment** con su nombre visible (PDF o Excel, según lo subido). El convenio se resuelve por el PAR aseguradora+prestador, nunca por un id suelto. 404 si no hay convenio vivo o no tiene listado |
| POST ⬡ | `/shared/aseguradoras/{id}/convenios/{prestador_id}/listado-precios` | Sube (o **reemplaza**) el ÚNICO listado del convenio, multipart `archivo`. Tipo real por contenido: PDF, `.xlsx` (ZIP con `xl/workbook.xml` dentro — un ZIP cualquiera renombrado se rechaza) o `.xls` (OLE). Nombre visible = nombre del archivo sin extensión; almacenamiento por UUID. Audita `actualizar` con antes/después |
| GET | `/shared/aseguradoras/{id}/sla` | **El SLA por módulo**: un renglón por cada módulo que la compañía tiene ACTIVO, con sus `horas` y `precio` (nulos si aún no se pactó) y el `grupo` para agrupar en pantalla |
| PUT | `/shared/aseguradoras/{id}/sla` | Guarda la tabla completa (`{"items": [{module_code, horas, precio}]}`). **El SLA es obligatorio en cada módulo contratado**: `422` si falta alguno —el mensaje los nombra—, si se envía uno que la compañía no tiene, si falta `horas` o `precio`, o si son negativos. Audita `actualizar` sobre `aseguradora_sla` con lo que cambió |
| GET | `/shared/aseguradoras/{id}/polizas` | Los documentos PDF de la compañía por `?categoria=` (`polizas` \| `cobertura_condiciones` \| `sla` \| `convenios`): nombre visible y fecha; el archivo tiene su propio endpoint |
| POST | `/shared/aseguradoras/{id}/polizas` | Sube un PDF (`multipart`: `archivo` + `nombre` opcional — sin nombre, el del archivo sin extensión — + `categoria`). Controles A08: MIME real `application/pdf`, tope de tamaño, nombre de almacenamiento por UUID. Audita `crear` sobre `aseguradora_polizas` |
| GET | `/shared/aseguradoras/{id}/polizas/{poliza_id}` | Sirve el PDF tras autorizar, con `nosniff` y sin caché |
| DELETE | `/shared/aseguradoras/{id}/polizas/{poliza_id}` | **Borrado lógico** (el archivo queda como evidencia). Audita `eliminar` |

**Una aseguradora no se elimina: se desactiva.** No hay `DELETE` en este router —una
petición a ese verbo devuelve `405`, no un `403`— porque la operación no existe, no
porque esté oculta en la interfaz. Tiene expedientes, convenios con prestadores y
usuarios colgando, y el histórico de todos ellos pierde sentido si su compañía
desaparece del listado. Dar de baja es `PATCH {"estado": "inactivo"}`, es reversible
y queda en la auditoría como cualquier otro cambio.

Las columnas `deleted_at`/`deleted_by` siguen existiendo en la tabla porque vienen
del mixin común, pero **ningún camino de la aplicación las escribe** para
`aseguradoras`.

### Las funciones transversales — qué abren y cómo se autorizan

Personal propio de Accumedical **sin módulos ni familia**: su permiso es
transversal, vive en `user_funcion` (§3.6b-bis de `01-esquema-bd.md`) y lo
conceden las dependencias `require_funcion(...)` de `core/security/deps.py`,
declaradas **a nivel de router** como todas las demás. Hay una sola persona en
cada función, y ninguna puede llevar dos.

Ninguna pasa por `UserModuleAccess` ni por el selector de módulos: tras el login
las dos aterrizan en `/admin/aseguradoras`, que es también el destino del índice
`/admin`.

**El coordinador de plataforma tampoco pasa por el selector**: aterriza en
`/coordinacion/bandeja`, su bandeja de entrada con los casos de todas sus
auditorías. Vale por las dos puertas —familia o fila de módulo—; el coordinador
de una compañía queda fuera por su `aseguradora_id` y sigue entrando a su módulo.

**Su área es `/coordinacion`, no `/admin`**: coordinar no es administrar la
plataforma, y la dirección no debe decir lo contrario. Ahí viven su bandeja, sus
usuarios y sus notificaciones —las MISMAS pantallas del administrador, montadas
bajo su prefijo, no copias—. **El coordinador de una COMPAÑÍA también trabaja
ahí** —mismo menú, mismas notificaciones—, pero la bandeja de entrada y los
usuarios no son suyos: no junta varias auditorías ni da de alta auditores, así
que `/coordinacion/bandeja` lo devuelve a su módulo. El prefijo es **rótulo y navegación, nunca
autorización**: cada endpoint la revalida, así que escribir `/admin` a mano no
vuelve administrador a nadie ni le abre un dato más.

**Las pantallas de cada una**, en el orden en que las ve en su menú —que muestra
esas y solo esas:

**Son complementarias, y se reparten la aseguradora por la mitad:** Contabilidad
lleva la compañía; Convenio, su red de prestadores.

| Función | Menú | Qué puede en cada pantalla |
|---|---|---|
| **Contabilidad** | Aseguradoras | La ficha **entera**: alta, datos generales, módulos contratados, SLA, pólizas, contactos y usuarios de la compañía. **Todo menos la pestaña «Convenios»**, que no existe para ella |
| **Convenio** | Aseguradoras · Prestadores · Red convenio | En **Aseguradoras**, justo lo contrario: solo la pestaña «Convenios»; no crea ni edita compañías. En **Prestadores**, todo: crear, editar, dar de baja, logo, sedes y contactos —son con quienes se pacta, así que el router entero de prestadores lleva su dependencia—. En **Red convenio**, todo sobre la red propia de Accumedical: marcar, desmarcar, listado de precios y valores FC |

Fuera de eso, **403 genérico** sin decir si el recurso existe:
`/shared/usuarios`, `/shared/configuracion` y las bandejas de cualquier módulo,
para las dos. Y ninguna alcanza lo de la otra: Contabilidad recibe 403 en
`/{id}/convenios`, `/propia`, `/{id}/basico` y `/shared/prestadores`; Convenio,
en el detalle de la compañía, su SLA, sus pólizas, sus usuarios, sus
requerimientos y el alta.

El **catálogo de módulos y coberturas** (`/shared/catalogos/{modulos,coberturas}`)
lo abre Contabilidad por lo mismo: sin él no puede marcar lo que una compañía
contrata. Sigue cerrado a todos los demás, para no filtrar qué módulos existen.

**Contabilidad crecerá** —facturación y lo que venga—, y crecerá por aquí: una
ruta más en su router, una entrada más en su menú. Nada de esto toca el esquema.

**Tres detalles que hay que respetar al tocar esto:**

1. Cada reparto es un **router propio con el mismo prefijo** (`router`,
   `router_listado` y `router_convenios` en `shared/aseguradoras/router.py`), y
   la dependencia se declara en el router, nunca por endpoint suelto: así una
   ruta nueva nace con la autorización de su grupo y olvidarla es imposible.
2. En `main.py`, **el router de la ficha se registra EL ÚLTIMO**. FastAPI
   resuelve por orden de registro, no por especificidad: antes, su
   `/{aseguradora_id}` se tragaría `/propia` y `/{id}/basico`, y Convenio
   acabaría recibiendo un 403 en su propia pantalla.
3. `require_funcion(...)` devuelve una función nueva en cada llamada, y FastAPI
   cachea las dependencias **por identidad**. Se crea UNA vez en una constante
   (`gestiona_companias`, `lleva_la_red`, `ve_companias`, `arma_la_ficha`) y se
   reutiliza en el router y en los endpoints que necesitan el `AuthContext`;
   repetir la llamada consultaría la base dos veces en la misma petición.

`require_funcion` consulta `user_funcion` directamente en lugar de llamar al
servicio de `shared`: `core` no debe depender de `shared` para dejar pasar a
nadie. El superadmin pasa siempre.

### Notificaciones — `/shared/notificaciones`

La campana del topbar, al lado del botón de tema. Router con `get_current_user` y
nada más: **cualquiera que haya iniciado sesión tiene la suya**, y solo la suya —
el `user_id` sale del contexto de la sesión y jamás de un parámetro, así que no
hay nada que acotar por fuera.

| Método | Path | Descripción |
|---|---|---|
| GET | `/shared/notificaciones` | `?solo_sin_leer=`, `?module_code=`, `?con_modulos=`, `?page=`, `?page_size=` (máx. 100). Devuelve los items, el `total` y **cuántas quedan sin leer** —ese contador cuenta TODAS las no leídas, no solo las de la página—. Los valores por defecto son los de la campana (últimas 30, leídas y sin leer, sin pastillas); la pantalla completa usa la MISMA ruta con parámetros, que es lo que evita mantener dos consultas a la par |
| POST | `/shared/notificaciones/{id}/leida` | Marca una. El `user_id` va en el `WHERE`, no se comprueba después: la de otra persona no se puede marcar ni adivinando su id, y la respuesta es la misma —no pasó nada— exista o no |
| POST | `/shared/notificaciones/leidas` | Marca todas las suyas |

**`module_code` filtra por módulo** —el `code`, no el slug: es lo que guarda cada
aviso—. No se valida contra el catálogo a propósito: uno que no exista no tiene
avisos y devuelve la lista vacía, sin decir si existe. Va parametrizado como todo
lo demás y se corta a 30 caracteres (`422` por encima).

**`con_modulos=true` añade las pastillas del filtro**: `modulos[]` con `codigo`,
`nombre`, `total` y `sin_leer`. Van **todos los módulos de los que esa persona
puede recibir avisos** —los suyos, o todos los vivos si es el administrador
global—, tenga avisos o no, más aquellos de los que ya tiene avisos aunque hoy no
tenga acceso, para que no queden filas imposibles de filtrar. **La lista la
calcula el backend**, como toda lista de módulos. Las cuentas se calculan **sin
el filtro de módulo puesto**: si contaran con él, elegir uno dejaría a los demás
en cero y no habría cómo volver.

Cuesta dos consultas más, así que va bajo bandera y **por defecto no viene**: la
campana sondea esta ruta cada 15 s y no las usa; las pide solo la pantalla
completa.

Las dos mutaciones responden **la bandeja entera**, para que la campana no tenga
que volver a preguntarla. Marcar leída no es un hecho de negocio: **no se audita**.

**El «tiempo real» es un sondeo de 15 segundos**, decidido así a propósito: la
campana pregunta cada 15 s y al volver a la pestaña. Funciona a través de nginx,
con varios procesos de uvicorn y sin conexiones abiertas ni nada que mantener
vivo. La alternativa —SSE— exigía `proxy_buffering off`, una conexión por
persona y un bus `LISTEN/NOTIFY` de Postgres para que el proceso que sostiene tu
conexión se entere de lo que ocurrió en otro; a cambio de quitar un retraso
máximo de 15 segundos. Cambiar de transporte después no toca la tabla.

**Quién avisa.** El módulo donde pasa el hecho, dentro de su misma transacción
(§3.6c de `01-esquema-bd.md`). Hoy solo Concurrencia: cuando una **compañía**
programa un caso, se escribe un aviso —título «Auditoría de Concurrencia»,
subtítulo la aseguradora, detalle el estado con el que nace («Programada»)— para
cada coordinador de Concurrencia **y para el administrador global**, que
supervisa el módulo desde su propio panel. Cuando el caso lo programa el propio
coordinador no se avisa a nadie: ya lo sabe.

**Cada uno con su URL, y por eso la URL se guarda por notificación**: el
coordinador va a `/concurrencia/supervision/<id>` y el administrador a
`/admin/auditorias/concurrencia/<id>` —a `/concurrencia` ni siquiera entra,
porque no tiene módulos—. Las dos son **la página del caso**, no la lista. La
ruta `/concurrencia/<id>` no sirve para ninguno de los dos: es la ficha de la
compañía y les responde 403.

Los coordinadores se resuelven con `auth.coordinadores_de_modulo()`, que mira
**las dos puertas** —la fila propia del módulo y la familia—. Mirar solo
`user_module_access`, como se hacía, deja fuera al coordinador de familia, que es
justo el que existe hoy.

### El coordinador de familia y su equipo — `/shared/usuarios`

El personal de plataforma lo administran dos figuras, y la dependencia del router
—`require_coordinacion`— admite exactamente esas dos. La diferencia entera cabe
en `ctx.grupo`:

| Quién | `ctx.grupo` | Qué alcanza |
|---|---|---|
| Administrador global | `None` | Todo el personal y todos los roles |
| **Coordinador de familia** | `"siniestro"` / `"suscripcion"` | **Los auditores de SU familia**, y solo ellos |

Lo que puede el coordinador, comprobado en el servidor y no en la pantalla:

- **Ve** solo a quien audita algún módulo vivo de su familia. Ni el otro
  coordinador, ni quien lleva una función transversal, ni nadie de la familia de
  al lado: para él, un `GET /{id}` de esos responde **404**, el mismo que si no
  existiera.
- **Crea y mantiene** a los suyos: alta, cambio de módulos, activar y desactivar,
  y reenvío de la invitación.
- **No puede nombrar coordinadores ni funciones**, ni conceder un módulo de la
  otra familia, **ni al crear ni al editar**: `403`. La comprobación vive en un
  solo sitio —`service.validar_alcance`— y la llaman las dos rutas.

Dos detalles de implementación que conviene no perder:

1. `ctx.grupo` lo resuelve la dependencia contra `user_grupo_access` **en cada
   request**, como todo lo demás: quitarle la familia a alguien surte efecto en
   la siguiente petición.
2. El acotado **viaja a cada llamada del servicio** (`listar`, `obtener`,
   `validar_alcance`), no se aplica al final sobre la respuesta. Filtrar al
   salir deja la puerta abierta a que una ruta nueva se olvide de filtrar.

El coordinador **no** necesita el catálogo de módulos —que sigue cerrado a él—:
los módulos de su familia son exactamente los que ya trae su sesión.

### Parámetros — API en `/shared/parametros`, UI en `/admin/parametros`

Los catálogos que mantiene la propia gente, para no necesitar una migración cada
vez que aparece un «Centro de imágenes». Router con `require_funcion("convenio")`
— **la misma dependencia que prestadores, no una parecida**: quien da de alta
prestadores tiene que poder nombrar su tipo, así que es la misma puerta.

| Método | Path | Descripción |
|---|---|---|
| GET | `/shared/parametros/tipos-prestador` | **Todos**, ofrecidos y retirados, cada uno con `en_uso`: cuántos prestadores vivos lo usan. El desplegable del formulario sigue pidiendo los suyos a `/shared/catalogos/tipos-prestador`, que devuelve solo los vivos |
| POST | `/shared/parametros/tipos-prestador` | Alta con `nombre` y `es_persona`. **El `codigo` lo genera el servidor** a partir del nombre, con sufijo si ya existe; nadie lo teclea, porque es la FK que guardan los prestadores. `409` si el nombre ya existe —sin distinguir mayúsculas ni contar si está retirado—: dos iguales serían indistinguibles en el desplegable |
| PATCH | `/shared/parametros/tipos-prestador/{codigo}` | Cambia `nombre`, `es_persona` o `activo`. **Retirar uno EN USO es `409`** y el mensaje dice cuántos prestadores lo usan. Renombrar se permite siempre, incluso en uso: el prestador guarda el código, no el nombre |

No hay `DELETE`: retirar es `activo = false`, reversible, y el histórico se
queda. La FK `ON DELETE RESTRICT` protege el borrado físico, pero **apagar la
fila la base no lo ve**, y por eso la guarda vive en el servicio.

### Prestadores — API en `/shared/prestadores`, UI en `/admin/prestadores`

Router con `require_funcion("convenio")` — admin global **y** la función Convenio,
que gestiona la red entera (ver arriba). Misma forma que aseguradoras, con dos diferencias: no hay pestaña de requerimientos —los módulos se conceden a la aseguradora, no al prestador— y el estado admite `suspendido`.

| Método | Path | Descripción |
|---|---|---|
| GET | `/shared/prestadores` | `?search=` (nombre, RUC o código interno; trigram sobre nombre), `?estado=activo\|inactivo\|suspendido`, `?tipo_codigo=`, `?provincia_codigo=`, `?page=`, `?page_size=`. Excluye siempre los eliminados. Cada fila trae `total_sedes` y `total_aseguradoras`, contados con subconsultas correlacionadas que solo se evalúan en las filas devueltas, no en el `count(*)` del total |
| GET | `/shared/prestadores/{id}` | Detalle con sus contactos; `404` si está eliminado |
| GET | `/shared/prestadores/mapa` | Los puntos del mapa: **uno por sitio donde se atiende** —el del prestador y el de cada sede ACTIVA—, con provincia, ciudad, dirección y coordenadas. Un prestador con sedes sale varias veces, y `sede_nombre` distingue cuál es cuál. `?aseguradora_id=` deja solo los que tienen convenio VIVO con esa compañía (es lo que usa «Red convenio»); sin él, el catálogo entero. Declarado ANTES de `/{id}` para que «mapa» no se lea como identificador |
| POST | `/shared/prestadores` | Alta: tipo, nombre, documento (tipo + número, obligatorio y único entre vivos), registro sanitario o profesional según el subtipo, especialidad, estado, provincia, ciudad, dirección, **`latitud` y `longitud` (obligatorias)**, `contactos` y `sedes` (listas completas; vacías son válidas). El código interno lo genera la base. **Sin `aseguradoras`**: la red se marca después, sobre la ficha ya creada, con `PUT /shared/prestadores/{id}/convenios` |
| PATCH | `/shared/prestadores/{id}` | Edición parcial. La coherencia de ciudad↔provincia se valida sobre el **estado resultante**, no sobre los campos sueltos. `contactos` y `sedes` se reconcilian como listas completas; omitirlas las deja intactas. Las coordenadas se pueden mover pero no vaciar. **`aseguradoras` ya no se acepta aquí** (sep 2026): la red tiene su propio endpoint en los dos lados |
| DELETE | `/shared/prestadores/{id}` | **Soft delete**: fija `deleted_at`/`deleted_by`. Jamás DELETE físico |
| POST | `/shared/prestadores/{id}/logo` | `multipart/form-data`. Controles A08 completos, §8 |
| GET | `/shared/prestadores/{id}/logo` | Sirve el archivo tras autorizar |

Errores de negocio propios: `409` si el RUC ya existe entre prestadores vivos; `422` si el RUC no tiene 13 dígitos, si el tipo no está en el catálogo, o si la ciudad no pertenece a la provincia elegida.

**Sedes.** Tener sedes es opcional; la sede que se manda va entera —nombre, provincia, ciudad, dirección y coordenadas—. Se reconcilian como lista completa: las que traen `id` se actualizan, las que no lo traen se crean, y las ausentes se borran lógicamente. `422` si dos sedes comparten nombre, si la ciudad de una sede no pertenece a su provincia, o si un `id` no es de ese prestador.

**Aseguradoras (convenios).** La lista `aseguradoras` del detalle del prestador es de **solo lectura**: cada elemento es una fila de `aseguradora_prestador`, el **convenio** bajo el que ese prestador pertenece a la red de esa compañía, con `codigo_convenio`, `fecha_inicio`, `fecha_fin`, `estado` y `observaciones`. **El `POST` y el `PATCH` del prestador ya no la aceptan**: la red se marca con `PUT /shared/prestadores/{id}/convenios`, que es el espejo del de la aseguradora. Un segundo camino de escritura a la misma tabla, con otra semántica, era una trampa esperando: la lista de vínculos reconciliaba por `id` y la de marcar reconcilia por contraparte.

**Hoy ninguna pantalla manda este campo.** La red se arma desde la compañía —pestaña «Convenios» de la aseguradora, `PUT /{id}/convenios`— y el formulario del prestador lo envía siempre como `undefined`, que es «no lo toques». El campo sigue en el esquema del API porque describe la misma tabla y es el camino natural si algún día hace falta capturar el convenio desde el otro lado; mientras tanto, **el sitio con el que contar es el de la aseguradora**.

Se reconcilia como lista completa, igual que contactos y sedes, y con las bajas volcadas antes que las altas. `422` si la misma aseguradora aparece dos veces, si alguna ya no existe, si la fecha de fin es anterior a la de inicio, o si un `id` no es de ese prestador. Cambiar la aseguradora de un convenio existente también da `422`: eso no es editar, es otro convenio, y reescribirlo borraría el anclaje histórico que los módulos van a necesitar. Desvincular es baja lógica: la fila queda con `deleted_at` y el índice único parcial permite volver a vincular más adelante.

**El correo no distingue mayúsculas.** `users.email` y los correos de contactos y sedes son `citext`, así que `ASOTO@X.COM` y `asoto@x.com` son la misma dirección: se guardan en mayúsculas —son dato del expediente— y el login, la comprobación de duplicados y el índice único siguen funcionando escriba quien escriba como escriba.

**Coordenadas.** `latitud` y `longitud` son obligatorias en aseguradoras, prestadores y cada sede. Se validan dos veces con el mismo rango: Pydantic (`app/shared/geo.py`, `numeric(9,6)` con `max_digits`/`decimal_places`) para dar un error legible, y CHECK en la base para que ninguna vía las esquive. Salen del API como número, no como cadena.

**`409` de integridad.** Un último manejador traduce cualquier `IntegrityError` que se escape —por ejemplo intercambiar en un solo guardado los nombres de dos sedes, que el índice único comprueba fila a fila— a `409` con un mensaje genérico. **Nunca se devuelve el texto del error de Postgres**: lleva nombres de tablas, columnas y valores.

**Valores del convenio (Factor de Cobertura).** Cuelgan del prestador y no de una
ruta suelta, para que el convenio se compruebe siempre contra **su** prestador: el
identificador de un convenio ajeno devuelve `404` en lugar de abrir los valores de
otra compañía.

| Método | Path | Descripción |
|---|---|---|
| GET | `/shared/prestadores/{id}/convenios` | **Espejo** de `/shared/aseguradoras/{id}/convenios`: TODAS las compañías vivas, marcando con cuáles tiene convenio vivo ESTE prestador, con su red, su `convenio_id` y el nombre de su listado de precios. La ficha propia de Accumedical queda fuera, como en todo listado de compañías |
| PUT | `/shared/prestadores/{id}/convenios` | Reconcilia la red del prestador (`{"aseguradoras": [{aseguradora_id, red_privada, red_publica}]}`), con la misma semántica y los mismos rechazos que el lado de la aseguradora. **El convenio con la ficha propia de Accumedical no se toca**: no se ofrece en esta lista, así que su ausencia no puede leerse como «desmárcalo» |
| GET | `/shared/prestadores/{id}/convenios/{convenio_id}/valores` | Lo pactado, **concepto a concepto**: `{concepto, nombre, modo, valor, base, importe, pactado}`. Vienen los NUEVE conceptos del convenio aunque no se haya guardado ninguno —con el modo con el que nacerían y `pactado: false`—, así que la pantalla no mantiene el catálogo ni los valores iniciales. `importe` va **calculado** (`valor de la base × porcentaje ÷ 100`) y solo lo tienen los porcentajes cuya base ya tiene cifra. Es lo que consume la sección «Valor FC» del detalle del convenio |
| PUT | `/shared/prestadores/{id}/convenios/{convenio_id}/valores` | Los guarda: `{"conceptos": [{concepto, modo, valor, base}]}`. `PUT` y no `PATCH`: se manda el juego completo, que es como se pacta, y el concepto que no llega deja de estar pactado. Rechaza con `422` y mensaje que NOMBRA el concepto: modo que no existe, porcentaje fuera de 0-100, porcentaje sin base, base igual al propio concepto, base que no está en el envío, concepto repetido, y **la cadena** —un porcentaje cuya base es a su vez un porcentaje—, que es la única regla que la base no puede comprobar porque mira otra fila |

`422` si un porcentaje se sale de 0-100, si un importe es negativo, o si se marca
«usar valor fijo» para la UCI sin indicar cuál —quedaría sin forma de liquidarse,
ni por fijo ni por puntos—.

### Usuarios de plataforma — API en `/shared/usuarios`, UI en la sección «Usuarios» del admin

El personal del propio administrador: supervisores, médicos auditores. Sin
aseguradora (`aseguradora_id NULL`) y sin contacto del que salir, así que la
identidad se teclea completa: obligatorios **nombre principal, apellido paterno
y correo** (el nombre secundario y el apellido materno son opcionales; ver
§2.1b de `01-esquema-bd.md`). El documento y el teléfono pasan por las mismas
comprobaciones que en contactos y pacientes —dígito verificador de cédula y RUC
incluido, §2.1c—: hasta sep 2026 aquí solo se validaba que el **tipo**
existiera, así que un auditor podía quedar con una cédula inventada;
opcionales el tipo y número de identificación —que van juntos o no van—, el
celular y la **ubicación** (provincia y ciudad en cascada, validadas como
pareja): con ella, al derivar un caso de Concurrencia el supervisor ve primero
a los auditores más cercanos al destino. Router protegido entero con
`require_coordinacion`: entra el administrador global y **el coordinador de una
familia**, acotado a los auditores de la suya — el detalle, arriba, en «El
coordinador de familia y su equipo».

**Un rol por persona** (desde `f5a8d3c6b924`), no uno por módulo:

| Rol | Alcance | Cuántos |
|---|---|---|
| **Coordinador** | Una **familia entera**: toda Suscripción o todo Siniestro. Los módulos que abarca se **calculan** de `modules.grupo`, así que un módulo nuevo en la familia lo cubre sin reeditar a nadie | **Uno por familia** |
| **Auditor** | Los módulos que se le marquen, uno a uno | Los que hagan falta |
| **Convenio** | Transversal, sin módulos ni familia. Lleva la red de prestadores: Prestadores y Red convenio completos, y de las aseguradoras **solo su pestaña Convenios** (`d6b3f9c8e214`) | **Uno solo** |
| **Contabilidad** | Transversal también. Hoy, **solo Aseguradoras**: las da de alta y gestiona su ficha entera **menos los convenios**. Facturación y lo demás llegarán sobre esta misma función | **Uno solo** |

Las dos últimas son **funciones**, no roles de módulo: viven en `user_funcion` y
su alcance está arriba, en «Las funciones transversales».

El cuerpo lo refleja: `{"acceso": {"rol": "coordinador", "grupo": "siniestro"}}`
o `{"acceso": {"rol": "auditor", "modulos": ["concurrencia", …]}}`. Mezclar los
dos —familia y módulos a la vez, o ninguno— es `422`.

«Coordinador» es el **nombre visible**; el `code` del rol sigue siendo
`supervisor` en la base, congelado como el de los módulos renombrados: cambiar
una etiqueta no puede cambiar lo que autoriza. El mismo término se usa para el
coordinador de una aseguradora, que **sigue siendo por módulo**.

El «uno por familia» lo garantiza la **base** con un índice único parcial sobre
las filas vivas de `user_grupo_access`; el servicio lo comprueba antes solo para
poder decir en el `409` **quién** ocupa el puesto. Desactivar a un coordinador
libera su familia sin tocar su fila; **reactivarlo se vuelve a validar**, porque
otro pudo tomarla mientras tanto.

| Método | Path | Descripción |
|---|---|---|
| GET | `/shared/usuarios` | El personal de plataforma con sus accesos, si ya fijó contraseña y si tiene invitación viva. El superadmin no se lista: no se administra a sí mismo. **A un coordinador se le acota a los auditores de su familia** |
| GET | `/shared/usuarios/{id}` | Detalle de uno. Fuera del alcance de quien pregunta, **404**: no se confirma ni que exista |
| POST | `/shared/usuarios` | Alta con identidad + `acceso` (`{rol, grupo}` o `{rol, modulos}`). Manda la invitación por correo **después** del commit. Un coordinador solo puede mandar `{rol: "auditor"}` con módulos de su familia; cualquier otra cosa, `403` |
| PATCH | `/shared/usuarios/{id}` | Cambia identidad, `acceso` y/o `is_active`. Cambiar de rol revoca lo del otro camino: un coordinador que pasa a auditor pierde su familia, y al revés. Desactivar **revoca todas sus sesiones vivas**. El documento —coherencia tipo/número, formato y dígito verificador— se valida sobre el estado **resultante**, no sobre el payload |
| POST | `/shared/usuarios/{id}/invitacion` | Reenvía la invitación e invalida la anterior; `409` si está desactivado |

La contraseña no la teclea nadie: el flujo de invitación es el mismo de los
usuarios de aseguradora (token de un solo uso, 72 h, `/definir-password`).

**Pendiente de diseño:** qué ve este personal *dentro* de un módulo. La bandeja
de Concurrencia se acota por la aseguradora del usuario, y un auditor de
plataforma no tiene ninguna: hoy entra al módulo y sus consultas responden `403`.

### Configuración de plataforma — API en `/shared/configuracion`, UI en «Configuración» del admin

Solo administrador global (dependencia a nivel de router). Hoy gestiona la
**firma electrónica de los informes**:

| Método | Ruta | Qué hace |
|---|---|---|
| GET | `/shared/configuracion/firma` | El estado: si hay firma, de dónde salió (`entorno` \| `panel`) y el titular del certificado. **La contraseña jamás sale del servidor** |
| POST | `/shared/configuracion/firma` | Sube el `.p12` con su contraseña (multipart; el campo del formulario es `type=password`: no se ve al teclear). La validación ES abrir el certificado en memoria: contraseña equivocada o archivo inválido → `422` y no se guarda nada. Al guardar, el `.p12` va al volumen de subidas y la contraseña queda **cifrada** (Fernet, llave derivada del `SECRET_KEY` con HKDF — `core/security/cifrado.py`): robarse el volumen no basta sin el entorno. Audita `firma_configurada` con titular y tamaño, jamás la contraseña. `409` si la firma está fijada por `FIRMA_P12_PATH` del entorno, que siempre manda |

El firmador de Concurrencia resuelve el certificado en ese orden (entorno →
panel) y lo cachea por huella del archivo (ruta, mtime, tamaño): reemplazarlo
desde el panel surte efecto en el siguiente PDF, también con varios workers.

### Usuarios de aseguradora — API en `/shared/aseguradoras/{id}`, UI en su pestaña «Usuarios»

Un usuario de aseguradora sale de **uno de sus contactos** y solo accede a los
**requerimientos que esa aseguradora tiene contratados**. Ambas cosas las comprueba
el servidor contra la base en cada llamada, nunca contra lo que mande el navegador.

| Método | Path | Descripción |
|---|---|---|
| GET | `/shared/aseguradoras/{id}/requerimientos` | Las hojas contratadas: módulos sin coberturas y coberturas de los que las tienen. Es la única lista sobre la que se puede conceder acceso |
| GET | `/shared/aseguradoras/{id}/usuarios` | Sus usuarios, con sus accesos, si ya fijaron contraseña y si tienen invitación viva |
| POST | `/shared/aseguradoras/{id}/usuarios` | Alta desde un contacto: `contacto_id` + `accesos` (uno por requerimiento, **cada uno con su rol**). Manda la invitación por correo |
| PATCH | `/shared/aseguradoras/{id}/usuarios/{user_id}` | Cambia `accesos` y/o `is_active`. Desactivar **revoca todas sus sesiones vivas** |
| POST | `/shared/aseguradoras/{id}/usuarios/{user_id}/invitacion` | Reenvía la invitación e **invalida la anterior** |

**Un rol por persona** (desde `a7c4e9f2b581`), igual que en el personal propio
pero con otro alcance:

| Rol | Alcance | Cuántos |
|---|---|---|
| **Coordinador** | **Toda la compañía**: los módulos que ella tenga contratados, calculados de `aseguradora_modulos`. Contratar uno se lo da; destildarlo se lo quita, sin tocar su ficha | **Uno por aseguradora** |
| **Operador** | Los requerimientos que se le marquen, de los contratados | Los que hagan falta |

El cuerpo lo refleja: `{"acceso": {"rol": "coordinador"}}` —sin lista, porque su
alcance no se guarda— o `{"acceso": {"rol": "operador", "accesos": [...]}}`.

Errores propios: `409` si el contacto ya tiene usuario, si el correo ya existe en
la plataforma o si **la compañía ya tiene coordinador** (el mensaje dice quién);
`422` si se marca un requerimiento que la aseguradora no tiene contratado, si se
repite, si al coordinador se le marcan requerimientos, o si un operador se queda
sin ninguno —un usuario sin acceso no podría entrar a nada, y para eso está
desactivarlo—. Quitar de la lista de contactos uno que ya tiene usuario devuelve
`409` con la instrucción de desactivarlo primero.

El «uno por compañía» lo garantiza la **base** con un índice único parcial sobre
las filas vivas de `user_aseguradora_coordinador`. Desactivar al coordinador
libera el puesto; reactivarlo se vuelve a validar.

### Invitación — rutas PÚBLICAS

Las dos únicas rutas sin sesión que se añaden a la allowlist, y por un motivo
estructural: quien abre una invitación **todavía no tiene contraseña**, así que no
puede haber sesión. El token del enlace es la credencial: 256 bits, guardado solo
como SHA-256, de un solo uso y con caducidad (`INVITACION_TTL_HORAS`, 72 por
defecto). Van con el mismo límite por IP que el login.

| Método | Path | Descripción |
|---|---|---|
| GET | `/auth/invitacion?token=` | Valida el enlace y devuelve **solo** `nombre_completo` y correo, para saludar. Ni la aseguradora ni los accesos: es público |
| POST | `/auth/definir-password` | Fija la contraseña, consume la invitación y **revoca las sesiones previas**. No abre sesión: se entra por el login como todo el mundo |

Cualquier fallo del enlace —inexistente, caducado, ya usado, o de un usuario
desactivado— responde **idéntico**: quien prueba enlaces al azar no aprende nada
de la diferencia.

### Administración — router con `require_global_admin`

| Método | Path | Descripción |
|---|---|---|
| GET | `/admin/modulos` | Catálogo completo de módulos **con sus roles disponibles**. Alimenta la pantalla de asignación |
| GET | `/admin/usuarios` | `?search=&activo=` + paginación |
| POST | `/admin/usuarios` | Alta. Contraseña ≥ 12 caracteres validada por Pydantic |
| GET | `/admin/usuarios/{id}` | Detalle + sus accesos a módulos |
| PATCH | `/admin/usuarios/{id}` | Edición; `activo=false` **revoca todas sus sesiones vivas** |
| POST | `/admin/usuarios/{id}/reset-password` | Fija contraseña nueva y revoca sesiones (`password_change`) |
| GET | `/admin/usuarios/{id}/module-access` | Filas de `user_module_access` del usuario |
| POST | `/admin/usuarios/{id}/module-access` | Body `{"module_code": "...", "rol_codigo": "..."}`. Resuelve `role_id` vía `roles(module_code, code)`; `422` si el par no existe. Crea o reactiva |
| DELETE | `/admin/usuarios/{id}/module-access/{module_code}` | Revoca (`activo=false`, `revoked_at`, `revoked_by`). Efecto inmediato por §6.2; si era el módulo activo de una sesión viva, se limpia |

El body de asignación lleva **`rol_codigo`**, no un `role_id` crudo ni un string libre: el servicio lo resuelve contra el catálogo y la FK compuesta de la DB garantiza que el rol pertenece a ese módulo.

### Módulos esqueleto

Cada uno es un `APIRouter` con `require_module_access("<slug>")` a nivel de router y `require_permission("dashboard:ver")` en el endpoint.

| Método | Path | Paquete Python |
|---|---|---|
| GET | `/suscripcion/status` | `app/modules/suscripcion/` (módulo retirado: responde 403 al no estar activo) |
| GET | `/calificacion/status` | `app/modules/calificacion/` (ídem) |
| GET | `/concurrencia/status` | `app/modules/concurrencia/` |
| GET | `/central-credito/status` | `app/modules/carta_credito/` (slug renombrado en `e5b9d7c3a248`, `a3c7e9b5d162` y `b6c9d4f8a527`; el paquete conserva el code) |

Respuesta: `{"modulo": "<code>", "nombre": "<nombre>", "rol": "<rol del usuario>"}`. Cero lógica de negocio.

---

## 8. Subida de archivos — el logo y el comprobante (A08)

El logo es un campo del CRUD que exige la especificación, así que se implementa completo, no se difiere. El **comprobante de reprogramación** de Concurrencia (`POST /concurrencia/supervision/visitas/{id}/comprobante`, ver `docs/modulos/concurrencia.md`) sigue exactamente el mismo patrón:

1. `multipart/form-data`, un solo archivo, tamaño máximo `UPLOAD_MAX_SIZE_MB` (5), rechazado **antes** de leerlo entero (`Content-Length` + lectura por chunks con corte).
2. **Tipo MIME real con `python-magic`** sobre los primeros bytes, no por extensión ni por el `Content-Type` del cliente. Allowlist: `image/png`, `image/jpeg`, `image/webp`. Cualquier otra cosa → `422`.
3. Renombrado a `<dueño>/<uuid>.<ext canónica del MIME detectado>` —`aseguradoras/…` o `prestadores/…`—; el nombre original del cliente se descarta por completo (puede llevar payloads o traversal).
4. Almacenado en `UPLOAD_DIR=/srv/uploads`, **fuera del árbol de código** y fuera de la imagen, en un volumen montado `ro` en nginx.
5. Servido **solo** por endpoints autenticados que autorizan antes de entregar nada, fijan el `Content-Type` desde el servidor y añaden `X-Content-Type-Options: nosniff`, de modo que el navegador nunca decide por su cuenta qué es el archivo. El de aseguradoras tiene dos rutas con autorizaciones distintas —el admin por id, y `GET /auth/mi-aseguradora/logo` para que cada usuario cargue el de su propia compañía—; la entrega común vive una sola vez en `shared/aseguradoras/logo.py`, sin la autorización, que es de cada ruta.

   **Desviación consciente:** hoy el archivo se transfiere desde la propia aplicación (`FileResponse`) y no con `X-Accel-Redirect` hacia una `location internal` de nginx. La propiedad de seguridad que importa —que el permiso lo decida siempre el backend— se cumple igual; lo que se pierde es que nginx haga la transferencia en lugar del proceso Python, que es una cuestión de rendimiento. El cambio entra con el endurecimiento de producción del hito 9, junto con la `location internal`.
6. Evento `logo_subido` en `audit_log`.

**Correo saliente: la única conexión que inicia el servidor.** El envío de invitaciones abre una conexión SMTP contra el host de `SMTP_HOST`, que es **configuración del despliegue y no una URL suministrada por el usuario**, así que A10 no aplica: no hay ninguna entrada del usuario que pueda redirigir esa conexión. El detalle operativo está en `docs/02 §5.2`.

**A10 (SSRF): prohibido el logo por URL.** La iteración 1 **no realiza ningún fetch de URLs suministradas por el usuario** desde el servidor; queda declarado explícitamente. El día que haga falta, la única vía autorizada será un helper `is_allowed_url()` con allowlist de host y esquema, aplicado antes de cualquier petición saliente.

---

## 9. Flujo del frontend

**Fuente de verdad: siempre el backend.** Zustand guarda solo estado de UI (sidebar plegado, drawer abierto); jamás decide autorización.

- **Rutas públicas del router**: `/login` y `/definir-password`. Esta última es la que abre el enlace de la invitación y **queda fuera de `RequireSession`** por la misma razón que su endpoint está en la allowlist: quien llega no tiene contraseña todavía. Al terminar navega a `/login`; no abre sesión por su cuenta.
- **Guard de sesión** (`core/auth/RequireSession.tsx`): envuelve todas las rutas privadas y ejecuta `useQuery(['me'], …)` con `refetchOnWindowFocus`. Cargando → skeleton; `401` → `<Navigate to="/login" state={{from}} />`. Ningún flag local sustituye esta consulta.
- **Guard de módulo** (`core/auth/RequireModule.tsx`): comprueba el slug de la RUTA contra la lista `modulos` de `/me`, únicamente para no pintar una pantalla a la que no se puede entrar. La autorización real la ejerce el backend en cada request. Un slug sin permiso y uno inexistente llevan **al mismo sitio** —el selector—, así que la interfaz tampoco delata qué módulos existen.
- **Selector de módulo** (`/seleccionar-modulo`): tarjetas con icono, nombre, color de acento y rol, en el orden que fija `modules.orden`. Solo lo ve quien tiene dos o más: con uno, `calcular_redireccion` lleva directo a su módulo, y el administrador global va a `/admin`.
- **Sin accesos** (`/sin-accesos`): sesión válida y cero módulos. No dice qué módulos existen ni por qué no entra.
- **Manejo del 403 — sin conflación.** Un `403` puede significar dos cosas distintas y el backend, por diseño, no las distingue. El interceptor de respuesta **refetchea `/me`** (fuente de verdad, sin filtrar nada nuevo) y decide:
  - el módulo sigue en la lista → toast "Acción no autorizada", el usuario permanece donde está (caso: le falta un permiso concreto);
  - el módulo desapareció → expulsión a `/seleccionar-modulo` con toast genérico (caso: acceso revocado).

  Sin esto, un usuario sin `aseguradoras:eliminar` que pulsa un botón acabaría expulsado del módulo entero. Un `401` en cualquier ruta limpia la caché de queries y navega a `/login`.
- **Último módulo usado**: campo `users.last_module_code` en **DB**, actualizado por `POST /auth/modulo-activo`. El frontend no lo persiste; el backend lo usa para calcular `redireccion`.
- **Selector del topbar**: renderiza `modulos` de `/me`; al elegir otro llama `POST /auth/modulo-activo` (misma sesión, **sin reautenticación**), invalida `['me']`, resetea la caché del módulo anterior y navega a `/{slug}`.
- **Arranque en `/`**: el router raíz consulta `/me` y aplica la `redireccion` resuelta por el backend, incluido `/sin-accesos`.

---

## 10. Parámetros consolidados

| Parámetro | Valor iteración 1 |
|---|---|
| `SESSION_IDLE_TTL_MIN` | 30 |
| `SESSION_ABSOLUTE_TTL_MIN` | 720 (12 h) |
| `SESSION_ACTIVITY_THROTTLE_SEC` | 60 |
| `SESSION_PURGE_AFTER_DAYS` | 30 |
| `LOGIN_MAX_FAILED_ATTEMPTS` / `LOGIN_LOCKOUT_MIN` | 5 / 15 |
| `LOGIN_RATE_LIMIT_IP` (slowapi) | `5/minute` |
| nginx `limit_req` en login | `10r/m`, `burst=5` |
| Contraseña mínima | 12 caracteres (validado en Pydantic, en alta y en reset) |
| Hash de contraseña | argon2id (`argon2-cffi`), parámetros por defecto de `PasswordHasher` |
| `mfa_secret` | columna presente y cifrada con `MFA_ENCRYPTION_KEY`; sin uso funcional en iteración 1 |
</content>
