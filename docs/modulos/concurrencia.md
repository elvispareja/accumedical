# Módulo: Concurrencia

Nombre público **«Auditoría de Concurrencia»**, dentro de la familia comercial
**Siniestro** (`modules.grupo`, desde `e5b9d7c3a248`). Su identidad técnica no
cambió: code y slug siguen siendo `concurrencia`, con sus rutas, tablas `conc_*`
y permisos intactos.

Seguimiento de los pacientes hospitalizados de una aseguradora en los prestadores
de su red. La primera pieza construida es la **bandeja de visitas**: programar la
ida del médico auditor a un prestador —se fija **a qué hora debe llegar**, y de
ahí salen los otros dos plazos— avisando a quien haga falta.

---

## 1. Entidades

### `conc_visitas`

La visita del médico auditor. Es el expediente raíz del módulo.

| Campo | Qué es |
|---|---|
| `codigo_interno` | `CONC-0001`, generado por una secuencia de la base |
| `paciente_nombre_principal` / `paciente_apellido_paterno` | **Obligatorios.** El paciente ES el caso: sin él no hay nada que auditar |
| `paciente_nombre_secundario` / `paciente_apellido_materno` | Opcionales (`e9f4c7b2d651`). El paciente se llama como toda persona de la plataforma: cuatro partes, solo letras — ver §2.1b de `01-esquema-bd.md` |
| `paciente_tipo_documento_codigo` / `paciente_numero_documento` | **Obligatorios.** FK al catálogo `tipos_documento`; el formato del número se valida contra el regex del catálogo (una cédula de 9 dígitos → `422` legible) |
| `aseguradora_id` | **La palanca de ownership.** Toda consulta arranca acotada por ella |
| `prestador_id` | A quién se visita. Tiene que tener convenio **vigente** con esa aseguradora |
| `sede_id` | A dónde se va. `NULL` significa **casa matriz**: la dirección propia del prestador |
| `desde` | **A qué hora debe llegar el auditor.** Lo único que se teclea de los tres plazos |
| `hasta` | **Cuándo vence la entrega del informe**: `desde` + las horas de SLA de esa compañía. No se teclea ni se acepta por la API. `CHECK (hasta > desde)` |
| `llegada_limite` | **Hasta cuándo se le acepta la llegada.** Nace igual a `desde`; cada prórroga lo empuja a «ahora + las horas concedidas». `CHECK (llegada_limite >= desde)` |
| `estado` | `programada` · `asignada` · `auditando` · `cancelada` · `culminada` (el sexto, `no_auditado`, se eliminó el 27/10/2026 con `d8b4f2e6a913`). **Ninguno se elige**: cada uno lo pone una acción (ver «La máquina de estados»). No se acepta por la API —no existe el campo en ningún esquema de escritura— ni hay desplegable en ninguna pantalla |
| `llegada_at` | Cuándo el auditor marcó **«Ya llegué»** desde la app. `NULL` = todavía no ha llegado |
| `observaciones` | Texto libre |
| `auditor_id` | A qué médico auditor se derivó el caso. `NULL` = sin asignar. FK a `users` con RESTRICT: un auditor con casos no se puede borrar |
| `comprobante_horario_path` | La imagen que comprueba el cambio de horario pedido por correo. Solo la ruta relativa en el volumen de subidas, como los logos |

### `conc_visita_fotos`

Las fotos que el auditor toma en el hospital —hojas del expediente, resultados,
estados de cuenta—. Cada fila lleva `visita_id` y la **ruta relativa** del
archivo en el volumen de subidas (fuera del árbol ejecutable, como el
comprobante y los logos), con auditoría de fila y borrado lógico (el archivo se
queda: es evidencia). Son materia prima del informe igual que las notas: al
redactar, la IA las recibe como imágenes junto al dictado.

### `conc_visita_correos`

A quién se avisa. Varios por visita, con único parcial `(visita_id, email)` para
que no se repita el mismo. Se reconcilian como lista completa, con las bajas
volcadas antes que las altas. Cada correo lleva una **`etiqueta` opcional de
quién es** (`f8d2c6e4a917`): el contacto marcado la hereda de su ficha
(«RODOLFO ALARCON · Gerente General») y el tecleado a mano la escribe en su
campo «Quién es»; viaja en la lista «Este aviso se envió a:» de los correos del
caso, y se enseña en la página del caso del supervisor y en la app del auditor.

La tabla guarda **correos, no contactos**, aunque el formulario ofrezca marcar
los contactos del prestador: al guardar, el correo del contacto marcado y el
transcrito a mano acaban idénticos aquí. Es deliberado: una FK a
`prestador_contactos` acoplaría la visita a la vida del contacto —¿y si lo
borran, o le cambian el correo después de programada la visita?—, cuando lo que
se pactó fue avisar a una dirección concreta. Al reabrir, el reparto se rehace
contra los contactos de hoy: el correo que coincide vuelve como casilla marcada
y el resto como texto; si un contacto se borró desde entonces, su correo
reaparece como texto y no se pierde.

---

## 1-bis. La máquina de estados

**El estado no se elige: se deduce.** No hay un desplegable de estado en
ninguna pantalla —se retiró del alta y de la edición en sep 2026—, porque un
caso no está culminado porque alguien lo marque, sino porque el auditor mandó
su informe. Cada flecha la dispara una acción concreta:

```
crear ──► programada ──► asignada ──► auditando ──► culminada
               ▲   │         │
               │   └──► cancelada               (la compañía, hasta que termina)
               └──────── quitar el auditor lo devuelve

  «Fuera del SLA» no es un estado: es una marca de los abiertos (ver abajo).
```

| A | Quién | Con qué acción |
|---|---|---|
| `programada` | operador o coordinador | al crear el caso. **Lo impone el servidor**: aunque el cliente mande otro estado, nace programada |
| `asignada` | coordinador de plataforma | al derivar el caso a un auditor. Quitarle la asignación lo devuelve a `programada` |
| `auditando` | auditor | «Ya llegué» en la app. Sella `llegada_at` y **libra al caso de vencer** |
| `culminada` | auditor | al enviar el informe (desde `asignada` o `auditando`; enviar no resucita una cancelada ni una no auditada) |
| `cancelada` | la compañía | `POST /visitas/{id}/cancelar`, **hasta que el caso termina**, con el auditor ya dentro incluido: si al asegurado le dan el alta mientras se audita, no hay por qué esperar un informe que ya no sirve. Lo acabado (`culminada`, `cancelada`) responde `409` |
| — | nadie | **Un caso CERRADO ya no se edita**: `PATCH /visitas/{id}` responde `409` sobre `culminada` —el auditor mandó su informe, y cambiarle después el paciente, el prestador o los plazos lo convertiría en mentira— y sobre `cancelada` —no hay visita que preparar—. `no_auditado` **sí se edita**: el plazo de llegada venció sin que nadie llegara, y corregir el caso antes de reprogramarlo es lo que se quiere poder hacer. En la bandeja, el menú de un caso cerrado se queda solo con «Ver» |
| ~~`no_auditado`~~ | — | **Eliminado el 27/10/2026** (pedido del usuario: «eliminemos lo que dice no auditado y cambiemos el nombre a fuera del SLA»). Lo que se vigila es el SLA: ver «Fuera del SLA» más abajo. «Extender» (prórroga) y «Reprogramar un vencido» se retiraron de las pantallas |

