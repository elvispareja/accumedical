# Esquema de base de datos — PostgreSQL 16

Plataforma modular de seguros de salud · Núcleo compartido + 4 módulos (escalable a 8 sin tocar la estructura) · Iteración 1

Este documento es **normativo y autoritativo**: ante cualquier discrepancia con otro documento, manda este. Define todas las tablas de la migración Alembic inicial, las decisiones transversales, el contrato para las tablas de módulos futuros y los seeds.

---

## 1. Decisiones transversales

### 1.1 Claves primarias

| Tipo de tabla | PK | Tablas |
|---|---|---|
| Entidades de negocio expuestas por la API | `uuid` (UUIDv7 generado en la app) | `users`, `sessions`, `roles`, `permissions`, `user_module_access`, `aseguradoras`, `prestadores`, `aseguradora_prestador` |
| Catálogos con código oficial/estable | clave natural (`varchar`/`char`) | `modules`, `tipos_documento`, `provincias`, `tipos_prestador` |
| Append-only de alto volumen, nunca recurso REST | `bigint GENERATED ALWAYS AS IDENTITY` | `audit_log` |

**Justificación:**

- **UUID en recursos de API** elimina la enumeración de IDs (`/aseguradoras/1`, `/2`…), que es fuga de información y superficie de IDOR (A01/A04), y permite generar el ID antes del INSERT — necesario para renombrar archivos subidos con UUID (A08).
- **UUIDv7, no v4**: v4 aleatorio destroza la localidad del índice B-tree (páginas frías, amplificación de WAL). UUIDv7 es monotónico por timestamp y se inserta como un bigint. PostgreSQL 16 no trae `uuidv7()` nativo (llega en PG18), así que se genera en Python como default de SQLAlchemy, con `DEFAULT gen_random_uuid()` en DB como red de seguridad para inserts manuales. **Implementado a mano en `app/core/ids.py`** (unas quince líneas siguiendo la RFC 9562, con contador de secuencia intra-milisegundo) en lugar de añadir la dependencia `uuid-utils`: es una extensión compilada en Rust y no compensa arrastrar un wheel binario por una función de este tamaño.
- **Clave natural en catálogos**: el código de módulo, el código INEC de provincia o el tipo de documento *son* la identidad real del dato, son inmutables por diseño y hacen legibles FKs, logs y exports sin JOIN. La regla única "catálogo ⇒ código natural" es más simple que mantener surrogate + código por catálogo.
- **`audit_log` con `bigint`**: crecimiento ilimitado donde importan el tamaño del índice y la inserción secuencial; jamás se expone su ID como recurso.

### 1.2 Convención de nombres

Tablas técnicas del núcleo en inglés, coincidiendo con los modelos que exige la especificación (`User`, `Session`, `AuditLog`…): `users`, `roles`, `permissions`, `role_permissions`, `user_module_access`, `sessions`, `modules`, `audit_log`. Tablas de dominio y catálogos en español: `aseguradoras`, `prestadores`, `aseguradora_prestador`, `tipos_documento`, `tipos_prestador`, `provincias`. Todo snake_case, plural.

**Frontera idioma columna ↔ JSON.** Las columnas técnicas van en inglés; el JSON de la API va en español porque la UI es en español. El mapeo es explícito y está congelado aquí:

| Columna | Campo JSON de la API |
|---|---|
| `users.is_superadmin` | `es_admin_global` |
| `users.is_active` | `activo` |
| `users.last_module_code` | `ultimo_modulo_usado` |
| `sessions.active_module_code` | `modulo_activo` |
| `user_module_access.activo` | `activo` |

### 1.3 Timestamps

Siempre `timestamptz`, nunca `timestamp`: la app corre en UTC dentro de Docker y los clientes están en `America/Guayaquil`. `created_at`/`updated_at NOT NULL DEFAULT now()`; `updated_at` lo mantiene SQLAlchemy (`onupdate`), sin triggers, para que toda la lógica sea visible en el código y en Alembic.

### 1.4 Mixin de auditoría de fila + soft delete (patrón uniforme)

Toda tabla de **negocio** (núcleo y módulos futuros) lleva exactamente:

```sql
created_at  timestamptz NOT NULL DEFAULT now(),
updated_at  timestamptz NOT NULL DEFAULT now(),
created_by  uuid NULL REFERENCES users (id) ON DELETE RESTRICT,  -- NULL solo en bootstrap/seed
updated_by  uuid NULL REFERENCES users (id) ON DELETE RESTRICT,
deleted_at  timestamptz NULL,                                    -- NULL = fila viva
deleted_by  uuid NULL REFERENCES users (id) ON DELETE RESTRICT
```

**Reglas del patrón:**

- Fila activa ⇔ `deleted_at IS NULL`. Un timestamp en vez de un boolean conserva *cuándo* se borró y `deleted_by` quién; no existe `is_deleted`.
- **Toda unicidad de negocio se implementa como índice único parcial `WHERE deleted_at IS NULL`.** Si no, un RUC soft-borrado bloquearía para siempre el re-registro de esa aseguradora. Es la consecuencia no obvia más importante del patrón.
- **`deleted_at` (borrado lógico) y `estado` (dato de negocio) son cosas distintas y no se tocan entre sí.** Ver §5.1. En `aseguradoras`, además, solo se usa `estado`: esa tabla no se elimina por ninguna vía.
- `created_by`/`updated_by` dan trazabilidad a nivel de fila (quién la dejó como está); `audit_log` da la película completa (qué cambió, cuándo, desde qué IP). Complementarios.
- **Excepciones deliberadas**: `audit_log` (append-only), `sessions` (la revocación es `revoked_at`), `role_permissions` (tabla puente de configuración), `user_module_access` (revocación = `activo=false` + `revoked_at`, reactivable), `roles` (configuración: usa `activo`), catálogos (usan `activo`).
- **Todas las FK son `ON DELETE RESTRICT`** salvo dos excepciones justificadas caso a caso (`users.last_module_code` y `sessions.rotated_from_id`). Como no existe DELETE físico de entidades de negocio, RESTRICT convierte cualquier DELETE accidental en un error en vez de una cascada silenciosa.
- En SQLAlchemy: `AuditMixin` + `SoftDeleteMixin`; los repositorios del núcleo filtran `deleted_at IS NULL` por defecto.

### 1.5 Naming convention de constraints e índices

Definida en `MetaData` para que `alembic autogenerate` produzca nombres deterministas:

```python
NAMING_CONVENTION = {
    "ix": "ix_%(table_name)s_%(column_0_N_name)s",
    "uq": "uq_%(table_name)s_%(column_0_N_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}
metadata = MetaData(naming_convention=NAMING_CONVENTION)
```

Los índices únicos **parciales** no pueden ser `UniqueConstraint` en SQLAlchemy; se declaran como `Index("uq_<tabla>_<cols>", ..., unique=True, postgresql_where=...)`. Los `CheckConstraint` siempre con `name=` explícito. **Objetivo verificable en CI:** el primer `alembic revision --autogenerate` tras la migración inicial produce un diff vacío.

### 1.6 Extensiones (al inicio de la migración)

```sql
CREATE EXTENSION IF NOT EXISTS citext;    -- emails case-insensitive sin lower() en cada query
CREATE EXTENSION IF NOT EXISTS pg_trgm;   -- búsqueda ILIKE '%...%' server-side indexada
```

`gen_random_uuid()` es nativa en PG16; no se necesita pgcrypto.

### 1.7 Aislamiento de módulos: prefijo de tabla, no schemas de Postgres

Los módulos futuros crean sus tablas en `public` con prefijo: `susc_`, `calif_`, `conc_`, `cc_`. Se descartan los schemas de Postgres por módulo: complican Alembic autogenerate (`include_schemas`, `search_path`) y no aportan ninguna garantía que las FKs y el contrato de §8 no den ya. **En la iteración 1 los módulos son esqueleto sin tablas: la migración inicial solo crea el núcleo.**

---

## 2. Vista general de dependencias

```
tipos_documento   provincias ──► ciudades   tipos_prestador      modules
        │             │             │             │             │  │  │
        └─────────┬───┴─────────────┴─────────────┘      ┌──────┘  │  └──────────┐
                  ▼                                      ▼         ▼             ▼
             prestadores ◄── prestador_contactos       roles     users ────► sessions
                  ▲     ◄── prestador_sedes
                  │                                      │         │
                  ▼                                      ▼         ▼
        aseguradora_prestador                  role_permissions  user_module_access
                  ▲                                      ▲
                  │                                      │
            aseguradoras                           permissions      audit_log (FK solo a users)
                  ▲
                  ├── aseguradora_modulos ◄── aseguradora_coberturas
                  └── aseguradora_contactos

módulos futuros (susc_*, calif_*, conc_*, cc_*) ──► referencian SOLO al núcleo
```

Las flechas apuntan del que referencia al referenciado: **el núcleo nunca conoce a los módulos.**

### 2.1b Cómo se llama una persona (`e9f4c7b2d651`)

Toda persona de la plataforma —usuario, contacto de aseguradora, contacto de
prestador y paciente del caso— lleva el nombre en **cuatro columnas**, con los
mismos nombres en las cuatro tablas (en `conc_visitas`, con prefijo
`paciente_`):

| Columna | Obligatoria |
|---|---|
| `nombre_principal` | **Sí** |
| `nombre_secundario` | No (`NULL` si no tiene) |
| `apellido_paterno` | **Sí** |
| `apellido_materno` | No (`NULL` si no tiene) |

- **Solo letras** (con tildes y eñes) y espacios: ni números ni símbolos. La
  regla se aplica con Pydantic en el servidor y se filtra al teclear en el
  cliente. **No hay CHECK en la base** a propósito: había filas vivas con
  apellidos como «S.A.» de pruebas, y un CHECK las habría vuelto ilegales de
  golpe; el servidor las rechaza en cuanto alguien las edita, que es donde debe
  doler.
- **El orden de lectura se decide en un solo sitio**: `app/shared/personas.py`.
  `completo()` lo compone en Python y `sql_completo()` en Postgres (con
  `concat_ws`, que ignora los nulos) para ordenar y buscar. Nombres primero,
  apellidos después: «SHIRLEY MARIA PAREJA VEGA». Ninguna pantalla recompone el
  nombre por su cuenta.
- **Las salidas de la API distinguen enseñar de editar**: los resúmenes y
  listados llevan `nombre_completo` ya compuesto; los detalles que reabren un
  formulario llevan además las cuatro partes por separado.

### 2.1c Identificación y teléfono

El catálogo `tipos_documento` guarda la **forma** de cada documento
(`regex_validacion`), y `app/shared/identificacion.py` guarda lo que un regex no
puede calcular: el **dígito verificador** ecuatoriano. Las dos cosas se aplican
en el mismo sitio, `contactos.validar_documento()`, que usan **contactos de
aseguradora y de prestador, el paciente del caso y el personal de plataforma**.

| Documento | Qué se comprueba |
|---|---|
| **Cédula** | 10 dígitos · provincia real (01–24, o 30 para quien se cedula fuera) · tercer dígito < 6 (del 6 en adelante ya es una sociedad) · dígito verificador módulo 10 |
| **RUC** | 13 dígitos · provincia real · según el tercer dígito: **0–5** persona natural (lleva su cédula dentro), **6** sociedad pública (verifica en la 9.ª posición, establecimiento de 4 dígitos), **9** sociedad privada (verifica en la 10.ª, establecimiento de 3); el establecimiento nunca es cero. 7 y 8 no los emite nadie |
| **Pasaporte** | Letras y números, de 6 a 15. **Sin verificador**: es documento extranjero, cada país lo numera a su manera y el número impreso no lleva checksum (los dígitos de control viven en la banda MRZ, que aquí nadie teclea) |
| **Teléfono** | Solo dígitos y, como mucho, un `+` delante para el código de país; de 7 a 15 dígitos (tope de E.164). Espacios, guiones y paréntesis se **limpian** en vez de rechazarse: nadie debería pelear con un formulario por un guion |

El RUC de `aseguradoras` y `prestadores` pasa por la misma comprobación desde su
validador de Pydantic. En el cliente, `shared/identificacion.ts` repite el
algoritmo para avisar mientras se teclea y filtrar lo que no es dígito; **la
autoridad es el servidor**, como siempre.

**No hay CHECK de verificador en la base**: había filas vivas con documentos de
prueba (un RUC `1790099999001` y una cédula `0912345678`), y un CHECK las habría
vuelto ilegales de golpe. Se rechazan en cuanto alguien las edita.

---

## 3. Núcleo — identidad y acceso

### 3.1 `modules` — catálogo de módulos (única fuente de verdad en runtime)

Descartados el `ENUM` de Postgres (añadir el módulo 5 exigiría DDL, no admite metadata) y `varchar + CHECK` (cada módulo nuevo reescribiría constraints y la metadata visible quedaría hardcodeada en el frontend, violando "el backend es la fuente de verdad"). La tabla catálogo da FK real desde accesos/sesiones/roles, metadata versionada en DB, kill-switch por módulo, y pasar de 4 a 8 módulos = 4 INSERTs.

```sql
CREATE TABLE modules (
    code          varchar(30)  NOT NULL,             -- identidad canónica snake_case: 'carta_credito'
    slug          varchar(30)  NOT NULL,             -- identidad en URL kebab-case: 'autorizacion-credito'
    nombre        varchar(80)  NOT NULL,             -- "Autorización de Crédito" (visible en tarjetas)
    descripcion   varchar(300) NULL,
    icono         varchar(60)  NOT NULL,             -- token de icono lucide-react: 'file-check'
    color_acento  varchar(30)  NOT NULL,             -- token del design system: 'emerald', 'violet'
    orden         smallint     NOT NULL DEFAULT 0,   -- orden de tarjetas en /seleccionar-modulo
    activo        boolean      NOT NULL DEFAULT true,-- kill-switch de módulo completo
    grupo         varchar(20)  NULL,                 -- familia comercial (e5b9d7c3a248): presentación, no autoriza
    -- b6c9d4f8a527: la rama dentro de la familia («siniestros_hospitalarios»…).
    -- Sin CHECK a propósito: solo lo escriben migraciones y cada rama nueva
    -- debe entrar sin ALTER.
    subgrupo      varchar(40)  NULL,
    created_at    timestamptz  NOT NULL DEFAULT now(),
    updated_at    timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT pk_modules PRIMARY KEY (code),
    CONSTRAINT uq_modules_slug UNIQUE (slug),
    CONSTRAINT ck_modules_code_formato CHECK (code ~ '^[a-z][a-z0-9_]{1,29}$'),
    CONSTRAINT ck_modules_slug_formato CHECK (slug ~ '^[a-z][a-z0-9-]{1,29}$'),
    CONSTRAINT ck_modules_grupo_catalogo CHECK (grupo IN ('suscripcion', 'siniestro'))
);
```

