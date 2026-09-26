# Convenciones de interfaz

Cómo se capturan los datos y cómo se comportan los componentes que comparten todas
las pantallas. `CLAUDE.md` fija el sistema de diseño —tokens, dark mode, Framer
Motion con criterio, accesibilidad, responsive desde 360 px—; esto es la capa de
abajo: las decisiones concretas que ya están tomadas y que conviene no volver a
discutir en cada formulario.

Existe porque estas reglas se estaban acumulando en
`docs/04-estado-implementacion.md`, que es una foto de qué está construido, no la
referencia de cómo se construye.

---

## 1. Los expedientes se escriben en MAYÚSCULAS

Razón social, nombre del prestador, direcciones, especialidades, nombres de
contacto, cargos, nombres de sede: todo lo que es dato de expediente se teclea y se
guarda en mayúsculas.

**Dónde vive.** En el primitivo `Input` (`shared/components/ui/input.tsx`), **activo
por defecto**. No es una decisión por campo: un campo nuevo la hereda sin que nadie
tenga que acordarse, igual que un endpoint nuevo nace protegido por la dependencia
del router.

**Se transforma el valor, no el aspecto.** Con `text-transform` de CSS se vería en
mayúsculas y se guardaría como se tecleó; ese desajuste no lo descubre nadie hasta
que consulta la base. Se sustituye el valor por una cadena de la misma longitud, así
que el cursor no salta.

**Qué queda fuera, y por qué:**

| Excluido | Motivo |
|---|---|
| `type` = `password`, `date`, `time`, `number`, `url`, `file` | Poner mayúsculas rompería el dato o el control del navegador |
| `type="email"`, **salvo que se pida con `mayusculas`** | El correo del login se deja como se teclea; el de un contacto o una sede **sí** va en mayúsculas, porque es dato del expediente |
| Cualquier campo cuyo `autocomplete` sea una credencial (`current-password`, `new-password`, `one-time-code`, `webauthn`) | **La trampa real**: un campo con botón de «mostrar contraseña» cambia su `type` a `text` al pulsarlo, así que mirar solo el tipo lo dejaría desprotegido justo cuando está a la vista. `autocomplete` no cambia al alternar |
| Cajas de búsqueda, marcadas a mano con `mayusculas={false}` | No son dato del expediente. La búsqueda es insensible a mayúsculas de todos modos |
| **Etiquetas del sistema** —el nombre de un tipo de prestador y lo que venga en Parámetros—, también a mano | Tampoco son dato del expediente: son opciones de un desplegable. «CENTRO DE IMÁGENES» junto a «Hospital» y «Clínica» se ve como un error, no como un dato |

Los acentos y la eñe se conservan: `josé peñafiel` → `JOSÉ PEÑAFIEL`. Se usa
`toUpperCase()` y no `toLocaleUpperCase()`, que dependería de la configuración
regional del navegador.

### El correo, caso aparte

El correo de un contacto o de una sede **sí va en mayúsculas**: es dato del
expediente y se lee junto al resto. Se pide con `mayusculas` explícito, que manda
sobre la exclusión por tipo.

Que eso no rompa nada descansa en dos cosas, y conviene tenerlas presentes antes de
tocarlo:

1. **Las columnas de correo son `citext`** —`users.email`, `aseguradora_contactos.email`,
   `prestador_contactos.email`, `prestador_sedes.email`—, así que comparar es
   insensible a mayúsculas. **Quien inicie sesión no tiene que respetar el caso**:
   `ASOTO@X.COM` y `asoto@x.com` son la misma cuenta, y el índice único también lo
   ve así, de modo que no se pueden dar de alta las dos.
2. **El servidor lo pasa entero a mayúsculas al guardar.** Sin eso quedaría a
   medias: `EmailStr` de Pydantic valida y de paso normaliza el **dominio** a
   minúsculas, así que lo tecleado saldría como `ASOTO@seguroslanion.com`.

El campo del login **no** se transforma: ahí no se captura un dato, se identifica a
alguien, y se acepta como venga.

**El servidor no impone las mayúsculas del resto de campos.** Un cliente que llame a
la API directamente puede guardar en minúsculas. Es una convención de captura, no
una invariante de datos; el correo es la excepción, por el motivo 2.

---

## 2. Formularios de alta y edición

- **Son páginas, no paneles laterales.** `/nueva` y `/{id}/editar`. Hay sitio para
  agrupar en bloques, la dirección es enlazable y el botón «atrás» hace lo esperado.
- **Un expediente se enseña con las MISMAS casillas con las que se capturó.**
  Si el nombre se teclea en cuatro —principal, secundario y los dos apellidos—,
  verlo no puede ser una sola casilla con todo pegado: se reusa `CamposNombre`
  con `deshabilitado`. El nombre ya compuesto es para los listados y los avisos,
  donde solo se lee de corrido.
- **Mirar no es elegir.** Un expediente en solo lectura enseña **lo que pasó**,
  no el formulario apagado con el que se capturó: nada de listas de opciones
  —los prestadores de la red, los contactos del prestador— donde solo una está
  marcada. Enseñarlas confunde de verdad: quien mira ve al gerente del hospital
  con su casilla al lado y se pregunta por qué podría marcarlo si a él no se le
  avisó. Así que se pinta **solo lo elegido**: el prestador al que se fue, y los
  correos a los que se avisó, cada uno en su casilla deshabilitada. Los campos
  de dato —paciente, fechas, observaciones— sí se quedan como estaban, porque
  ahí la casilla ES el dato (§2).
- **Y ver un expediente también es una página.** Un diálogo sirve para una
  decisión corta —derivar un caso, elegir a alguien—, no para leer un expediente
  entero: no se puede enlazar, ni compartir, ni volver con «atrás», y obliga a
  hacer scroll dentro de una caja. El caso de Concurrencia visto desde la
  supervisión se abrió como diálogo hasta sep 2026 y pasó a ser página
  (`/concurrencia/supervision/:id`, y `/admin/auditorias/concurrencia/:id` para
  el administrador). **Mudarse de sitio no cambia lo que se puede tocar**: sigue
  entero deshabilitado.