### Cambios del 26–27/10/2026 (pedidos del usuario)

- **La hora la pone Accumedical, no la compañía.** El alta de la compañía ya no
  lleva hora; el coordinador fija la **ventana** al derivar: «Ir al hospital
  desde» (`desde`) y «Hasta» (`llegada_limite`). La compañía no ve el horario en
  ninguna pantalla ni en ningún correo (`router._resumen`, `con_horario=False`).
- **`hasta` es la entrega del informe y corre desde el PEDIDO**: el alta de la
  compañía (`created_at`) o, si el caso lo crea nuestra coordinación, la fecha y
  hora del **Requerimiento** (`requerimiento_medio` correo/otro +
  `requerimiento_recibido_at`), más las horas de SLA de la compañía. Sin CHECK
  `hasta > desde` (`c6a2d4f8e135`).
- **Póliza y titular** (`a7d3e9c1b852`): `poliza_numero` obligatorio;
  `paciente_es_titular`; si no lo es, titular con parentesco, nombre en cuatro
  partes y documento validado, distinto del paciente.
- **Fuera del SLA** (`service.fuera_de_sla`, reemplaza a `no_auditado`): caso
  abierto (programada/asignada/auditando) con `hasta` vencido. Cifra
  `fuera_sla`, filtro `?fuera_sla=true` de `/supervision/visitas`, insignia roja
  junto al estado y campo `fuera_sla` en cada caso de supervisión. Solo
  Accumedical. La tarea periódica (cada 5 min) **no cambia estados**: avisa una
  vez por la campana a la coordinación (AuditLog `visita_fuera_sla`, que es
  también la marca de «ya avisado»).
- **Ficha del caso del coordinador**: programada → «Derivar» (desde, hasta y
  auditor). Asignada → «Cuándo» de solo lectura y «Nuevo horario» (desde, hasta
  y auditor). Mismo auditor: AuditLog `visita_reprogramada`, correo «nuevo
  horario» al auditor y nada a la compañía. Otro auditor: derivación nueva.
  Sin «A quién se avisa», «Comprobante», «Entrega» ni «Plazo de llegada».
- **Refresco cada 10 s** (`REFRESCO_MS`) en listas, cifras y ficha de
  supervisión, bandeja y panel de la compañía. El formulario de edición no.
- **Enviar informe**: siempre a los fijos —quien creó el caso, coordinación de
  la compañía y de Accumedical— más los correos del caso; sin correos marcados
  también se envía. **Enviado, se bloquea**: 409 en redactar, corregir y enviar
  sobre un culminado, con la fila bloqueada (`FOR UPDATE`) contra el doble envío;
  la app apaga los botones y oculta «Corregir el informe».
- **Reportería** (`/reporteria`, solo coordinador de plataforma): SLA, sexo y
  edad (estos dos de las líneas `GENERO:` y `EDAD:` del informe), con gráficos,
  atajos de periodo y «Imprimir / PDF» con el filtro como título
  (`reportes.py`, `GET /supervision/reportes/{sla,sexo,edad}`).

Tres decisiones que conviene no deshacer:

- **Derivar mueve el estado, y solo entre los pendientes.** Reasignar un caso
  que ya se está auditando no lo devuelve a `asignada`: el médico ya llegó, y
  eso no se borra cambiando de nombre en una lista.
- **«Ya llegué» es idempotente.** Pulsarlo dos veces —o reintentar con mala
  cobertura— responde `200` con la llegada que ya estaba sellada, no un error:
  por eso el guardia admite `asignada` **y** `auditando`. Desde un estado
  terminal sí corta con `409`.
- **Cancelar es un endpoint propio, no un campo del PATCH.** Así la auditoría
  guarda `visita_cancelada` con nombre y no un `estado: cancelada` perdido
  entre los campos editados, y la regla de hasta cuándo se puede vive en un
  solo sitio. **Se puede hasta que el caso termina** —con el auditor ya dentro
  incluido, desde sep 2026—: si al asegurado le dan el alta mientras se audita,
  la compañía no tiene por qué esperar un informe que ya no sirve. Lo acabado
  (`culminada`, `cancelada`) no se toca.

- **Un caso vencido se corrige y se reprograma; no se resucita solo.** Por eso
  `no_auditado` **sí se edita** —al revés que culminada y cancelada—: la visita
  no ocurrió, y lo que hace falta es darle fecha nueva. Solo una hora en el
  FUTURO lo devuelve a la agenda: corregirle el nombre al paciente de un caso
  vencido no resucita nada. El auditor no puede hacerlo desde su app, porque el
  caso ya no está en su trabajo por delante.

Un caso `auditando` que nunca recibe informe **se queda ahí**: es la verdad
—el médico llegó, falta el informe— y el coordinador lo ve en su panel. No se
inventa un estado para eso.

---

## 2. Reglas de negocio

- **El paciente es obligatorio, entero.** Nombre principal, apellido paterno, tipo y número de identificación: `NOT NULL` en la base y validación de formato contra el catálogo en el servicio (reutiliza `validar_documento` de los contactos). El nombre secundario y el apellido materno son opcionales. Las cuatro partes admiten **solo letras (con tildes y eñes) y espacios** — ni números ni símbolos —: lo impone Pydantic en el servidor con el validador de `app/shared/personas.py` y el formulario además los filtra al teclear. El nombre completo —compuesto en un solo sitio— viaja en todos los avisos por correo, en los listados y en la tarjeta del auditor; **donde se ENSEÑA el expediente** —la página del caso— van las cuatro casillas, las mismas del alta.
- **Solo prestadores de la red.** Se ofrece —y se acepta— únicamente un prestador
  con convenio `vigente` y no eliminado. Se comprueba contra la base en el alta y
  en cada edición: si el convenio se termina mientras el formulario está abierto,
  el guardado se rechaza.
- **La casa matriz es un destino más.** Tener sedes no la saca de la lista: un
  hospital con sucursales sigue teniendo su central, y a veces es ahí donde hay
  que ir. En la base eso es `sede_id` nulo, exactamente lo mismo que ya guardan
  los prestadores sin sedes. Una sede inactiva sí queda fuera: no es sitio al que
  mandar a nadie.
- **Elegir destino es obligatorio, pero solo en el formulario.** Cuando el
  prestador tiene sedes, la interfaz no preselecciona nada para que nadie
  programe una visita a la matriz por inercia. El servidor no impone esa
  elección: para él, ausencia de sede es una respuesta válida y no una omisión.
