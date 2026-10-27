# La app móvil del auditor

Nativa, con **Expo SDK 58 / React Native 0.88** (TypeScript), en `movil/`. Es
la app del médico auditor de Concurrencia: login con la marca real y la bandeja
«Mis casos» en dos pestañas —**Programadas** (lo pendiente, lo más urgente
primero, con semáforo contra el reloj) e **Historial** (lo ya cerrado:
canceladas, culminadas o no auditadas)—, refrescándose sola cada 10 segundos;
el resto llega con el paso a paso del negocio.

> **El SDK manda sobre Expo Go.** Expo Go solo abre proyectos de SU SDK, y las
> tiendas solo ofrecen la última versión (la razón de subir de 54 a 57: el Expo
> Go de iOS ya venía en 57 y no había forma de instalarle uno viejo a un iPhone
> físico). Al subir de SDK: `npx expo install expo@^<sdk> --fix`, los peers que
> pida `npx expo-doctor` y actualizar Expo Go en los teléfonos.
>
> Gotcha del 57 que ya mordió: su `fetch` global es el estándar de Expo y **ya
> no acepta la parte `{uri, name, type}`** de React Native en un FormData
> («unsupported FormDataPart implementation»); todo archivo se adjunta como un
> `File` de expo-file-system, que implementa la interfaz Blob (así suben el
> dictado y las fotos en `api/visitas.ts`).

**No contradice la prohibición de Node en producción**: esa regla es del
*servidor*, que sigue siendo Python. Expo es una app *cliente* que corre en el
teléfono; en el repositorio solo vive su código fuente.

---

## 1. Cómo se autentica — la única pieza nueva del backend

El modelo de sesión **no cambió**: sigue siendo el token opaco de 256 bits,
guardado como SHA-256 en `sessions`, con doble expiración y revocación
inmediata. Lo que cambió es **el sobre** en que viaja, porque una app nativa no
tiene navegador que guarde cookies:

1. `POST /auth/login` con `"cliente": "movil"` responde el token **una única
   vez en el cuerpo** (`token`) y **no emite cookies**. Con `"web"` (el valor
   por defecto, el navegador jamás manda otro) el cuerpo trae `token: null` y
   las cookies salen como siempre: exponer el token al JS del navegador
   regalaría la sesión a cualquier XSS.
2. La app lo guarda en el **llavero del sistema** (Keychain en iOS, Keystore en
   Android, vía `expo-secure-store`): cifrado por el teléfono y fuera del
   alcance de otras apps. La regla «nunca token en localStorage» sigue intacta —
   esto es su equivalente nativo correcto, no su excepción.
3. Cada petición lo manda por `Authorization: Bearer`. `get_current_user`
   acepta las dos vías —cookie primero, Bearer si no hay cookie— contra la
   misma tabla: revocar la sesión, desactivar al usuario o cerrar sesión surte
   efecto en el acto también en el teléfono.
4. **La vía Bearer está exenta del CSRF a propósito**: el CSRF existe porque el
   navegador adjunta cookies solo, sin preguntar; una cabecera `Authorization`
   no la adjunta nadie más que la propia app, así que no hay diputado confundido
   que proteger. La exención depende de *cómo llegó el token* (`via_bearer` en
   el `AuthContext`), nunca de quién es el usuario: una sesión de cookie no
   puede colarse por ahí.
5. El chequeo de `Origin` del middleware no estorba: solo rechaza cuando el
   Origin **viene** y no está en la allowlist, y las peticiones nativas no
   mandan Origin. CORS tampoco aplica: es un mecanismo del navegador.

Todo lo demás queda igual: rate limiting y lockout del login, respuesta idéntica
en todos los fallos, `login_ok` en auditoría (ahora con el campo `cliente`).

Verificado por HTTP contra la app corriendo: login móvil entrega token y **cero
`Set-Cookie`**; `/auth/me` con Bearer `200` y con un token inventado `401`;
`POST /auth/logout` con Bearer y **sin** cabecera CSRF `204`; el mismo token
después del logout `401`; y el login web sigue exactamente igual (cookies sí,
`token: null`).

## 2. Qué hay en `movil/`

