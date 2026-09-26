# Operación de datos en desarrollo

Cómo se toca la base de datos mientras se construye la plataforma, y qué no se
toca nunca. Existe porque el 2026-08-29 se borró por error un registro real del
usuario dando por hecho que era residuo de una verificación automática; el relato
completo está en `docs/04-estado-implementacion.md §6`.

La premisa que lo explica todo: **la base de desarrollo no es un entorno de
pruebas exclusivo.** El usuario da de alta registros reales desde su navegador
mientras se trabaja. Cualquier fila puede ser suya.

---

## 1. La regla

**No se borran filas de tablas de negocio.** Ni con `DELETE`, ni con `TRUNCATE`,
ni «para limpiar». Las tablas de negocio son `aseguradoras`, `prestadores`, sus
contactos, sedes, módulos y coberturas, y todo lo que traigan los módulos.

`CLAUDE.md` prohíbe el DELETE físico y **la aplicación lo cumple**: cada baja
escribe `deleted_at`/`deleted_by` y la fila se queda. Pero esa garantía protege lo
que pasa por la API; una consola con `psql` está fuera de ella. La regla del
código no sustituye al cuidado con las manos.

---

## 2. Cómo distinguir un dato real de uno de prueba

`audit_log` es append-only —lo garantiza el trigger `trg_audit_log_inmutable`— y
guarda el `user_agent` de cada mutación. Eso separa los dos mundos sin ambigüedad:

| Origen | `user_agent` |
|---|---|
| El usuario, desde su navegador | `Mozilla/5.0 (Windows NT …) Chrome/…` |
| Verificaciones con Playwright | `…HeadlessChrome/…` |
| Pruebas por HTTP con `curl` | `curl/…` |

```sql
-- Qué ha creado el usuario de verdad
SELECT to_char(created_at, 'DD HH24:MI') AS cuando, accion, entidad, entidad_id, detalle
FROM audit_log
WHERE user_agent LIKE '%Chrome/%' AND user_agent NOT LIKE '%Headless%'
  AND entidad IS NOT NULL
ORDER BY id;
```

Dos segundos de consulta. Es lo que no se hizo.

---

## 3. Datos de prueba: crearlos identificables y retirarlos por id

El usuario pidió que la base no tenga datos de muestra, así que las
verificaciones sí limpian lo suyo. La forma correcta:

- **Guardar el identificador que devuelve el alta** y borrar por ese id, nunca
  con un `DELETE` sin `WHERE`.
- **Usar valores reconocibles**: los RUC de prueba siguen el patrón
  `099XXXXXXX001` con el dígito repetido (`0995555555001`, `0996666666001`…), que
  ningún RUC real de Guayas emitido tiene por casualidad.
- **Preferir la propia API** (`DELETE /shared/…`), que hace baja lógica y deja
  rastro, antes que `psql`. Solo cuando hace falta que la fila desaparezca de
  verdad —por ejemplo para liberar un índice único— se baja a SQL, y entonces se
  hace por id.

### 3.1 Mejor todavía: un stack aislado y desechable

Cuando la verificación necesita **datos que no existen** —cuatro prestadores para
ver un scroll, un operador con contraseña conocida—, crearlos en la base de
desarrollo ensucia el trabajo del usuario y obliga a borrarlos después, que es
justo el momento peligroso. La alternativa es levantar el mismo compose con otro
nombre de proyecto: los volúmenes llevan otro prefijo, así que la base nace vacía
y no comparte absolutamente nada con la de desarrollo.

```bash
# qa.yml solo cambia los puertos publicados y el Origin permitido.
# `!override` es imprescindible: Compose FUSIONA las listas de `ports`, y sin él
# el stack de QA intentaría publicar también el 8080 y el 55432 del de desarrollo.
docker compose -p accumedical-qa -f docker-compose.yml -f qa.yml up -d --wait
docker compose -p accumedical-qa -f docker-compose.yml -f qa.yml exec api /opt/venv/bin/alembic upgrade head
docker compose -p accumedical-qa -f docker-compose.yml -f qa.yml exec api /opt/venv/bin/python -m app.cli create-superadmin
# … sembrar por API, verificar, y al terminar:
docker compose -p accumedical-qa down -v
```