**El catálogo vigente (migraciones `e5b9d7c3a248` y `a5b8c3e7f419`, sep 2026).**
Dos familias comerciales en `grupo`: **Suscripción** → `examen_asegurabilidad`
(nombre público «Requisitos de Asegurabilidad», slug `requisitos-asegurabilidad`
desde `a5b8c3e7f419`; cambia la identidad pública, la canónica queda congelada)
y `calificacion_riesgo` (ambos por construir); **Siniestro** → organizado en
ramas (`subgrupo`, desde `b6c9d4f8a527`). La primera rama, **Siniestros
hospitalarios**, lleva en orden: `carta_credito` (nombre público «Central de
Crédito», slug `central-credito`; antes Autorización de Crédito, antes Carta de
Vida — el code jamás cambió), `concurrencia` («Auditoría de Concurrencia», el
único construido), `auditoria_alta` y `auditoria_credito_hospitalario` (nuevos,
sembrados con los cuatro roles de sistema y su permiso de entrada). Las otras
tres ramas (`c7d2e5a9f318` y `d8e3f6b1c429`) llevan una pieza homónima cada
una: **Ambulatorio** → `ambulatorio`, **Auditoría de vida** → `auditoria_vida`
y **Reembolso** → `reembolso` — entraron como filas, sin ALTER, tal como se
prometió al crear `subgrupo`.
Retirados con `activo = false` y filas conservadas: los originales
`suscripcion` y `calificacion`, y desde `a5b8c3e7f419` también
`declaracion_salud` (DST) — el kill-switch hizo exactamente el trabajo para el
que se diseñó.

**Doble identificador — decisión D-01 del plan.** `code` es la identidad canónica: es la PK, el destino de todas las FKs (`user_module_access.module_code`, `roles.module_code`, `permissions.module_code`, `sessions.active_module_code`, `users.last_module_code`), el nombre del paquete Python (`app/modules/carta_credito/`) y el prefijo de sus tablas. `slug` es la identidad pública: la ruta del frontend (`/autorizacion-credito`), el segmento de la API y la carpeta del frontend. El caso que demuestra la separación es `carta_credito`: el negocio lo renombró dos veces —Carta de Vida (`e5b9d7c3a248`) y Autorización de Crédito (`a3c7e9b5d162`)— cambiando el slug ambas veces sin tocar una sola FK ni el paquete Python. Se modelan como dos columnas explícitas en lugar de una traducción implícita `replace('_','-')` precisamente porque una traducción implícita dispersa por el código es donde nacen los bugs de autorización silenciosos: la resolución `slug → code` ocurre en **un solo lugar** (la dependencia que resuelve el módulo de la ruta) y todo lo demás trabaja con `code`.

`icono` y `color_acento` son *tokens*, no SVG ni hex: el frontend los mapea contra su design system.

### 3.2 `users`

```sql
CREATE TABLE users (
    id                    uuid         NOT NULL DEFAULT gen_random_uuid(),
    email                 citext       NOT NULL,
    password_hash         varchar(255) NOT NULL,     -- string PHC de argon2id, nunca otra cosa
    -- e9f4c7b2d651: el nombre va en cuatro partes, igual que en contactos y en
    -- el paciente del caso. Obligatorios los dos primeros. Ver §2.1b.
    nombre_principal      varchar(100) NOT NULL,
    nombre_secundario     varchar(100) NULL,
    apellido_paterno      varchar(100) NOT NULL,
    apellido_materno      varchar(100) NULL,
    is_superadmin         boolean      NOT NULL DEFAULT false,  -- admin global: entra a /admin
    is_active             boolean      NOT NULL DEFAULT true,   -- desactivación administrativa (≠ soft delete)
    -- A07: MFA preparado desde el día 1
    mfa_secret            varchar(255) NULL,         -- secreto TOTP CIFRADO con MFA_ENCRYPTION_KEY (Fernet), jamás en claro
    mfa_enabled           boolean      NOT NULL DEFAULT false,
    -- A04: lockout temporal por cuenta
    failed_login_attempts smallint     NOT NULL DEFAULT 0,
    locked_until          timestamptz  NULL,         -- NULL = no bloqueado
    last_login_at         timestamptz  NULL,
    password_changed_at   timestamptz  NOT NULL DEFAULT now(),
    -- flujo (8): recordar el último módulo usado ENTRE sesiones → vive aquí, no en sessions
    last_module_code      varchar(30)  NULL,
    created_at            timestamptz  NOT NULL DEFAULT now(),
    updated_at            timestamptz  NOT NULL DEFAULT now(),
    created_by            uuid         NULL,          -- NULL solo en bootstrap
    updated_by            uuid         NULL,
    deleted_at            timestamptz  NULL,
    deleted_by            uuid         NULL,
    CONSTRAINT pk_users PRIMARY KEY (id),
    CONSTRAINT fk_users_last_module_code_modules
        FOREIGN KEY (last_module_code) REFERENCES modules (code) ON DELETE SET NULL,
    CONSTRAINT fk_users_created_by_users FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE RESTRICT,
    CONSTRAINT fk_users_updated_by_users FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE RESTRICT,
    CONSTRAINT fk_users_deleted_by_users FOREIGN KEY (deleted_by) REFERENCES users (id) ON DELETE RESTRICT,
    CONSTRAINT ck_users_failed_attempts_rango CHECK (failed_login_attempts BETWEEN 0 AND 100),
    CONSTRAINT ck_users_mfa_coherente CHECK (NOT mfa_enabled OR mfa_secret IS NOT NULL)
);

CREATE UNIQUE INDEX uq_users_email ON users (email) WHERE deleted_at IS NULL;
```

**Notas:**

- `citext`: unicidad case-insensitive garantizada en DB, sin confiar en que todo el código normalice. Unicidad **parcial** por soft delete: permite re-registrar el email de un usuario borrado lógicamente (desactivarlo NO lo libera: sigue ocupando su correo).
- **El alcance es la plataforma entera, no la aseguradora.** Tu personal y los usuarios de todas las compañías comparten el mismo espacio de correos, porque el correo es la credencial de un `/login` único. No confundir con `aseguradora_contactos.email` (§5.2d), cuya unicidad sí es **por aseguradora**: ahí el correo identifica a una persona dentro de una compañía, no a quien entra. Los cinco caminos de alta se verificaron contra la API: crear personal, crear personal con el correo escrito en otro caso, usar el correo de un usuario de aseguradora, dar usuario a un contacto que ya lo tiene, y editar un usuario poniéndole el correo de otro — los cinco responden `409`.
- **Lockout (A04)**: el incremento y la fijación del bloqueo van en **un solo statement** para evitar la carrera de dos requests concurrentes leyendo el mismo contador:
  ```sql
  UPDATE users
     SET failed_login_attempts = failed_login_attempts + 1,
         locked_until = CASE WHEN failed_login_attempts + 1 >= :max
                             THEN now() + :lockout_interval ELSE locked_until END
   WHERE id = :id
  RETURNING failed_login_attempts, locked_until;
  ```
  Condición `>=`, nunca `==`. El login exitoso resetea ambos. `locked_until` se evalúa **solo en el login**, después de la verificación argon2 (ver `03-auth-y-api.md` §2.3).
- `is_active` ≠ `deleted_at`: desactivar un usuario (no puede iniciar sesión, reactivable, visible en admin) es operación administrativa normal y es el único mecanismo que mata **todas** sus sesiones vivas; el soft delete es retiro del registro.
- `is_superadmin` como boolean y no como "rol global": la especificación define roles **por módulo**; un rol sin módulo rompería la FK compuesta de §3.6. El superadmin es una dimensión ortogonal que las dependencias FastAPI comprueban explícitamente.
- `last_module_code ON DELETE SET NULL`: es preferencia de navegación, no dato de negocio. Si el último módulo ya no está entre los accesos activos, el backend cae al selector (nunca redirige a un módulo revocado).

### 3.3 `sessions`

```sql
CREATE TABLE sessions (
    id                 uuid         NOT NULL DEFAULT gen_random_uuid(),
    user_id            uuid         NOT NULL,
    token_hash         char(64)     NOT NULL,      -- hex de SHA-256 del token opaco; el token JAMÁS se persiste
    csrf_token_hash    char(64)     NOT NULL,      -- hex de SHA-256 del token CSRF de la sesión (A08)
    active_module_code varchar(30)  NULL,          -- módulo activo del flujo; NULL hasta elegir
    ip                 inet         NOT NULL,
    user_agent         varchar(400) NOT NULL DEFAULT '',
    created_at         timestamptz  NOT NULL DEFAULT now(),
    last_activity_at   timestamptz  NOT NULL DEFAULT now(),  -- base de la expiración por inactividad
    expires_at         timestamptz  NOT NULL,                -- expiración ABSOLUTA (12 h); jamás se extiende
    revoked_at         timestamptz  NULL,                    -- revocación inmediata
    revoke_reason      varchar(30)  NULL,
    rotated_from_id    uuid         NULL,                    -- cadena de rotación (A07)
    CONSTRAINT pk_sessions PRIMARY KEY (id),
    CONSTRAINT fk_sessions_user_id_users
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT,
    CONSTRAINT fk_sessions_active_module_code_modules
        FOREIGN KEY (active_module_code) REFERENCES modules (code) ON DELETE RESTRICT,
    CONSTRAINT fk_sessions_rotated_from_id_sessions
        FOREIGN KEY (rotated_from_id) REFERENCES sessions (id) ON DELETE SET NULL,
    CONSTRAINT uq_sessions_token_hash UNIQUE (token_hash),
    CONSTRAINT ck_sessions_expira_despues_de_crear CHECK (expires_at > created_at),
    CONSTRAINT ck_sessions_revoke_reason CHECK (revoke_reason IS NULL OR revoke_reason IN
        ('logout', 'rotation', 'admin', 'password_change', 'expiration', 'user_deactivated'))
);

CREATE INDEX ix_sessions_user_id    ON sessions (user_id) WHERE revoked_at IS NULL;
CREATE INDEX ix_sessions_expires_at ON sessions (expires_at);   -- barrido de purga
```

**Notas:**

- **Token opaco hasheado**: la cookie lleva `secrets.token_urlsafe(32)` (256 bits); la DB guarda solo su SHA-256. Un volcado de la tabla no permite fabricar sesiones válidas. SHA-256 (no argon2) es lo correcto aquí: el token ya tiene entropía plena y el lookup por request debe ser O(índice), no 100 ms de KDF. Como beneficio adicional, buscar por hash elimina la comparación byte a byte del token y con ella el canal de timing.
- **CSRF (A08) — decisión D-03 del plan.** Se almacena el hash de un token CSRF **aleatorio e independiente**, no un HMAC derivado del token de sesión. Motivo: un HMAC determinista sobre `SECRET_KEY` ata la validez de todos los tokens CSRF a esa clave (rotarla invalida en silencio todas las mutaciones en vuelo) y reutiliza la clave maestra para un segundo propósito criptográfico. Con token propio, `GET /auth/csrf` **rota** el token de la sesión y reemite la cookie, que es exactamente el comportamiento que se necesita cuando el cliente perdió la cookie con la sesión viva.
- **Validez evaluada en cada request**: `revoked_at IS NULL AND expires_at > now() AND last_activity_at > now() - :idle_ttl`. El idle TTL es configuración y se compara en la query, **no** se materializa como columna: cambiarlo no exige migración ni UPDATE masivo. `last_activity_at` se actualiza con *throttling* (solo si pasaron >60 s) para no convertir cada GET en un UPDATE.
- **Rotación al login (A07)**: cada login exitoso crea fila nueva (token y CSRF nuevos) y revoca la anterior con `revoke_reason='rotation'`, encadenada vía `rotated_from_id`. **La revocación de la sesión previa ocurre solo tras verificar credenciales correctamente** (si no, un POST a `/login` con contraseña errónea desde otra pestaña destruiría la sesión válida del usuario).
- `rotated_from_id ON DELETE SET NULL` es excepción deliberada al RESTRICT general: las sesiones vencidas se purgan físicamente a los 30 días y un RESTRICT en la cadena de rotación haría fallar esa purga.
- `active_module_code` registra el módulo activo del flujo, pero **jamás autoriza nada**: es estado de navegación; cada request revalida contra `user_module_access`.

### 3.4 `roles` — roles POR módulo

```sql
CREATE TABLE roles (
    id           uuid         NOT NULL DEFAULT gen_random_uuid(),
    module_code  varchar(30)  NOT NULL,
    code         varchar(50)  NOT NULL,              -- 'operador', 'supervisor', 'consulta'
    nombre       varchar(80)  NOT NULL,              -- "Supervisor de Suscripción"
    descripcion  varchar(300) NULL,
    es_sistema   boolean      NOT NULL DEFAULT false,-- sembrado en migración, no editable desde la UI
    activo       boolean      NOT NULL DEFAULT true,
    created_at   timestamptz  NOT NULL DEFAULT now(),
    updated_at   timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT pk_roles PRIMARY KEY (id),
    CONSTRAINT fk_roles_module_code_modules
        FOREIGN KEY (module_code) REFERENCES modules (code) ON DELETE RESTRICT,
    CONSTRAINT uq_roles_module_code_code UNIQUE (module_code, code),
    -- clave compuesta redundante que habilita la FK de integridad módulo-rol de §3.6
    CONSTRAINT uq_roles_id_module_code UNIQUE (id, module_code)
);
```

Entidad de configuración: usa `activo`, no soft delete (así el `UNIQUE (module_code, code)` puede ser total). Los cambios quedan en `audit_log`.

### 3.5 `permissions` y `role_permissions`

Permisos granulares `recurso:accion` con **scope de módulo en columna** (`NULL` = permiso del núcleo):

```sql
CREATE TABLE permissions (
    id          uuid         NOT NULL DEFAULT gen_random_uuid(),
    module_code varchar(30)  NULL,                   -- NULL = permiso del núcleo
    code        varchar(100) NOT NULL,               -- 'aseguradoras:leer', 'solicitudes:aprobar'
    descripcion varchar(300) NULL,
    created_at  timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT pk_permissions PRIMARY KEY (id),
    CONSTRAINT fk_permissions_module_code_modules
        FOREIGN KEY (module_code) REFERENCES modules (code) ON DELETE RESTRICT,
    CONSTRAINT uq_permissions_module_code_code UNIQUE NULLS NOT DISTINCT (module_code, code),
    CONSTRAINT ck_permissions_code_formato CHECK (code ~ '^[a-z_]+:[a-z_]+$')
);

CREATE TABLE role_permissions (
    role_id       uuid        NOT NULL,
    permission_id uuid        NOT NULL,
    granted_at    timestamptz NOT NULL DEFAULT now(),
    granted_by    uuid        NULL,
    CONSTRAINT pk_role_permissions PRIMARY KEY (role_id, permission_id),
    CONSTRAINT fk_role_permissions_role_id_roles
        FOREIGN KEY (role_id) REFERENCES roles (id) ON DELETE CASCADE,
    CONSTRAINT fk_role_permissions_permission_id_permissions
        FOREIGN KEY (permission_id) REFERENCES permissions (id) ON DELETE RESTRICT,
    CONSTRAINT fk_role_permissions_granted_by_users
        FOREIGN KEY (granted_by) REFERENCES users (id) ON DELETE RESTRICT
);

CREATE INDEX ix_role_permissions_permission_id ON role_permissions (permission_id);
```

