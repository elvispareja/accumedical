import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle2, Hourglass, Printer, XCircle } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'

import { useSesion } from '@/core/auth/useSesion'
import {
  obtenerFiltrosSupervision,
  obtenerReporteEdad,
  obtenerReporteSexo,
  obtenerReporteSla,
  type FiltrosReporte,
  type ReporteEdad,
  type ReporteSexo,
  type ReporteSla,
} from '@concurrencia/api'
import { FechaConEtiqueta } from '@concurrencia/components/filtros'
import { GrupoDeOpciones } from '@/shared/components/ui/opciones'
import {
  Columnas,
  Dona,
  TarjetaGrafico,
  type Columna,
  type SerieGrafico,
} from '@concurrencia/components/graficos'
import { Marca } from '@/core/components/Marca'
import { Boton } from '@/shared/components/ui/button'
import { Input } from '@/shared/components/ui/input'
import { Select } from '@/shared/components/ui/select'

/**
 * **Reportería de Concurrencia** (27/10/2026), del coordinador de Accumedical.
 * Solo gráficos (pedido del usuario: «no quiero tanta tabla; hazlos con
 * charts, círculos, tortas, escaleras, colores»).
 *
 * - **SLA**: el reloj corre desde que llegó el pedido —el alta de la compañía o
 *   el «Requerimiento» de nuestra coordinación— hasta la primera entrega del
 *   informe. Dona del estado (cumplimiento al centro), columnas de cumplimiento
 *   por aseguradora y columnas apiladas de casos por día.
 * - **Sexo**: de los casos ya auditados, según la línea «GENERO:» del informe.
 *   Torta y columnas apiladas por aseguradora.
 * - **Edad**: igual, de la línea «EDAD:», en los rangos del usuario (1–20,
 *   21–40, 41–60, más de 60). Rangos ORDENADOS → una escala de un solo tono,
 *   de claro a oscuro (validada como ordinal en los dos modos).
 *
 * Colores validados con la guía de visualización: el SLA usa la paleta de
 * ESTADO (siempre con icono y nombre en la leyenda); el sexo, los dos primeros
 * colores categóricos (azul y naranja, con su paso oscuro). Los filtros
 * —días de Ecuador sobre cuándo llegó el pedido, y la aseguradora— valen para
 * todo.
 */
/** Atajos de periodo (pedido del usuario, 27/10/2026): diario, semanal, mensual y anual. */
type Periodo = 'hoy' | 'semana' | 'mes' | 'anio' | 'todo' | 'personalizado'

const PERIODOS: { valor: Periodo; etiqueta: string }[] = [
  { valor: 'hoy', etiqueta: 'Hoy' },
  { valor: 'semana', etiqueta: 'Esta semana' },
  { valor: 'mes', etiqueta: 'Este mes' },
  { valor: 'anio', etiqueta: 'Este año' },
  { valor: 'todo', etiqueta: 'Todo' },
]