```
movil/
  App.tsx                     arranque: si el llavero tiene token válido → Inicio; si no → Login
  app.json                    identidad (Accumedical, ec.med.accumedical.auditor), icono y splash de la marca
                              (el splash va como plugin expo-splash-screen: en SDK 57 la clave top-level ya no existe)
  src/
    tema.ts                   colores muestreados del logo real (azul #1a2448, oro #b0914d)
    api/cliente.ts            base URL + fetch con Bearer leído del llavero
    api/auth.ts               iniciarSesion (cliente movil) · sesionActual · cerrarSesion
    sesion/almacen.ts         SecureStore: guardar/leer/borrar el token
    pantallas/LoginScreen.tsx tarjeta con el logo sobre fondo azul de marca
    pantallas/InicioScreen.tsx «Mis casos» en dos pestañas: Programadas (urgentes primero, con semáforo) e Historial (canceladas y culminadas, recientes primero); refresco solo cada 10 s
    pantallas/CasoScreen.tsx    el panel del caso: notas dictadas por tipo + informe redactado por Claude
    api/visitas.ts            misCasos() → GET /concurrencia/auditor/visitas (Bearer)
  assets/                     logo, monograma, icono y splash (los mismos PNG procesados de la web)
```

Sin librería de navegación todavía: dos pantallas condicionales bastan hasta que
el paso a paso pida más.

## 3. Cómo correrla

```bash
cd movil
npm install          # una vez
npx expo start       # imprime un QR
```

- **Teléfono físico**: instala **Expo Go** (Play Store / App Store) — tiene que
  ser la versión del SDK del proyecto (57); en Android escanea el QR desde Expo
  Go, en iOS con la app de Cámara («Abrir en Expo Go», aceptando el permiso de
  **red local** la primera vez). Para que el teléfono alcance la API — que a
  propósito solo escucha en `127.0.0.1:8080` — conéctalo por USB y corre
  `adb reverse tcp:8080 tcp:8080` con `"apiUrl": "http://localhost:8080"` en el
  `extra` de `app.json`; o, por Wi-Fi, publica nginx en la LAN (el override lo
  expone en el 8088) y apunta `apiUrl` a `http://<IP de la máquina>:8088` — esa
  IP cambia con la red, hay que revisarla al cambiar de Wi-Fi.
- **Emulador Android**: funciona sin tocar nada (la app usa `10.0.2.2`, que es
  el localhost de la máquina visto desde el emulador).
- **Simulador iOS**: funciona sin tocar nada (`localhost`).
- **Desde el servidor de laboratorio, a un teléfono en cualquier red** (sin USB ni Wi-Fi compartido):
  - `app.config.js` toma `ACCUMEDICAL_API_URL` (p. ej. `https://concurrencia.pymes.ec`) y deja `app.json` intacto.
  - Se corre Expo en un contenedor con túnel:
    `docker run -d --name expo-movil -v <copia de movil, dueño 100000>:/app -w /app -e ACCUMEDICAL_API_URL=https://concurrencia.pymes.ec node:22-slim sh -c "npm ci && npm i -g @expo/ngrok@^4.1.0 && npx expo start --tunnel"`.
    La copia es porque con userns-remap el contenedor no puede escribir en el repo.
  - La dirección `exp://…exp.direct` sale del manifiesto (`hostUri`) y se pega en Expo Go → «Enter URL manually».
  - Al terminar: `docker rm -f expo-movil`. Mientras corre, el código de la app es accesible por esa dirección; no contiene secretos.
- **Producción**: `apiUrl` apuntará al dominio real con HTTPS, y el binario se
  construye con EAS Build cuando toque distribuir.

## 3b. El panel del caso: dictar y que la IA redacte

Tocar una tarjeta abre `pantallas/CasoScreen.tsx`, en dos etapas:

