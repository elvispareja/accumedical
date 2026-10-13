# 09 · Conexión con la API central

La plataforma se está separando (docs del proyecto de infraestructura: `contexto-proyecto-central.md`): el núcleo compartido —personas, aseguradoras, prestadores, documentos y eventos— pasa a la **API central** (`elvispareja/accumedical-central`, Python + PostgreSQL), y cada módulo habla con ella a través de **su traductor**.

## Qué hace hoy Concurrencia (primer traductor)

| En Concurrencia | En la central | Cuándo |
|---|---|---|
| Paciente de la visita (tipo + número de documento, nombre en 4 partes) | `personas` — se busca; si no existe se crea. **Nunca se sobrescribe** una persona que ya existe: la central es la dueña de la identidad | Toda visita viva |
| Visita culminada | Evento `visita_concurrencia` con datos **administrativos** (código, estado, fechas, sede) + `aseguradora_id` y `prestador_id`. `referencia_externa` = id de la visita | Al culminar |

**Lo clínico no sale de Concurrencia:** ni el informe, ni las notas, ni las fotos.

## Concurrencia lee el núcleo de la central (paso 4c)

`app/modules/concurrencia/nucleo.py` es **el único sitio** de Concurrencia que pregunta por cosas que no son suyas. Dos fuentes con el mismo contrato, elegidas con `CONCURRENCIA_NUCLEO`:

| Operación | `local` | `central` |
|---|---|---|
| Compañías con Concurrencia (`aseguradoras_con_concurrencia`) | JOIN `aseguradoras` + `aseguradora_modulos` | `GET /api/aseguradoras?aplicacion=concurrencia&estado=activo` |
| Red de prestadores con sedes y contactos (`prestadores_de_la_red`) | JOIN convenios, prestadores, sedes, contactos, catálogos | `GET /api/aseguradoras/{id}/convenios` + `GET /api/prestadores/{id}` + catálogos (caché 10 min) |
| ¿Prestador en la red? / sedes activas (`_validar_destino`) | consultas a `aseguradora_prestador` y `prestador_sedes` | `GET /api/prestadores/{id}/convenios` y `GET /api/prestadores/{id}` |
| Horas de SLA (`horas_de_sla` → plazo del informe) | `aseguradora_sla` | `GET /api/aseguradoras/{id}/aplicaciones` |
| Nombres en los avisos de campana | `aseguradoras`, `prestadores` | `GET /api/aseguradoras/{id}`, `GET /api/prestadores/{id}` |

- Con `central`, **si la central falla** (sin respuesta, error, o un dato que la réplica aún no llevó) se usa `local` y queda `nucleo_central_respaldo_local` en el log. Hoy pasa, por ejemplo, con compañías dadas de baja (la central responde 404).
- `python -m app.cli comparar-nucleo` compara las dos fuentes con los datos reales. En el laboratorio: 29 comparaciones, 0 diferencias.
- **Pantallas y usuarios (paso 4d):** con `central`, Concurrencia ya no consulta `aseguradoras`, `prestadores`, `prestador_sedes`, `users` ni sus roles:

| Qué | Cómo, en modo central |
|---|---|
| Bandeja, supervisión, bandeja del auditor, panel, detalle del caso | La consulta trae solo `conc_visitas`; `_completar` añade los nombres (prestador, sede, ciudades, compañía, auditor) con 3 llamadas en lote (`/prestadores/lote`, `/aseguradoras/lote`, `/usuarios/lote`). Misma forma de fila: el router no cambió |
| Búsqueda por nombre de prestador o compañía | Primero se piden a la central los ids que coinciden (`?q=…&todos=true`, también dados de baja) y se filtra `conc_visitas` por esos ids |
| Mapa de la app (coordenadas) | `/prestadores/lote` (prestador o sede) |
| Operadores, auditores para derivar | `/api/usuarios?aplicacion=concurrencia&rol=…` |
| Destinatarios de campana y correos | `/api/aplicaciones/concurrencia/coordinadores`, `/api/aseguradoras/{id}/coordinadores`, `/api/usuarios?superadmin=true`, `/api/usuarios/{id}` (creador, auditor) |