- **Un destino se identifica por su ciudad y provincia, no por su calle.** Entre
  la matriz y las sedes lo que hay que distinguir es a qué ciudad se viaja —Quito
  o Guayaquil—; la dirección exacta importa cuando ya se está yendo, así que va
  debajo y no en el desplegable. Además la dirección del prestador es opcional
  mientras que la ciudad casi nunca falta: nombrar por la calle dejaba destinos
  reales rotulados como «sin dirección registrada».
- **La ubicación se resuelve por el destino entero, no campo a campo.** La bandeja
  devuelve `lugar`, `ciudad_nombre` y `provincia_nombre` ya resueltos: los de la
  sede si la visita es a una sede, los del prestador si es a la matriz. Nunca se
  mezclan —nada de «la ciudad de la sede o, si falta, la del prestador»—, porque
  eso mandaría al auditor a la otra punta del país.
- **La sede tiene que ser de ese prestador.** Cambiar de prestador en una edición
  obliga a revisar la sede: se valida el **estado resultante**, no cada campo
  suelto.
- **De los tres plazos solo se teclea uno.** Se pone la hora de llegada del
  auditor y el servidor deriva los otros dos: la entrega del informe es esa hora
  más las **horas de SLA** que la compañía tiene pactadas para Concurrencia
  (reloj corrido: con 23 h, llegar el 27 a las 15:00 entrega el 28 a las 14:00),
  y el plazo de llegada nace en la hora tecleada. **Sin SLA no se abre el
  caso**: no se sabría para cuándo es. Reprogramar recalcula la entrega con el
  SLA vigente y devuelve el plazo de llegada a la hora nueva —las prórrogas de
  la cita anterior no valen para una cita distinta—. `hasta` se materializa en
  la fila: renegociar el SLA mañana no mueve un caso ya abierto.
- **Derivar es del supervisor de plataforma.** La bandeja global —los casos de
  TODAS las aseguradoras— y la asignación de auditor solo responden a personal
  de plataforma con rol `supervisor` en el módulo: un usuario de compañía
  (aunque sea supervisor de la suya) o un auditor reciben el mismo `403`
  genérico. Se puede derivar únicamente a **auditores de plataforma activos**
  con acceso vivo a Concurrencia, validado contra la base al momento de asignar;
  `null` deja el caso sin asignar. Cada derivación escribe `visita_derivada` en
  `audit_log`, con el antes y el después.
- **`no_auditado` es interno de Accumedical.** La compañía no lo ve: su bandeja,
  su panel y sus cifras le siguen enseñando el estado que el caso tenía al
  vencer —`asignada` si ya había auditor, `programada` si no—, y su filtro de
  estado usa la misma equivalencia, para que filtrar «Asignada» encuentre lo que
  la lista enseña como asignada (`service.estado_visible` y
  `service.condicion_de_estado`). El motivo: para ella el caso sigue pendiente y
  el vencimiento suele resolverse con una prórroga en un par de horas;
  anunciarle un problema de casa ajena que quizá dure dos horas sobra. Lo que sí
  ve es el final: cancelada o culminada no se traducen.
- **La prórroga es del coordinador de Accumedical.** «Extender» le da al auditor
  más horas para llegar, **contadas desde que se pulsa** —a las 16:00, dos horas
  son las 18:00, no la hora original más dos— y se puede repetir hasta que
  llegue. Devuelve el caso vencido a la agenda (si no, el auditor seguiría sin
  poder marcar su llegada) y **no mueve la entrega del informe**: son dos plazos
  distintos y mezclarlos borraría la prueba de si el informe llegó tarde. Nunca
  recorta: sobre un caso que aún no vence, «ahora + 2 h» puede caer antes del
  plazo vigente y se queda el mayor de los dos.
- **El NO AUDITADO lo pone solo el servidor.** Una tarea periódica del arranque
  (`main.py`, cada 5 minutos con primera pasada inmediata, bajo advisory lock
  para que un solo worker la corra) busca toda visita **pendiente**
  —`programada` o `asignada`— cuyo **plazo de llegada** ya venció
  (`llegada_limite < now()`) **sin llegada registrada** (`llegada_at IS NULL`) y
  la pasa a `no_auditado`, escribiendo `visita_no_auditada` en `audit_log` por
  cada caso (acción del sistema: sin usuario ni request) y avisando por la
  campana **solo a la coordinación de Accumedical**. Mira el plazo de llegada y
  no la entrega del informe: así un auditor que nunca fue se detecta el mismo
  día y no cuando ya no hay margen para nada. **Mira los dos estados**: si solo mirara
  `programada`, un caso derivado que nadie visitó no vencería nunca. Las
  `auditando` quedan fuera porque ahí el auditor SÍ llegó: ese caso termina con
  su informe y, mientras tanto, se ve tal cual en el panel.

### Por qué dos de estas no son claves foráneas

Ninguna es un descuido:

- **El convenio** vive en `aseguradora_prestador`, cuya unicidad es **parcial**
  (`WHERE deleted_at IS NULL`), y un índice parcial no puede respaldar una FK.
- **La sede** sí podría garantizarse con una FK compuesta, pero exigiría añadir un
  `UNIQUE (id, prestador_id)` redundante a `prestador_sedes`, o sea un `ALTER`
  sobre una tabla del núcleo. La regla de escalar a ocho módulos dice justo lo
  contrario: añadir un módulo son tablas nuevas y cero cambios en las existentes.

### Cuando una compañía programa un caso, se avisa por dos vías

Las dos salen del alta y **solo del alta**: editar no reenvía nada.

| Vía | A quién | Cuándo |
|---|---|---|
| **Correo** | A cada correo del caso, al operador que lo creó, al coordinador de plataforma y a los de la compañía | **Después** de responder, como tarea de fondo: un envío es irreversible y lento, y un SMTP caído ya dejó a nginx cortando con 504 un caso perfectamente creado |
| **Campana** | A la coordinación de Concurrencia en Accumedical, al administrador global y a **la coordinación de la propia aseguradora** | **Dentro** de la misma transacción del caso: un aviso de algo que no llegó a guardarse sería mentira, y aquí no hay nada irreversible que proteger |

El aviso de la campana dice el módulo, la compañía y el estado con el que nace
—«Auditoría de Concurrencia · LA UNION · Programada»— y lleva **a la página del
caso**, que no está en el mismo sitio para los tres, y por eso la URL se guarda
en cada notificación y no se deduce del módulo:

| Quién | A dónde le lleva su aviso |
|---|---|
| Coordinación de Accumedical | `/concurrencia/supervision/<id>` |
| Administrador global | `/admin/auditorias/concurrencia/<id>` |
| Coordinación de la aseguradora | `/concurrencia/<id>/ver`, el caso de su compañía en solo lectura |

Las dos primeras rutas le responderían `403` a la tercera persona, y al revés:
cada cual entra por la suya.

**Las dos vías buscan a los coordinadores por las MISMAS dos puertas** —la fila
del módulo y, según el lado, la familia (`user_grupo_access`) o la compañía
(`user_aseguradora_coordinador`)—. Mirar solo `user_module_access`, como se hacía,
dejaba sin aviso justo a los coordinadores que hoy existen: primero se descubrió
en el correo y después, con un caso real, en la campana de la aseguradora.