**La llegada.** Primero la ficha del caso con dos acciones: **«Ver mapa»**
—abre la app de mapas del teléfono con el punto exacto del destino, que ahora
viaja en `GET /auditor/visitas` (`destino_latitud`/`longitud`: la sede si la
hay, la casa matriz si no; sin coordenadas cae a buscar por dirección)— y
**«Ya llegué»**, que ya no es solo navegación: llama a
`POST /auditor/visitas/{id}/llegada` y el servidor sella `llegada_at` con su
propia hora antes de pasar al trabajo (409 si el caso ya no está programado;
repetirlo no mueve el sello). Ese sello importa: si el **plazo de llegada**
vence sin él, el servidor pasa el caso solo a **`no_auditado`** —la app lo pinta
en rojo en el historial— y **el caso le desaparece de lo que tiene por delante**.
No es definitivo: la coordinación de Accumedical puede darle más horas
(«Extender», contadas desde que las concede) y el caso vuelve a su agenda, así
que puede marcar su llegada al llegar aunque sea tarde. Si el caso ya tiene llegada registrada, notas o informe, la app
entra directo al trabajo: no se devuelve a nadie a la puerta.

**El trabajo**, dentro del hospital:

- **Dictar una nota, con micrófono propio.** Tres tipos —historial clínico,
  charla con médico, observación (enfermería se retiró; las notas viejas de
  ese tipo se siguen mostrando)— y un botón «Dictar
  con el micrófono»: la app graba con `expo-audio` (funciona en Expo Go), sube
  el audio a `POST /auditor/visitas/{id}/dictado` y **el texto aparece solo en
  la caja**, transcrito en el propio servidor con **Whisper local**
  (faster-whisper, CPU, `STT_MODELO`; el modelo se cachea en el volumen de
  subidas y el audio se borra apenas transcrito: el dato clínico no sale ni se
  conserva). La caja sigue siendo editable —se corrige antes de guardar— y el
  micrófono del teclado sigue sirviendo como alternativa. La nota se guarda con
  `POST /auditor/visitas/{id}/notas`, con borrado lógico para retirar un
  dictado equivocado.
- **Fotos del caso.** «Tomar foto» dispara **en ráfaga** (tras cada toma la
  cámara se reabre sola hasta cancelar, porque la cámara nativa entrega una por
  sesión) y «De la galería» admite **selección múltiple** sin límite
  (expo-image-picker). **Toda foto se convierte a JPEG en el teléfono antes de
  subir** (expo-image-manipulator, `compress: 0.7`): el iPhone dispara en HEIC,
  que ni el servidor ni la API de Claude aceptan, y la conversión además la
  deja holgada bajo el tope de 5 MB. Cada una sube a
  `POST /auditor/visitas/{id}/fotos` con progreso «Subiendo N de M…»; la app
  pinta las miniaturas con **expo-image** (el `Image` clásico de RN fallaba con
  la cabecera Bearer y dejaba el cuadro en negro; expo-image además cachea) con
  su ✕ para quitarlas, y **las fotos entran al análisis de la IA junto a las
  notas** (el servidor las normaliza a 1568 px antes de mandarlas a la visión —
  `informe.preparar_foto`—, así un lote grande o las de 48 MP no tumban el
  request): el backend se las manda a Claude como
  imágenes y el prompt le ordena transcribir a su sección solo lo que se lea
  con claridad (valores a LABORATORIO, rubros a CUENTA), sin inventar lo
  ilegible.
- **Redactar informe con IA.** Con varias fotos la generación **tarda 2-3
  minutos**: el spinner es normal, no está colgado (los timeouts de nginx y de
  la espera a Claude están dimensionados para eso, `docs/02`). La regla: el
  botón se enciende solo cuando el
  caso tiene **las tres notas** —cada chip se marca con ✓ al dictarla y una
  línea dice cuáles faltan—; el backend la impone igual (422 con la lista).
  Entonces manda las notas al backend, que llama a **Claude**
  (`POST …/informe`) con los datos exactos del caso y las notas agrupadas por
  tipo, y guarda el informe vigente en la visita. **El prompt está calcado de
  los informes reales de auditoría concurrente de la compañía** (los PDF de la
  Dra. Pareja): mismas secciones —DATOS GENERALES, antecedentes, ENFERMEDAD
  ACTUAL con «MC.:», DIAGNOSTICOS con CIE-10 cuando es inequívoco, EXAMENES,
  COMENTARIOS con el análisis clínico de auditoría, CUENTA y ANALISIS de
  glosas—, con fidelidad absoluta a lo dictado («No consta en el dictado.» si
  falta) y la firma la pone el sistema con el nombre real del auditor. El botón
  «Ver / compartir el PDF» baja `GET …/informe.pdf` (con el Bearer, vía
  expo-file-system) y lo abre con la hoja de compartir del teléfono
  (expo-sharing): un PDF con la marca —banda azul del logo, secciones en oro,
  tabla de cuenta, caja de análisis— renderizado al vuelo en el servidor con
  reportlab, sin persistir archivo alguno.