- **Una fila puede abrir un ARCHIVO en vez de una pantalla**, y entonces lo
  dice: se abre en otra pestaña y su etiqueta empieza por «Descargar». No se
  navega a un PDF con el router —dentro de la aplicación no existe esa ruta y
  acabaría en «no encontrada»—. Y **solo se ofrece si el archivo existe**: un
  caso terminado sin informe abre el caso, no promete un PDF que daría 404.
- **Una ficha con dos caras se abre en pestañas**: los datos de la persona o la
  cosa en «Datos generales», y su actividad en la otra. La del cliente lo hace
  así —«Datos generales» y «Módulos»—, con el mismo primitivo accesible que el
  resto (`Tabs`: flechas, Inicio y Fin). Todo de solo lectura cuando no hay nada
  que editar: los datos del cliente los escribe cada caso al registrarse, no esa
  pantalla.
- **Primero el rol, después su alcance.** Donde se concede acceso —el personal
  propio y los usuarios de una aseguradora— se elige **un rol por persona** en
  dos tarjetas, y la pantalla cambia debajo según cuál sea: el **Coordinador**
  elige su familia (o no elige nada, en la aseguradora) y ve escrito **qué
  abarca**; el **Auditor/Operador** marca sus módulos con casillas. Nunca las
  dos cosas a la vez. Lo que el coordinador abarca se **enseña pero no se
  marca**: es una consecuencia, no una elección, y marcarlo sugeriría que se
  puede recortar.
- **Una relación de dos lados se edita con UNA pieza.** El convenio es una fila
  entre una compañía y un prestador, así que la pestaña «Convenios» de la
  aseguradora y la del prestador son la misma pantalla leída al revés:
  `shared/convenios/PanelDeRed` no sabe qué está marcando —recibe fichas ya
  traducidas (`SocioDeConvenio`) y quién es quién en este lado—, y
  `shared/convenios/ConvenioDetalle` recibe los dos identificadores y el rótulo
  compuesto. Duplicar la pantalla habría duplicado también las reglas —la red
  obligatoria, el aviso al desmarcar la última— y se habrían separado al primer
  arreglo.
- **Lo que cuelga de una casilla se elige junto a ella, no en otra pantalla.**
  En la red de convenios, marcar un prestador CREA el convenio, así que la red
  que cubre —privada, pública o las dos— se pregunta ahí mismo: dos casillas
  `compacto` bajo la tarjeta, que viajan en el mismo «Guardar red». La variante
  `compacto` de `Checkbox` existe para esto: sin tarjeta, porque un recuadro
  dentro de otro recuadro se lee como un nivel que no existe. **Desmarcar la
  última opción se rechaza al tocarla**, con aviso, en vez de dejar guardar y
  fallar al final (el mismo criterio que el CHECK de la base).
- **La identificación se filtra al teclear y se verifica al instante.** Cédula y
  RUC solo admiten dígitos y se cortan a su largo exacto (10 y 13); el pasaporte
  admite letras y números. Debajo del campo, el texto de ayuda se vuelve rojo en
  cuanto el **dígito verificador** no cuadra, sin esperar al guardado
  (`shared/identificacion.ts`, espejo del servidor, que es quien manda). El
  teléfono admite solo números con un `+` opcional delante.
- **Un dato que el servidor deriva se enseña, no se teclea.** Cuando una cifra
  sale de otra —la entrega del informe es la hora de llegada más las horas de
  SLA de la compañía—, su casilla aparece **deshabilitada y ya calculada**, con
  una línea debajo que dice de dónde sale («48,5 h de SLA desde la llegada»).
  Ni se esconde ni se deja escribir: esconderla obligaría a fiarse, y dejarla
  escribir inventaría un dato pactado. La cuenta se repite en el cliente solo
  para verla mientras se elige; **quien manda es el servidor**, que la vuelve a
  hacer al guardar con la misma regla.
- **A una persona se la identifica ANTES de pedir sus datos.** Al abrir un caso,
  lo primero es el tipo y el número de documento, con un botón «Buscar
  paciente»; **las casillas del nombre no existen hasta haber buscado**, porque
  son la respuesta a esa búsqueda: rellenas si ya lo teníamos —con el aviso de
  que se llenaron solas y se pueden corregir— o en blanco si es nuevo, diciendo
  que al crear el caso quedará registrado en Pacientes Accumedical. Buscar se
  PIDE, no ocurre solo mientras se teclea: hacerlo en silencio dejaba sin
  respuesta la pregunta que se ha venido a hacer, «¿ya lo tenemos?». Tocar el
  documento después invalida el resultado y **borra el nombre que había
  traído**: era el de otra persona, y arrastrarlo sería el peor error posible
  en un expediente.
- **El nombre de una persona son cuatro casillas, siempre las mismas.** Nombre
  principal y apellido paterno obligatorios; nombre secundario y apellido
  materno opcionales. No se escriben a mano en cada formulario: salen de
  `shared/personas/CamposNombre`, que además filtra al teclear todo lo que no
  sea una letra (un número no llega ni a pintarse). Paciente, contacto y usuario
  usan el mismo componente y por eso se ven idénticos. Para ENSEÑAR un nombre se
  usa el `nombre_completo` que ya compone el servidor: ninguna pantalla decide
  por su cuenta el orden.
- **TODO va a todo el ancho**, y no solo el admin. Ni los listados ni los
  formularios llevan `max-w-*`: los contenidos se estiran igual en todas las
  páginas (sep 2026 se retiraron las columnas centradas que hacían ver
  proporciones distintas entre listado y formulario). **El armazón de módulo se
  sumó después**: la bandeja del operador tiene siete columnas y una columna
  centrada de 72 rem le recortaba el estado. Las listas largas paginan **de 20
  en 20**.
- **Los `max-w` de las celdas son otra cosa** y sí se quedan: mantienen la fila
  en una línea, que un nombre kilométrico no la rompa. Crecen en pantalla ancha
  (`2xl`, 1536 px) para que el corte sea la excepción; **no antes**, porque con
  columnas más anchas la tabla no cabría y habría que desplazarla a mano, que es
  peor que unos puntos suspensivos.