Las notificaciones escritas antes de sep 2026 llevan el formato viejo
`?caso=<id>`; el panel las redirige a la página, así que siguen abriendo donde
deben.

**En la bandeja de entrada del coordinador**, el módulo pone dos piezas a través
de `modules/concurrencia/bandeja.tsx`: el **número de su cuadro** y sus **casos
traducidos** a la forma común —código, aseguradora, prestador, cuándo y estado—,
que la tabla compartida pinta igual que los de las demás auditorías. Las dos
comparten clave de consulta, así que es una sola petición. Lo específico del módulo
—filtros, derivar a un auditor, reprogramar— **no está ahí**: sigue en su panel y
en la página del caso.

Cuando el caso lo programa el propio coordinador no se escribe ninguna
notificación: ya lo sabe.

**Al DERIVAR el caso a un médico auditor se avisa otra vez**, y a dos sitios
distintos:

| Vía | A quién | Qué dice |
|---|---|---|
| **Campana** | A los dos lados de la compañía: **la coordinación** de la aseguradora y **el operador que programó el caso** | «Auditoría de Concurrencia · CONC-0025 · HOSPITAL … · **Asignada**». Dentro de la misma transacción de la derivación |
| **Correo** | Al **médico auditor** derivado | Sus datos exactos del caso, en tarea de fondo tras responder |

**Cada uno abre el caso por SU puerta**, y por eso la URL se guarda en la
notificación: la coordinación en `/concurrencia/<id>/ver`, solo lectura —las
visitas las gestiona el equipo operador—, y el operador en `/concurrencia/<id>`,
su ficha de siempre.

Tres decisiones, para no deshacerlas sin querer:

- **Al creador solo si es de la compañía.** Cuando el caso lo programó la propia
  coordinación de plataforma no hay operador al que avisar, y avisarle a quien
  derivó de su propia derivación sobraría.
- **A quien deriva no se le avisa**, que acaba de hacerlo.
- **El aviso NO dice quién es el auditor.** A quién manda Accumedical es asunto
  de Accumedical —por eso el estado se lee «Asignada» y no «Asignada a
  Fulano»—; lo que la compañía necesita saber es que su caso ya tiene médico.
  Por lo mismo el subtítulo no repite la compañía, que para los dos es obvia:
  lleva **el código del caso y el prestador**, que es lo que lo identifica.

**Quitar la asignación no avisa a nadie**: no hay nada que contar ahí.

**Al ENVIAR el informe también se avisa a los TRES**, con «… ·
**Culminada**»: es el final que todos esperaban. El correo con el PDF firmado
sale aparte y a más gente —los correos anotados del caso—; la campana es de
quien trabaja en la plataforma.

**Y cuando el auditor marca «Ya llegué» en la app se avisa a los TRES**: al
operador que programó el caso y a las **dos** coordinaciones —aquí sí entra la
de Accumedical, porque esto no lo hizo ella—, con el estado nuevo:
«… · **Auditando**». Al auditor no, que acaba de pulsarlo. La llegada **no manda
ningún correo**: es un cambio de estado, no un hecho que haya que documentar
fuera de la plataforma.

Los tres avisos —derivación, llegada y el del alta— salen del mismo par de
funciones (`_destinos_del_aviso` y `_escribir_aviso`), así que **cada quien
entra siempre por su puerta**: el operador a su ficha, la coordinación de la
compañía al caso en solo lectura, y la de Accumedical a su panel de supervisión.
La de uno le responde `403` a los demás, y por eso la URL se guarda por
notificación.

---

## 3. Roles y permisos

| Permiso | supervisor | operador | consulta | auditor |
|---|:--:|:--:|:--:|:--:|
| `dashboard:ver` | ✅ | ✅ | ✅ | ✅ |
| `visitas:leer` | ✅ | ✅ | ✅ | ✅ |
| `visitas:crear` | ✅ | ✅ | — | — |
| `visitas:editar` | ✅ | ✅ | — | — |

Los permisos dicen qué puede hacer un rol; **quién es** también cuenta: las rutas
de supervisión exigen además personal de plataforma con rol supervisor, así que
un supervisor de compañía —mismo rol, otra pertenencia— no las ve. **El
administrador global también pasa**: `require_module_access` lo deja entrar como
supervisor de plataforma (enmienda a D-10, `docs/03 §6`), y su menú «Auditorías
→ Concurrencia» monta esta misma bandeja.

La misma doble puerta corta en el otro sentido: **el supervisor de la compañía
solo mira y supervisa** —crear y editar visitas es trabajo del operador—. No se
le puede quitar el permiso al rol porque la fila de `supervisor` es la misma que
usa el de plataforma (que sí edita en sus rutas de supervisión), así que
`_aseguradora_operadora` rechaza sus mutaciones por pertenencia, con el mismo
403 genérico.

Y dentro de la compañía, **cada operador ve solo SU bandeja**: los casos que él
creó (`created_by`). El caso de un compañero responde el mismo 404 que uno de
otra aseguradora —listar, abrir y editar—, y el parámetro `?creado_por=` solo
obedece al supervisor: al operador se le impone su propio id. Ver el equipo
entero es exclusivo de los supervisores, en la web de la aseguradora y en la
supervisión de plataforma por igual (el auditor, en su app, ya veía solo lo
derivado a él).

El router lleva `require_module_access("concurrencia")` a nivel de `APIRouter`, así
que un endpoint nuevo nace protegido; el permiso concreto va en cada uno.

---

## 4. Endpoints — `/api/v1/concurrencia`