El `qa.yml` necesita dos cosas además de los puertos: `ALLOWED_ORIGINS` y
`APP_BASE_URL` apuntando al puerto nuevo —el `.env` compartido dice `8080` y el
chequeo de Origin rechazaría todo—, y `VITE_HMR_CLIENT_PORT` igual, o el cliente
HMR intenta conectarse al puerto equivocado.

Dentro de esa base, cosas que en desarrollo serían inaceptables son triviales:
fijar la contraseña de un usuario con un `UPDATE`, borrar filas sin miramientos,
o vaciar una tabla entera. Es su razón de ser.

---

## 4. Migraciones que exigen la tabla vacía

Añadir una columna `NOT NULL` sin valor por defecto solo es posible con la tabla
vacía; es lo que ocurrió con `latitud` y `longitud` en `a91c4e7f2d38`. Que
Postgres lo rechace con filas presentes **es la propiedad deseable**: falla en voz
alta en lugar de inventar un valor. La forma de resolverlo **no** es vaciar la
tabla.

El procedimiento:

1. Contar y **mirar** las filas afectadas: `SELECT` completo, no `count(*)`.
2. Si hay alguna, enseñarlas al usuario junto con la migración y preguntar qué
   valor deben tomar. Rellenar es decisión suya, no del que migra.
3. Con el relleno decidido, la migración es en tres pasos: añadir la columna
   como nullable, `UPDATE` con el valor acordado, y `ALTER … SET NOT NULL`.

Esto se apoya en la regla que ya estaba en `CLAUDE.md`: **antes de modificar el
esquema se pide aprobación y se enseña la migración.** El error de agosto no fue
saltarse esa regla —la migración se aprobó— sino tratar el vaciado previo como un
detalle de fontanería que no había que consultar.

---

## 5. Qué se puede reconstruir si algo se pierde

Sabiendo esto de antemano se decide mejor qué hacer en caliente:

| Fuente | Qué conserva | Qué no |
|---|---|---|
| `audit_log` | Quién, cuándo, desde qué IP y navegador, qué acción, sobre qué entidad, y un `detalle` con identificadores y recuentos | El contenido de los campos: nombres, direcciones, datos de contacto. **Deliberado**: la auditoría no guarda datos personales |
| Volumen `uploads` | Los archivos subidos, nombrados por el uuid de su dueño. Un `DELETE` en la base no los toca | Nada más: no hay metadatos fuera de la base |
| Volumen `pgdata` | El estado actual | **No hay copias.** Sin snapshots ni archivado de WAL: no existe punto de restauración |

**Un usuario que ya tiene auditoría no se puede borrar.** `audit_log.user_id` es FK
`RESTRICT` y sus filas son inmutables por trigger, así que en cuanto alguien inicia
sesión o fija su contraseña, su fila de `users` se queda para siempre: solo admite
baja lógica. Es la consecuencia deseada de que la auditoría no se pueda vaciar, pero
conviene tenerlo presente **antes** de crear usuarios de prueba, no después.

La ausencia de respaldos es la carencia de fondo y entra con el hito 9. Mientras
no exista, la única red es no borrar.

---

## 6. Comandos que sí son seguros

```bash
# Estado de las tablas de negocio
docker compose exec db psql -U accumedical -d accumedical -c \
  "SELECT (SELECT count(*) FROM aseguradoras) a, (SELECT count(*) FROM prestadores) p;"

# Qué creó el usuario desde su navegador (§2)
docker compose exec db psql -U accumedical -d accumedical -c "SELECT …"

# Migrar y comprobar que el modelo y la migración coinciden
docker compose exec -w /app api /opt/venv/bin/alembic upgrade head
docker compose exec -w /app api /opt/venv/bin/alembic revision --autogenerate -m "verif"
```

En Windows, los `docker compose exec` con `-w /app` se lanzan desde PowerShell:
Git Bash convierte `/app` en una ruta de Windows y el contenedor la rechaza.