- **El formulario envuelve las pestañas, no al revés.** Los botones de guardar del
  encabezado apuntan al formulario por `form="…"`; si el formulario se desmontara al
  cambiar de pestaña, guardar desde la última no haría nada. Ya pasó una vez.
- **Bloques con `Bloque`**, con entrada escalonada de 50 ms entre ellos.
- **Listas anidadas —contactos, sedes, convenios— se reconcilian enteras.** El
  formulario manda la lista completa; el servidor da de alta lo nuevo, actualiza lo
  que trae `id` y da de baja lógica lo ausente. Las bajas se vuelcan **antes** que
  las altas, porque si una fila nueva reutiliza el valor único de la que se va, el
  índice único parcial vería las dos vivas a la vez.
- **Validar en el cliente es cortesía, no autoridad.** Cada comprobación de estas
  existe también en el servidor; la del formulario solo evita un viaje y señala la
  pestaña donde está el problema.
- **Un dato opcional que falta se sustituye por el que sí está, no por «no hay».**
  La dirección de un prestador es opcional; su provincia y su ciudad casi nunca
  faltan. Enseñar «sin dirección registrada» cuando consta que es Quito es
  informar de menos con un dato a mano. La regla vive en una función —`zona()`—
  y no repartida por el JSX, y el «no consta» solo aparece cuando de verdad no
  queda nada que decir.
- **En una lista de opciones se elige por lo que las distingue.** Entre sedes de
  un mismo prestador eso es la ciudad, no la calle: «SEDE SUR — Guayaquil,
  Guayas» se compara de un vistazo y «SEDE SUR — AV. DE LAS AMÉRICAS 1200» no.
  El dato fino baja a la línea de confirmación de debajo, que **solo se pinta si
  añade algo**: si no hay calle no se pinta, porque repetir la ciudad que ya está
  en la opción elegida es ruido y anunciar que falta un campo opcional es peor.
- **Una lista de tarjetas para elegir enseña tres y hace scroll.** Con más, el
  bloque siguiente se va fuera de pantalla y el formulario deja de leerse de un
  vistazo. El alto no es un número mágico: la tarjeta se fija (`h-20`) y el alto
  del contenedor se calcula a partir de ella —`3 × 5rem + 2 × 0.5rem`— para que
  nunca se corte media tarjeta. Si hay más de tres, una línea debajo dice cuántas
  son y que se puede buscar; un scroll que no se anuncia no existe.

---

## 2b. La marca

El logo real de Accumedical vive en `core/components/Marca.tsx` y en ningún otro
sitio: login, menú del admin, selector de módulo y pantalla de invitación lo
montan desde ahí, así que cambiar la marca es tocar un componente.

- **Cuatro piezas**: el logotipo completo y el monograma AC, cada uno en su
  versión original (azul + oro, para fondos claros) y **en blanco** (el interior
  azul pasa a blanco y el oro se queda), generada del propio PNG. Sobre fondos
  oscuros ya **no** viaja en una tarjeta blanca: se apoya directa con su
  variante blanca — `sobreOscuro` la fuerza en fondos oscuros fijos (el login) y
  en los contextos con tema cada variante se enseña en su modo
  (`dark:hidden` / `hidden dark:block`).
- La app móvil hace lo mismo: `monograma-accumedical-blanco.png` en su modo
  oscuro.

### Arriba del menú va SIEMPRE Accumedical

También para quien entra desde una aseguradora. El menú lateral es la
plataforma, y la plataforma es de Accumedical; el logo de la compañía ahí
arriba hacía parecer que el producto era suyo y además lo repetía, porque ya
está a dos dedos.

**La compañía se reconoce en el topbar**, junto al módulo: su logo en el mismo
hueco de 36 px que ocuparía el icono del módulo —nada baila al cambiar de
módulo— y su nombre bajo el del módulo, detrás del rol: «Coordinador · LA
UNION». Sin logo subido, ese hueco lo llena el icono del módulo con su acento;
si el archivo no llega (borrado del volumen, red), se cae al icono en vez de
dejar la imagen rota. El logo se pide a `GET /auth/mi-aseguradora/logo`, que
solo sirve el de la propia compañía (`docs/03`).

### Las paletas SON la marca

