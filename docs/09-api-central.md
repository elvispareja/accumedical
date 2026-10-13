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

| Operación | Dónde se resuelve (`app/shared/central/redes.py`) |
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
- Desde el paso 5a, las redes de las **demás** compañías también viven en la central (ver abajo).

## Todas las redes viven en la central (paso 5a)

Con `REDES_EN_CENTRAL=true` (en el `.env` **y** en el compose de `api-central`), la central es la dueña de la red de convenios de **todas** las compañías. El módulo `app/shared/central/redes.py` (antes `red_propia.py`; se importa como `redes_central`) generaliza la regla del paso 4e: `aplica(db, aseguradora)` es verdadero para cualquier compañía.

| Pantalla / uso | Con el paso 5a |
|---|---|
| «Red convenio» de cualquier compañía (lista, guardar, par, listado, FC, mapa) | central, como la red propia en el 4e |
| Ficha del prestador: pestaña de convenios (`convenios_de_prestador`) y guardar (`fijar_convenios_de_prestador`) | `GET /api/prestadores/{id}/convenios` y `PUT /api/prestadores/{id}/red` |
| Convenios en la ficha del prestador (`convenios.listar`) | todos de la central |
| Concurrencia: red y validación de destino (`nucleo.prestadores_de_la_red`, `prestador_en_red`) | central **sin respaldo local** (503 si no responde) |
| Réplica | ya no envía `convenios` ni `convenio_fc` |

- `aseguradora_prestador` y `aseguradora_prestador_fc` quedan como historia: no se leen ni se escriben.
- Pruebas: `scripts/equivalencia-redes.py` (cada pantalla leída local vs central, en memoria) y `scripts/probar-redes-central.py` (escrituras reales, que se deshacen al final).

## Fichas de aseguradoras y prestadores: la central es la dueña (paso 5b)

Con `FICHAS_EN_CENTRAL=true` (en el `.env` **y** en el compose de `api-central`), la central es la dueña de `aseguradoras`, `aseguradora_contactos`, `prestadores`, `prestador_contactos` y `prestador_sedes`. Estas tablas **se quedan aquí como espejo**: usuarios, casos de Concurrencia, pólizas, SLA… tienen llaves foráneas a ellas y las leen en muchas consultas, que no cambian.

`app/shared/central/fichas.py`:

1. **Central primero.** Un evento `after_flush` anota qué filas de esas tablas se escribieron, y en `before_commit` se publican en la central (`PUT /api/fichas/{entidad}`) con las mismas consultas de la réplica, leídas dentro de la transacción.
   - Si la central no responde → **503**.
   - Si la rechaza → **409/422**, con su motivo.
   - En los dos casos **no se confirma nada aquí**.
   - Cubre todas las pantallas sin tocarlas: ficha, contactos, sedes, logo, alta y baja.
2. La réplica periódica ya no envía esas tablas.
3. **Verificación del espejo** cada `CENTRAL_FICHAS_VERIFICAR_SEC` (300 s; lock `815_243_005`) y con `python -m app.cli verificar-fichas [--reparar]`.
   - Compara fila a fila y trae de la central lo que difiera: **gana la central**.
   - Las filas que solo existen aquí se informan; no se borran.
4. Los eventos se registran al importar el módulo, cosa que hacen `app.main` y `app.cli`. Un proceso nuevo que escriba fichas debe importarlo también.

Pruebas: `scripts/probar-fichas-central.py`. Los archivos de logo siguen en el volumen local; la central guarda la ruta.

## Documentos de la aseguradora en el almacén de la central (D2)

Dos tipos de documentos (decisión del negocio):
- **De la aseguradora** (póliza, tarifario, cobertura y condiciones, SLA, convenio, listados de precios): uno para todas las aplicaciones → **viven en el almacén cifrado de la central**.
- **Del caso del paciente** (informes, fotos, notas): se quedan en la aplicación dueña del expediente; de Concurrencia solo se compartirá el informe final firmado (D3).

Con `DOCUMENTOS_EN_CENTRAL=true` (`app/shared/central/archivos.py`):

| Dónde | Qué cambia |
|---|---|
| Pestañas Pólizas, Cobertura, SLA, Convenios (`aseguradoras/router.py`: subir y ver) | El PDF se sube al almacén de la central (`POST /api/archivos`); `aseguradora_polizas.ruta` guarda `central:<id>`. Al verlo, se trae de la central |
| Listado de precios de un convenio (subir y ver) | Igual; la Red convenio propia SIEMPRE va a la central (su convenio ya vive allá) |
| Réplica | `aseguradora_polizas` → `documentos_aseguradora` (con `archivo_id`); `listado_precios_ruta` `central:<id>` → `listado_archivo_id` |
| Rutas antiguas (relativas al volumen) | Siguen funcionando hasta migrarlas con `python -m app.cli migrar-documentos-central` (sube, verifica la huella y deja la referencia; **no borra** los archivos locales) |

- La central valida de nuevo cada archivo (PDF sin contenido activo, Excel sin macros): es más estricta que la validación de aquí.
- Sin respaldo local: si la central no responde, subir o ver un documento da 503.
- Cliente: `ClienteCentral.llamar_binario` (envía el archivo como cuerpo) y `.descargar` (recibe bytes).

## Informe final entregado: guardado y compartido con otras apps (D3)

Los documentos de un caso **se quedan en Concurrencia**. Lo único que sale es el
**informe final firmado**, tal como se entregó, y solo con un enlace de la central.

1. **Al pulsar «Enviar informe»** (`enviar_informe`) se guarda el PDF firmado exacto en
   `conc_informes_entregados` como entrega n.º *n* del caso, en la misma transacción
   que culmina la visita. Corregir y reenviar crea la entrega *n+1*; ninguna se pisa.
   El correo adjunta esos mismos bytes.
   - Cifrado AES-256-GCM (`core/security/cifrado.cifrar_bytes`, llave HKDF propia
     derivada del `SECRET_KEY`, id de la fila como dato asociado).
   - `sha256` del PDF en claro; al servir se verifica: si no coincide → 500 y log
     `informe_entregado_alterado`.
   - **Cambiar el `SECRET_KEY` deja ilegibles las entregas guardadas.**
2. **El sincronizador** (cada 120 s, `central.sincronizar_pendientes`) publica, después
   de las visitas, un evento `informe_concurrencia` por entrega, con la **ficha**
   (número, huella, tamaño, firmante, fecha, `url_relativa`) y nunca el PDF.
   Es idempotente (`referencia_externa` = id de la entrega).
3. **Otra app** pide a la central `POST /api/eventos/{id}/acceso` con un motivo. Recibe
   un enlace de un solo uso, válido 5 minutos:
   `https://concurrencia.pymes.ec/api/v1/concurrencia/compartido/informes/{entrega}?acceso=…`
4. **`GET /api/v1/concurrencia/compartido/informes/{entrega_id}`** (`informes.py`, en
   `PUBLIC_PATHS`, sin sesión: el enlace ES la credencial; límite por IP como el login):
   - canjea el token en la central (`POST /api/accesos/canjear`), que verifica que no
     se usó, que no venció y que es para ESA entrega;
   - registra `informe_compartido` en la auditoría, con la app, el usuario y el motivo;
   - entrega el PDF con `no-store` y `no-referrer`;
   - cualquier fallo responde 404 y queda registrado como `informe_compartido_rechazado`.
5. El access log de uvicorn tapa `?acceso=` y `?token=`.

No hay carga retroactiva: los informes enviados antes de D3 no se guardaron.
Prueba de punta a punta: `python3 -I /srv/accumedical/scripts/probar-informe-compartido.py <evento_id>`.
