# 09 · Conexión con la API central

La plataforma se está separando (docs del proyecto de infraestructura: `contexto-proyecto-central.md`): el núcleo compartido —personas, aseguradoras, prestadores, documentos y eventos— pasa a la **API central** (`elvispareja/accumedical-central`, Python + PostgreSQL), y cada módulo habla con ella a través de **su traductor**.

## Qué hace hoy Concurrencia (primer traductor)

| En Concurrencia | En la central | Cuándo |
|---|---|---|
| Paciente de la visita (tipo + número de documento, nombre en 4 partes) | `personas` — se busca; si no existe se crea. **Nunca se sobrescribe** una persona que ya existe: la central es la dueña de la identidad | Toda visita viva |
| Visita culminada | Evento `visita_concurrencia` con datos **administrativos** (código, estado, fechas, sede) + `aseguradora_id` y `prestador_id`. `referencia_externa` = id de la visita | Al culminar |

**Lo clínico no sale de Concurrencia:** ni el informe, ni las notas, ni las fotos.

Concurrencia **sigue leyendo** aseguradoras, prestadores, convenios y SLA de su propia base. Pasar a leerlos de la central exige antes mover convenios, SLA y módulos contratados, y que el admin escriba en la central (siguientes pasos de la separación).

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