Los tokens de `index.css` salen del logo: el acento `--marca` es su azul marino
muestreado (#1a2448) y `--oro` el oro del arco. **El modo oscuro es ese mismo
azul**: fondos, superficies y bordes comparten su hue (227), con el acento
aclarado para contrastar. La app móvil replica el criterio en `tema.ts`
(`paletas.claro` / `paletas.oscuro`). Los colores de estado (éxito, aviso,
peligro, semáforo) no son marca y conservan su propio hue.

## 3. Diálogos

El primitivo `Modal` (`shared/components/ui/modal.tsx`):

- Portal sobre `document.body`, para que ningún `overflow: hidden` lo recorte.
- **Foco atrapado**: el tabulador circula dentro, `Esc` cierra, y al cerrar el foco
  vuelve al botón que lo abrió.
- `role="dialog"`, `aria-modal`, y título y descripción enlazados por `aria-labelledby`
  y `aria-describedby`.
- La página de detrás no se desplaza mientras está abierto.
- **Sin `layoutId` de Framer Motion.** Una animación de layout pendiente deja la
  salida de `AnimatePresence` sin terminar y el diálogo no se cierra nunca. Costó
  una sesión descubrirlo con el panel lateral que ya no existe.

---

## 3b. Desplegables con buscador

El primitivo `Select` (`shared/components/ui/select.tsx`) ya **no es el select
nativo**: es un desplegable propio con caja de búsqueda arriba, porque las
listas de catálogo —24 provincias, 25 ciudades por provincia— obligaban a dar
scroll y cansan.

- **Conserva la API del select de siempre**: `value`, `onChange` que entrega
  `e.target.value`, hijos `<option>` y `<optgroup>`. Por eso TODOS los
  desplegables de la plataforma lo heredaron sin tocar un solo formulario, y
  un formulario nuevo se escribe igual que antes.
- El buscador **ignora tildes y mayúsculas** («canar» encuentra «Cañar») y
  filtra también por el nombre del grupo.
- **Teclado completo**: Enter/Espacio/flechas abren, escribir filtra, flechas
  recorren (saltando deshabilitadas), Enter elige, `Esc` cierra y devuelve el
  foco al campo. ARIA de combobox/listbox.
- **La lista vive en un portal** con posición fija, como el `Modal`: dentro de
  una tabla con `overflow` un `absolute` quedaría recortado (pasó con el
  desplegable de derivación). Un scroll o un cambio de tamaño la cierran; si
  abajo no cabe, se despliega hacia arriba, y nunca es más estrecha de 15rem.
- Los `<optgroup>` se pintan como cabeceras de grupo (así se ven los grupos de
  cercanía al derivar un caso). Ojo: el componente lee las opciones de los
  hijos JSX, así que un componente intermedio que «devuelva options» debe
  invocarse **como función**, no como `<Componente/>` (ver `OpcionesAuditores`
  en la supervisión de Concurrencia).
- Lo que se pierde a cambio: el selector nativo del sistema en móvil. Asumido:
  las pantallas web son de escritorio; el trabajo móvil vive en la app del
  auditor, que no usa este componente.

### 3b.1 Cuando NO es un desplegable

`GrupoDeOpciones` (`shared/components/ui/opciones.tsx`): pocas opciones
excluyentes, **todas a la vista**. Se usa cuando la elección cambia lo que se
pide justo debajo —cómo se pacta un concepto del convenio: por punto, por
porcentaje o precio fijo—, porque con un desplegable habría que abrirlo para
saber qué hay y, encima, lo que aparece debajo cambiaría sin que se vea por qué.

Es un `radiogroup` de verdad y no tres botones sueltos: solo la marcada entra en
el tabulador y dentro se navega con las flechas, que es lo que un lector de
pantalla y un teclado esperan de un grupo de opciones.

Dicho al revés, para no confundirlos: el desplegable es para **elegir un dato de
una lista** (una provincia, un auditor, un concepto base); el grupo de opciones,
para **elegir un camino** entre dos o tres.

---

## 4. Ubicación en el mapa

`shared/mapa/MapaUbicacion.tsx`, compartido por aseguradoras, prestadores y cada
sede.

- Leaflet con teselas de OpenStreetMap, **instalado por npm y nunca desde una CDN**,
  para que `script-src` y `style-src` de la CSP se queden en `'self'`. Lo único
  externo es `https://*.tile.openstreetmap.org` en `img-src` (`docs/02 §3.1`).
- **Las cajas de latitud y longitud no son decoración**: son la vía accesible por
  teclado y la que permite pegar una coordenada exacta. Arrastrar el pin es el
  atajo cómodo, no el único camino.
- El texto de esas cajas se guarda **tal cual se teclea** y no se deriva del número
  en cada render: derivándolo, escribir «-0.» se convertiría en «-0» y sería
  imposible teclear un decimal.
- Seis decimales, la misma escala que `numeric(9,6)` en la base.

### 4.1 Ver la red sobre el mapa

`shared/mapa/MapaDeRed.tsx`, el otro uso del mapa: **consultar** dónde está la
red, no capturar un punto. Lo abre el botón «Mapa» del listado de prestadores,
el de «Red convenio» y el de aseguradoras, cada uno con su página
(`/admin/prestadores/mapa`, `/admin/red-convenio/mapa`,
`/admin/aseguradoras/mapa`).

- **El mapa no sabe qué pinta.** Recibe `PuntoDeMapa` —clave, rótulo, ficha,
  ubicación y coordenadas— y cada entidad traduce lo suyo en su envoltorio
  (`MapaPrestadores`, `MapaAseguradoras`), igual que la bandeja de entrada con
  los casos de cada módulo. Así el panel de provincias, el filtrado por ciudad y
  el encuadre se escriben UNA vez.
- **Un punto por sitio, no por entidad**: un prestador aporta el suyo y el de
  cada sede activa —aparece en varias ciudades, y el rótulo lleva el nombre de
  la sede para distinguir cuál es cuál—; una aseguradora aporta uno solo, su
  domicilio, porque no lleva sedes.
- **El punto es rojo**, y su color sale de `--peligro` —el token del sistema—,
  no de un hexadecimal escrito a mano: así se ve igual de rojo en claro y en
  oscuro sin mantener dos constantes.
- **En el país entero no se pintan los sitios sueltos, sino una burbuja por
  provincia con cuántos hay dentro.** Un punto por sitio a esa escala no dice
  nada y además se solapan. La burbuja va en el centro medio de sus puntos —que
  siempre cae entre ellos—, crece con los DÍGITOS del número y no con la
  cantidad (un «120» necesita sitio; el triple de prestadores no merece el
  triple de círculo), y pulsarla entra a esa provincia igual que pulsarla en el
  panel. Dentro de una provincia ya se pinta cada sitio.
- **El número va en un `Tooltip` permanente, no en un icono con HTML.**
  `L.divIcon({html})` es inyectar HTML, y el proyecto no lo hace; el tooltip lo
  escribe React y se escapa solo. La clase `.burbuja-mapa` (en `index.css`) solo
  le quita a Leaflet el bocadillo, y lleva `pointer-events: none` para que el
  rótulo no se coma el clic del círculo.
- **El panel manda y el mapa acompaña**: se elige provincia y quedan los suyos,
  se elige ciudad y quedan solo los de esa ciudad; el mapa encuadra la
  selección. Lo que se ve en el mapa y lo que se lista al lado es SIEMPRE lo
  mismo. La lista es además la vía por teclado: son botones, no puntos que haya
  que acertar con el ratón.
- **El zoom lo decide el nivel elegido, no cuántos puntos haya** (7 el país, 12
  la provincia, 16 la ciudad). Encuadrar un rectángulo de un solo punto lleva al
  zoom máximo, y quien abre el mapa sin filtrar ha pedido ver el país, no un
  tejado.
- Mismas teselas y mismas reglas de CSP que el mapa de ubicación: cero
  dependencias nuevas.

---

## 5. Estados de cada vista

Toda pantalla que pide datos tiene los cuatro, y no se dan por supuestos:

| Estado | Cómo se ve |
|---|---|
| Cargando | Esqueleto con la forma del contenido, no un *spinner* centrado |
| Vacío | Icono, una frase que explica qué falta y **la acción que lo resuelve** |
| Error | Qué pasó en lenguaje llano y un botón de reintentar |
| Éxito | Toast, y la lista se invalida para que refleje el cambio |

Distinguir «vacío porque no hay nada» de «vacío porque los filtros no casan» es
obligatorio: son dos mensajes distintos y solo el primero ofrece crear.

---

## 6. Acciones de fila

- **Una acción, su icono; varias, los tres puntos.** Mientras la fila tiene una
  sola cosa que hacer, va su icono suelto —el lápiz de editar, el encendido de
  activar—. En cuanto tiene dos o más, se juntan en el menú `⋮`
  (`shared/components/ui/menu.tsx`, `MenuAcciones`), que es uno para toda la
  plataforma: alinear tres iconos por fila se lee peor que un solo punto de
  entrada. Se abre con Enter o Espacio, las flechas recorren, `Esc` cierra y
  devuelve el foco, y pulsar fuera lo cierra.
- **El menú se pinta en un portal, con posición fija.** El envoltorio de la
  tabla lleva `overflow-x-auto` y un desplegable absoluto quedaría cortado por
  ese recorte. Por lo mismo se cierra al desplazar la página: la posición se
  calcula al abrir, no se persigue. Y se abre hacia arriba si abajo no cabe,
  que es el caso de la última fila.
- **Lo que no se puede hacer no aparece.** Un caso **cerrado** —culminado o
  cancelado— se lee, no se toca, así que su menú se queda solo con «Ver»:
  editar uno culminado convertiría en mentira un informe ya enviado, y uno
  cancelado no tiene ninguna visita que preparar. Como siempre, esto es
  presentación —el servidor responde `409` a quien teclee la dirección— y las
  dos cosas se escriben, no una sola (§6b). **La lista de estados cerrados vive
  en un solo sitio a cada lado** (`MOTIVOS_SIN_EDICION` en el servicio,
  `sePuedeEditar()` en el módulo web), para que no puedan discrepar.
- **Desactivar/activar** es un icono de encendido que alterna `estado`. La fila **no
  desaparece**: cambia su insignia. Es reversible y no pide confirmación.
- **No hay papelera en aseguradoras.** No es que esté oculta: el `DELETE` no existe
  en el router y responde `405` (`docs/03`). En prestadores todavía existe.
- Toda acción de fila lleva `aria-label` con el nombre del registro: «Acciones de
  CONC-0011», «Editar LA UNIÓN»; nunca un «Editar» a secas.

---

## 6b. El menú enseña solo lo que el rol puede abrir

Una entrada de menú que lleva a un `403` es una promesa rota. Así que el armazón
(`core/layout/AppShell`) **filtra las entradas por el rol**, y lo mismo ocurre
dentro de una pantalla: si de una ficha solo se puede tocar una pestaña, es la
única pestaña que se dibuja, y el botón de guardar la ficha entera no aparece.

Dos ejemplos vivos, las funciones transversales:

- **Convenio** ve tres entradas —Aseguradoras, Prestadores y Red convenio—, en el
  listado de aseguradoras no hay «Nueva aseguradora», y al entrar en una compañía
  solo existe la pestaña «Convenios», titulada **«Convenios de la aseguradora»** y
  no «Editar aseguradora», porque no es lo que hace.
- **Contabilidad** ve una sola entrada, Aseguradoras, con su «Nueva aseguradora»
  y su lápiz; dentro de la ficha están todas las pestañas **menos «Convenios»**.
  Ahí el título sí es «Editar aseguradora», porque eso es exactamente lo que está
  haciendo.

Las dos son el mismo mecanismo: una lista de pestañas y un filtro por rol, no dos
pantallas paralelas que haya que mantener a la par.

**El menú completo NO es el «si no es ninguno de los anteriores».** El armazón
lo montan también pantallas que lleva cualquiera —las notificaciones—, así que
quién entra decide qué ve, y en este orden: función transversal → lo suyo; quien
coordina —Accumedical o una compañía— → el mismo menú que lleva dentro de su
módulo; **administrador global** → el menú completo; cualquier otro —una
operadora abriendo sus notificaciones— → solo esa entrada. Costó un fallo real:
el menú completo era el caso por defecto, y una coordinadora de compañía que
pulsaba la campana acababa viendo Aseguradoras, Prestadores, Red convenio,
Parámetros y Configuración. El servidor le habría respondido `403` en todas,
pero **la puerta no debe ni pintarse**.

Por lo mismo, el rótulo de esa pantalla lo decide **quién mira y no la ruta**: a
una operadora no se le dice que está en «Administración», porque no lo está —se
queda sin rótulo, y se lee igual de bien—.

Dos reglas que van con esto:

- **Esto es presentación, no autorización.** Quien teclee la URL a mano igual
  recibe su `403` del servidor: la dependencia del router es la que manda
  (`docs/03`). Ocultar sin proteger no protege nada.
- **La pantalla se rellena solo con lo que el servidor le dio.** Si un rol recibe
  una ficha recortada, el formulario no puede dar por hecho que llegó entera. Costó
  un fallo real: el detalle recortado de la aseguradora no trae `modulos` ni
  `contactos`, y rellenar el formulario a ciegas tumbó la pantalla con un
  `undefined.filter`.
- **Y tampoco pide lo que no puede pedir.** Una consulta que va a responder `403`
  no aporta nada: se apaga. Por eso `useModulos(habilitado)` admite apagarse —el
  catálogo de módulos solo lo abren el admin y Contabilidad— y la ficha de quien
  lleva los convenios, que no tiene esa pestaña, no lo pide.
- **Cuidado con guardar lo que no se cargó.** El formulario manda listas
  completas: contactos y módulos se reconcilian contra lo enviado. Si una vista
  recortada rellenara esas listas en vacío y luego guardara, BORRARÍA los
  contactos y revocaría los módulos de la compañía. Por eso la vista recortada de
  Convenio no guarda la ficha —su pestaña guarda por su cuenta—, y la de
  Contabilidad carga la ficha entera aunque enseñe una pestaña menos.

---

## 6b-bis. El coordinador lleva el MISMO menú dentro de su módulo

El menú lateral no es «la barra del administrador»: es el armazón de la
plataforma (`core/layout/MenuLateral.tsx`, `ArmazonLateral`). Lo usan igual el
área de administración y el módulo en el que trabaja un **coordinador** —el de
una familia de Accumedical y el de una compañía, que para la pantalla son la
misma persona—. Los componentes se comparten, no se duplican: si el menú cambia,
cambia para todos.

Su menú es siempre el mismo, `NavegacionCoordinador`, esté donde esté:

```
Bandeja de entrada  ← donde aterriza: TODOS los casos de todas sus auditorías
Auditorías          ← grupo desplegable
  · sus módulos, de la A a la Z
Usuarios            ← solo el coordinador de una FAMILIA
Notificaciones
```

**Y sus pantallas cuelgan de `/coordinacion`, no de `/admin`.** Coordinar no es
administrar la plataforma y la dirección no tiene por qué decir lo contrario.
Vale para los dos coordinadores, el de una familia y el de una compañía; lo que
cambia es qué hay dentro: la bandeja de entrada y los usuarios son del de
plataforma, y al de una compañía `/coordinacion/bandeja` lo devuelve a su
módulo.
`/coordinacion/bandeja`, `/coordinacion/usuarios`, `/coordinacion/notificaciones`.
Son las MISMAS pantallas montadas bajo dos prefijos —el mismo componente, no una
copia—; lo único que cambia es el rótulo pequeño de la cabecera («Coordinación»
o «Administración») y a dónde llevan los enlaces de dentro, que se quedan en el
área por la que se entró. Quién es cada quien y bajo qué prefijo va lo dice
`core/auth/area.ts`, en un solo sitio —`coordinaDesdePlataforma`, `useArea`,
`useAreaDeLaRuta`—, que es lo que evita que el armazón, el menú y la campana
opinen distinto. **El prefijo no autoriza nada**: cada endpoint lo revalida el
servidor, así que teclear `/admin` no vuelve administrador a nadie. La dirección
vieja, `/admin/bandeja`, redirige a la nueva.

- **La bandeja es de quien coordina desde PLATAFORMA**, venga por familia o por
  fila de módulo; el coordinador de una compañía no tiene panel de supervisión
  que juntar. Es también su destino al iniciar sesión: lleva varias auditorías a
  la vez y su trabajo es mirarlas juntas, no elegir una, así que el selector de
  módulo no le aporta nada.
- **Arriba, un cuadro por auditoría: TODAS las suyas**, tengan expediente
  construido o no. La que no lo tiene sale con una raya en vez del número y «en
  construcción» debajo, y lleva igual a su módulo, donde le espera el cartel.
  Enseñarlas todas es lo honesto —su sitio ya existe y se ve el alcance de lo
  que coordina— y el día que una se construya no cambia de sitio: se le
  enciende el número. Cada cuadro lleva su nombre, su acento y cuántos casos
  tiene. **Es el atajo a la bandeja de esa auditoría** —`/concurrencia`, y lo que
  venga—, donde está todo lo suyo: filtros, derivación y las acciones de su
  expediente. Es el mismo cuadro que las cifras del panel de la compañía
  —etiqueta pequeña, número grande, chevron al pasar por encima—: **la misma
  idea se pinta igual en toda la plataforma**, no se reinventa por pantalla.
- **Un filtro para todas: texto y rango de fechas, y NADA de estado.** Va
  **bajo los cuadros**, como en el panel de cada auditoría, y lo obedecen
  también ellos —el número de cada cuadro cuenta su propia lista, que es lo que
  se está mirando—. El
  estado se queda fuera a propósito: cada auditoría tiene los suyos —una visita
  se «culmina», un reembolso se «liquida»— y un desplegable común mezclaría
  vocabularios; para eso está el panel de cada una. Lo que sí comparten todas es
  de quién viene el caso, a quién y cuándo. **Cada módulo traduce esos filtros a
  su consulta** (`FiltrosDeBandeja`, en `shared/components/bandeja.ts`): la
  bandeja no sabe por qué columnas busca ninguno. Cambiar el filtro devuelve a
  la primera página, y el vacío distingue «sin casos por ahora» de «ningún caso
  coincide con el filtro» (§5).
- **Es un enlace, no un botón.** Lleva a otro sitio, así que se abre en otra
  pestaña con el botón central y el navegador lo trata como lo que es. Un botón
  es para actuar aquí; un enlace, para ir allí.
- **Y el cuadro es el único rótulo.** Debajo va la lista pelada, sin repetir el
  nombre de la auditoría encima: decir dos veces lo mismo en la misma pantalla
  es ruido. El nombre no se pierde para quien no ve la pantalla — viaja en el
  `aria-label` de la sección.
- **Todas las auditorías se leen igual: cinco columnas y ninguna más.** Código,
  aseguradora, prestador, cuándo y estado. Cada expediente es distinto —una
  visita no se parece a un reembolso—, así que lo propio de cada uno vive en su
  página, a la que lleva la fila entera; en la bandeja solo está lo que
  comparten, que es lo que permite mirar ocho auditorías sin aprenderse ocho
  tablas. Lo que el panel del módulo sí tiene y aquí no: filtros, derivación y
  las acciones de su expediente.
- **La tabla está en `shared/` y no sabe de ningún módulo** (`TablaBandeja`).
  Recibe filas ya normalizadas, y lo que cambia de forma pero no de sitio —la
  ventana horaria, la insignia de estado— viaja **ya pintado** por su módulo,
  que es quien sabe sus colores y sus etiquetas.
- **La bandeja vive en `app/`, no en `core/`.** Para juntar los casos hay que
  importar de cada módulo, y `core` no puede depender de un módulo (regla dura de
  arquitectura); `app/` sí, que es donde ya se componen sus rutas. Añadir una
  auditoría a la bandeja es **una entrada más en su lista** y su adaptador en
  `modules/<slug>/bandeja.tsx`, que aporta dos piezas: **el número de su cuadro y
  sus casos ya traducidos**. El módulo traduce hacia la tabla, no la tabla hacia
  el módulo; del cuadro solo pone el número, porque el nombre, el icono y el
  acento los tiene la bandeja.

- **Sus módulos cuelgan de «Auditorías»**, el mismo `GrupoMenu` que usa el
  administrador: desplegable, y contraído el grupo se pinta activo cuando la
  página abierta está dentro.
- **Uno por línea y de la A a la Z.** No por `modules.orden`, que ordena el
  catálogo por familias: en una columna que se lee de arriba abajo, lo que se
  busca es un nombre. `localeCompare(…, 'es')`, para que las tildes y la ñ
  caigan donde deben.
- **«Usuarios» es del coordinador de familia**, no del de una aseguradora: ahí
  da de alta a los auditores de SU familia. Se pinta según
  `sesion.user.grupo_coordinado`, y el servidor impone lo mismo por su cuenta
  (`require_coordinacion`, en `docs/03`).
- **Quien no coordina conserva su topbar** con el selector «Cambiar de módulo»:
  con uno o dos módulos, un desplegable es más directo que una columna entera.
- La franja de acento del módulo sigue arriba, y el topbar sigue diciendo en qué
  módulo estás, con qué rol y de qué compañía. En el panel, la marca es **el logo
  de su aseguradora** si lo subió; si no, el de Accumedical.

**El nombre del rol se pinta con `nombreDeRol()`** (`core/auth/roles.ts`), nunca
con el `code` en crudo: el código sigue congelado en `supervisor` y la persona
tiene que leer «Coordinador». Pintarlo crudo ya enseñó «Supervisor» en la
pantalla de un coordinador, en el armazón de módulo y en el selector.

---

## 6b-ter. El administrador ve TODAS las auditorías, construidas o no

Su grupo «Auditorías» no es la lista de las que ya tienen panel: son **todos los
requerimientos vivos**, repartidos en sus dos familias comerciales.

```
Auditorías
  SUSCRIPCIÓN
    · Calificación de Riesgo
    · Requisitos de Asegurabilidad
  SINIESTRO
    · Ambulatorio
    · Auditoría de Alta
    · Auditoría de Concurrencia
    · …
```

- **La lista sale del catálogo del servidor** (`/shared/catalogos/modulos`), no
  de una constante en el cliente: un requerimiento nuevo aparece con su fila en
  `modules` y sin tocar el armazón, que es la regla de la plataforma. La familia
  viene de `modules.grupo`; una sin familia —no debería haberla— cae al final y
  sin encabezado, igual que en la ficha de la aseguradora: el mismo dato se
  pinta igual en toda la plataforma.
- **Dentro de cada familia, de la A a la Z**, por el mismo motivo que en el menú
  del coordinador (§6b-bis): en una columna que se lee de arriba abajo lo que se
  busca es un nombre, no el orden del catálogo.
- **La que todavía no tiene panel se enseña igual, y su dirección existe.**
  `/admin/auditorias/<slug>` lleva a su cartel de «en construcción», con el
  nombre, el icono y el acento del módulo. Que una entrada lleve a un error es
  el problema de §6b; esconderla deja al administrador sin saber qué viene, así
  que la tercera salida es enseñarla con su estado escrito. Un slug que no está
  en el catálogo recibe lo mismo que cualquier otro: que no existe.
- **No se pide lo que no se puede pedir.** El catálogo solo lo abren el
  administrador y Contabilidad, así que la consulta va bajo bandera
  (`useModulos(esAdmin)`) y el grupo no se dibuja hasta que llega: un
  «Auditorías» que se despliega en nada se lee como algo roto.

---

## 6c. El menú lateral se contrae a iconos

En escritorio, el menú tiene abajo un botón con una flecha que lo encoge de
**15 rem a 4,5 rem**: quedan solo los iconos y la página gana ese ancho. Volver a
pulsarlo lo expande. La flecha es la misma en los dos sentidos, girada 180°, y
el ancho se anima en 200 ms —salvo con `prefers-reduced-motion`, donde cambia sin
transición—. Vale para los dos sitios donde hay menú: administración y el módulo
de un coordinador.

Lo que hay que respetar si se toca:

- **Ningún destino se queda sin nombre.** El `title` va siempre —contraído
  porque el icono es lo único visible, y expandido porque un nombre largo como
  «Auditoría del Crédito Hospitalario» se corta—; el `aria-label` se añade
  contraído, que es cuando el enlace no tiene texto. El botón declara
  `aria-expanded` y `aria-controls` sobre el `aside`.
- **Nada queda inalcanzable por contraer.** El grupo «Auditorías» no puede
  desplegar su submenú en 4,5 rem, así que pulsarlo **expande el menú y se abre**.
  Y como su submenú no se ve, contraído el propio grupo se pinta activo cuando la
  página abierta está dentro.
- **Se desplaza la NAVEGACIÓN, no el panel.** La marca se queda arriba y el
  botón de contraer abajo, siempre a la vista; entre los dos, la lista tiene su
  propio desplazamiento (`min-h-0 flex-1 overflow-y-auto`). El `min-h-0` no es
  adorno: sin él un hijo de flex no baja de su altura natural, y con un grupo
  abierto la lista se sale del panel en vez de desplazarse —pasó al listar las
  nueve auditorías—. Vale igual para el panel del móvil, que es el mismo
  componente.
- **Y la barra es nuestra, no la del sistema** (`.barra-fina`, en `index.css`):
  una pastilla de 4 px con aire a los lados, del color de la tinta tenue y por
  tanto distinta en cada tema, sobre un carril transparente. La de Windows es
  ancha, cuadrada y con flechas en los extremos; dentro de un panel de 15 rem
  pesa más que el contenido. Se escribe con `::-webkit-scrollbar` **a
  propósito**: lo estándar (`scrollbar-width: thin`) adelgaza la barra pero deja
  las flechas, y no hay forma de quitarlas por ahí. La trampa al tocarlo: en
  Chromium, fijar `scrollbar-width` o `scrollbar-color` a algo que no sea `auto`
  anula TODAS las reglas `::-webkit-`, así que las estándar quedan encerradas en
  un `@supports` para Firefox, que es quien no entiende las otras. El área
  arrastrable siguen siendo los 10 px completos: se ve fina, pero se agarra.
- **El panel superpuesto del móvil se monta siempre expandido**, y ahí el botón no
  existe: el ancho no es un problema en un panel que se cierra al navegar.
- La preferencia se recuerda en `localStorage` (`core/layout/preferenciaMenu.ts`,
  Zustand, el mismo patrón que el tema) y es la misma en los dos armazones. Es de
  **este navegador**, no de la cuenta: no viaja al servidor, a diferencia del
  último módulo usado, que sí es dato del usuario y vive en
  `users.last_module_code`.

---

## 6d. La campana de notificaciones

Va en el topbar, **a la izquierda del botón de tema**, en los dos armazones. Cada
aviso se lee en tres líneas, y esa forma es del núcleo, no de quien lo escribe:

```
[icono del módulo]  Auditoría de Concurrencia      hace 2 min  ●
                    LA UNION
                    Programada
```

Título el módulo, subtítulo de quién viene, y debajo qué pasó. El icono y el
acento salen de `identidadDe(module_code)`, los mismos que el resto de la
plataforma.

- **El texto llega compuesto del servidor.** La campana no sabe de visitas ni de
  pólizas: pinta tres cadenas y navega a una URL. Así, un módulo nuevo se
  notifica sin tocar este componente.
- **Un punto rojo en la esquina, sin número.** Dice lo único que hace falta de
  un vistazo: hay algo sin ver. El cuántas y el cuáles están dentro. Lleva un
  anillo del color del fondo para despegarlo del icono y que no se lea como
  parte de la campana.
- **El mismo rojo distingue lo visto de lo no visto** en las dos listas —el panel
  y la pantalla completa—: punto rojo y fondo tenue mientras está sin ver, nada
  cuando ya se vio. Un solo código de color para una sola idea.
- **Pulsar un aviso hace tres cosas**: cerrar el panel, marcarlo leído y navegar.
  En ese orden, para que la lista no parpadee bajo el dedo.
- **Se cierra pulsando fuera o con `Esc`.** No atrapa el foco: no es un diálogo,
  es un desplegable, y tiene que soltarse con lo que uno espera.
- **El panel es el vistazo; la lista entera está en `/admin/notificaciones`**, a
  la que se llega por el pie del panel y por su entrada de menú. La lleva **todo
  el mundo**: cada quien ve las suyas y nada más. Ahí se filtra por **dos ejes
  que se combinan** —el estado (todas · sin ver) y el módulo—, en dos filas de
  pastillas, una por eje, para que no se lean como una sola lista de opciones
  que se excluyen; y se pagina de 20 en 20.
- **Las pastillas de módulo las nombra el SERVIDOR, y están todas.** No se
  deducen de los avisos recibidos: son los módulos de los que esa persona puede
  recibir avisos —los suyos; todos los vivos si es el administrador global—,
  tengan algo o no, porque la fila dice de dónde puede llegarle algo y no solo
  de dónde ya le llegó. En orden alfabético, el mismo con el que cuelgan del
  menú, con el icono y el acento de `identidadDe`. Se añaden además los módulos
  de los que YA tiene avisos aunque hoy no tenga acceso: si no, al revocarle uno
  le quedarían filas sin ninguna pastilla capaz de filtrarlas.
- **Cada pastilla cuenta lo que se verá al pulsarla**, así que su número sigue al
  estado elegido arriba: en «sin ver» cuenta las que no se han visto. Esas
  cuentas se calculan **sin el filtro de módulo puesto** —si contaran con él,
  elegir uno dejaría a los demás en cero y no habría cómo volver—, y por lo
  mismo «Sin ver» cuenta las del módulo elegido, no las de todos. Sin número
  cuando es cero: la pastilla sigue ahí, y pulsarla explica el vacío con su
  nombre —«Todavía no hay notificaciones de Ambulatorio»— y ofrece la salida
  («Ver todos los módulos»), que es la regla de §5.
- **La campana no pide las pastillas.** Sondea la misma ruta cada 15 s y no las
  usa; se piden con `con_modulos`, que cuesta dos consultas más (`docs/03`).
- Las dos vistas comparten ruta del servidor pero **no clave de caché**: con una
  sola, abrir la página 2 dejaría a la campana pintando la página 2.
- **Lo que entra con la app abierta sale además como toast**, abajo a la
  derecha y pulsable: el punto rojo dice que hay algo, el toast dice qué. Dura 8
  s —el doble que el de «guardado», porque no confirma algo que acabas de hacer—
  y lleva el borde de marca, que lo distingue de las confirmaciones.
  **Entrar no dispara nada**: en la primera respuesta se anota lo que ya había,
  o abrir sesión sería una ráfaga de avisos de ayer.
- El sondeo es cada **15 s** y también al volver a la pestaña (`docs/03`).

---

## 7. Identidad de cada módulo

Icono y color viven en `core/modulos/identidad.ts`, **por código de módulo y de
forma explícita**. El dato manda desde `modules.icono` y `modules.color_acento`,
pero ninguno de los dos se puede construir a partir de esa cadena: los iconos son
componentes que hay que importar, y **Tailwind necesita ver la clase escrita
literal** para generarla —`bg-modulo-${codigo}` no produce nada—.

Añadir un módulo es una fila en `modules` y una entrada ahí. Uno que falte no rompe
nada: sale con el verde institucional y un icono neutro.

---

## 8. Movimiento

Duraciones de 150 a 300 ms con `ease` natural `[0.22, 0.61, 0.36, 1]`. Entrada
escalonada de filas y tarjetas, con tope de 8 elementos para que una tabla larga no
tarde en aparecer.

**`prefers-reduced-motion` se respeta con `useReducedMotion` de Framer Motion**: sin
movimiento, las animaciones se reducen a un fundido. Hay una excepción pendiente, el
recentrado del mapa al teclear una coordenada, anotada como cuestión abierta 12 en
`docs/04-estado-implementacion.md`.