**Idioma de los códigos de permiso — decisión D-05 del plan: español.** Coherente con el resto del dominio (`aseguradoras`, `prestadores`) y con la UI. Los códigos se comparan por string en `require_permission`, así que la lista canónica está congelada en §7 y cualquier código nuevo se añade allí.

**Notas:**

- **Scope por columna, no incrustado en el string**: `solicitudes:leer` puede existir en dos módulos sin colisión, el admin lista los permisos de cada módulo sin parsear strings, y extirpar un módulo = borrar sus filas.
- **Invariante de servicio** (no expresable como FK porque `permissions.module_code` puede ser NULL): un rol solo recibe permisos de su propio módulo o del núcleo. Se valida en la capa service y se cubre con test. Un permiso mal asignado sería además inerte: la autorización exige primero acceso al módulo de la ruta.
- `CASCADE` solo hacia `roles`; borrar un `permission` del catálogo es `RESTRICT` porque su código está referenciado por el código de las dependencias FastAPI.

### 3.6 `user_module_access` — la puerta de entrada

```sql
CREATE TABLE user_module_access (
    id          uuid        NOT NULL DEFAULT gen_random_uuid(),
    user_id     uuid        NOT NULL,
    module_code varchar(30) NOT NULL,
    role_id     uuid        NOT NULL,
    activo      boolean     NOT NULL DEFAULT true,   -- revocación = false (efecto inmediato, reactivable)
    granted_at  timestamptz NOT NULL DEFAULT now(),
    granted_by  uuid        NULL,
    revoked_at  timestamptz NULL,
    revoked_by  uuid        NULL,
    updated_at  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pk_user_module_access PRIMARY KEY (id),
    CONSTRAINT uq_user_module_access_user_id_module_code UNIQUE (user_id, module_code),
    CONSTRAINT fk_user_module_access_user_id_users
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT,
    CONSTRAINT fk_user_module_access_granted_by_users
        FOREIGN KEY (granted_by) REFERENCES users (id) ON DELETE RESTRICT,
    CONSTRAINT fk_user_module_access_revoked_by_users
        FOREIGN KEY (revoked_by) REFERENCES users (id) ON DELETE RESTRICT,
    -- FK COMPUESTA: hace IMPOSIBLE a nivel de datos asignar a un usuario un rol de otro módulo
    CONSTRAINT fk_user_module_access_role_id_roles
        FOREIGN KEY (role_id, module_code) REFERENCES roles (id, module_code) ON DELETE RESTRICT
);

CREATE INDEX ix_user_module_access_role_id ON user_module_access (role_id);
```

**Notas:**

- `UNIQUE (user_id, module_code)` **total**: a lo sumo una fila por usuario y módulo; cambiar de rol o revocar/reactivar es UPDATE sobre esa fila. El historial completo de ciclos grant/revoke vive en `audit_log`. Ese mismo índice único es el que usa la autorización por request: no hacen falta índices adicionales.
- La FK compuesta `(role_id, module_code) → roles(id, module_code)` es la materialización en DB de "rol POR módulo": ningún bug de servicio puede crear "supervisor de calificación dentro de suscripción".

### 3.6b `user_grupo_access` — el coordinador de una familia (`f5a8d3c6b924`)

La otra puerta del personal **propio**: en vez de una fila por módulo, una por
**familia comercial**. El coordinador de Siniestro entra a todos los módulos con
`modules.grupo = 'siniestro'` —incluidos los que se agreguen mañana—, con el rol
de coordinación de cada uno.

```sql
CREATE TABLE user_grupo_access (
    id         uuid        NOT NULL DEFAULT gen_random_uuid(),
    user_id    uuid        NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    grupo      varchar(20) NOT NULL,   -- 'suscripcion' | 'siniestro'
    activo     boolean     NOT NULL DEFAULT true,
    -- + granted_at/by, revoked_at/by, updated_at, como en user_module_access
    CONSTRAINT pk_user_grupo_access PRIMARY KEY (id),
    CONSTRAINT uq_user_grupo_access_user_id_grupo UNIQUE (user_id, grupo),
    CONSTRAINT ck_user_grupo_access_grupo CHECK (grupo IN ('suscripcion', 'siniestro'))
);

-- UNO SOLO por familia, garantizado por la base: parcial sobre las filas vivas,
-- para que revocar libere el puesto sin borrar el historial.
CREATE UNIQUE INDEX uq_user_grupo_access_coordinador_unico
    ON user_grupo_access (grupo) WHERE activo;
```

- **Sin FK a `modules.grupo`**: la familia no es una tabla, es una columna de
  presentación. El CHECK la acota igual.
- **Los módulos del coordinador no se guardan, se calculan.** Es lo que hace que
  la promesa «abarca todo Siniestro» siga siendo cierta cuando entre el módulo
  ocho, sin reeditar ninguna ficha.
- `auth.rol_en_modulo()` mira primero la fila por módulo y, si no la hay, esta:
  dos caminos, una sola respuesta, y ambos revocables al instante.
- El `code` del rol sigue siendo `supervisor`; «Coordinador» es su nombre
  visible desde `f5a8d3c6b924`, aquí y en los usuarios de aseguradora.
- **Esta fila es también la que le deja administrar a su equipo.** Desde sep 2026
  el coordinador de una familia entra a `/shared/usuarios` acotado a **los
  auditores de su familia**: los ve, los crea y los mantiene, y no puede nombrar
  coordinadores, ni funciones, ni tocar la familia de al lado. La dependencia
  `require_coordinacion` resuelve aquí su `grupo` en cada request —quitarle la
  fila se lo quita todo en la siguiente petición— y el alcance viaja al servicio,
  que filtra y corta. El detalle, en «El coordinador de familia y su equipo» de
  `03-auth-y-api.md`. El coordinador de una **aseguradora** no tiene nada de
  esto: coordina una compañía, no una familia.

### 3.6b-bis `user_funcion` — Convenio y Contabilidad (`d6b3f9c8e214`)

Las funciones transversales del personal propio. No entran por módulo ni por
familia —su trabajo cruza todo el catálogo—, así que tienen tabla propia.

```sql
CREATE TABLE user_funcion (
    id      uuid        NOT NULL DEFAULT gen_random_uuid(),
    user_id uuid        NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    funcion varchar(20) NOT NULL,   -- 'convenio' | 'contabilidad'
    activo  boolean     NOT NULL DEFAULT true,
    -- + granted_at/by, revoked_at/by, updated_at
    CONSTRAINT pk_user_funcion PRIMARY KEY (id),
    CONSTRAINT uq_user_funcion_user_id UNIQUE (user_id),
    CONSTRAINT ck_user_funcion_catalogo CHECK (funcion IN ('convenio', 'contabilidad'))
);

CREATE UNIQUE INDEX uq_user_funcion_unica ON user_funcion (funcion) WHERE activo;
```

- **Una de cada, y una por persona.** El índice parcial garantiza un solo
  Convenio y un solo Contabilidad entre las filas vivas; el `UNIQUE (user_id)`,
  que nadie lleve las dos. Verificado contra la base: dos de la misma función se
  rechazan, una de cada conviven, y una función fuera del catálogo la corta el
  CHECK.
- **Las dos tienen ya sus pantallas, y se reparten la aseguradora por la mitad.**
  Contabilidad lleva la compañía: la da de alta y gestiona su ficha **entera**
  —datos generales, módulos contratados, SLA, pólizas, contactos y usuarios—
  salvo la pestaña «Convenios». Convenio lleva justo esa: la red de prestadores,
  con Prestadores y Red convenio completos, y de cada aseguradora **solo sus
  convenios**. La autorización la imponen las dependencias `require_funcion(...)`
  a nivel de router; el alcance exacto está en «Las funciones transversales» de
  `03-auth-y-api.md`.
- **Lo de Contabilidad crecerá** —facturación y lo que venga— sobre esta misma
  función: una ruta más en su router y una entrada más en su menú. **Sin tocar
  esta tabla ni su ficha**, que es justo para lo que se diseñó así.
- Como no tienen módulos, el destino tras el login no sale de `UserModuleAccess`
  sino de la función: las dos entran por `/admin/aseguradoras`. Una función sin
  pantallas definidas caería en «sin accesos», y eso sería deliberado, no un
  olvido: hoy no le pasa a ninguna.

### 3.6c `user_aseguradora_coordinador` — el coordinador de una compañía (`a7c4e9f2b581`)

La tercera puerta, y la de los usuarios de ASEGURADORA: **uno por compañía**, y
entra a todos los módulos que ella tenga contratados.

```sql
CREATE TABLE user_aseguradora_coordinador (
    id             uuid NOT NULL DEFAULT gen_random_uuid(),
    user_id        uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    -- Redundante con users.aseguradora_id a propósito: sin ella no se puede
    -- escribir el índice «uno por compañía», que es la regla entera.
    aseguradora_id uuid NOT NULL REFERENCES aseguradoras (id) ON DELETE RESTRICT,
    activo         boolean NOT NULL DEFAULT true,
    -- + granted_at/by, revoked_at/by, updated_at
    CONSTRAINT pk_user_aseguradora_coordinador PRIMARY KEY (id),
    CONSTRAINT uq_user_aseguradora_coordinador_user_id UNIQUE (user_id)
);

CREATE UNIQUE INDEX uq_user_aseguradora_coordinador_unico
    ON user_aseguradora_coordinador (aseguradora_id) WHERE activo;
```

- **Su alcance tampoco se guarda: se calcula** de `aseguradora_modulos`. Es lo
  que hace que contratar un módulo se lo dé y destildarlo se lo quite, sin que
  nadie reedite su ficha. Verificado: destildar Central de Crédito en LA UNION
  le dejó solo Concurrencia, y volver a marcarlo se lo devolvió.
- El **operador** no usa esta tabla: sigue por `user_module_access`, requerimiento
  a requerimiento, y puede haber varios.

Las **tres** puertas en orden de especificidad, que es como las mira
`auth.rol_en_modulo()`: la fila del módulo, la familia (personal propio), la
compañía (usuarios de aseguradora). Todas revocables al instante.

### 3.6c `notificaciones` — la campana del armazón (`e7f4a2c9b806`)

Los avisos que se ven en la campana del topbar. **Tabla del núcleo, no de un
módulo**: cada módulo escribe su fila cuando pasa algo que alguien debe saber, y
la campana las lee todas igual, sin saber de qué módulo vienen.

```sql
CREATE TABLE notificaciones (
    id          uuid         NOT NULL DEFAULT gen_random_uuid(),
    user_id     uuid         NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    module_code varchar(30)  NOT NULL REFERENCES modules (code) ON DELETE RESTRICT,
    titulo      varchar(120) NOT NULL,   -- «Auditoría de Concurrencia»
    subtitulo   varchar(200) NOT NULL,   -- «LA UNION»
    detalle     varchar(300) NOT NULL,   -- «Programada»
    url         varchar(300) NOT NULL,   -- a dónde lleva el clic
    entidad     varchar(50)  NOT NULL,   -- 'conc_visitas'
    entidad_id  uuid         NOT NULL,
    leida_at    timestamptz  NULL,
    -- + created_at, updated_at
    CONSTRAINT pk_notificaciones PRIMARY KEY (id)
);

CREATE INDEX ix_notificaciones_bandeja
    ON notificaciones (user_id, leida_at, created_at);
```

- **El texto se guarda ya compuesto, no se calcula al leer.** Un aviso es la foto
  de lo que pasó: si el caso se cancela mañana, la notificación tiene que seguir
  diciendo lo que decía, que es por lo que la persona la reconoce.
- **Sin FK a la entidad de origen.** `entidad` + `entidad_id` son una referencia
  suelta **a propósito**: el núcleo no puede depender de las tablas de un módulo
  —regla dura de arquitectura—, y con ocho módulos por delante esa FK sería
  imposible de escribir. Es el mismo criterio que usa `audit_log`.
- **La URL viaja por notificación**, no se deduce del módulo: dos personas pueden
  tener que ir a sitios distintos por el mismo hecho. Un coordinador de
  Concurrencia va a la página del caso en su módulo
  (`/concurrencia/supervision/<id>`) y el administrador global a la suya
  (`/admin/auditorias/concurrencia/<id>`); ninguno a la ficha de la compañía,
  que a los dos les responde 403.
- **Leer no borra: marca.** `leida_at` deja el historial de lo avisado.
- Se escribe **en la misma transacción que el hecho** que la provoca. Un aviso de
  un caso que no llegó a guardarse sería mentira, y aquí no hay nada
  irreversible que proteger —al revés que el correo, que sale después de
  responder justamente porque no se puede deshacer—.

### 3.7 Autorización por request: una sola consulta indexada

Dependencia `require_permission("recurso:accion")` — sesión → usuario → acceso al módulo → módulo vivo → permisos, en **una** query de puros index lookups:

```sql
SELECT u.id AS user_id, u.is_superadmin, s.id AS session_id, uma.role_id,
       coalesce(array_agg(p.code) FILTER (WHERE p.code IS NOT NULL), '{}') AS permisos
FROM sessions s
JOIN users u  ON u.id = s.user_id
             AND u.is_active AND u.deleted_at IS NULL
JOIN user_module_access uma
              ON uma.user_id = u.id
             AND uma.module_code = :modulo_de_la_ruta   -- del path, JAMÁS de sessions.active_module_code
             AND uma.activo
JOIN modules m ON m.code = uma.module_code AND m.activo -- kill-switch de módulo respetado por request
JOIN roles r  ON r.id = uma.role_id AND r.activo
-- LEFT, no INNER: un rol sin permisos asignados todavía TIENE acceso al módulo.
-- Con INNER JOIN la fila desaparecería y se devolvería un 403 incorrecto.
LEFT JOIN role_permissions rp ON rp.role_id = r.id
LEFT JOIN permissions p       ON p.id = rp.permission_id
WHERE s.token_hash = :sha256_del_token_de_cookie
  AND s.revoked_at IS NULL
  AND s.expires_at > now()
  AND s.last_activity_at > now() - :idle_ttl
GROUP BY u.id, u.is_superadmin, s.id, uma.role_id;
```

- Plan: `uq_sessions_token_hash` (1 fila) → `pk_users` → `uq_user_module_access_user_id_module_code` (1 fila) → `pk_modules` → `pk_roles` → `pk_role_permissions`. Sin seq scans, sub-milisegundo.
- 0 filas ⇒ **403 genérico** (deny by default; no se filtra si el módulo existe, si hay sesión sin acceso, o si el módulo está apagado — A01).
- Como toca `user_module_access` en vivo, **revocar (`activo=false`) surte efecto en el siguiente request de la sesión activa**. Por eso está prohibido cachear permisos en cookie, claims o memoria entre requests.
- La lista de módulos del login es esta misma consulta sin el filtro de módulo, agrupando por módulo y devolviendo `slug`, `nombre`, `icono`, `color_acento` y el rol. Los endpoints de `/admin` comprueban `is_superadmin` y no exigen `user_module_access`.