| Método | Path | Permiso | Descripción |
|---|---|---|---|
| GET | `/status` | `dashboard:ver` | Placeholder del módulo |
| GET | `/dashboard` | `dashboard:ver` + **solo supervisor de compañía** | El panel del supervisor: totales por estado, cuántas visitas programadas tocan **hoy** (hora de Ecuador, desfase fijo −5) y las **próximas cinco** programadas. Cifras de todo el equipo, que es justo lo que un operador no ve: 403 genérico para el resto |
| GET | `/pacientes/buscar` | `visitas:leer` | `?tipo=&numero=`: si ese documento ya pasó por un caso de **MI aseguradora**, devuelve sus nombres. Es lo que contesta al botón «Buscar paciente» del alta, que es el PRIMER paso del formulario. Acotado por ownership a propósito: un paciente de otra compañía no existe para quien pregunta |
| GET | `/pacientes` | `visitas:leer` **+ supervisión** | **Lo que el módulo aporta al listado de pacientes**: las personas que ha registrado, **una por documento** (`tipo`+`número`), con sus cuatro partes del nombre, el nombre ya compuesto, cuántos casos tiene y el último. El nombre sale del caso **más reciente** —un apellido corregido después es el bueno—. **Sin aseguradora**: un mismo paciente puede entrar por varias, así que poner una sola sería mentir; el paciente es la persona. `?search=` por nombre completo o documento; orden alfabético por nombre; paginación |
| GET | `/pacientes/{tipo}/{numero}` | `visitas:leer` **+ supervisión** | **Una persona**, por su documento: los mismos datos del listado más su primer caso. `404` si este módulo no la ha registrado nunca, que es lo que hay que decir |
| GET | `/correos-por-defecto` | `visitas:leer` | **A quién se avisa siempre** de un caso de esa compañía, además de los que se anoten: quien lo crea y las dos coordinaciones, cada uno con quién es. Sale de la MISMA función que usa el envío (`notificaciones.correos_por_defecto`), así que lo que enseña el formulario es exactamente lo que va a salir. `?aseguradora_id=` solo lo obedece la supervisión; a quien es de una compañía se le impone la suya |
| GET | `/prestadores` | `visitas:leer` | Los prestadores de MI red **con sus sedes y sus contactos**. Alimenta el formulario, y es lectura: también lo necesita quien solo mira el caso para pintar destino y contactos |
| GET | `/operadores` | `visitas:leer` + **solo supervisor de compañía** | Los operadores de MI aseguradora (también inactivos: sus casos viejos siguen existiendo), para filtrar el historial por quién creó cada caso |
| GET | `/visitas` | `visitas:leer` | Bandeja: `?search=` (paciente —las cuatro partes concatenadas con `concat_ws`, así «MARIA PAREJA» cruza segundo nombre y apellido—, número de documento, código del caso o prestador), `?estado=`, `?desde=`, `?hasta=`, `?creado_por=` (id del operador autor; **solo obedece al supervisor**: al operador se le impone su propio id), paginación |
| GET | `/visitas/{id}` | `visitas:leer` | Detalle con sus correos. Para el operador, solo los casos que él creó: el de un compañero es un 404 |
| POST | `/visitas/{id}/cancelar` | `visitas:editar` + su propio caso | **La única forma de mover el estado desde la compañía.** Pasa el caso a `cancelada` mientras no haya terminado —`auditando` incluido—; sobre lo acabado, `409`. Escribe `visita_cancelada` en `audit_log` con el antes y el después |
| POST | `/visitas` | `visitas:crear` + **no ser supervisor de compañía** | Alta: prestador, sede, **la hora de llegada del auditor** (`desde`; la entrega sale del SLA y no se acepta del cliente), `correos` y observaciones. **Avisa por correo como tarea de fondo, después de responder** (la respuesta nunca espera al SMTP: uno inalcanzable llegó a colgar el alta hasta el 504 de nginx), con los datos exactos del caso, a cada correo de la visita, al **operador que creó el caso**, a **quien coordina Concurrencia en Accumedical** y a **quien coordina la propia aseguradora** (cada rol etiquetado en la lista de destinatarios que enumera el propio mensaje). Los dos coordinadores se buscan **por sus dos puertas** —la fila del módulo y, según el caso, la familia o `user_aseguradora_coordinador`—, las mismas que usa la campana: mirar solo `user_module_access`, como se hacía, dejaba sin correo justo a los coordinadores que hoy existen |
| PATCH | `/visitas/{id}` | `visitas:editar` + **no ser supervisor de compañía** | Edición parcial; `correos` se reconcilia como lista completa. El operador solo edita lo suyo: el caso de un compañero es un 404 |
| GET | `/auditor/visitas` | `visitas:leer` + personal de plataforma | Los casos derivados **al propio usuario**, completos, próximos primero, **con el punto exacto del destino** (`destino_latitud`/`longitud`: la sede si la hay, la casa matriz si no) para abrir el mapa desde la app. Sin parámetros: el ownership es `auditor_id = su id` |
| GET | `/auditor/visitas/{id}/panel` | `visitas:leer` + plataforma + **caso derivado a él** | El panel del caso en la app: las notas dictadas, el informe vigente y `llegada_at`. El caso de otro auditor es un 404 idéntico |
| POST | `/auditor/visitas/{id}/llegada` | ídem | **«Ya llegué»**: sella `llegada_at` con la hora del servidor y audita `llegada_registrada`. Idempotente —repetirlo no mueve el sello—; sobre un caso que no esté `programada`, 409 |
| POST | `/auditor/visitas/{id}/notas` | ídem | Un dictado del auditor, tipificado: `historial_clinico`, `charla_medico` u `observacion` (`charla_enfermeria` es legado: se muestra pero ya no se crea). El texto es dato clínico: al AuditLog solo van tipo y longitud, jamás el contenido |
| DELETE | `/auditor/visitas/{id}/notas/{nota_id}` | ídem | Retira un dictado equivocado (borrado lógico, como todo) |
| POST | `/auditor/visitas/{id}/fotos` | ídem | Una foto del caso (A08: MIME real de imagen PNG/JPEG/WebP, tope de **5 MB** —el máximo por imagen de la API de Claude—, nombre UUID, fuera del árbol ejecutable). Audita `foto_subida` con MIME y tamaño, jamás la imagen |
| GET | `/auditor/visitas/{id}/fotos/{foto_id}` | ídem | La imagen para las miniaturas de la app, con Content-Type fijado y sin sniffing |
| DELETE | `/auditor/visitas/{id}/fotos/{foto_id}` | ídem | Retira una foto (borrado lógico; el archivo queda como evidencia). Audita `foto_eliminada` |
| POST | `/auditor/visitas/{id}/dictado` | ídem | **El micrófono de la app**: recibe el audio dictado (MIME real de audio, tope de subida) y devuelve su texto, transcrito **localmente con Whisper** (faster-whisper, CPU, `STT_MODELO`) — el audio clínico no sale del servidor y se borra apenas transcrito. No persiste nada: la nota se guarda al confirmarla |
| POST | `/auditor/visitas/{id}/informe` | ídem | **Redacta el informe con Claude** a partir de las notas **y de las fotos del caso**, que viajan como bloques de imagen (cada una normalizada antes a 1568 px y JPEG liviano —`informe.preparar_foto`, con la orientación EXIF corregida—: es lo que la API de visión usa de verdad, y así ni las fotos de 48 MP del iPhone ni un lote grande tumban el request; una foto rota se salta con su huella en el log): la IA transcribe a su sección lo que se lea con claridad (valores a LABORATORIO, rubros a CUENTA) y jamás inventa lo ilegible. La regla: exige **las tres** notas —historial clínico, charla con médico y observación—; con menos responde 422 diciendo cuáles faltan. Con muchas fotos la generación **tarda 2-3 minutos**: nginx espera hasta 300 s en `/api` y `CLAUDE_TIMEOUT_SEC` (240) queda por debajo a propósito para que el error legible llegue antes del corte; `max_tokens` va en 16000 porque transcribir fotos ya chocó el tope dos veces. Primero responde la IA y solo entonces se guarda en `conc_visitas.informe`; sin `CLAUDE_API_KEY` responde 503 con mensaje claro y el resto del panel sigue sirviendo |
| POST | `/auditor/visitas/{id}/informe/corregir` | ídem | **Corrige el informe con lo que el auditor dicta tras revisarlo** (`{"instrucciones": …}`): «la edad es 54», «que diga X en vez de Y». Sus correcciones son la autoridad —vienen del médico— y la IA cambia SOLO lo pedido, conservando el resto palabra por palabra; la firma se quita antes y se re-agrega con el nombre real, fuera del alcance de la IA. 409 sin informe previo. Audita `informe_corregido` con longitudes, jamás el texto |
| GET | `/auditor/visitas/{id}/informe.pdf` | ídem | El informe vigente como **PDF con la marca** (banda azul del logo, secciones en oro, tabla de cuenta, firma real del auditor en el pie), renderizado al vuelo con reportlab desde el texto guardado: no se persiste ningún archivo. **Con `FIRMA_P12_PATH` configurado sale además firmado electrónicamente (PAdES, pyHanko)** con el certificado de la empresa: sello visible en español en la última página y firma criptográfica verificable en Adobe; todos los PDF del informe salen por el mismo punto (`_pdf_del_caso`), así que todos salen firmados. Sin informe, 404 |
| POST | `/auditor/visitas/{id}/informe/enviar` | ídem | El botón «Enviar informe»: manda el **PDF adjunto** a los correos marcados del caso **y al mismo trío de todos los avisos —operador creador, coordinación de Concurrencia y coordinación de la aseguradora—** (la lista vive en `_destinatarios_del_caso`, compartida con el alta para que jamás diverjan; 422 si no hay correos; 404 si falta el informe). **Enviar es terminar el trabajo: la visita `programada` pasa a `culminada` en la misma transacción** (los demás estados no se tocan: enviar no resucita una cancelada ni una no auditada), y así la ve la aseguradora en su panel. Valida y responde al instante con `{destinatarios}`; los correos salen **en tarea de fondo tras responder** —dentro del request retenían la respuesta hasta el 504 con SMTP lento y cada reintento del botón duplicaba el envío—. Primero la huella `informe_enviado` en AuditLog; cada correo aislado deja la suya y la tanda cierra con `informe_enviado_correo` |
| GET | `/visitas/{id}/informe.pdf` | `visitas:leer` (compañía) | El mismo PDF para la aseguradora, con su ownership de siempre: el operador solo el de sus casos; su supervisor, todos. El detalle de la visita trae `tiene_informe` para saber cuándo ofrecerlo |
| GET | `/supervision/visitas/{id}/informe.pdf` | `visitas:leer` + supervisión | El mismo PDF para la supervisión de plataforma y el panel de Auditorías del admin; el detalle de supervisión también trae `tiene_informe` |
| GET | `/supervision/visitas` | `visitas:leer` **+ plataforma con rol supervisor** | Los casos de todas las compañías, con su aseguradora y su auditor. Filtros: búsqueda (aseguradora, prestador, código), estado, «solo sin asignar», **rango de fechas** (`?desde=`, `?hasta=`) y el **documento del paciente** (`?paciente_tipo_documento=` + `?paciente_numero_documento=`, los dos juntos o ninguno: media identificación no identifica a nadie), que es lo que pide la ficha del paciente, y que acota por los plazos del caso con las mismas reglas que la bandeja de la compañía: entra el que toque cualquier día del rango, no solo el que empiece dentro |
| GET | `/supervision/dashboard` | `visitas:leer` + supervisión | **Los cuadros del panel**: las mismas cinco cifras que ve el supervisor de una compañía de lo suyo, pero de TODAS las aseguradoras. Sin `proximas`: aquí el panel es la lista entera. La cuenta se escribe una sola vez en el servicio y la comparten los dos paneles |
| GET | `/supervision/aseguradoras` | `visitas:leer` + supervisión | Las compañías **activas y con Concurrencia habilitado**: sobre ellas puede programar el coordinador. Primer paso de su alta |
| GET | `/supervision/aseguradoras/{id}/prestadores` | `visitas:leer` + supervisión | La red de ESA aseguradora, con sedes y contactos — el mismo shape que `/prestadores`, mismo mapeo compartido |
| GET | `/supervision/pacientes/buscar` | `visitas:leer` + supervisión | La misma búsqueda de paciente del alta, acotada a la aseguradora elegida (`?aseguradora_id=&tipo=&numero=`) |
| GET | `/sla` | `visitas:leer` | Las horas de SLA de MI compañía para Concurrencia: de ahí sale la entrega del informe, y el formulario la enseña calculada mientras se elige la hora de llegada |
| GET | `/supervision/sla` | `visitas:leer` + supervisión | Lo mismo para el coordinador, que elige de qué compañía nace el caso (`?aseguradora_id=`) |
| POST | `/supervision/visitas/{id}/prorroga` | `visitas:editar` + supervisión | **La prórroga**: `{horas}` más para que el auditor llegue, **contadas desde ahora** (a las 16:00, dos horas son las 18:00). Repetible. Devuelve un caso vencido a la agenda —si no, el auditor seguiría sin poder marcar su llegada— y **no mueve la entrega del informe**. De 1 a 72 horas, y nunca recorta el plazo vigente |
| POST | `/supervision/visitas` | `visitas:crear` + supervisión | **El alta del coordinador de plataforma** (los pedidos le llegan por correo): el mismo cuerpo del alta de compañía más `aseguradora_id` (422 si no existe, está inactiva o sin el módulo). Mismas validaciones —convenio vigente de ESA red, sede suya, paciente completo—, audita `crear` con `origen: supervision`, y avisa igual que el alta de compañía (tarea de fondo), con el coordinador etiquetado como quien **creó el caso** |
| GET | `/supervision/auditores` | `visitas:editar` + supervisión | A quién se puede derivar: auditores de plataforma activos del módulo, **con su ciudad y provincia**. El diálogo de derivación los agrupa por cercanía al destino del caso — solo ordena, se puede derivar a cualquiera |
| PATCH | `/supervision/visitas/{id}/auditor` | `visitas:editar` + supervisión | `{"auditor_id": ...}` deriva —pasa el caso a `asignada`, **avisa por campana a la coordinación de la aseguradora y al operador que creó el caso** en la misma transacción y **por correo al auditor** en tarea de fondo, tras responder—; `null` desasigna sin avisar. Devuelve la fila entera |
| GET | `/supervision/visitas/{id}` | `visitas:leer` + supervisión | El caso entero —correos y observaciones incluidos—, tal como lo capturó la compañía |
| PATCH | `/supervision/visitas/{id}/horario` | `visitas:editar` + supervisión | **Reprogramar**: la hora de llegada nueva (la entrega se recalcula con el SLA y el plazo de llegada vuelve a la hora nueva). Audita `visita_reprogramada` y, en tarea de fondo tras responder, **avisa a todos** —correos del caso, supervisor y auditor—. **Ninguna pantalla lo llama desde sep 2026**: «Nueva fecha» se retiró del coordinador y quien reprograma es el operador, editando su ficha. Sigue vivo porque es lo que da sentido al comprobante de cambio de horario |
| POST | `/supervision/visitas/{id}/comprobante` | `visitas:editar` + supervisión | La imagen que comprueba el cambio pedido por correo. Mismas defensas que el logo: MIME real, tope de tamaño, nombre derivado de la visita. Reemplaza la anterior |
| GET | `/supervision/visitas/{id}/comprobante` | `visitas:leer` + supervisión | El archivo, con Content-Type fijado y sin sniffing |

