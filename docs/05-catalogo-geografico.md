# Catálogo geográfico: provincias y ciudades

Cómo se obtuvieron las 24 provincias y los 222 cantones que hay en la base, y cómo rehacerlos cuando el INEC publique una división político-administrativa nueva.

Existe como documento aparte porque es **procedimiento**, no esquema: la forma de las tablas está en [`01-esquema-bd.md`](01-esquema-bd.md) §4 y §4.1, pero el modo de extraer el dato y las trampas que tiene solo se descubren haciéndolo, y se olvidan en un año.

---

## 1. Por qué no se escribió a mano

Son 222 filas de dato de referencia con código oficial. Escribirlas de memoria, o copiarlas de un repositorio de terceros, habría metido errores silenciosos en un catálogo del que después cuelgan direcciones fiscales y, más adelante, prestadores. Un cantón mal codificado no falla: simplemente queda mal para siempre.

Se descartaron también los conjuntos de datos comunitarios que circulan en GitHub, porque usan identificadores autoincrementales propios en lugar del código DPA del INEC, que es el que hace que este catálogo sea interoperable con cualquier otro sistema del país.

---

## 2. Fuente

**Clasificador Geográfico Estadístico 2025 — Esquema de codificación de la División Político Administrativa del País**, del INEC (Dirección de Cartografía Estadística y Operaciones de Campo). Actualizado al 31 de diciembre de 2024.

```
https://aplicaciones2.ecuadorencifras.gob.ec/SIN/descargas/cge2025.xls
```

Pese a la extensión, es un `.xls` binario OLE2 (no un XLSX), con una sola hoja llamada `DPA 2025` de unas 3 142 filas. La convierte cualquier lector de BIFF; se usó `xlrd 2.0.1` en un contenedor desechable, sin añadir la dependencia al proyecto.

---

## 3. Estructura de la hoja

Los códigos no vienen concatenados sino repartidos por columnas, y el nivel de cada fila se deduce de cuáles están rellenas:

| Fila | col 1 | col 2 | col 3 | col 4 |
|---|---|---|---|---|
| Provincia | `01` | — | — | `PROVINCIA DEL AZUAY` |
| Cantón | `01` | `01` | — | `CANTÓN CUENCA` |
| Parroquia | `01` | `01` | `01` | `BELLAVISTA` |

El código DPA del cantón es la concatenación de las columnas 1 y 2: `01` + `01` = `0101`.

**La regla de extracción es la fila de cantón**: columnas 1 y 2 con código de dos dígitos, columna 3 vacía, y columna 4 empezando por `CANTÓN`.

---

## 4. Las tres trampas

**Excel entrega números, no texto.** Las celdas numéricas llegan como `'10.0'`, no como `'10'`. Con una comprobación ingenua de dos dígitos, todas las provincias de la 12 en adelante y todos los cantones a partir del décimo desaparecen sin ruido. Hay que normalizar cortando por el punto y rellenando con cero a la izquierda.

**El resumen por provincia no sirve.** Cada provincia abre con un bloque «COMPRENDE LOS SIGUIENTES CANTONES» que los lista en dos columnas. Es tentador porque es compacto, pero el par de columnas **cambia de una provincia a otra** —en Azuay son la 5 y la 7, en Bolívar la 6 y la 8— y el bloque se corta de forma irregular. Las fichas de cantón son la fuente fiable.

**El asterisco tiene dos significados.** El archivo advierte en su cabecera que las jurisdicciones precedidas por asterisco han cambiado con el tiempo, pero no explica que la cantidad importa:

- **Un asterisco** marca el cantón bajo su provincia **antigua**. Se descarta.
- **Dos asteriscos** lo marcan bajo la provincia **nueva**. Se conserva.

Son nueve entradas de un asterisco: La Concordia bajo Esmeraldas, Salinas, Santa Elena y La Libertad bajo Guayas, Aguarico, La Joya de los Sachas, Orellana y Loreto bajo Napo, y Santo Domingo bajo Pichincha. Y una sola de dos asteriscos: La Concordia bajo Santo Domingo.

Descartarlas todas por igual deja a Santo Domingo con un único cantón. No descartar ninguna infla Guayas, Napo, Pichincha y Morona Santiago.

---

## 5. Validación hecha

Se contrastó el resultado provincia por provincia contra el conteo conocido: **veinte de veinticuatro cuadran exactas**. Las cuatro diferencias se investigaron una a una y todas tienen explicación:

| Provincia | Obtenido | Por qué |
|---|---|---|
| Esmeraldas | 7 | La Concordia pasó a Santo Domingo |
| Santo Domingo | 2 | Santo Domingo y La Concordia |
| Morona Santiago | 13 | Sevilla Don Bosco es un cantón reciente |
| Guayas / Napo / Pichincha | 25 / 5 / 8 | Correctos tras excluir las jurisdicciones antiguas |

Comprobaciones adicionales: sin códigos duplicados, toda provincia referenciada existe, y Guayaquil y Quito presentes. Los códigos de Guayas **saltan** el 0915, el 0917 y el 0926 porque esos cantones se fueron a Santa Elena; esa discontinuidad es correcta y esperable.

---

## 6. Rarezas de grafía que se conservan

Se respeta la escritura oficial del archivo aunque no sea la de uso corriente:

- `Distrito Metropolitano de Quito`, no «Quito».
- `Mejia` y `Pucara`, sin tilde, tal como los escribe el INEC.

Cambiarlas rompería la correspondencia con cualquier cruce futuro contra datos oficiales. Si se quisiera una etiqueta más amable para mostrar, sería una columna aparte, nunca una edición del nombre oficial.

---

## 7. Cómo actualizarlo

Cuando el INEC publique la DPA siguiente (el archivo suele llamarse `cgeAAAA.xls`):

1. Descargar el archivo nuevo.
2. Extraer con la regla de §3 y las tres precauciones de §4.
3. Contrastar contra el catálogo actual: qué cantones son nuevos, cuáles cambiaron de nombre y cuáles cambiaron de provincia.
4. Escribir una migración **aditiva**: `INSERT` de los nuevos y `UPDATE` de los nombres cambiados. **Jamás borrar una fila**: puede estar referenciada por la dirección de una aseguradora. Para retirar un cantón se usa `activo = false`, que lo saca de los formularios y deja intactos los registros históricos.
5. Volver a pasar la validación por conteo de §5 antes de aplicar.

Las provincias se actualizan con `ON CONFLICT (codigo) DO UPDATE SET nombre = EXCLUDED.nombre`, así que renombrar una provincia es reejecutar la semilla.