---

### 3.9 Usuarios de aseguradora, acceso por cobertura e invitación

Un usuario de aseguradora **sale de uno de sus contactos**: se elige el contacto y
de ahí vienen nombre, apellido y correo, que así no pueden divergir de lo que ya
está registrado. Y solo puede acceder a los **requerimientos que esa aseguradora
tiene contratados**, que son hojas: los módulos sin coberturas, y las coberturas
de los que sí las tienen.

```sql
ALTER TABLE users
    ADD COLUMN aseguradora_id          uuid NULL REFERENCES aseguradoras (id) ON DELETE RESTRICT,
    ADD COLUMN aseguradora_contacto_id uuid NULL REFERENCES aseguradora_contactos (id) ON DELETE RESTRICT,
    -- Un superadmin no pertenece a ninguna compañía: su scope es global y el de
    -- la aseguradora lo contradiría.
    ADD CONSTRAINT ck_users_superadmin_sin_aseguradora
        CHECK (NOT is_superadmin OR aseguradora_id IS NULL);

CREATE INDEX ix_users_aseguradora_id ON users (aseguradora_id) WHERE deleted_at IS NULL;
-- Un contacto tiene como mucho un usuario vivo.
CREATE UNIQUE INDEX uq_users_aseguradora_contacto_id ON users (aseguradora_contacto_id)
    WHERE deleted_at IS NULL AND aseguradora_contacto_id IS NOT NULL;

CREATE TABLE user_cobertura_access (
    id               uuid        NOT NULL DEFAULT gen_random_uuid(),
    user_id          uuid        NOT NULL,
    module_code      varchar(30) NOT NULL,
    cobertura_codigo varchar(30) NOT NULL,
    role_id          uuid        NOT NULL,
    activo           boolean     NOT NULL DEFAULT true,
    granted_at timestamptz NOT NULL DEFAULT now(), granted_by uuid NULL,
    revoked_at timestamptz NULL,                   revoked_by uuid NULL,
    CONSTRAINT pk_user_cobertura_access PRIMARY KEY (id),
    -- No se puede conceder una cobertura de un módulo al que el usuario no entra.
    CONSTRAINT fk_user_cobertura_access_user_module_access
        FOREIGN KEY (user_id, module_code)
        REFERENCES user_module_access (user_id, module_code) ON DELETE RESTRICT,
    -- Y el rol pertenece a ese módulo, igual que en user_module_access.
    CONSTRAINT fk_user_cobertura_access_role_id_roles
        FOREIGN KEY (role_id, module_code) REFERENCES roles (id, module_code) ON DELETE RESTRICT,
    CONSTRAINT ck_user_cobertura_access_catalogo CHECK (
        module_code = 'calificacion'
        AND cobertura_codigo IN ('vida', 'asistencia_medica', 'vida_desgravamen')),
    CONSTRAINT uq_user_cobertura_access_user_id_module_code_cobertura_codigo
        UNIQUE (user_id, module_code, cobertura_codigo)
);

CREATE TABLE password_setup_tokens (
    id         uuid        NOT NULL DEFAULT gen_random_uuid(),
    user_id    uuid        NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    token_hash varchar(64) NOT NULL,          -- SHA-256, jamás el token
    expires_at timestamptz NOT NULL,
    used_at    timestamptz NULL,              -- de un solo uso
    created_at timestamptz NOT NULL DEFAULT now(),
    created_by uuid NULL REFERENCES users (id) ON DELETE RESTRICT,
    CONSTRAINT pk_password_setup_tokens PRIMARY KEY (id),
    CONSTRAINT uq_password_setup_tokens_token_hash UNIQUE (token_hash)
);
CREATE INDEX ix_password_setup_tokens_user_id ON password_setup_tokens (user_id)
    WHERE used_at IS NULL;
CREATE INDEX ix_password_setup_tokens_expires_at ON password_setup_tokens (expires_at);
```

- **`user_module_access` no cambia y sigue siendo LA puerta.** Una fila por usuario
  y módulo, revocable al instante, consultada en cada request. `user_cobertura_access`
  solo **estrecha** dentro de un módulo con coberturas.
- **El rol se elige por requerimiento**, no por usuario: la misma persona puede ser
  supervisora en Vida y operadora en Vida desgravamen. Cuando un módulo tiene
  coberturas, el `role_id` de su fila de módulo es el **más amplio** de los que
  tenga dentro (supervisor si hay alguno, si no operador): esa fila deja pasar y
  lo que manda dentro es la fila de la cobertura.
- **Solo dos roles se ofrecen**, supervisor y operador. `consulta` sigue sembrado
  desde el hito 2 pero no se asigna; volver a ofrecerlo es una línea en la tupla
  `ROLES` del servicio.
- **Del token de invitación solo se guarda su SHA-256**, igual que en `sessions`:
  quien lea la base no puede fijar la contraseña de nadie. Emitir uno invalida los
  anteriores del mismo usuario, para que un enlace viejo filtrado deje de servir.
- **El usuario invitado nace con un hash de contraseña aleatorio e inservible**, no
  con la columna vacía: así el login sigue ejecutando siempre argon2 —sin rama
  nueva que abra un canal de tiempo— y sencillamente nunca acierta hasta que la
  persona usa su enlace.
- **Un contacto con usuario no se puede quitar** de la lista de contactos: la FK
  RESTRICT lo impediría igual, pero el servicio lo corta antes con un mensaje
  legible que dice qué hacer (desactivar el usuario primero).

### 3.10 Personal de plataforma y el rol «auditor»

El personal del propio administrador —supervisores, médicos auditores— es un
usuario con `aseguradora_id NULL` que **no sale de ningún contacto**, así que su
identificación tiene que vivir en `users`:

```sql
ALTER TABLE users
    ADD COLUMN tipo_documento_codigo varchar(10) NULL
        REFERENCES tipos_documento (codigo) ON DELETE RESTRICT,
    ADD COLUMN numero_documento varchar(20) NULL,
    ADD COLUMN telefono         varchar(25) NULL,
    -- Igual que en los contactos: tipo y número van juntos o no van.
    ADD CONSTRAINT ck_users_documento
        CHECK ((tipo_documento_codigo IS NULL) = (numero_documento IS NULL));
```

- **Opcionales los tres**: para existir bastan nombre, apellido y correo. Los
  usuarios de aseguradora nunca los usan —su documento vive en su contacto—.

Y **dónde está** cada uno (`f6a1c3e8b427`), la palanca de cercanía al derivar
casos de Concurrencia — el supervisor ve primero a los auditores de la misma
ciudad del destino, luego a los de la provincia y al final al resto:

```sql
ALTER TABLE users
    ADD COLUMN provincia_codigo varchar(2) NULL
        REFERENCES provincias (codigo) ON DELETE RESTRICT,
    ADD COLUMN ciudad_codigo varchar(4) NULL,
    -- La misma FK compuesta de aseguradoras y prestadores: la ciudad debe
    -- pertenecer a la provincia elegida.
    ADD CONSTRAINT fk_users_ciudad_codigo_ciudades
        FOREIGN KEY (ciudad_codigo, provincia_codigo)
        REFERENCES ciudades (codigo, provincia_codigo) ON DELETE RESTRICT;
```

Nulables: los usuarios de aseguradora no la necesitan y el personal ya creado
la irá completando desde Editar.
- Sus accesos se conceden por **hojas**, igual que a los usuarios de
  aseguradora: `user_module_access` para los módulos enteros y
  `user_cobertura_access` para las tres coberturas de Calificación; la fila de
  módulo lleva el rol más amplio de sus hojas. Roles ofrecidos: solo
  `supervisor` y `auditor`.
- **A lo sumo un supervisor por hoja** entre el personal de plataforma activo.
  Regla de servicio, no índice: «activo» vive en `users` y un índice único no
  cruza tablas. Desactivar libera el puesto; reactivar se revalida.
- El rol **`auditor`** se sembró en los cuatro módulos originales (y las piezas
  nuevas de `e5b9d7c3a248` nacieron con los mismos cuatro roles), de **solo
  lectura**: `dashboard:ver` en todos y `visitas:leer`
  en Concurrencia. Qué pantalla ve un auditor dentro de cada módulo es diseño
  pendiente; el rol existe para poder dar los accesos desde hoy.

---

### 3.11 Las notas dictadas del auditor y el informe (`b3e8d5a1f947`)

En el hospital, el auditor dicta lo que encuentra y cada dictado queda como una
fila de `conc_visita_notas`: `visita_id` (FK a `conc_visitas`), `tipo` con
CHECK (`historial_clinico` · `charla_enfermeria` · `charla_medico` ·
`observacion`), `texto` (TEXT), auditoría de fila y borrado lógico, con índice
parcial por visita. Son la materia prima del informe. Desde sep 2026
`charla_enfermeria` es **solo legado**: se retiró del flujo (el servicio ya no
acepta crearla y la app no la ofrece), pero sigue en el CHECK porque las notas
ya dictadas se conservan y se muestran — retirar un valor del catálogo jamás
destruye las filas que lo usan.

El informe vigente vive en la propia visita: `conc_visitas.informe` (TEXT,
nulable) e `informe_actualizado_at`. Una columna y no una tabla porque el
vigente es uno —regenerarlo lo reemplaza— y la película la lleva `AuditLog`
(acciones `nota_creada`, `nota_eliminada`, `informe_generado`, siempre con tipo
y longitud, **jamás el texto**: es dato clínico y el log no lo guarda, A09).

---

### 3.12 El estado `no_auditado` y la llegada del auditor (`c7f2a9d4e163`)

Dos piezas de la misma regla: si la ventana de la visita vence y el auditor
nunca marcó «Ya llegué», el caso pasa solo a `no_auditado`.

- `conc_visitas.llegada_at` (`timestamptz`, nulable): el sello de «Ya llegué»,
  puesto con la hora del servidor por `POST /auditor/visitas/{id}/llegada`.
  `NULL` = nunca llegó.
- El CHECK de `estado` se amplía a
  `IN ('programada','cancelada','culminada','no_auditado')`. El cuarto valor
  **no lo acepta la API** (el `Literal` de los schemas sigue en tres): lo pone
  únicamente la tarea periódica de `main.py` —cada 5 minutos, primera pasada
  inmediata al arrancar, bajo advisory lock— sobre toda visita `programada` con
  `hasta < now()` y `llegada_at IS NULL`, escribiendo `visita_no_auditada` en
  `audit_log` por cada caso. El downgrade devuelve esas filas a `programada`
  antes de restaurar el CHECK de tres valores.

---

### 3.13 Los dos estados que faltaban: `asignada` y `auditando` (`f2c7d9a4e531`)

El CHECK de `conc_visitas.estado` pasa a
`IN ('programada','asignada','auditando','cancelada','culminada','no_auditado')`.
No es una columna nueva ni una tabla nueva: es **la misma columna contando toda
la historia** del caso, ahora que el estado dejó de ser un campo que alguien
teclea y pasó a ser la consecuencia de lo que ocurre (`docs/modulos/concurrencia.md`,
«La máquina de estados»).

- `asignada` — el coordinador la derivó a un auditor y nadie ha llegado aún.
- `auditando` — el auditor marcó «Ya llegué»: está dentro del prestador.

**La migración pone al día lo que ya estaba derivado** —`UPDATE … SET estado =
'asignada' WHERE estado = 'programada' AND auditor_id IS NOT NULL`—, que no es
reescribir historia sino llamar por su nombre a lo que ya era. El downgrade
pliega los dos estados nuevos sobre `programada` antes de restaurar el CHECK
viejo: los dos describen una visita que todavía no ocurrió.

Ojo al tocar este CHECK: la convención de nombres antepone `ck_<tabla>_`, así
que en `drop_constraint` va el nombre **corto** (`"estado"`), igual que en
`create_check_constraint`. Pasarle el largo pide una restricción que no existe.

---

### 3.13 Las fotos del caso (`d8c4f6a2b915`)

`conc_visita_fotos`: una fila por foto que el auditor toma en el hospital, con
`visita_id` (FK a `conc_visitas`), `ruta` (la ruta relativa del archivo en el
volumen de subidas, `String(300)`, como `comprobante_horario_path`), auditoría
de fila, borrado lógico e índice parcial por visita. El borrado es lógico y el
archivo se queda: es evidencia. En `audit_log` solo van MIME y tamaño
(`foto_subida` / `foto_eliminada`), jamás la imagen: es dato clínico (A09).

---

## 4. Núcleo — catálogos comunes

En la migración inicial solo los que ya tienen consumidor: `tipos_documento`, `provincias`, `tipos_prestador` (los tres los referencia `prestadores`). PK natural; usan `activo`, no soft delete.

```sql
CREATE TABLE tipos_documento (
    codigo           varchar(10) NOT NULL,      -- 'cedula', 'ruc', 'pasaporte'
    nombre           varchar(60) NOT NULL,
    regex_validacion varchar(100) NULL,         -- '^[0-9]{10}$'; NULL = formato libre (pasaporte)
    activo           boolean     NOT NULL DEFAULT true,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pk_tipos_documento PRIMARY KEY (codigo)
);

CREATE TABLE provincias (
    codigo     char(2)     NOT NULL,            -- código INEC: '01'..'24'
    nombre     varchar(60) NOT NULL,
    activo     boolean     NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pk_provincias PRIMARY KEY (codigo),
    CONSTRAINT uq_provincias_nombre UNIQUE (nombre)
);

CREATE TABLE tipos_prestador (
    codigo     varchar(20)  NOT NULL,           -- 'hospital','clinica','centro_medico','laboratorio','medico'
    nombre     varchar(100) NOT NULL,
    es_persona boolean      NOT NULL DEFAULT false,  -- distingue médico de establecimiento; ya no gobierna validaciones
    activo     boolean      NOT NULL DEFAULT true,
    created_at timestamptz  NOT NULL DEFAULT now(),
    updated_at timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT pk_tipos_prestador PRIMARY KEY (codigo)
);
```

`regex_validacion` permite que el service valide `numero_documento` según el tipo elegido sin hardcodear formatos (dato, no lógica).

**`tipos_prestador` dejó de ser una semilla y pasó a administrarse** desde la
pantalla «Parámetros › Tipo de prestador» (sep 2026, **sin migración**: la tabla
ya tenía lo necesario). Tres cosas que conviene no perder:

- **El `codigo` lo genera el servidor a partir del nombre** («Centro de
  imágenes» → `centro_de_imagenes`) y no se edita nunca: es la FK que llevan los
  prestadores. El nombre sí se corrige cuando haga falta, porque el prestador no
  guarda el nombre.