**Las rutas de compañía se acotan a la aseguradora del usuario**, tomada de
`users.aseguradora_id` y nunca de un parámetro. Una visita de otra compañía
devuelve `404`, el mismo que si no existiera: no se confirma su existencia. Las
de `/supervision` son la excepción deliberada: globales por diseño, y por eso su
puerta es doble —permiso del rol **y** pertenencia a la plataforma—.

---

## 5. Pantallas

La portada del módulo depende de quién entra, y lo decide la sesión que calcula
el backend: **supervisor de compañía → su panel**; el resto del personal de
compañía → su bandeja; supervisor de plataforma → la bandeja global de
supervisión; auditor de plataforma → «Tus casos viven en la app móvil», con los
botones de descarga de Google Play y App Store **inertes a propósito** (la app
aún no está publicada, y la pantalla lo dice): el auditor trabaja desde el
celular, no desde el navegador. El conmutador solo elige qué pintar: la
autorización real la ejerce el backend en cada endpoint.

- **`/concurrencia` (supervisor de compañía)** — «Panel de supervisión», en dos
  pestañas. **Historial** (el total de todos): arriba **siete cifras** —una por
  estado (programadas, asignadas, auditando, culminadas, canceladas y **no
  auditadas**) más la de hoy; el número viste tinta de texto y la identidad la
  lleva el punto de color de la insignia de estado— y debajo **todos los
  casos** —la misma lista de la bandeja, empotrada, sin cabecera propia y sin
  crear (su menú de fila se queda solo con «Ver»)— con buscador, filtro de
  estado, rango de fechas y paginación de 25 en 25. **Cada cifra es también un
  filtro**: pulsarla no navega a ningún sitio, repinta la lista de abajo
  —«Hoy» pone solo el día, porque cuenta todo lo que sigue en pie; las demás,
  su estado— con los controles pintados para verlo y deshacerlo, y
  «Quitar filtros» vuelve a todos. **Operadores**: primero se elige un
  operador de la compañía y se ven **solo los casos que él creó**
  (`?creado_por=`), con los mismos filtros; cambiar de operador reinicia
  búsqueda y página. Clic en una fila, en ambas pestañas, abre el caso **en
  solo lectura** —el mismo formulario, todo deshabilitado y sin Guardar—,
  porque las visitas las gestiona el operador. Las cifras se refrescan solas
  cada minuto.