- La **autenticación y los permisos** de cada petición (quién es el usuario, qué puede hacer) siguen en la plataforma: es el login único de `admin.pymes.ec`.
- Los listados se ordenan con desempate por id (`desde, id`): antes, dos casos con la misma hora podían salir en orden distinto entre consultas (y repetirse o saltarse al paginar).
- Equivalencia verificada con `/srv/accumedical/scripts/equivalencia-concurrencia.py` (121 comparaciones de pantallas + 60 de destinatarios, todas idénticas, 0 respaldos).
- Diferencia conocida: el listado de la central excluye la ficha propia de Accumedical (`es_propia`); si algún día se le diera Concurrencia, `aseguradoras_con_concurrencia` en modo `central` no la mostraría.

## Réplica del núcleo (paso 4b)

Mientras el admin de aseguradoras y prestadores viva aquí, **esta base es la fuente** y la central su réplica. El admin no cambió en nada.

| Aquí | En la central |
|---|---|
| `modules` | `aplicaciones` |
| `tipos_prestador` | `tipos_prestador` |
| `aseguradoras`, `aseguradora_contactos` | igual |
| `prestadores`, `prestador_contactos`, `prestador_sedes` | igual |
| `aseguradora_modulos` | `aseguradora_aplicaciones` (`module_code` → `aplicacion_codigo`) |
| `aseguradora_sla`, `aseguradora_coberturas` | igual (`module_code` → `aplicacion_codigo`) |
| `aseguradora_prestador`, `aseguradora_prestador_fc` | `convenios`, `convenio_fc` |

- `app/shared/central/replicacion.py`: una consulta literal por entidad (con los nombres de la central), foto completa, huella SHA-256; **solo se envía lo que cambió** (`central_replicacion` guarda la última huella y el último error).
- Tarea cada `CENTRAL_REPLICACION_INTERVALO_SEC` (60 s), advisory lock `815_243_004`, y comando `python -m app.cli replicar-central [--forzar]`.
- Si una entidad falla, la pasada se corta (lo que sigue depende de ella) y se reintenta entera en la próxima.
- **No editar aseguradoras ni prestadores directamente en la central** mientras dure esta etapa: la siguiente réplica los devolvería a lo que diga esta base.
- Pólizas (`aseguradora_polizas`), logos y listados de precios son **archivos** del volumen de subidas: la central solo recibe su ruta (opaca); los archivos siguen aquí.

## Piezas

| Archivo | Qué es |
|---|---|
| `app/core/central.py` | Cliente HTTP de la central (OAuth2 client credentials → JWT, reutilizado hasta que vence; un 401 renueva y reintenta una vez). Solo biblioteca estándar |
| `app/modules/concurrencia/central.py` | El traductor: `persona_canonica`, `evento_canonico`, `sincronizar_pendientes` |
| `conc_sync_central` (migración `e1c4a7d2b913`) | Qué se publicó de cada visita: id de la persona y del evento en la central, intentos y último error (sin datos personales) |
| `app/main.py` · `_central_periodica` | Tarea cada `CENTRAL_INTERVALO_SEC` (120 s) bajo advisory lock `815_243_003`; solo si `CENTRAL_*` está configurado |
| `python -m app.cli sincronizar-central` | La misma pasada, a mano (p. ej. tras una caída larga de la central) |

## Garantías

- **La app nunca se bloquea por la central:** si no responde, la visita queda pendiente (`ultimo_error = "sin respuesta: …"`) y se reintenta en la próxima pasada. Verificado apagando la central.
- **Sin duplicados:** la central reconoce el mismo `(aplicación, tipo_evento, referencia_externa)` y devuelve el evento ya guardado. Verificado reenviando.
- **Aseguradora o prestador nuevos que aún no estén en la central:** el evento se registra igual, sin el vínculo, y sus ids viajan en `resultado` (`*_id_plataforma`).