- **Un tipo EN USO no se puede retirar.** La FK es `ON DELETE RESTRICT`, así que
  la base ya impide borrarlo; pero aquí no se borra, se apaga con `activo`, y eso
  la base no lo ve. Lo corta el servicio contando prestadores vivos con ese tipo,
  y el mensaje dice cuántos son. Sin esa guarda, la ficha de esos prestadores se
  reabriría con el desplegable sin su tipo y el primer guardado se lo cambiaría.
- **Los cinco de fábrica no son especiales**: se renombran y se retiran como
  cualquier otro, con la misma regla del uso.

### 4.1 `ciudades` — los 222 cantones del Ecuador

```sql
CREATE TABLE ciudades (
    codigo           char(4)     NOT NULL,   -- código DPA: provincia (2) + cantón (2)
    provincia_codigo char(2)     NOT NULL,
    nombre           varchar(80) NOT NULL,
    activo           boolean     NOT NULL DEFAULT true,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pk_ciudades PRIMARY KEY (codigo),
    CONSTRAINT fk_ciudades_provincia_codigo_provincias
        FOREIGN KEY (provincia_codigo) REFERENCES provincias (codigo) ON DELETE RESTRICT,
    -- Redundante con la PK, pero es lo que habilita la FK compuesta desde
    -- aseguradoras: sin ella no se puede garantizar en la base que la ciudad
    -- pertenezca a la provincia elegida.
    CONSTRAINT uq_ciudades_codigo_provincia_codigo UNIQUE (codigo, provincia_codigo)
);

CREATE INDEX ix_ciudades_provincia_codigo ON ciudades (provincia_codigo);
```

**Origen del dato.** Del *Clasificador Geográfico Estadístico 2025* del INEC, esquema de codificación de la División Político Administrativa actualizado al 31 de diciembre de 2024. Se extrajo del archivo oficial, no de una lista escrita a mano ni de un repositorio de terceros.

**Qué se excluyó y por qué.** El propio archivo advierte que las jurisdicciones precedidas por asterisco han cambiado con el tiempo. Un asterisco marca el cantón bajo su provincia **antigua** y dos asteriscos bajo la **nueva**. Se descartan las nueve entradas de un asterisco —Santa Elena bajo Guayas, Orellana bajo Napo, Santo Domingo bajo Pichincha y La Concordia bajo Esmeraldas— y se conserva La Concordia bajo Santo Domingo, que lleva dos. Sin esa distinción, cuatro provincias salían con cantones de más y Santo Domingo con uno de menos.

El resultado son 24 provincias y **222 cantones**, con veinte de las veinticuatro provincias cuadrando contra el conteo conocido. Las cuatro diferencias se explican: Esmeraldas tiene 7 porque La Concordia se fue, y Morona Santiago tiene 13 porque Sevilla Don Bosco es un cantón reciente.

El procedimiento completo de extracción, las trampas del archivo y cómo rehacer el catálogo cuando el INEC publique una división nueva están en [`05-catalogo-geografico.md`](05-catalogo-geografico.md).

Se llama `ciudades` y no `cantones` porque es como lo nombra y lo lee quien usa el sistema. Los nombres respetan la grafía oficial del archivo, incluidas sus rarezas: `Distrito Metropolitano de Quito` y algún cantón sin tilde, como `Mejia`.

**CIE-10: diferido — decisión D-11 del plan.** La especificación lo nombra como catálogo del núcleo, pero ninguna tabla de la iteración 1 lo referencia: crearlo ahora es una tabla muerta y congela prematuramente su modelo de versionado (ediciones OPS). Añadirlo después es una migración puramente aditiva. Cuando llegue vivirá en `shared/catalogos` con PK natural `codigo`, columna `version`, índice `pg_trgm` sobre `descripcion`, y su carga (~14 000 filas) irá en un comando idempotente `load_cie10`, no en Alembic (es dato, no esquema).

---

## 5. Núcleo — dominio: aseguradoras, prestadores y convenios

### 5.1 `aseguradoras`

Identidad de la compañía —razón social, nombre comercial, RUC, código interno—, su ubicación y su punto en el mapa, el estado y el logo. Los campos de contacto sueltos que pedía la especificación original se retiraron: viven en `aseguradora_contactos` (§5.2d).

```sql
CREATE TABLE aseguradoras (
    id               uuid         NOT NULL DEFAULT gen_random_uuid(),
    -- Identificador legible, generado por la secuencia aseguradoras_codigo_interno_seq:
    -- ASEG-0001, ASEG-0002... La secuencia vive en la base y no en la aplicación, así que
    -- dos altas simultáneas no pueden obtener el mismo número.
    codigo_interno   varchar(20)  NOT NULL DEFAULT ('ASEG-' || lpad(nextval('aseguradoras_codigo_interno_seq')::text, 4, '0')),
    razon_social     varchar(200) NOT NULL,
    nombre_comercial varchar(200) NULL,
    ruc              char(13)     NOT NULL,
    tipo             varchar(30)  NULL,   -- se conserva a la espera de definir su uso
    -- Los datos de contacto sueltos se retiraron en d5f3a91c2b48: viven en
    -- aseguradora_contactos (§5.2d), que es donde manda.
    provincia_codigo char(2)      NULL,
    ciudad_codigo    char(4)      NULL,
    direccion_fiscal varchar(300) NULL,
    latitud          numeric(9,6) NOT NULL,   -- punto exacto, obligatorio (§5.2g)
    longitud         numeric(9,6) NOT NULL,
    estado           varchar(20)  NOT NULL DEFAULT 'activo',
    logo_path        varchar(500) NULL,   -- ruta relativa en el storage privado: 'aseguradoras/<uuid>.png'
    -- f4a7b9d1e263: la ficha interna de Accumedical, dueña de la «Red convenio»
    -- propia. Se excluye del listado y de todo selector; un índice único parcial
    -- (uq_aseguradoras_propia WHERE es_propia) garantiza que solo exista una.
    es_propia        boolean      NOT NULL DEFAULT false,
    created_at      timestamptz  NOT NULL DEFAULT now(),
    updated_at      timestamptz  NOT NULL DEFAULT now(),
    created_by      uuid         NULL,
    updated_by      uuid         NULL,
    deleted_at      timestamptz  NULL,
    deleted_by      uuid         NULL,
    CONSTRAINT pk_aseguradoras PRIMARY KEY (id),
    CONSTRAINT fk_aseguradoras_created_by_users FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE RESTRICT,
    CONSTRAINT fk_aseguradoras_updated_by_users FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE RESTRICT,
    CONSTRAINT fk_aseguradoras_deleted_by_users FOREIGN KEY (deleted_by) REFERENCES users (id) ON DELETE RESTRICT,
    CONSTRAINT fk_aseguradoras_provincia_codigo_provincias
        FOREIGN KEY (provincia_codigo) REFERENCES provincias (codigo) ON DELETE RESTRICT,
    -- FK COMPUESTA: impide guardar una ciudad que no pertenezca a la provincia
    -- elegida. Con ambas columnas nulas, o con solo la provincia puesta, la
    -- restricción se satisface (MATCH SIMPLE).
    CONSTRAINT fk_aseguradoras_ciudad_codigo_ciudades
        FOREIGN KEY (ciudad_codigo, provincia_codigo)
        REFERENCES ciudades (codigo, provincia_codigo) ON DELETE RESTRICT,
    CONSTRAINT ck_aseguradoras_ruc_formato CHECK (ruc ~ '^[0-9]{13}$'),
    CONSTRAINT ck_aseguradoras_tipo   CHECK (tipo IN ('publica', 'privada', 'medicina_prepagada')),
    CONSTRAINT ck_aseguradoras_estado CHECK (estado IN ('activo', 'inactivo')),
    CONSTRAINT ck_aseguradoras_latitud  CHECK (latitud BETWEEN -90 AND 90),
    CONSTRAINT ck_aseguradoras_longitud CHECK (longitud BETWEEN -180 AND 180)
);

CREATE UNIQUE INDEX uq_aseguradoras_ruc ON aseguradoras (ruc) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX uq_aseguradoras_codigo_interno ON aseguradoras (codigo_interno);
CREATE INDEX ix_aseguradoras_razon_social_trgm     ON aseguradoras USING gin (razon_social gin_trgm_ops);
CREATE INDEX ix_aseguradoras_nombre_comercial_trgm ON aseguradoras USING gin (nombre_comercial gin_trgm_ops);
CREATE INDEX ix_aseguradoras_listado ON aseguradoras (estado, created_at) WHERE deleted_at IS NULL;
```

- **Razón social y nombre comercial son campos distintos**: la primera es la identidad legal que va en la factura, el segundo es como se la conoce. Solo la razón social es obligatoria.
- `estado` es `activo`/`inactivo`. Se retiró `suspendida` del dominio original porque el formulario acordado ofrece dos estados; añadirlo de vuelta es un ALTER de un único CHECK.
- `tipo` sigue existiendo pero ya **no es obligatorio**: no entra en el formulario y queda a la espera de definir su uso.
- El código interno tiene huecos si un alta falla, porque las secuencias de Postgres no se revierten. Es el precio de que nunca haya colisiones bajo concurrencia, y numerar sin huecos exigiría serializar las altas con un bloqueo.
- `logo_path` guarda la ruta relativa del archivo ya validado (MIME real con python-magic, límite de tamaño, renombrado con UUID, fuera del árbol ejecutable — A08). Nunca URL absoluta ni nombre original.
- GIN + pg_trgm sobre `nombre`: el listado exige búsqueda server-side; con B-tree un `ILIKE '%anda%'` es seq scan. El índice compuesto parcial `(estado, created_at DESC)` cubre exactamente la query paginada del CRUD.

**Una aseguradora no se elimina: se desactiva.** El listado ofrece una sola acción,
**cambiar estado** (`PATCH`, mueve `estado` entre `activo` e `inactivo`), y la fila
sigue visible y filtrable. **No hay `DELETE` en el router**: una petición a ese verbo
devuelve `405`, no un `403`, porque la ruta no existe.

Esto revisa la decisión D-09 del plan, que preveía las dos acciones —cambiar estado
y eliminar con borrado lógico—. El motivo del cambio: una aseguradora tiene
expedientes, convenios con prestadores y usuarios colgando, y el histórico de todos
ellos pierde sentido si su compañía desaparece del listado. Desactivar cubre el caso
real —«con esta ya no operamos»— y es reversible.

Las columnas `deleted_at`/`deleted_by` siguen en la tabla porque vienen del mixin
común (§1.4), pero **ningún camino de la aplicación las escribe** para
`aseguradoras`. Los índices únicos parciales `WHERE deleted_at IS NULL` se conservan
tal cual: no estorban, y quitarlos sería una migración a cambio de nada.

### 5.2 `prestadores` — tabla única con catálogo de tipos

Una sola tabla, sin herencia por subtablas: ~90 % de los campos son comunes y los módulos futuros referencian "un prestador" indistintamente (`prestador_id`) — con subtablas cada FK de módulo necesitaría resolución polimórfica, que Postgres no tiene. El tipo va en catálogo porque lleva metadata que gobierna validación (`es_persona`) y su universo crece plausiblemente (farmacias, ópticas, imagen): crecer = INSERT, no migración. Si el subtipo "médico" se complica, se añade una extensión 1:1 `prestadores_medicos(prestador_id PK/FK, …)` sin tocar consumidores.

**Es una tabla propia, no una variante de `aseguradoras`.** Comparten forma de administración —código interno, logo, ubicación en cascada, contactos— pero los campos que las distinguen (tipo, registro sanitario o profesional, especialidad) no tienen equivalente en la otra, y los módulos las consultan por caminos distintos.

```sql
CREATE TABLE prestadores (
    id                    uuid         NOT NULL DEFAULT gen_random_uuid(),
    codigo_interno        varchar(20)  NOT NULL
        DEFAULT 'PREST-' || lpad(nextval('prestadores_codigo_interno_seq')::text, 4, '0'),
    tipo_codigo           varchar(20)  NOT NULL,
    nombre                varchar(200) NOT NULL,    -- razón social o nombres completos del médico
    ruc                   char(13)     NOT NULL,    -- la única identidad: no hay tipo que elegir
    logo_path             varchar(500) NULL,        -- ruta relativa dentro de UPLOAD_DIR, nunca una URL
    direccion             varchar(300) NULL,
    provincia_codigo      char(2)      NULL,
    ciudad_codigo         char(4)      NULL,
    latitud               numeric(9,6) NOT NULL,   -- punto exacto, obligatorio
    longitud              numeric(9,6) NOT NULL,
    estado                varchar(20)  NOT NULL DEFAULT 'activo',
    -- + mixin de auditoría de fila y borrado lógico (§1.4)
    CONSTRAINT pk_prestadores PRIMARY KEY (id),
    CONSTRAINT fk_prestadores_tipo_codigo_tipos_prestador
        FOREIGN KEY (tipo_codigo) REFERENCES tipos_prestador (codigo) ON DELETE RESTRICT,
    CONSTRAINT fk_prestadores_provincia_codigo_provincias
        FOREIGN KEY (provincia_codigo) REFERENCES provincias (codigo) ON DELETE RESTRICT,
    -- FK COMPUESTA: la ciudad tiene que pertenecer a la provincia elegida,
    -- invariante de datos y no solo de código (igual que en aseguradoras, §5.1)
    CONSTRAINT fk_prestadores_ciudad_codigo_ciudades
        FOREIGN KEY (ciudad_codigo, provincia_codigo)
        REFERENCES ciudades (codigo, provincia_codigo) ON DELETE RESTRICT,
    CONSTRAINT ck_prestadores_estado CHECK (estado IN ('activo', 'inactivo', 'suspendido')),
    CONSTRAINT ck_prestadores_ruc_formato CHECK (ruc ~ '^[0-9]{13}$'),
    CONSTRAINT ck_prestadores_latitud  CHECK (latitud BETWEEN -90 AND 90),
    CONSTRAINT ck_prestadores_longitud CHECK (longitud BETWEEN -180 AND 180)
);

CREATE UNIQUE INDEX uq_prestadores_codigo_interno ON prestadores (codigo_interno);
CREATE UNIQUE INDEX uq_prestadores_ruc
    ON prestadores (ruc) WHERE deleted_at IS NULL;
CREATE INDEX ix_prestadores_nombre_trgm ON prestadores USING gin (nombre gin_trgm_ops);
CREATE INDEX ix_prestadores_tipo_codigo ON prestadores (tipo_codigo) WHERE deleted_at IS NULL;
```

- **La identidad es el RUC y nada más.** Se retiraron `tipo_documento_codigo` y `numero_documento`: un campo que solo puede valer una cosa no es una elección, es ruido en la pantalla. Mismo formato y misma unicidad parcial que en `aseguradoras`, así que un RUC liberado por baja lógica se puede volver a registrar. `tipos_documento` sigue en uso, pero para los **contactos**, no para el prestador.
- `codigo_interno` lo genera la secuencia de la base (`PREST-0001`), no la aplicación: dos altas simultáneas no pueden producir el mismo. Es único **sin** filtro por `deleted_at`: un código emitido no se reutiliza jamás, aunque el prestador se elimine.
- **Se retiró el bloque de habilitación**: `especialidad`, `registro_profesional` y `registro_sanitario`. Con ellos desaparece la coherencia de subtipo, que enfrentaba esos campos entre sí según `es_persona`. El catálogo `tipos_prestador` y su columna `es_persona` se conservan —siguen distinguiendo un médico de un hospital— pero ya no gobiernan ninguna validación.
- **Se retiraron `email` y `telefono` de la tabla.** Venían de la especificación original y quedaban redundantes con `prestador_contactos` (§5.2e); mantener dos sitios para lo mismo termina en que nadie recuerda cuál manda.