/** `YYYY-MM-DD` del día local, como lo esperan los filtros. */
function iso(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Desde y hasta de cada atajo. La semana empieza el lunes; todos llegan hasta hoy. */
function rangoDe(periodo: Periodo): { desde?: string; hasta?: string } {
  const hoy = new Date()
  const hasta = iso(hoy)
  switch (periodo) {
    case 'hoy':
      return { desde: hasta, hasta }
    case 'semana': {
      const lunes = new Date(hoy)
      lunes.setDate(hoy.getDate() - ((hoy.getDay() + 6) % 7))
      return { desde: iso(lunes), hasta }
    }
    case 'mes':
      return { desde: iso(new Date(hoy.getFullYear(), hoy.getMonth(), 1)), hasta }
    case 'anio':
      return { desde: iso(new Date(hoy.getFullYear(), 0, 1)), hasta }
    default:
      return {}
  }
}

const MESES = new Intl.DateTimeFormat('es-EC', { month: 'long' })
const FECHA_LARGA = new Intl.DateTimeFormat('es-EC', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
})
const GENERADO = new Intl.DateTimeFormat('es-EC', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

/** `YYYY-MM-DD` → la fecha local de ese día (sin corrimiento a UTC). */
function deIso(valor: string) {
  const [a, m, d] = valor.split('-').map(Number)
  return new Date(a ?? 0, (m ?? 1) - 1, d ?? 1)
}

/** La semana del mes que se está cursando (semanas de lunes a domingo). */
function semanaDelMes(d: Date) {
  const primero = new Date(d.getFullYear(), d.getMonth(), 1)
  return Math.ceil((d.getDate() + ((primero.getDay() + 6) % 7)) / 7)
}

/**
 * **El título del PDF**, según el filtro (pedido del usuario, 27/10/2026):
 * el día exacto, «semana N de octubre», el mes, el año, o «Reporte general»
 * más el mes en curso; y el nombre de la aseguradora si se filtró por una.
 */
function tituloDelReporte(
  periodo: Periodo,
  filtros: FiltrosReporte,
  aseguradora: string | undefined,
  hoy = new Date(),
) {
  const mesAnio = (d: Date) => `${MESES.format(d)} ${d.getFullYear()}`
  let base: string
  switch (periodo) {
    case 'hoy':
      base = `Reporte del ${FECHA_LARGA.format(hoy)}`
      break
    case 'semana':
      base = `Reporte de la semana ${semanaDelMes(hoy)} de ${mesAnio(hoy)}`
      break
    case 'mes':
      base = `Reporte de ${mesAnio(hoy)}`
      break
    case 'anio':
      base = `Reporte del año ${hoy.getFullYear()}`
      break
    case 'personalizado': {
      const { desde, hasta } = filtros
      if (desde && hasta) {
        base =
          desde === hasta
            ? `Reporte del ${FECHA_LARGA.format(deIso(desde))}`
            : `Reporte del ${FECHA_LARGA.format(deIso(desde))} al ${FECHA_LARGA.format(deIso(hasta))}`
      } else if (desde) {
        base = `Reporte desde el ${FECHA_LARGA.format(deIso(desde))}`
      } else if (hasta) {
        base = `Reporte hasta el ${FECHA_LARGA.format(deIso(hasta))}`
      } else {
        base = `Reporte general · ${mesAnio(hoy)}`
      }
      break
    }
    default:
      base = `Reporte general · ${mesAnio(hoy)}`
  }
  return aseguradora ? `${base} · ${aseguradora}` : base
}

export function ReporteriaPage() {
  const { data: sesion } = useSesion()
  const [filtros, setFiltros] = useState<FiltrosReporte>({})
  const [periodo, setPeriodo] = useState<Periodo>('todo')

  const rol = sesion?.modulos.find((m) => m.codigo === 'concurrencia')?.rol
  const esCoordinador = Boolean(sesion) && !sesion?.aseguradora && rol === 'supervisor'

  const opciones = useQuery({
    queryKey: ['supervision-filtros'],
    queryFn: obtenerFiltrosSupervision,
    enabled: esCoordinador,
  })
  const sla = useQuery({
    queryKey: ['reporte-sla', filtros],
    queryFn: () => obtenerReporteSla(filtros),
    enabled: esCoordinador,
    placeholderData: keepPreviousData,
  })
  const sexo = useQuery({
    queryKey: ['reporte-sexo', filtros],
    queryFn: () => obtenerReporteSexo(filtros),
    enabled: esCoordinador,
    placeholderData: keepPreviousData,
  })
  const edad = useQuery({
    queryKey: ['reporte-edad', filtros],
    queryFn: () => obtenerReporteEdad(filtros),
    enabled: esCoordinador,
    placeholderData: keepPreviousData,
  })

  const nombreAseguradora = opciones.data?.aseguradoras.find(
    (a) => a.id === filtros.aseguradora_id,
  )?.nombre
  const titulo = tituloDelReporte(periodo, filtros, nombreAseguradora)

  // **Imprimir / PDF** (pedido del usuario, 27/10/2026). Mientras se imprime:
  // siempre en modo claro (un PDF oscuro gasta tinta y se lee mal en papel) y
  // con el título del reporte como nombre del archivo. Vale también para
  // Ctrl+P. Al terminar, todo vuelve como estaba.
  const tituloActual = useRef(titulo)
  tituloActual.current = titulo
  useEffect(() => {
    let teniaOscuro = false
    let tituloAnterior = document.title
    const antes = () => {
      const raiz = document.documentElement
      teniaOscuro = raiz.classList.contains('dark')
      raiz.classList.remove('dark')
      tituloAnterior = document.title
      document.title = tituloActual.current
    }
    const despues = () => {
      if (teniaOscuro) document.documentElement.classList.add('dark')
      document.title = tituloAnterior
    }
    window.addEventListener('beforeprint', antes)
    window.addEventListener('afterprint', despues)
    return () => {
      window.removeEventListener('beforeprint', antes)
      window.removeEventListener('afterprint', despues)
    }
  }, [])
  const [generado, setGenerado] = useState(() => new Date())

  if (!sesion) return null
  if (!esCoordinador) {
    return (
      <div className="mx-auto max-w-md px-6 py-20 text-center">
        <p className="font-display text-sm font-medium">Esta sección no está disponible</p>
        <p className="mt-1 text-sm text-tenue-fg">
          La reportería es de la coordinación de Accumedical.
        </p>
      </div>
    )
  }

  const poner = (cambio: Partial<FiltrosReporte>) => setFiltros((f) => ({ ...f, ...cambio }))
  // Elegir un atajo fija las dos fechas; tocar una fecha a mano lo desmarca.
  const elegirPeriodo = (p: Periodo) => {
    setPeriodo(p)
    poner({ desde: undefined, hasta: undefined, ...rangoDe(p) })
  }
  const ponerFecha = (cambio: Partial<FiltrosReporte>) => {
    setPeriodo('personalizado')
    poner(cambio)
  }

  return (
    <div>
      {/* La hoja: horizontal, con sus colores tal cual. */}
      <style>{`@page { size: A4 landscape; margin: 10mm; }
        @media print { html, body { background: #fff !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; } }`}</style>

      {/* Solo en el PDF: la marca, el filtro como título y cuándo se generó. */}
      <header className="mb-5 hidden border-b border-borde pb-4 print:block">
        <div className="flex items-center justify-between gap-4">
          <Marca className="text-marca" />
          <p className="text-xs text-tenue-fg">Concurrencia · Reportería</p>
        </div>
        <h1 className="mt-4 font-display text-xl font-semibold tracking-tight">{titulo}</h1>
        <p className="mt-0.5 text-xs text-tenue-fg">Generado el {GENERADO.format(generado)}</p>
      </header>

      <header className="flex flex-wrap items-end justify-between gap-4 print:hidden">
        <div>
        <p className="font-display text-[0.6875rem] font-semibold uppercase tracking-[0.16em] text-tenue-fg">
          Concurrencia · Reportería
        </p>
        <h1 className="mt-1.5 font-display text-2xl font-semibold tracking-tight">Reportería</h1>
        <p className="mt-1 text-sm text-tenue-fg">
          Los casos de todas las aseguradoras, por la fecha en que llegó el pedido.
        </p>
        </div>
        <Boton
          type="button"
          variante="contorno"
          onClick={() => {
            setGenerado(new Date())
            // Tras pintar la hora nueva: el diálogo de impresión congela la página.
            window.setTimeout(() => window.print(), 50)
          }}
        >
          <Printer aria-hidden="true" />
          Imprimir / PDF
        </Boton>
      </header>

      {/* Los filtros, para todo lo de abajo: primero el periodo (lo que más se
          toca), luego las fechas a mano y la aseguradora. En el PDF no salen:
          los dice el título. */}
      <div className="print:hidden">
      <GrupoDeOpciones
        etiqueta="Periodo"
        valor={periodo}
        opciones={PERIODOS}
        onCambiar={elegirPeriodo}
        className="mt-6 max-w-xl"
      />
      <div className="mt-3 grid items-center gap-3 sm:grid-cols-[13rem_13rem_minmax(0,1fr)]">
        <FechaConEtiqueta etiqueta="Desde">
          <Input
            type="date"
            value={filtros.desde ?? ''}
            onChange={(e) => ponerFecha({ desde: e.target.value })}
            aria-label="Desde esta fecha"
            className="pl-16"
          />
        </FechaConEtiqueta>
        <FechaConEtiqueta etiqueta="Hasta">
          <Input
            type="date"
            value={filtros.hasta ?? ''}
            min={filtros.desde || undefined}
            onChange={(e) => ponerFecha({ hasta: e.target.value })}
            aria-label="Hasta esta fecha"
            className="pl-16"
          />
        </FechaConEtiqueta>
        <Select
          value={filtros.aseguradora_id ?? ''}
          onChange={(e) => poner({ aseguradora_id: e.target.value })}
          aria-label="Aseguradora"
        >
          <option value="">Todas las aseguradoras</option>
          {(opciones.data?.aseguradoras ?? []).map((a) => (
            <option key={a.id} value={a.id}>
              {a.nombre}
            </option>
          ))}
        </Select>
      </div>
      </div>

      {/* Arriba, todos los círculos; abajo, las columnas (pedido del usuario,
          27/10/2026). Un solo estado de carga para los tres reportes. */}
      <Seccion
        titulo="Resumen"
        nota="SLA desde que llegó el pedido hasta la primera entrega del informe; sexo y edad de los casos ya auditados, según su informe."
        cargando={sla.isPending || sexo.isPending || edad.isPending}
        error={sla.isError || sexo.isError || edad.isError}
        recargando={sla.isFetching || sexo.isFetching || edad.isFetching}
      >
        {sla.data && sexo.data && edad.data && (
          <Tablero sla={sla.data} sexo={sexo.data} edad={edad.data} />
        )}
      </Seccion>
    </div>
  )
}

// ─────────────────────────── Colores ───────────────────────────

// Paleta de ESTADO de la guía (fija en los dos modos): verde, ámbar y rojo se
// distinguen también con daltonismo (validado); el gris es «aún sin juzgar».
const SERIES_SLA: SerieGrafico[] = [
  {
    clave: 'a_tiempo',
    etiqueta: 'A tiempo',
    fondo: 'bg-[#0ca30c]',
    relleno: 'fill-[#0ca30c]',
    icono: CheckCircle2,
  },
  {
    clave: 'fuera_de_plazo',
    etiqueta: 'Entregado fuera del SLA',
    fondo: 'bg-[#fab219]',
    relleno: 'fill-[#fab219]',
    icono: AlertTriangle,
  },
  {
    clave: 'vencido',
    etiqueta: 'Fuera del SLA sin informe',
    fondo: 'bg-[#d03b3b]',
    relleno: 'fill-[#d03b3b]',
    icono: XCircle,
  },
  {
    clave: 'en_plazo',
    etiqueta: 'En plazo',
    fondo: 'bg-[#898781]',
    relleno: 'fill-[#898781]',
    icono: Hourglass,
  },
]

// Una sola serie (el cumplimiento): un solo color, el primero categórico.
const SERIE_CUMPLIMIENTO: SerieGrafico[] = [
  {
    clave: 'cumplimiento',
    etiqueta: 'Cumplimiento',
    fondo: 'bg-[#2a78d6] dark:bg-[#3987e5]',
    relleno: 'fill-[#2a78d6] dark:fill-[#3987e5]',
  },
]

// Azul y naranja categóricos, con su paso oscuro (validados juntos); «no consta», gris.
const SERIES_SEXO: SerieGrafico[] = [
  {
    clave: 'femenino',
    etiqueta: 'Femenino',
    fondo: 'bg-[#2a78d6] dark:bg-[#3987e5]',
    relleno: 'fill-[#2a78d6] dark:fill-[#3987e5]',
  },
  {
    clave: 'masculino',
    etiqueta: 'Masculino',
    fondo: 'bg-[#eb6834] dark:bg-[#d95926]',
    relleno: 'fill-[#eb6834] dark:fill-[#d95926]',
  },
  { clave: 'no_consta', etiqueta: 'No consta', fondo: 'bg-[#898781]', relleno: 'fill-[#898781]' },
]

// Rangos de edad: ORDENADOS, así que una escala de un solo tono (azul), de claro
// (jóvenes) a oscuro (mayores) en modo claro, y al revés en oscuro, donde «más»
// se lee más claro. Validada como ordinal en los dos modos. «No consta», gris.
const SERIES_EDAD: SerieGrafico[] = [
  {
    clave: 'de_1_a_20',
    etiqueta: '1 – 20 años',
    fondo: 'bg-[#86b6ef] dark:bg-[#184f95]',
    relleno: 'fill-[#86b6ef] dark:fill-[#184f95]',
  },
  {
    clave: 'de_21_a_40',
    etiqueta: '21 – 40 años',
    fondo: 'bg-[#5598e7] dark:bg-[#256abf]',
    relleno: 'fill-[#5598e7] dark:fill-[#256abf]',
  },
  {
    clave: 'de_41_a_60',
    etiqueta: '41 – 60 años',
    fondo: 'bg-[#2a78d6] dark:bg-[#3987e5]',
    relleno: 'fill-[#2a78d6] dark:fill-[#3987e5]',
  },
  {
    clave: 'mas_de_60',
    etiqueta: 'Más de 60 años',
    fondo: 'bg-[#1c5cab] dark:bg-[#86b6ef]',
    relleno: 'fill-[#1c5cab] dark:fill-[#86b6ef]',
  },
  { clave: 'no_consta', etiqueta: 'No consta', fondo: 'bg-[#898781]', relleno: 'fill-[#898781]' },
]

// ──────────────────────────── Tablero ────────────────────────────

const diaEc = new Intl.DateTimeFormat('es-EC', {
  timeZone: 'America/Guayaquil',
  day: 'numeric',
  month: 'short',
})
// AAAA-MM-DD en Ecuador: la clave del día, que además ordena bien.
const claveDia = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Guayaquil' })

/** Los conteos de edad, sin el total: lo que se reparte en la torta y las columnas. */
function rangosDeEdad(f: Omit<ReporteEdad['total'], 'auditados'>) {
  return {
    de_1_a_20: f.de_1_a_20,
    de_21_a_40: f.de_21_a_40,
    de_41_a_60: f.de_41_a_60,
    mas_de_60: f.mas_de_60,
    no_consta: f.no_consta,
  }
}

function SinAuditados() {
  return (
    <p className="py-10 text-center text-sm text-tenue-fg">Aún no hay casos auditados en el periodo.</p>
  )
}

/**
 * Fila de arriba: los tres círculos (estado del SLA, sexo, edad). Debajo, las
 * cuatro columnas en una fila: cumplimiento por aseguradora, casos por día, y
 * sexo y edad por aseguradora.
 */
function Tablero({
  sla,
  sexo,
  edad,
}: {
  sla: ReporteSla
  sexo: ReporteSexo
  edad: ReporteEdad
}) {
  const total = sla.total
  // Casos por día en que llegó el pedido, apilados por estado (sin cancelados).
  const porDia = new Map<string, Columna>()
  for (const c of [...sla.casos].sort((a, b) => a.inicio_sla.localeCompare(b.inicio_sla))) {
    if (c.estado_sla === 'cancelado') continue
    const fecha = new Date(c.inicio_sla)
    const clave = claveDia.format(fecha)
    const col = porDia.get(clave) ?? { etiqueta: diaEc.format(fecha), valores: {} }
    col.valores[c.estado_sla] = (col.valores[c.estado_sla] ?? 0) + 1
    porDia.set(clave, col)
  }
  const auditados = sexo.total.auditados
  const notaAuditados = `${auditados} ${auditados === 1 ? 'caso auditado' : 'casos auditados'}.`

  return (
    <>
      {/* En la hoja, la misma rejilla que en pantalla grande (3 y 4 por fila). */}
      <div className="grid gap-4 lg:grid-cols-3 print:grid-cols-3">
        <TarjetaGrafico
          titulo="Estado del SLA"
          nota={`${total.casos} ${total.casos === 1 ? 'caso' : 'casos'} en el periodo.`}
        >
          <Dona
            etiqueta="Estado del SLA"
            series={SERIES_SLA}
            valores={{
              a_tiempo: total.a_tiempo,
              fuera_de_plazo: total.fuera_de_plazo,
              vencido: total.vencido,
              en_plazo: total.en_plazo,
            }}
            centro={{
              valor: total.cumplimiento === null ? '—' : `${Math.round(total.cumplimiento)} %`,
              detalle: 'cumplimiento',
            }}
            tamano={180}
            leyendaAbajo
          />
        </TarjetaGrafico>

        <TarjetaGrafico titulo="Distribución por sexo" nota={notaAuditados}>
          {auditados === 0 ? (
            <SinAuditados />
          ) : (
            <Dona
              etiqueta="Distribución por sexo"
              series={SERIES_SEXO}
              valores={{
                femenino: sexo.total.femenino,
                masculino: sexo.total.masculino,
                no_consta: sexo.total.no_consta,
              }}
              torta
              tamano={180}
              leyendaAbajo
            />
          )}
        </TarjetaGrafico>

        <TarjetaGrafico titulo="Distribución por edad" nota={notaAuditados}>
          {edad.total.auditados === 0 ? (
            <SinAuditados />
          ) : (
            <Dona
              etiqueta="Distribución por edad"
              series={SERIES_EDAD}
              valores={rangosDeEdad(edad.total)}
              torta
              tamano={180}
              leyendaAbajo
            />
          )}
        </TarjetaGrafico>
      </div>

      {/* Las cuatro columnas en una sola fila (pedido del usuario, 27/10/2026);
          en pantallas medianas, de dos en dos. */}
      <div className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-4 print:grid-cols-4">
        <TarjetaGrafico
          titulo="Cumplimiento por aseguradora"
          nota="A tiempo entre entregados y vencidos."
        >
          <Columnas
            etiqueta="Cumplimiento por aseguradora"
            series={SERIE_CUMPLIMIENTO}
            maximo={100}
            formato={(n) => `${n} %`}
            vacio="Aún no hay casos entregados ni vencidos."
            columnas={sla.por_aseguradora
              .filter((f) => f.cumplimiento !== null)
              .map((f) => ({
                etiqueta: f.aseguradora,
                valores: { cumplimiento: Math.round(f.cumplimiento ?? 0) },
              }))}
          />
        </TarjetaGrafico>

        <TarjetaGrafico
          titulo="Casos por día"
          nota="Día en que llegó el pedido."
        >
          <Columnas
            etiqueta="Casos por día y estado del SLA"
            series={SERIES_SLA}
            columnas={[...porDia.values()]}
          />
        </TarjetaGrafico>

        <TarjetaGrafico titulo="Sexo por aseguradora" nota="Casos auditados.">
          <Columnas
            etiqueta="Casos auditados por sexo y aseguradora"
            series={SERIES_SEXO}
            vacio="Aún no hay casos auditados en el periodo."
            columnas={sexo.por_aseguradora.map((f) => ({
              etiqueta: f.aseguradora,
              valores: { femenino: f.femenino, masculino: f.masculino, no_consta: f.no_consta },
            }))}
          />
        </TarjetaGrafico>

        <TarjetaGrafico
          titulo="Edad por aseguradora"
          nota="Casos auditados."
        >
          <Columnas
            etiqueta="Casos auditados por edad y aseguradora"
            series={SERIES_EDAD}
            vacio="Aún no hay casos auditados en el periodo."
            columnas={edad.por_aseguradora.map((f) => ({
              etiqueta: f.aseguradora,
              valores: rangosDeEdad(f),
            }))}
          />
        </TarjetaGrafico>
      </div>
    </>
  )
}

// ─────────────────────────── Piezas ───────────────────────────

function Seccion({
  titulo,
  nota,
  cargando,
  error,
  recargando,
  children,
}: {
  titulo: string
  nota: string
  cargando: boolean
  error: boolean
  recargando: boolean
  children: ReactNode
}) {
  return (
    <section className="mt-9">
      <h2 className="font-display text-lg font-semibold tracking-tight">{titulo}</h2>
      <p className="mt-0.5 text-sm text-tenue-fg">{nota}</p>
      <div className="mt-5">
        {error ? (
          <p className="rounded-md border border-dashed border-borde px-4 py-6 text-center text-sm text-tenue-fg">
            No se pudo cargar este reporte.
          </p>
        ) : cargando ? (
          <div className="grid gap-4 lg:grid-cols-2" role="status" aria-label="Cargando">
            <div className="h-64 animate-pulse rounded-md bg-tenue" />
            <div className="h-64 animate-pulse rounded-md bg-tenue" />
          </div>
        ) : (
          // Al cambiar un filtro se queda el gráfico anterior, atenuado: sin saltos.
          <div className={recargando ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
            {children}
          </div>
        )}
      </div>
    </section>
  )
}