- **`/concurrencia` (supervisión)** — «Casos de las aseguradoras»: una fila por
  visita con su compañía, prestador y destino, ventana, estado y el auditor
  asignado. Arriba, **«Programar visita»**: el alta del coordinador —el mismo
  formulario del operador (compartido, no duplicado) con un bloque previo para
  **elegir la aseguradora**, cuya red define los prestadores ofrecidos; cambiar
  de compañía reinicia prestador, sede y contactos. El botón arma su destino
  sobre la ruta actual, así que también sirve tal cual en el panel de
  Auditorías del admin (`/admin/auditorias/concurrencia/programar`). **Derivar abre un diálogo** con los auditores en tres secciones
  según el destino del caso —«En la ciudad · {ciudad}», «En la provincia ·
  {provincia}» y «En otras provincias» (o una lista única si el caso no tiene
  ubicación)—, cada uno con dónde está, un buscador por nombre o ciudad,
  «Asignado» marcado al reabrir y «Quitar la asignación actual». Elegir asigna,
  cierra y el toast lo confirma con nombre. El lápiz de cada fila **abre el caso en su propia página** (ver abajo).
  **Arriba, los MISMOS cinco cuadros del panel de la compañía** —hoy,
  programadas, culminadas, canceladas y no auditadas— pero con las cifras de
  todas: es el mismo componente (`components/cifras.tsx`), no una copia, y
  pulsar uno tampoco navega, acota la lista. Las cifras **no siguen al rango de
  fechas**: son la foto completa, y por eso pulsar un cuadro **quita los demás
  filtros** —si se sumaran, el número del cuadro y lo que se ve debajo no
  cuadrarían—. Cuatro filtros: búsqueda, estado, **rango de fechas** («desde» y
  «hasta», el mismo par que la compañía) y «solo sin asignar» para repartir lo
  pendiente, con «Quitar filtros» cuando hay alguno puesto. Se refrescan solas
  cada minuto. Las piezas comunes de ambas bandejas —insignia de estado, ventana
  horaria— viven una sola vez en `components/visitas.tsx`.
- **Ver un caso (`/{id}/ver`, o cualquiera ya cerrado) enseña lo que pasó, no
  el formulario apagado.** «A quién se visita» pinta **solo el prestador al que
  se fue** —sin el buscador ni la lista de la red— y «A quién se avisa», **solo
  los correos a los que se avisó**, con su etiqueta y deshabilitados: sin las
  casillas de los contactos del prestador, que enseñaban a gente a la que NO se
  le mandó nada como si todavía se pudiera marcar (`docs/07`, §2).

- **`/concurrencia/supervision/{id}`** — el estado se enseña con **su insignia**
  y no con un desplegable apagado (que era lo que había): el estado no se elige
  en ninguna pantalla, así que tampoco se pinta como si se pudiera. Si el caso
  está vencido, al lado se explica que **la compañía no ve ese estado** y que
  «Extender» le da al auditor más horas para llegar. El caso
  visto desde la supervisión,
  **como página entera y no como diálogo** (lo fue hasta sep 2026): dirección
  propia, enlazable, y «atrás» hace lo esperado. El administrador global llega a
  la misma pantalla por `/admin/auditorias/concurrencia/{id}`, que es la suya.
  Enseña **el caso tal como lo capturó la compañía, con TODO deshabilitado** —el
  paciente en sus **cuatro casillas**, las mismas del alta, no el nombre ya
  compuesto— con los **tres plazos** a la vista (llegada del auditor, entrega
  del informe y plazo de llegada) y las dos únicas acciones habilitadas:
  **«Extender»** —más horas para que el auditor llegue, contadas desde que se
  pulsa— y **subir o reemplazar el comprobante** del cambio pedido por correo,
  que se ve ahí mismo. **«Nueva fecha» se retiró en sep 2026**: mover un caso de
  día es del operador, desde su ficha; lo del coordinador es dar horas. Es a donde llevan el lápiz de la
  lista, la fila de la bandeja de entrada y el aviso de la campana.