### 5.2b `aseguradora_modulos` — a qué módulos puede entrar

Alimenta las casillas de la pestaña Módulos del formulario de aseguradoras
(la pestaña se llamó «Requerimientos» hasta septiembre de 2026).

```sql
CREATE TABLE aseguradora_modulos (
    aseguradora_id uuid        NOT NULL,
    module_code    varchar(30) NOT NULL,
    activo         boolean     NOT NULL DEFAULT true,
    granted_at     timestamptz NOT NULL DEFAULT now(),
    granted_by     uuid        NULL,
    revoked_at     timestamptz NULL,
    revoked_by     uuid        NULL,
    updated_at     timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pk_aseguradora_modulos PRIMARY KEY (aseguradora_id, module_code),
    CONSTRAINT fk_aseguradora_modulos_aseguradora_id_aseguradoras
        FOREIGN KEY (aseguradora_id) REFERENCES aseguradoras (id) ON DELETE RESTRICT,
    CONSTRAINT fk_aseguradora_modulos_module_code_modules
        FOREIGN KEY (module_code) REFERENCES modules (code) ON DELETE RESTRICT,
    CONSTRAINT fk_aseguradora_modulos_granted_by_users
        FOREIGN KEY (granted_by) REFERENCES users (id) ON DELETE RESTRICT,
    CONSTRAINT fk_aseguradora_modulos_revoked_by_users
        FOREIGN KEY (revoked_by) REFERENCES users (id) ON DELETE RESTRICT
);

CREATE INDEX ix_aseguradora_modulos_module_code ON aseguradora_modulos (module_code);
```

- **Destildar no borra la fila**: pone `activo = false` y sella `revoked_at`/`revoked_by`. Volver a marcarla la reactiva y limpia esa marca. Es el mismo patrón que `user_module_access` y respeta la regla de que aquí no hay borrado físico.
- **Las casillas se generan desde `modules`, no desde estas filas.** El servicio parte del catálogo y marca cuáles tiene la aseguradora, así que un módulo nuevo aparece solo como casilla sin marcar, sin sembrar nada.
- El índice por `module_code` responde «¿qué aseguradoras tienen habilitado el módulo X?», que es la consulta que harán los módulos cuando tengan lógica propia.
- No es una tabla de módulo: relaciona dos tablas del núcleo (`aseguradoras` y `modules`), así que no viola la regla de dirección del §8.
- Una aseguradora nueva nace **sin ningún módulo**: deny by default, igual que el resto de la plataforma.

### 5.2c `aseguradora_coberturas` — subramas dentro de un módulo

Las coberturas son subramas de un módulo. Hoy **solo `calificacion` tiene**: vida, asistencia médica y vida desgravamen.

```sql
CREATE TABLE aseguradora_coberturas (
    aseguradora_id   uuid        NOT NULL,
    module_code      varchar(30) NOT NULL,
    cobertura_codigo varchar(40) NOT NULL,
    activo           boolean     NOT NULL DEFAULT true,
    granted_at timestamptz NOT NULL DEFAULT now(), granted_by uuid NULL,
    revoked_at timestamptz NULL,                    revoked_by uuid NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pk_aseguradora_coberturas
        PRIMARY KEY (aseguradora_id, module_code, cobertura_codigo),
    -- La aseguradora debe tener fila para ese módulo. Basta con que exista,
    -- aunque esté inactiva: es lo que permite conservar las coberturas al
    -- destildar el módulo.
    CONSTRAINT fk_aseguradora_coberturas_modulo
        FOREIGN KEY (aseguradora_id, module_code)
        REFERENCES aseguradora_modulos (aseguradora_id, module_code) ON DELETE RESTRICT,
    CONSTRAINT ck_aseguradora_coberturas_catalogo CHECK (
        module_code = 'calificacion'
        AND cobertura_codigo IN ('vida', 'asistencia_medica', 'vida_desgravamen')
    )
);
```

**Sin tabla de catálogo, por decisión explícita.** Las coberturas válidas viven en el `CHECK` y en la constante `COBERTURAS` de `app/shared/aseguradoras/service.py`, que deben moverse juntas. Es más simple hoy, a cambio de que añadir una cobertura, o dárselas a otro módulo, exija una migración. Si eso empieza a pasar a menudo, la señal es promover el catálogo a tabla.

**Un módulo con coberturas no se marca por sí mismo: su acceso se DERIVA.** Calificación es el encabezado de sus tres subramas, no una casilla. La aseguradora entra a calificación si tiene **al menos una cobertura activa**, y deja de entrar cuando se destilda la última. La derivación vive en `service.fijar_accesos()`, que es el único punto por el que pasan módulos y coberturas, para que el invariante se cumpla venga la petición de donde venga. Los módulos sin coberturas (suscripción, concurrencia y carta de crédito) sí se marcan directamente.

**Destildar un módulo NO toca sus coberturas.** Se conservan tal cual y reaparecen si el módulo se vuelve a marcar. Por eso la FK compuesta apunta a la fila de `aseguradora_modulos` y no exige que esté activa. Como es `RESTRICT`, tampoco se puede borrar la fila del módulo mientras tenga coberturas colgando.

### 5.2c-bis `aseguradora_sla` — horas y precio por módulo (`b9e5c2a7d340`)

Lo pactado con la compañía para cada módulo que tiene contratado: cuántas horas
de SLA y a qué precio. Ambos opcionales, porque se van acordando.

```sql
CREATE TABLE aseguradora_sla (
    aseguradora_id uuid          NOT NULL,
    module_code    varchar(30)   NOT NULL,
    -- NOT NULL desde c3f7b8e1d952: un módulo contratado sin SLA es un acuerdo
    -- a medias. Numeric y no entero: media hora es pactable.
    horas          numeric(6,2)  NOT NULL,
    precio         numeric(12,2) NOT NULL,
    -- + marcas de tiempo y autoría de fila
    CONSTRAINT pk_aseguradora_sla PRIMARY KEY (aseguradora_id, module_code),
    CONSTRAINT ck_aseguradora_sla_importes CHECK (
        (horas IS NULL OR horas >= 0) AND (precio IS NULL OR precio >= 0)),
    -- Mismo patrón que las coberturas: basta con que la fila del módulo exista,
    -- aunque esté inactiva.
    CONSTRAINT fk_aseguradora_sla_modulo FOREIGN KEY (aseguradora_id, module_code)
        REFERENCES aseguradora_modulos (aseguradora_id, module_code) ON DELETE RESTRICT
);
```

- **Solo se listan —y solo se aceptan— los módulos ACTIVOS** de esa compañía: no
  se pacta el nivel de servicio de algo que no está contratado. Enviar otro
  responde `422`.
- **Obligatorio en todos, o no se guarda ninguno** (`c3f7b8e1d952`). El servicio
  exige que lleguen TODOS los módulos activos y **nombra los que falten**
  («Falta el SLA de: Auditoría de Concurrencia»); la pantalla lo avisa en rojo
  antes de enviar. Las columnas son `NOT NULL`, así que la regla vive también en
  la base y no solo en el código.
- **Destildar un módulo NO borra lo pactado.** Desaparece de la pestaña y
  reaparece con sus valores si vuelve a marcarse: un acuerdo se conserva.
  Verificado de punta a punta.
- Al endurecer las columnas, las fichas que ya existían se rellenaron **desde la
  propia API** con valores de ejemplo (24 h · 25,00) en lugar de meter defaults
  dentro de la migración: así el relleno quedó en `audit_log` como cualquier otro
  cambio del admin, y la migración falla en voz alta si algún día encuentra nulos.

### 5.2d `aseguradora_contactos` — personas de contacto

```sql
CREATE TABLE aseguradora_contactos (
    id             uuid         NOT NULL DEFAULT gen_random_uuid(),
    aseguradora_id uuid         NOT NULL REFERENCES aseguradoras (id) ON DELETE RESTRICT,
    -- e9f4c7b2d651: las cuatro partes del nombre (§2.1b)
    nombre_principal  varchar(100) NOT NULL,
    nombre_secundario varchar(100) NULL,
    apellido_paterno  varchar(100) NOT NULL,
    apellido_materno  varchar(100) NULL,
    email          citext       NOT NULL,
    telefono       varchar(25)  NULL,
    tipo_documento_codigo varchar(10) NULL
        REFERENCES tipos_documento (codigo) ON DELETE RESTRICT,
    numero_documento      varchar(20) NULL,
    cargo                 varchar(100) NULL,   -- «Gerente de Siniestros»
    -- + mixin de auditoría de fila y borrado lógico (§1.4)
    CONSTRAINT pk_aseguradora_contactos PRIMARY KEY (id),
    -- El documento es opcional, pero a medias no: o tipo y número, o ninguno
    CONSTRAINT ck_aseguradora_contactos_documento
        CHECK ((tipo_documento_codigo IS NULL) = (numero_documento IS NULL))
);

CREATE INDEX ix_aseguradora_contactos_aseguradora_id
    ON aseguradora_contactos (aseguradora_id) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX uq_aseguradora_contactos_email
    ON aseguradora_contactos (aseguradora_id, email) WHERE deleted_at IS NULL;
```

- Nombre principal, apellido paterno y correo son obligatorios; nombre secundario, apellido materno, teléfono, documento y cargo, opcionales (§2.1b).
- El tipo de documento **reutiliza el catálogo `tipos_documento`** ya sembrado (cédula, RUC, pasaporte). Eso permite además validar el número contra su `regex_validacion` sin hardcodear formatos: una cédula de cinco dígitos se rechaza con «El número no tiene el formato de cédula».
- `email` es `citext` y su unicidad es **por aseguradora** y parcial: dos aseguradoras distintas pueden tener el mismo correo de contacto, y un correo borrado lógicamente no impide volver a darlo de alta. Que sea `citext` es además lo que permite guardarlo **en mayúsculas** como el resto del expediente sin romper nada: el usuario que salga de ese contacto inicia sesión escribiéndolo como quiera.
- Quitar un contacto es borrado lógico, como todo aquí.

**Se retiraron `contacto_nombre`, `email` y `telefono` de `aseguradoras`.** Venían de la especificación original, nunca entraron al formulario y quedaban redundantes con esta tabla; mantener dos sitios para lo mismo termina en que nadie recuerda cuál manda.

### 5.2e `prestador_contactos` — personas de contacto

Misma forma que `aseguradora_contactos` (§5.2d) y **misma lógica de servicio**, extraída a `app/shared/contactos/service.py` para no escribirla dos veces. Lo que no se comparte es la tabla: cada dueño tiene la suya, con su FK real, porque un contacto pertenece a un prestador o a una aseguradora, nunca a "alguno de los dos".

```sql
CREATE TABLE prestador_contactos (
    id           uuid         NOT NULL DEFAULT gen_random_uuid(),
    prestador_id uuid         NOT NULL REFERENCES prestadores (id) ON DELETE RESTRICT,
    -- e9f4c7b2d651: las cuatro partes del nombre (§2.1b)
    nombre_principal  varchar(100) NOT NULL,
    nombre_secundario varchar(100) NULL,
    apellido_paterno  varchar(100) NOT NULL,
    apellido_materno  varchar(100) NULL,
    email        citext       NOT NULL,
    telefono     varchar(25)  NULL,
    tipo_documento_codigo varchar(10) NULL
        REFERENCES tipos_documento (codigo) ON DELETE RESTRICT,
    numero_documento      varchar(20) NULL,
    cargo                 varchar(100) NULL,   -- «Gerente de Siniestros»
    -- + mixin de auditoría de fila y borrado lógico (§1.4)
    CONSTRAINT pk_prestador_contactos PRIMARY KEY (id),
    CONSTRAINT ck_prestador_contactos_documento
        CHECK ((tipo_documento_codigo IS NULL) = (numero_documento IS NULL))
);

CREATE INDEX ix_prestador_contactos_prestador_id
    ON prestador_contactos (prestador_id) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX uq_prestador_contactos_email
    ON prestador_contactos (prestador_id, email) WHERE deleted_at IS NULL;
```

- Nombre principal, apellido paterno y correo obligatorios; nombre secundario, apellido materno, teléfono, documento y cargo opcionales, y el documento entero o nada (§2.1b).
- El listado ordena por `(created_at, id)`, no solo por `created_at`: los contactos de una misma alta comparten la marca de tiempo de la transacción al milímetro, y sin desempatar por el id —UUIDv7, o sea orden de inserción— el formulario los devolvería intercambiados.

### 5.2f `prestador_sedes` — dónde atiende

Un prestador puede atender en varios sitios: matriz, sucursales, consultorios.
**Tener sedes es opcional** —un prestador sin ninguna es un estado válido y
frecuente: el médico que solo pasa consulta en su dirección principal—, pero la
sede que se crea va entera, coordenadas incluidas: una sede sin punto no sirve
para lo único que se le pide, saber dónde está.

```sql
CREATE TABLE prestador_sedes (
    id               uuid         NOT NULL DEFAULT gen_random_uuid(),
    prestador_id     uuid         NOT NULL REFERENCES prestadores (id) ON DELETE RESTRICT,
    nombre           varchar(150) NOT NULL,
    provincia_codigo char(2)      NOT NULL,
    ciudad_codigo    char(4)      NOT NULL,
    direccion        varchar(300) NOT NULL,
    telefono         varchar(25)  NULL,
    email            citext       NULL,
    latitud          numeric(9,6) NOT NULL,
    longitud         numeric(9,6) NOT NULL,
    estado           varchar(20)  NOT NULL DEFAULT 'activa',
    -- + mixin de auditoría de fila y borrado lógico (§1.4)
    CONSTRAINT pk_prestador_sedes PRIMARY KEY (id),
    CONSTRAINT fk_prestador_sedes_provincia_codigo_provincias
        FOREIGN KEY (provincia_codigo) REFERENCES provincias (codigo) ON DELETE RESTRICT,
    -- La misma FK compuesta de siempre: la ciudad pertenece a la provincia.
    CONSTRAINT fk_prestador_sedes_ciudad_codigo_ciudades
        FOREIGN KEY (ciudad_codigo, provincia_codigo)
        REFERENCES ciudades (codigo, provincia_codigo) ON DELETE RESTRICT,
    CONSTRAINT ck_prestador_sedes_estado   CHECK (estado IN ('activa', 'inactiva')),
    CONSTRAINT ck_prestador_sedes_latitud  CHECK (latitud BETWEEN -90 AND 90),
    CONSTRAINT ck_prestador_sedes_longitud CHECK (longitud BETWEEN -180 AND 180)
);

CREATE INDEX ix_prestador_sedes_prestador_id
    ON prestador_sedes (prestador_id) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX uq_prestador_sedes_nombre
    ON prestador_sedes (prestador_id, nombre) WHERE deleted_at IS NULL;
```

