import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle2, Hourglass, XCircle } from 'lucide-react'
import { useState, type ReactNode } from 'react'

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
      <header>
        <p className="font-display text-[0.6875rem] font-semibold uppercase tracking-[0.16em] text-tenue-fg">
          Concurrencia · Reportería
        </p>
        <h1 className="mt-1.5 font-display text-2xl font-semibold tracking-tight">Reportería</h1>
        <p className="mt-1 text-sm text-tenue-fg">
          Los casos de todas las aseguradoras, por la fecha en que llegó el pedido.
        </p>
      </header>

      {/* Los filtros, para todo lo de abajo: primero el periodo (lo que más se
          toca), luego las fechas a mano y la aseguradora. */}
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

      <Seccion
        titulo="SLA de entrega del informe"
        nota="Desde que llegó el pedido —el alta de la aseguradora o el «Requerimiento» de la coordinación— hasta la primera entrega del informe."
        cargando={sla.isPending}
        error={sla.isError}
        recargando={sla.isFetching && !sla.isPending}
      >
        {sla.data && <GraficosSla datos={sla.data} />}
      </Seccion>

      <Seccion
        titulo="Casos auditados por sexo"
        nota="Solo los casos ya auditados: el sexo sale del informe (línea «GÉNERO»)."
        cargando={sexo.isPending}
        error={sexo.isError}
        recargando={sexo.isFetching && !sexo.isPending}
      >
        {sexo.data && <GraficosSexo datos={sexo.data} />}
      </Seccion>

      <Seccion
        titulo="Casos auditados por edad"
        nota="Solo los casos ya auditados: la edad sale del informe (línea «EDAD»). Los menores de un año cuentan en 1 – 20."
        cargando={edad.isPending}
        error={edad.isError}
        recargando={edad.isFetching && !edad.isPending}
      >
        {edad.data && <GraficosEdad datos={edad.data} />}
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
    etiqueta: 'Fuera de plazo',
    fondo: 'bg-[#fab219]',
    relleno: 'fill-[#fab219]',
    icono: AlertTriangle,
  },
  {
    clave: 'vencido',
    etiqueta: 'Vencido sin entregar',
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

// ───────────────────────────── SLA ─────────────────────────────

const diaEc = new Intl.DateTimeFormat('es-EC', {
  timeZone: 'America/Guayaquil',
  day: 'numeric',
  month: 'short',
})
// AAAA-MM-DD en Ecuador: la clave del día, que además ordena bien.
const claveDia = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Guayaquil' })

function GraficosSla({ datos }: { datos: ReporteSla }) {
  const total = datos.total
  // Casos por día en que llegó el pedido, apilados por estado (sin cancelados).
  const porDia = new Map<string, Columna>()
  for (const c of [...datos.casos].sort((a, b) => a.inicio_sla.localeCompare(b.inicio_sla))) {
    if (c.estado_sla === 'cancelado') continue
    const fecha = new Date(c.inicio_sla)
    const clave = claveDia.format(fecha)
    const col = porDia.get(clave) ?? { etiqueta: diaEc.format(fecha), valores: {} }
    col.valores[c.estado_sla] = (col.valores[c.estado_sla] ?? 0) + 1
    porDia.set(clave, col)
  }

  // Los tres en una fila (pedido del usuario, 27/10/2026).
  return (
    <div className="grid gap-4 lg:grid-cols-3">
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

      <TarjetaGrafico
        titulo="Cumplimiento por aseguradora"
        nota="A tiempo entre lo entregado y lo vencido."
      >
        <Columnas
          etiqueta="Cumplimiento por aseguradora"
          series={SERIE_CUMPLIMIENTO}
          maximo={100}
          formato={(n) => `${n} %`}
          vacio="Aún no hay casos entregados ni vencidos."
          columnas={datos.por_aseguradora
            .filter((f) => f.cumplimiento !== null)
            .map((f) => ({
              etiqueta: f.aseguradora,
              valores: { cumplimiento: Math.round(f.cumplimiento ?? 0) },
            }))}
        />
      </TarjetaGrafico>

      <TarjetaGrafico
        titulo="Casos por día"
        nota="Por el día en que llegó el pedido, con su estado del SLA."
      >
        <Columnas
          etiqueta="Casos por día y estado del SLA"
          series={SERIES_SLA}
          columnas={[...porDia.values()]}
        />
      </TarjetaGrafico>
    </div>
  )
}

// ───────────────────────────── Sexo ─────────────────────────────

function GraficosSexo({ datos }: { datos: ReporteSexo }) {
  const { auditados, femenino, masculino, no_consta } = datos.total
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <TarjetaGrafico
        titulo="Distribución por sexo"
        nota={`${auditados} ${auditados === 1 ? 'caso auditado' : 'casos auditados'}.`}
      >
        {auditados === 0 ? (
          <p className="py-10 text-center text-sm text-tenue-fg">
            Aún no hay casos auditados en el periodo.
          </p>
        ) : (
          <Dona
            etiqueta="Distribución por sexo"
            series={SERIES_SEXO}
            valores={{ femenino, masculino, no_consta }}
            torta
          />
        )}
      </TarjetaGrafico>

      <TarjetaGrafico titulo="Sexo por aseguradora">
        <Columnas
          etiqueta="Casos auditados por sexo y aseguradora"
          series={SERIES_SEXO}
          vacio="Aún no hay casos auditados en el periodo."
          columnas={datos.por_aseguradora.map((f) => ({
            etiqueta: f.aseguradora,
            valores: { femenino: f.femenino, masculino: f.masculino, no_consta: f.no_consta },
          }))}
        />
      </TarjetaGrafico>
    </div>
  )
}

// ───────────────────────────── Edad ─────────────────────────────

function GraficosEdad({ datos }: { datos: ReporteEdad }) {
  const { auditados, ...rangos } = datos.total
  const valoresDe = (f: Omit<ReporteEdad['total'], 'auditados'>) => ({
    de_1_a_20: f.de_1_a_20,
    de_21_a_40: f.de_21_a_40,
    de_41_a_60: f.de_41_a_60,
    mas_de_60: f.mas_de_60,
    no_consta: f.no_consta,
  })
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <TarjetaGrafico
        titulo="Distribución por edad"
        nota={`${auditados} ${auditados === 1 ? 'caso auditado' : 'casos auditados'}.`}
      >
        {auditados === 0 ? (
          <p className="py-10 text-center text-sm text-tenue-fg">
            Aún no hay casos auditados en el periodo.
          </p>
        ) : (
          <Dona
            etiqueta="Distribución por edad"
            series={SERIES_EDAD}
            valores={valoresDe(rangos)}
            torta
          />
        )}
      </TarjetaGrafico>

      <TarjetaGrafico titulo="Edad por aseguradora">
        <Columnas
          etiqueta="Casos auditados por edad y aseguradora"
          series={SERIES_EDAD}
          vacio="Aún no hay casos auditados en el periodo."
          columnas={datos.por_aseguradora.map((f) => ({
            etiqueta: f.aseguradora,
            valores: valoresDe(f),
          }))}
        />
      </TarjetaGrafico>
    </div>
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