- **`/concurrencia`** — la bandeja de entrada del operador: **solo las visitas
  que él programó** (la puerta está en el backend, no en la pantalla). Búsqueda
  (paciente, documento, código o prestador), filtro por estado y por rango de
  fechas (desde y hasta), y una fila por visita con paciente, dónde, cuándo,
  cuántos avisos y en qué estado, de 25 en 25. Los filtros también se aceptan
  por URL (`?estado=…&desde=…&hasta=…`, validados antes de viajar al backend).
- **`/concurrencia/nueva`** y **`/concurrencia/{id}`** — el formulario. El
  paciente empieza por su **identificación**: tipo y número, y un botón **«Buscar
  paciente»** (`GET /pacientes/buscar`). **Las casillas del nombre no existen
  hasta haber buscado**, porque son la respuesta a esa búsqueda: si ese documento
  ya pasó por un caso de la misma aseguradora salen rellenas, con el aviso «Ya lo
  teníamos: <nombre>» y la nota de que se pueden corregir; si no, en blanco, con
  «No lo teníamos todavía… quedará registrado en Pacientes Accumedical». Buscar
  se PIDE: hasta sep 2026 ocurría solo a los 400 ms de teclear y nadie se
  enteraba de si el paciente ya estaba, que es la pregunta que se viene a hacer.
  Tocar el documento después **borra el nombre traído** —era el de otra
  persona— y guardar sin buscar avisa en lugar de dejar un «falta el nombre»
  incomprensible. Las casillas son las mismas que en contactos y
  usuarios —nombre principal y secundario, apellido paterno y materno— y salen
  del componente compartido `shared/personas/CamposNombre`, que filtra al
  teclear todo lo que no sea una letra. Se elige
  prestador de una lista con buscador; al elegirlo, la pantalla enseña **si tiene
  sedes** —y pide el destino— **o la dirección propia** a la que se irá. Debajo,
  **cuándo debe llegar el auditor** —con la entrega del informe debajo,
  calculada con el SLA y deshabilitada— y el bloque de avisos en dos partes: **los contactos
  del prestador con casillas** —se marcan solo los que deben enterarse, con
  contador «2 de 5 marcados» y la misma regla de tres filas y scroll— y **«Otros
  correos»**, transcritos a mano. Marcar un contacto y teclear además su mismo
  correo no es un error: se guarda una sola vez. Cambiar de prestador desmarca
  los contactos —son del otro— y conserva lo transcrito.

  Encima de todo eso, **«Correos por defecto»**: quien programa el caso y las
  dos coordinaciones, **deshabilitados y con quién es cada uno**. El aviso les
  llega igual, así que enseñarlos evita que alguien los teclee otra vez o crea
  que se olvidaron; y no llevan casilla porque no se pueden quitar. Salen del
  servidor, de la misma función que usa el envío, no de una lista escrita en la
  pantalla.

  Un caso **no auditado** se abre a editar como cualquiera, pero con su aviso
  sobre la casilla de la fecha —«venció sin que el auditor llegara; ponle fecha
  nueva y vuelve a la agenda»— y el botón de guardar rotulado
  **«Reprogramar visita»**: sobre un caso vencido, guardar es reprogramar, y el
  botón lo dice.

  En la **ficha del paciente** el módulo pone solo sus casos **terminados**, y
  ahí la fila lleva **al PDF del informe** en vez de a la pantalla del caso —si
  lo tiene: uno culminado sin informe abre el caso, que es lo honesto—. El
  filtro se pide como `soloFinalizados`, no por el nombre del estado: cada
  auditoría llama al suyo de otra forma, y en Concurrencia es «culminada».

  En la tabla, cada fila abre su **menú de tres puntos** con **Ver** —el mismo
  expediente en `/{id}/ver`, con todo deshabilitado— y **Editar**. Un caso
  **cerrado —culminado o cancelado— no ofrece editar**, y quien solo mira
  tampoco lo ve nunca. La ficha dice por qué no se puede tocar: «CONC-0011 ·
  solo lectura: el caso ya culminó», «… el caso está cancelado».

- **`/coordinacion/bandeja`** — la bandeja de entrada del coordinador **no es
  del módulo**, pero él pone su parte: un cuadro con cuántos casos tiene —que
  lleva a `/concurrencia`— y sus casos traducidos a las cinco columnas comunes.
  Traduce además los **filtros comunes** de la bandeja —texto y rango de
  fechas— a los suyos: el texto busca por aseguradora, prestador o código, y el
  rango acota por la ventana de la visita. El cuadro y la lista comparten
  consulta, así que el número del cuadro sigue al filtro y sale una sola
  petición.
  Las auditorías sin expediente construido salen igual, con su cuadro «en
  construcción», así que el suyo es hoy el único con número. Los dos
  salen de `modules/concurrencia/bandeja.tsx` y comparten consulta, así que es
  una sola petición. Lo suyo —filtros, derivación, acciones— no está ahí: sigue
  en su panel y en la página del caso.

Las rutas las expone el propio módulo en `web/src/modules/concurrencia/routes.tsx`
y el router raíz solo las compone, como manda la arquitectura. **`supervision/:id`
va declarada ANTES que `:id`**: ese segmento dinámico se tragaría «supervision» y
el coordinador acabaría en la ficha de la compañía, que le responde 403.

---

## 6. Lo que todavía no está

- **El alta y la derivación avisan por correo.** Al crearse el caso, cada correo de la
  visita, el operador que lo creó, el supervisor de Concurrencia y los
  supervisores de la propia aseguradora reciben los datos exactos (código,
  compañía, prestador, destino resuelto, ventana en hora de Ecuador, estado y
  observaciones), **enumerando en el propio mensaje a todos sus destinatarios** —cada quien ve quién más está enterado, con cada rol señalado—, sin repetir destinatario y con cada envío aislado, **en tarea de fondo tras responder**: un buzón
  que rebota no frena a los demás ni rompe la respuesta, porque el caso ya está
  creado. La **derivación** también avisa: al asignar (o reasignar) un caso, el
  auditor recibe los mismos datos exactos con su nombre; desasignar no manda
  nada. Lo que **no** avisa todavía: editar la visita, y la **notificación push
  a la app móvil** —pendiente de que la app tenga build propio (Expo Go en
  Android ya no admite push) y de guardar el token del dispositivo—. Los avisos
  viven en `modules/concurrencia/notificaciones.py`, con el bloque de datos
  compartido entre el alta y la derivación.
- **Notificación push al derivar.** El auditor ya recibe el correo y ve el
  caso en su app móvil (se refresca sola cada 10 s), pero el aviso tipo
  WhatsApp con la app cerrada espera a que la app tenga build propio: Expo Go
  en Android ya no admite push.
- **No se registra qué médico auditor va.** No se pidió, y no se inventa un campo
  sin saber si el auditor es un usuario de la plataforma, un prestador de tipo
  médico o un nombre suelto.
- **Nada consulta las coberturas contratadas.** Una visita no comprueba si la
  aseguradora tiene tal cobertura: cuando haga falta, el dato ya está en
  `aseguradora_coberturas`.