- El estado va en femenino (`activa`/`inactiva`) porque así se lee en pantalla, y
  es propio de la sede: cerrar una sucursal no cambia el estado del prestador.
- La unicidad del nombre es **por prestador** y parcial: dos prestadores pueden
  tener cada uno su «Sede Matriz», y un nombre liberado por baja lógica se puede
  volver a usar.
- Se reconcilia como lista completa, igual que los contactos. **Las bajas se
  vuelcan antes que las altas**: si una sede nueva reutiliza el nombre de la que
  se va, el índice único parcial vería las dos vivas a la vez y rechazaría el
  guardado entero. La misma corrección se aplicó a `aseguradora_contactos` y
  `prestador_contactos`, que tenían el problema latente con el correo.
- Se ordena por `(created_at, id)` por la misma razón que los contactos: las
  sedes de una misma alta comparten la marca de tiempo de la transacción.

### 5.2g Coordenadas: por qué `numeric(9,6)` y no PostGIS

`latitud` y `longitud` son **obligatorias** en `aseguradoras`, en `prestadores` y
en cada sede. La dirección escrita ubica de forma aproximada; el par de
coordenadas ubica de verdad, y es lo que los módulos necesitarán para calcular
cercanía o pintar un mapa de red.

- `numeric(9,6)` da unos 11 cm de resolución. El decimal es **exacto**: con
  `double precision`, el mismo punto podría guardarse y leerse con dígitos
  distintos, y una comparación de igualdad fallaría sin motivo aparente.
- Los CHECK de rango (`-90..90`, `-180..180`) están en la base además de en
  Pydantic: un dedazo en el formulario no llega a la tabla por ninguna vía.
- **Sin PostGIS.** Para fijar un pin y pintarlo no hace falta, y añadiría una
  extensión al despliegue. El día que haya consultas de proximidad o polígonos de
  cobertura, se añade `geography(Point,4326)` calculada desde estas dos columnas,
  sin migrar datos ni romper consumidores.
- Las columnas se añadieron `NOT NULL` y sin valor por defecto a propósito: no
  existe una coordenada por defecto que no sea mentira. Postgres solo lo permite
  con la tabla vacía, así que un entorno con filas habría hecho fallar la
  migración en voz alta en lugar de inventar una ubicación.

### 5.2e `aseguradora_polizas` — documentos PDF (`b6e8d2f4c791`, `c8f4a6d2e953`)

Una fila por documento: `aseguradora_id` (FK), `nombre` visible (`varchar(160)`,
lo tecleado o el nombre del archivo sin extensión — texto para enseñar, jamás
ruta), `ruta` relativa en el volumen de subidas (archivo validado como PDF por
contenido real, guardado con nombre UUID, fuera del árbol ejecutable, como el
logo), y `categoria` con CHECK — `polizas` · `cobertura_condiciones` · `sla` ·
`convenios` —: cuatro pestañas del formulario, un solo panel compartido
(Cobertura y condiciones y SLA se muestran hoy como «En construcción»: la
categoría y la API ya existen; falta encender su pestaña).
Auditoría de fila, borrado lógico e índice parcial por aseguradora; solo admin
global.

### 5.3 `aseguradora_prestador` — el convenio / red de prestadores

**En uso desde las dos pestañas «Convenios»** —la de la aseguradora y la del
prestador—, que son la misma pantalla leída al revés porque son la misma fila:
el admin marca los prestadores de la red de cada compañía — marcar crea el convenio
(`vigente`), desmarcar lo retira con borrado lógico. Sobre la fila viva, el
botón «Editar» de cada marcado abre el detalle del convenio: su **listado de
precios** (un solo archivo, PDF o Excel; subir otro lo reemplaza) y sus
**valores FC** (la tabla 5.3b, contra los endpoints del lado prestador).

**La «Red convenio» de Accumedical usa esta misma tabla**: la entrada del menú
del superadmin arma la red PROPIA de la empresa con idéntico mecanismo, con la
ficha interna `aseguradoras.es_propia = true` como contraparte. Cero tablas ni
endpoints duplicados.

**Esta es la relación entre aseguradoras y prestadores.** La fila representa que el prestador pertenece a la **red** de la aseguradora bajo un **convenio**: el hecho que los módulos consultarán ("¿esta clínica atiende asegurados de X?" en concurrencia; "¿a qué prestador en convenio emito la carta?" en carta-crédito). No es una M2M simple: lleva vigencia y estado propios.

```sql
CREATE TABLE aseguradora_prestador (
    id              uuid        NOT NULL DEFAULT gen_random_uuid(),
    aseguradora_id  uuid        NOT NULL,
    prestador_id    uuid        NOT NULL,
    codigo_convenio varchar(50) NULL,               -- referencia contractual externa
    fecha_inicio    date        NOT NULL DEFAULT CURRENT_DATE,
    fecha_fin       date        NULL,               -- NULL = indefinido
    estado          varchar(20) NOT NULL DEFAULT 'vigente',
    observaciones   text        NULL,
    -- d2e9f5b7a634: el listado de precios del convenio — UN archivo (PDF o
    -- Excel) guardado por UUID en el volumen de subidas; subir otro reemplaza
    -- (el anterior queda como evidencia y el cambio se audita).
    listado_precios_ruta   varchar(500) NULL,
    listado_precios_nombre varchar(160) NULL,
    -- a3e9c15b7d42: qué red cubre el convenio. Dos banderas y no un valor con
    -- tres opciones: «ambas» es marcar las dos, y así «los que cubren pública»
    -- no tiene que acordarse de un tercer valor.
    red_privada     boolean     NOT NULL DEFAULT true,
    red_publica     boolean     NOT NULL DEFAULT false,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    created_by      uuid        NULL,
    updated_by      uuid        NULL,
    deleted_at      timestamptz NULL,
    deleted_by      uuid        NULL,
    CONSTRAINT pk_aseguradora_prestador PRIMARY KEY (id),
    CONSTRAINT fk_aseguradora_prestador_aseguradora_id_aseguradoras
        FOREIGN KEY (aseguradora_id) REFERENCES aseguradoras (id) ON DELETE RESTRICT,
    CONSTRAINT fk_aseguradora_prestador_prestador_id_prestadores
        FOREIGN KEY (prestador_id) REFERENCES prestadores (id) ON DELETE RESTRICT,
    CONSTRAINT fk_aseguradora_prestador_created_by_users FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE RESTRICT,
    CONSTRAINT fk_aseguradora_prestador_updated_by_users FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE RESTRICT,
    CONSTRAINT fk_aseguradora_prestador_deleted_by_users FOREIGN KEY (deleted_by) REFERENCES users (id) ON DELETE RESTRICT,
    CONSTRAINT ck_aseguradora_prestador_estado CHECK (estado IN ('vigente', 'suspendido', 'terminado')),
    CONSTRAINT ck_aseguradora_prestador_fechas CHECK (fecha_fin IS NULL OR fecha_fin >= fecha_inicio),
    CONSTRAINT ck_aseguradora_prestador_red CHECK (red_privada OR red_publica)
);

CREATE UNIQUE INDEX uq_aseguradora_prestador_par
    ON aseguradora_prestador (aseguradora_id, prestador_id) WHERE deleted_at IS NULL;
CREATE INDEX ix_aseguradora_prestador_prestador_id ON aseguradora_prestador (prestador_id);
```

- **PK surrogate `id`**: los módulos futuros pueden referenciar *el convenio concreto* (`convenio_id`). Una carta de crédito emitida "bajo el convenio C-2024-018" conserva su anclaje contractual histórico aunque el convenio se renegocie después. Renegociación = cerrar (`estado='terminado'` + `fecha_fin`) o soft-borrar y crear fila nueva; el histórico queda consultable.
- **La red que cubre** (`red_privada`, `red_publica`) se elige **al crear el convenio**, en la misma fila de la lista donde se marca el prestador, y se puede corregir después desde ahí mismo. Dos casillas y no un valor con tres opciones porque «ambas» es marcar las dos; el CHECK exige al menos una —un convenio que no cubre ninguna red no es un convenio— y el servidor lo rechaza antes con un mensaje legible. Los convenios anteriores a la columna quedaron en **privada**, que es lo que hace el DEFAULT: no se adivinó ninguno.
- Unicidad parcial: a lo sumo un convenio **vivo** por par.
- El único índice extra es el inverso por `prestador_id` ("¿con qué aseguradoras trabaja esta clínica?"); la dirección aseguradora → prestadores la cubre el índice único.

---

### 5.3b `aseguradora_prestador_fc` — el Factor de Cobertura

Lo que se pacta en un convenio, **un concepto por fila**. Va por convenio, no
por aseguradora ni por prestador: la misma compañía puede pactar un FC distinto
con cada prestador de su red, y eso es exactamente lo que representa
`aseguradora_prestador`.

Hasta `b4f1a72c9e38` esto era `aseguradora_prestador_valores`, una tabla de UNA
fila por convenio con una columna por concepto, y **cada concepto llevaba su
forma congelada en el esquema**: Cirugía era un valor, Ayudante un porcentaje
sobre Cirugía, la UCI fija o por puntos. Hoy la forma la decide quien pacta, así
que es un dato (`modo`) y no una columna distinta.

```sql
CREATE TABLE aseguradora_prestador_fc (
    convenio_id uuid          NOT NULL,
    concepto    varchar(30)   NOT NULL,   -- cirugia · anestesia · evaluacion_manejo
                                          -- uci · ucin · recien_nacido
                                          -- medicina · imagenologia · ayudante
    modo        varchar(12)   NOT NULL,   -- punto · porcentaje · fijo
    valor       numeric(12,2) NULL,       -- nulo = pactado, sin cifra todavía
    base        varchar(30)   NULL,       -- de qué concepto sale el porcentaje
    -- + marcas de tiempo y autoría de fila
    CONSTRAINT pk_aseguradora_prestador_fc PRIMARY KEY (convenio_id, concepto),
    CONSTRAINT fk_aseguradora_prestador_fc_convenio_id_aseguradora_prestador
        FOREIGN KEY (convenio_id) REFERENCES aseguradora_prestador (id) ON DELETE RESTRICT,
    CONSTRAINT ck_aseguradora_prestador_fc_concepto CHECK (concepto IN (
        'cirugia','anestesia','evaluacion_manejo','uci','ucin',
        'recien_nacido','medicina','imagenologia','ayudante')),
    CONSTRAINT ck_aseguradora_prestador_fc_modo CHECK (modo IN ('punto','porcentaje','fijo')),
    CONSTRAINT ck_aseguradora_prestador_fc_base CHECK (base IS NULL OR base IN (
        'cirugia','anestesia','evaluacion_manejo','uci','ucin',
        'recien_nacido','medicina','imagenologia','ayudante')),
    -- La base existe exactamente cuando hace falta: un porcentaje sin decir de
    -- qué no es liquidable, y un importe con base sobra.
    CONSTRAINT ck_aseguradora_prestador_fc_base_solo_en_porcentaje CHECK (
        (modo = 'porcentaje') = (base IS NOT NULL)),
    CONSTRAINT ck_aseguradora_prestador_fc_base_distinta CHECK (
        base IS NULL OR base <> concepto),
    -- Un porcentaje va de 0 a 100; lo demás es dinero y no es negativo.
    CONSTRAINT ck_aseguradora_prestador_fc_valor CHECK (
        valor IS NULL
        OR (modo =  'porcentaje' AND valor BETWEEN 0 AND 100)
        OR (modo <> 'porcentaje' AND valor >= 0))
);
```

- **Los tres modos.** `punto` es el valor de CADA punto del tarifario y se
  multiplica por los puntos del procedimiento; `porcentaje` es un tanto por
  ciento de OTRO concepto, el que diga `base`; `fijo` es un importe cerrado que
  no se multiplica por nada.
- **Una fila por concepto y no una columna por concepto.** Un solo CHECK gobierna
  los tres modos en vez de repetirlo por concepto, y un rubro nuevo del tarifario
  entra como una fila —ampliando el CHECK del concepto— y no como dos `ALTER`
  sobre una tabla con datos. Ya se cobró: `c6d3b8e4f172` sumó UCIN, Medicina e
  Imagenología sin tocar una sola fila.
- **El código está congelado; el nombre no.** `uci`, `recien_nacido`… son la
  identidad de la fila, como el `code` de un módulo, y no se renombran. Lo que se
  lee en pantalla —«UCI - Cuidado Intensivo», «Recién Nacido / Neonatales»— vive
  en el servidor (`convenios.NOMBRES_FC`) y cambiarlo NO necesita migración.
- **Que no haya fila responde sin ambigüedad a «ese concepto no se ha pactado».**
- **La cadena de porcentajes la corta el servicio, no la base.** Que la `base` no
  sea a su vez un porcentaje mira OTRA fila, y en Postgres costaría un trigger;
  este proyecto no los usa para que toda la lógica se lea en el código
  (`convenios.fijar_fc()`), y el mensaje que sale nombra los dos conceptos.
- **Los importes derivados NO se guardan.** Un porcentaje vale `valor de la base
  × porcentaje ÷ 100`; almacenarlo sería duplicar un dato que puede quedar
  desincronizado del que lo origina. Se calcula en un solo sitio del servidor
  —`convenios.importes_derivados()`— y el formulario lo repite solo para verlo
  mientras se teclea.
- **Decimal exacto, no coma flotante.** Sumar tarifas en `float` acumula céntimos
  de error, y esto acaba en una liquidación.
- **«General» ya no existe.** Era un séptimo concepto y se retiró con la misma
  migración, con aprobación explícita y sabiendo que los dos convenios vivos
  tenían cifra en él.

---

## 6. `audit_log` — append-only e inmutable

```sql
CREATE TABLE audit_log (
    id          bigint       GENERATED ALWAYS AS IDENTITY,
    user_id     uuid         NULL,           -- NULL en login fallido de email inexistente
    session_id  uuid         NULL,           -- SIN FK: la purga de sessions no debe tocar ni bloquear auditoría
    module_code varchar(30)  NULL,           -- SIN FK deliberadamente (ver nota)
    accion      varchar(50)  NOT NULL,       -- catálogo cerrado, §6.1
    entidad     varchar(63)  NULL,           -- nombre de tabla: 'aseguradoras'
    entidad_id  varchar(64)  NULL,           -- texto: admite uuid, bigint o código de catálogo
    detalle     jsonb        NULL,           -- shape documentado en §6.2, ya redactado
    ip          inet         NULL,
    user_agent  varchar(400) NULL,
    request_id  uuid         NULL,           -- correlación con los logs JSON estructurados (A09)
    created_at  timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT pk_audit_log PRIMARY KEY (id),
    CONSTRAINT fk_audit_log_user_id_users
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT
);

CREATE INDEX ix_audit_log_user_id_created_at ON audit_log (user_id, created_at DESC);
CREATE INDEX ix_audit_log_entidad_entidad_id ON audit_log (entidad, entidad_id);
CREATE INDEX ix_audit_log_created_at_brin    ON audit_log USING brin (created_at);

-- Inmutabilidad real, garantizada por trigger y no por convención:
CREATE OR REPLACE FUNCTION audit_log_inmutable() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'audit_log es append-only: % no permitido', TG_OP
        USING ERRCODE = 'raise_exception';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_audit_log_inmutable
BEFORE UPDATE OR DELETE ON audit_log
FOR EACH STATEMENT EXECUTE FUNCTION audit_log_inmutable();
```