- **Corregir el informe dictando.** El texto del informe **no se pinta en la
  pantalla** (se hace largo): se revisa como va a salir, abriendo su PDF; la
  app solo confirma «Informe listo». Debajo hay una caja propia con su botón
  «Dictar la corrección» (el mismo micrófono Whisper, apuntando a esa caja):
  se dicta lo que falte o esté mal —«la edad es 54», «en comentarios que
  diga X en vez de Y»— y «Aplicar correcciones» llama a
  `POST …/informe/corregir`. La IA aplica SOLO lo dictado (las correcciones del
  médico son la autoridad, aunque el informe dijera «No consta en el dictado.»)
  y conserva el resto palabra por palabra; el PDF sale corregido porque se
  renderiza siempre del informe vigente.
- **Enviar informe.** Revisado el informe, el botón «Enviar informe» confirma
  enseñando a quiénes y manda el **PDF adjunto** a los correos marcados del
  caso y al mismo trío de todos los avisos —operador creador, supervisor de
  Concurrencia y supervisores de la aseguradora— (`POST …/informe/enviar`).
  La respuesta vuelve al instante —«Informe en camino a N correos»— y los
  correos salen en tarea de fondo; el envío queda en AuditLog como
  `informe_enviado` y cada correo deja su huella en el log del servidor.
  **Enviar es terminar el trabajo**: la visita programada pasa a `culminada`
  ahí mismo —la aseguradora la ve así en su panel y en la app el caso se muda
  a Historial en el siguiente refresco—. El PDF también aparece
  en la web: el operador y el supervisor de la compañía lo ven en el caso
  («Informe (PDF)»), y la supervisión de plataforma y el panel de Auditorías
  del admin en su diálogo Editar («Ver el informe (PDF)»). Sin
  `CLAUDE_API_KEY` en el servidor el botón responde 503 con un mensaje claro y
  el resto del panel sigue sirviendo; con la clave puesta, el informe aparece
  ahí mismo y «Volver a redactar» lo reemplaza.
- Las notas son **dato clínico**: el `AuditLog` registra tipo y longitud,
  jamás el texto, y el servidor tampoco las escribe en su log.

En la bandeja, cada programada lleva un **semáforo contra el reloj**, con
texto además del color: verde con 2 h o más por delante («Faltan 5 h»),
anaranjado a menos de 2 h del inicio («Faltan 45 min») y rojo pasada la hora de
llegada («EN CURSO») o vencida sin culminar («Vencida»). El semáforo mira la
hora de llegada y la entrega del informe, que desde sep 2026 son dos plazos
distintos: el primero es su cita, el segundo el plazo de su informe
(`docs/modulos/concurrencia.md`).

---

## 3c. Claro u oscuro: lo elige el auditor

La bandeja lleva un botón de luna/sol que alterna entre las dos paletas de la
marca (`tema.ts`: `paletas.claro` y `paletas.oscuro`, con el semáforo
calibrado por fondo), y la elección se recuerda en el llavero
(`tema-contexto.tsx`). El login conserva su diseño nocturno propio.

---

## 4. Lo que todavía no está

- **Marcar culminada.** El caso ya se abre a pantalla completa (ver «El panel
  del caso»), pero el auditor todavía no puede cerrarlo desde la app.
- **Renovación de sesión**: la expiración por inactividad (30 min) manda al
  login otra vez. Para el uso en campo habrá que decidir entre alargar el TTL de
  las sesiones móviles o renovar el token en silencio.
- **Notificaciones push** («te derivaron un caso») y **distribución** (EAS
  Build, firma, tiendas o APK directo).