## Configuración

`CENTRAL_API_URL`, `CENTRAL_CLIENT_ID`, `CENTRAL_CLIENT_SECRET` (ver `.env.example`). En el servidor de laboratorio la URL es interna (`http://api-central:3000`): el contenedor `api` comparte red con la central y no sale a Internet para hablarle.

## Pendiente de este repo (no introducido por este cambio)

`alembic check` ya reportaba diferencias entre modelos y base en `aseguradora_sla`, `user_funcion` y `user_grupo_access` (nombres de CHECK con el prefijo duplicado y defaults de `id`). Conviene una migración que las alinee.

## Subdominios: `admin.pymes.ec` y un dominio por módulo

La misma aplicación se sirve en varios subdominios y reparte sus rutas (`web/src/core/dominios.ts` + `GuardaDeDominio`, que envuelve todas las rutas):

| Ruta | Dominio |
|---|---|
| `/login`, `/definir-password`, `/admin/…`, `/coordinacion/…`, `/seleccionar-modulo`… | `VITE_URL_ADMIN` (`https://admin.pymes.ec`) |
| `/<slug>/…` y la supervisión `/admin/auditorias/<slug>/…` | el de `VITE_URLS_MODULOS[slug]` (`{"concurrencia":"https://concurrencia.pymes.ec"}`) |

- Si se abre una ruta en el dominio que no le toca, el navegador va al correcto (p. ej. **Auditorías → Concurrencia** en el admin lleva a `concurrencia.pymes.ec`).
- **Sesión compartida:** `COOKIE_DOMAIN=pymes.ec` + `COOKIE_PREFIX=__Secure-` → la cookie (`HttpOnly; Secure; SameSite=strict`) vale para todos los subdominios: se inicia sesión una vez en `admin.pymes.ec`. `ALLOWED_ORIGINS` debe listar todos los dominios.
- Sin `VITE_URL_ADMIN` (desarrollo local) no hay reparto: todo en el mismo origen, como siempre.
- Vite (dev) admite **un solo** host extra: `__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS=".pymes.ec"` (el punto cubre los subdominios).
- `APP_BASE_URL=https://admin.pymes.ec`: los enlaces de invitación llevan al portal.

## La Red convenio de Accumedical vive en la central (paso 4e)

Con `RED_PROPIA_EN_CENTRAL=true`, la red de la ficha propia (`aseguradoras.es_propia`) **es de la central**: ya no es réplica.

| Operación | Dónde se resuelve (`app/shared/central/red_propia.py`) |
|---|---|
| Lista de prestadores con casillas (`aseguradoras/service.convenios_de_aseguradora`) | central: prestadores + convenios vivos (`?estado=todos`) |
| Guardar la selección (`fijar_convenios`) | `PUT /api/aseguradoras/{id}/red` |
| Convenio del par / listado de precios | convenios de la central; el **archivo** sigue en el volumen de subidas y su ruta/nombre se guardan con `PATCH /api/convenios/{id}/listado` |
| Valores FC (`prestadores/convenios.fc_de`, `fijar_fc`, `obtener_convenio`) | `GET /api/convenios/{id}` y `PUT /api/convenios/{id}/fc` (las reglas y mensajes se validan antes, aquí) |
| Mapa de la red (`prestadores/service.puntos_del_mapa`) | prestadores en la red según la central |
| Convenios en la ficha del prestador (`convenios.listar`) | los de la red propia, de la central; los demás, locales |

- **Sin respaldo local**: si la central no responde → 503 «la Red convenio no está disponible». Escribir aquí mientras tanto crearía dos versiones de la red.
- La réplica deja de enviar la red propia (`_SIN_RED_PROPIA`), y la central la ignora aunque llegue.
- Las filas viejas de la red propia en `aseguradora_prestador` quedan como historia y no se vuelven a leer.
- Las redes de las **demás** aseguradoras siguen aquí y se replican como antes.