**Por qué un trigger y no `REVOKE UPDATE, DELETE`.** El rol de la aplicación es el
propietario de las tablas, porque es quien ejecuta Alembic. Un propietario conserva
siempre sus privilegios sobre sus objetos, así que un `REVOKE` sobre él no haría
absolutamente nada: sería una garantía de mentira. El trigger sí corta el `UPDATE`
y el `DELETE`, y está verificado en el entorno real. Cuando se separen los roles de
migración y de aplicación, el `REVOKE` podrá añadirse como segunda capa.

### 6.1 Catálogo canónico de acciones (iteración 1) — decisión D-06

Español, snake_case. Congelado aquí; ampliarlo es editar esta tabla.

| Acción | Cuándo |
|---|---|
| `login_ok` | Login correcto |
| `login_fallido` | Password incorrecto, email inexistente o cuenta bloqueada (el motivo real va en `detalle`; la respuesta HTTP es genérica) |
| `cuenta_bloqueada` | Al activarse `locked_until` |
| `logout` | Logout explícito |
| `sesion_revocada` | Revocación no iniciada por el usuario (rotación en login, usuario desactivado, cambio de contraseña) |
| `cambio_modulo` | `POST /auth/modulo-activo` exitoso |
| `acceso_denegado` | 403 de `require_module_access` / `require_permission` / `require_global_admin` (detección de sondeo de rutas) |
| `crear` / `actualizar` / `eliminar` | CRUD de cualquier entidad (`entidad` + `entidad_id` identifican qué) |
| `acceso_modulo_asignado` / `acceso_modulo_revocado` | Mutaciones de `user_module_access` |
| `usuario_creado` / `usuario_actualizado` / `usuario_desactivado` | Ciclo de vida de usuarios |
| `logo_subido` | Subida de archivo aceptada (A08) |

Los módulos amplían este catálogo con acciones propias, documentadas en su
doc de módulo. Las de Concurrencia hoy: `visita_derivada`,
`visita_reprogramada`, `comprobante_subido`, `nota_creada`, `nota_eliminada`,
`foto_subida`, `foto_eliminada`, `informe_generado`, `informe_corregido`,
`informe_enviado` (que además registra el paso de la visita a `culminada` en su
`detalle`), `llegada_registrada` y
`visita_no_auditada`; y de la configuración de plataforma, `firma_configurada`
(titular y tamaño del `.p12`, jamás la contraseña). `visita_no_auditada` es la
primera **acción del sistema**: la
escribe la tarea periódica, sin usuario ni request, así que `user_id`, IP y
user-agent van nulos — el registrador de auditoría lo admite explícitamente
para este caso.

### 6.2 Shape de `detalle`

```jsonc
// CRUD: solo los campos que cambiaron, ya redactados
{ "antes": { "estado": "activo" }, "despues": { "estado": "inactivo" } }

// Eventos de auth y autorización
{ "motivo": "password_incorrecto", "email_intentado": "ana@x.ec" }
{ "modulo_origen": "suscripcion", "modulo_destino": "calificacion" }
{ "ruta": "/api/v1/concurrencia/status", "modulo_solicitado": "concurrencia" }
```

**La redacción vive en un único serializador de auditoría del núcleo** con denylist estricta: jamás `password`, `password_hash`, `mfa_secret`, `token_hash`, `csrf_token_hash` ni datos clínicos.

### 6.3 Notas de diseño

- `module_code`, `session_id` y `entidad_id` **sin FK deliberadamente**: (a) el log debe poder registrar el intento de acceso a un módulo *inexistente* — justo lo interesante para seguridad; (b) el INSERT de auditoría no compite por locks ni puede fallar por integridad: la auditoría nunca rompe la transacción de negocio; (c) la purga de `sessions` no debe mutar auditoría; (d) `entidad_id` como texto admite PKs heterogéneas. La única FK es `user_id`.
- **Índices para crecimiento**: los dos B-tree responden las consultas reales; el **BRIN** sobre `created_at` da barridos por rango temporal a coste de KB incluso con cientos de millones de filas (append-only con IDENTITY ⇒ correlación física perfecta). No hay GIN sobre `detalle`: caro en escritura y sin consulta que lo requiera.
- **Particionado: diferido con umbral documentado.** Al superar ~50 M de filas se migra a particionado declarativo mensual. La conversión no exige reescritura: rename + `ATTACH PARTITION` de la tabla vieja como partición histórica es una operación de metadatos. Retención futura = `DETACH PARTITION` + archivado; jamás `DELETE` masivo.

---

## 7. Seeds de la migración inicial

Idempotentes (`ON CONFLICT DO NOTHING`), dentro de la propia migración.

| Tabla | Contenido |
|---|---|
| `modules` | 4 filas (ver abajo) |
| `roles` | 4 por módulo: `operador`, `supervisor`, `consulta` y `auditor` (16 filas), `es_sistema=true`. El `auditor` entró con `b8f5e3d1a692`, de solo lectura |
| `permissions` | núcleo + por módulo (ver abajo) |
| `role_permissions` | mapeo mínimo de los roles seed |
| `tipos_documento` | `cedula` (`^[0-9]{10}$`), `ruc` (`^[0-9]{13}$`), `pasaporte` (NULL) |
| `provincias` | las 24 provincias de Ecuador con código INEC |
| `tipos_prestador` | `hospital`, `clinica`, `centro_medico`, `laboratorio` (`es_persona=false`), `medico` (`es_persona=true`) |

**Seed de `modules`:**

| `code` | `slug` | `nombre` | `icono` | `color_acento` | `orden` |
|---|---|---|---|---|---|
| `suscripcion` | `suscripcion` | Suscripción | `file-signature` | `emerald` | 1 |
| `calificacion` | `calificacion` | Calificación | `clipboard-check` | `violet` | 2 |
| `concurrencia` | `concurrencia` | Concurrencia | `activity` | `sky` | 3 |
| `carta_credito` | `carta-credito` | Carta de Crédito | `credit-card` | `amber` | 4 |

**Lista canónica de permisos (congelada):**

- Núcleo (`module_code = NULL`): `aseguradoras:leer`, `aseguradoras:crear`, `aseguradoras:editar`, `aseguradoras:eliminar`, `prestadores:leer`, `prestadores:crear`, `prestadores:editar`, `prestadores:eliminar`, `usuarios:leer`, `usuarios:crear`, `usuarios:editar`, `accesos:leer`, `accesos:asignar`, `accesos:revocar`, `auditoria:leer`.
- Por módulo (4 × 1 fila): `dashboard:ver` — el único permiso que la iteración 1 exige de verdad, en el endpoint placeholder de cada módulo, para que la maquinaria RBAC quede probada de punta a punta.

**El usuario superadmin NO se siembra en la migración**: una contraseña (o su hash) en el historial de migraciones es un secreto filtrado y un hash constante compartido entre todos los despliegues. Se crea con `docker compose exec api /opt/venv/bin/python -m app.cli create-superadmin`, que lee `SUPERADMIN_EMAIL`/`SUPERADMIN_PASSWORD` de variables de entorno validadas por pydantic-settings, es idempotente y escribe con `created_by=NULL` (bootstrap).

---

## 8. Contrato núcleo ↔ módulos futuros

**Regla de dirección, no negociable:** las tablas de módulo referencian al núcleo; el núcleo **jamás** referencia tablas de módulo; un módulo **jamás** referencia tablas de otro módulo. Si dos módulos necesitan el mismo dato, ese dato asciende al núcleo en su propia migración (misma regla que `shared/` en el código). El grafo queda acíclico.

**Prueba de fuego del diseño: agregar el módulo 8 no ejecuta ni un solo ALTER sobre tablas existentes** — es una fila en `modules`, sus roles y permisos (INSERTs) y sus tablas nuevas.

Convenciones obligatorias para toda tabla de módulo:

1. **Prefijo por módulo**: `susc_`, `calif_`, `conc_`, `cc_`. La naming convention lo hereda en los constraints.
2. **Columnas estándar**: PK `uuid` (v7 en app), mixin completo de §1.4 (con `created_by NOT NULL`), unicidades como índices parciales.
3. **FKs al núcleo** con nombre canónico y `ON DELETE RESTRICT`: `aseguradora_id`, `prestador_id`, `convenio_id → aseguradora_prestador(id)`, `provincia_codigo`, `user_id`. Nada de duplicar nombre/RUC del prestador dentro del módulo: siempre referencia.
4. **Toda tabla raíz de expediente lleva `aseguradora_id NOT NULL`**: los flujos ocurren siempre en el contexto de una aseguradora, y esa columna es la palanca de scoping/ownership (A01) que cada query del módulo debe filtrar.

Ejemplo ilustrativo del contrato (**NO** va en la migración inicial):

```sql
CREATE TABLE cc_cartas (
    id             uuid NOT NULL DEFAULT gen_random_uuid(),
    aseguradora_id uuid NOT NULL REFERENCES aseguradoras (id)          ON DELETE RESTRICT,
    prestador_id   uuid NOT NULL REFERENCES prestadores (id)           ON DELETE RESTRICT,
    convenio_id    uuid NULL     REFERENCES aseguradora_prestador (id) ON DELETE RESTRICT,
    -- ... campos propios del módulo ...
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    created_by uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    updated_by uuid NULL     REFERENCES users (id) ON DELETE RESTRICT,
    deleted_at timestamptz NULL,
    deleted_by uuid NULL     REFERENCES users (id) ON DELETE RESTRICT,
    CONSTRAINT pk_cc_cartas PRIMARY KEY (id)
);
```

---

## 9. Resumen de tablas y orden de creación

| # | Tabla | PK | Baja lógica | Índices no-PK claves |
|---|---|---|---|---|
| 1 | `modules` | `code` natural | `activo` | `uq_modules_slug` |
| 2 | `users` | uuid | soft delete + `is_active` | `uq_users_email` (parcial), `ix_users_aseguradora_id` (parcial), `uq_users_aseguradora_contacto_id` (parcial); CHECK superadmin sin aseguradora y CHECK documento coherente |
| 3 | `sessions` | uuid | `revoked_at` | `uq_sessions_token_hash`, `ix_sessions_user_id` (parcial), `ix_sessions_expires_at` |
| 4 | `roles` | uuid | `activo` | `uq_roles_module_code_code`, `uq_roles_id_module_code` |
| 5 | `permissions` | uuid | — | `uq_permissions_module_code_code` (NULLS NOT DISTINCT) |
| 6 | `role_permissions` | (role_id, permission_id) | — | `ix_role_permissions_permission_id` |
| 7 | `user_module_access` | uuid | `activo` | `uq_..._user_id_module_code` (total), `ix_..._role_id` |
| 7b | `user_cobertura_access` | uuid | `activo` | `uq_..._user_module_cobertura` (total); FK compuesta a `user_module_access` y a `roles`; CHECK de catálogo |
| 7c | `password_setup_tokens` | uuid | `used_at` | `uq_..._token_hash`, `ix_..._user_id` (parcial), `ix_..._expires_at` |
| 8 | `tipos_documento` | `codigo` natural | `activo` | — |
| 9 | `provincias` | `codigo` char(2) | `activo` | `uq_provincias_nombre` |
| 10 | `tipos_prestador` | `codigo` natural | `activo` | — |
| 10b | `ciudades` | `codigo` char(4) DPA | `activo` | `ix_ciudades_provincia_codigo`, `uq_ciudades_codigo_provincia_codigo` |
| 11 | `aseguradoras` | uuid | **solo `estado`** (no se elimina) | `uq_aseguradoras_ruc` (parcial), `uq_aseguradoras_codigo_interno`, trgm en razón social y nombre comercial, `ix_..._listado` (parcial); CHECK de rango de coordenadas |
| 12 | `prestadores` | uuid | soft delete + `estado` | `uq_prestadores_ruc` (parcial), `uq_prestadores_codigo_interno`, trgm `nombre`, `ix_..._tipo_codigo` (parcial); FK compuesta `(ciudad_codigo, provincia_codigo)`; CHECK de formato de RUC y de rango de coordenadas |
| 12b | `aseguradora_modulos` | (aseguradora_id, module_code) | `activo` + `revoked_at` | `ix_aseguradora_modulos_module_code` |
| 12c | `aseguradora_coberturas` | (aseguradora_id, module_code, cobertura_codigo) | `activo` + `revoked_at` | FK compuesta a `aseguradora_modulos`; CHECK de catálogo |
| 12d | `aseguradora_contactos` | uuid | soft delete | `uq_..._email` (parcial, por aseguradora); CHECK de documento entero o vacío |
| 12e | `prestador_contactos` | uuid | soft delete | `uq_..._email` (parcial, por prestador); CHECK de documento entero o vacío |
| 12f | `prestador_sedes` | uuid | soft delete + `estado` | `uq_..._nombre` (parcial, por prestador), `ix_..._prestador_id` (parcial); FK compuesta de ciudad; CHECK de rango de coordenadas |
| 13 | `aseguradora_prestador` | uuid | soft delete + `estado` | `uq_..._par` (parcial), `ix_..._prestador_id`, CHECK de red (`red_privada OR red_publica`) |
| 13a | `aseguradora_prestador_fc` | `(convenio_id, concepto)` | — | CHECK de concepto, modo, base solo en los porcentajes, base distinta del concepto y rango del valor según el modo |
| 13b | `conc_visitas` | uuid | soft delete + `estado` | `uq_..._codigo_interno`, `ix_..._bandeja` (aseguradora + fecha, parcial), `ix_..._prestador_id` (parcial); CHECK de ventana y de estado |
| 13c | `conc_visita_correos` | uuid | soft delete | `uq_..._email` (parcial, por visita), `ix_..._visita_id` (parcial) |
| 14 | `audit_log` | bigint identity | append-only | `(user_id, created_at DESC)`, `(entidad, entidad_id)`, BRIN `created_at` |

Orden en `upgrade()`: extensiones → `modules` → `users` → `sessions` → `roles` → `permissions` → `role_permissions` → `user_module_access` → `tipos_documento` → `provincias` → `tipos_prestador` → `aseguradoras` → `prestadores` → `aseguradora_prestador` → `audit_log` → `REVOKE` → seeds. `downgrade()` en orden inverso.
</content>
</invoke>
