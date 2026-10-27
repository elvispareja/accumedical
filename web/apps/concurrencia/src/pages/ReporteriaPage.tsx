import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle2, Clock, Hourglass, XCircle } from 'lucide-react'
import { useState, type ReactNode } from 'react'

import { cn } from '@/lib/utils'
import { useSesion } from '@/core/auth/useSesion'
import {
  obtenerFiltrosSupervision,
  obtenerReporteSexo,
  obtenerReporteSla,
  type EstadoSla,
  type FiltrosReporte,
  type ReporteSexo,
  type ReporteSla,
} from '@concurrencia/api'
import { FechaConEtiqueta } from '@concurrencia/components/filtros'
import { Input } from '@/shared/components/ui/input'
import { Select } from '@/shared/components/ui/select'

/**
 * **Reportería de Concurrencia** (27/10/2026), del coordinador de Accumedical.
 *
 * - **SLA**: el reloj corre desde que llegó el pedido —el alta de la compañía o
 *   el «Requerimiento» que anota nuestra coordinación— hasta la primera entrega
 *   del informe, con las horas pactadas con cada aseguradora.
 * - **Por sexo**: de los casos ya auditados, según la línea «GENERO:» del
 *   informe.
 *
 * Los filtros (días de Ecuador sobre cuándo llegó el pedido, y la aseguradora)
 * valen para los dos. Cifras y tablas, sin gráficos: el estado del SLA va
 * siempre con su nombre e icono, nunca solo el color.
 */
export function ReporteriaPage() {
  const { data: sesion } = useSesion()
  const [filtros, setFiltros] = useState<FiltrosReporte>({})

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

      {/* Los filtros, en una fila, para los dos reportes. */}
      <div className="mt-6 grid items-center gap-3 sm:grid-cols-[13rem_13rem_minmax(0,1fr)]">
        <FechaConEtiqueta etiqueta="Desde">
          <Input
            type="date"
            value={filtros.desde ?? ''}
            onChange={(e) => poner({ desde: e.target.value })}
            aria-label="Desde esta fecha"
            className="pl-16"
          />
        </FechaConEtiqueta>
        <FechaConEtiqueta etiqueta="Hasta">
          <Input
            type="date"
            value={filtros.hasta ?? ''}
            min={filtros.desde || undefined}
            onChange={(e) => poner({ hasta: e.target.value })}
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

      <ReporteDeSla datos={sla.data} cargando={sla.isPending} error={sla.isError} />
      <ReporteDeSexo datos={sexo.data} cargando={sexo.isPending} error={sexo.isError} />
    </div>
  )
}

// ───────────────────────────── SLA ─────────────────────────────

const ESTADO: Record<EstadoSla, { etiqueta: string; icono: typeof Clock; tono: string }> = {
  a_tiempo: { etiqueta: 'A tiempo', icono: CheckCircle2, tono: 'text-exito' },
  fuera_de_plazo: { etiqueta: 'Fuera de plazo', icono: AlertTriangle, tono: 'text-aviso' },
  vencido: { etiqueta: 'Vencido sin entregar', icono: XCircle, tono: 'text-peligro' },
  en_plazo: { etiqueta: 'En plazo', icono: Hourglass, tono: 'text-tenue-fg' },
  cancelado: { etiqueta: 'Cancelado', icono: Clock, tono: 'text-tenue-fg' },
}

const ORIGEN: Record<string, string> = {
  sistema: 'Sistema (aseguradora)',
  correo: 'Correo',
  otro: 'Otro medio',
}

const fechaHora = new Intl.DateTimeFormat('es-EC', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
})

function porcentaje(valor: number | null) {
  return valor === null ? '—' : `${valor.toLocaleString('es-EC')} %`
}

function ReporteDeSla({
  datos,
  cargando,
  error,
}: {
  datos?: ReporteSla
  cargando: boolean
  error: boolean
}) {
  return (
    <section className="mt-9" aria-labelledby="titulo-sla">
      <h2 id="titulo-sla" className="font-display text-lg font-semibold tracking-tight">
        SLA de entrega del informe
      </h2>
      <p className="mt-0.5 text-sm text-tenue-fg">
        Desde que llegó el pedido —el alta de la aseguradora o el «Requerimiento» de la
        coordinación— hasta la primera entrega del informe, con las horas pactadas con cada
        compañía.
      </p>

      {error ? (
        <Aviso texto="No se pudo cargar el reporte de SLA." />
      ) : cargando || !datos ? (
        <Esqueleto />
      ) : (
        <>
          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <Cifra
              etiqueta="Cumplimiento"
              valor={porcentaje(datos.total.cumplimiento)}
              detalle={`${datos.total.casos} ${datos.total.casos === 1 ? 'caso' : 'casos'} en el periodo`}
              destacada
            />
            {(['a_tiempo', 'fuera_de_plazo', 'vencido', 'en_plazo'] as const).map((e) => (
              <Cifra key={e} etiqueta={ESTADO[e].etiqueta} valor={String(datos.total[e])} estado={e} />
            ))}
          </div>

          <Tabla
            className="mt-5"
            titulo="Por aseguradora"
            columnas={[
              'Aseguradora',
              'Casos',
              'A tiempo',
              'Fuera de plazo',
              'Vencidos',
              'En plazo',
              'Cumplimiento',
            ]}
            vacio="No hay casos en el periodo."
            filas={datos.por_aseguradora.map((f) => [
              f.aseguradora,
              f.casos,
              f.a_tiempo,
              f.fuera_de_plazo,
              f.vencido,
              f.en_plazo,
              porcentaje(f.cumplimiento),
            ])}
          />

          <Tabla
            className="mt-5"
            titulo="Casos"
            columnas={[
              'Código',
              'Aseguradora',
              'Llegó por',
              'Inicio del SLA',
              'Límite',
              'Entregado',
              'Horas usadas',
              'Estado',
            ]}
            vacio="No hay casos en el periodo."
            filas={datos.casos.map((c) => [
              <span key="c" className="font-mono text-xs">
                {c.codigo_interno}
              </span>,
              c.aseguradora,
              ORIGEN[c.origen] ?? c.origen,
              fechaHora.format(new Date(c.inicio_sla)),
              fechaHora.format(new Date(c.limite)),
              c.entregado_at ? fechaHora.format(new Date(c.entregado_at)) : '—',
              `${c.horas.toLocaleString('es-EC')} de ${c.horas_sla.toLocaleString('es-EC')} h`,
              <EstadoSlaInsignia key="e" estado={c.estado_sla} />,
            ])}
          />
        </>
      )}
    </section>
  )
}

function EstadoSlaInsignia({ estado }: { estado: EstadoSla }) {
  const { etiqueta, icono: Icono, tono } = ESTADO[estado]
  return (
    <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-medium', tono)}>
      <Icono className="size-3.5" aria-hidden="true" />
      {etiqueta}
    </span>
  )
}

// ───────────────────────────── Sexo ─────────────────────────────

function ReporteDeSexo({
  datos,
  cargando,
  error,
}: {
  datos?: ReporteSexo
  cargando: boolean
  error: boolean
}) {
  const parte = (n: number, de: number) =>
    de ? `${Math.round((100 * n) / de).toLocaleString('es-EC')} % de los auditados` : undefined
  return (
    <section className="mt-10" aria-labelledby="titulo-sexo">
      <h2 id="titulo-sexo" className="font-display text-lg font-semibold tracking-tight">
        Casos auditados por sexo
      </h2>
      <p className="mt-0.5 text-sm text-tenue-fg">
        Solo los casos ya auditados: el sexo sale del informe (línea «GÉNERO»).
      </p>

      {error ? (
        <Aviso texto="No se pudo cargar el reporte por sexo." />
      ) : cargando || !datos ? (
        <Esqueleto />
      ) : (
        <>
          <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Cifra etiqueta="Auditados" valor={String(datos.total.auditados)} destacada />
            <Cifra
              etiqueta="Femenino"
              valor={String(datos.total.femenino)}
              detalle={parte(datos.total.femenino, datos.total.auditados)}
            />
            <Cifra
              etiqueta="Masculino"
              valor={String(datos.total.masculino)}
              detalle={parte(datos.total.masculino, datos.total.auditados)}
            />
            <Cifra
              etiqueta="No consta"
              valor={String(datos.total.no_consta)}
              detalle={parte(datos.total.no_consta, datos.total.auditados)}
            />
          </div>

          <Tabla
            className="mt-5"
            titulo="Por aseguradora"
            columnas={['Aseguradora', 'Auditados', 'Femenino', 'Masculino', 'No consta']}
            vacio="No hay casos auditados en el periodo."
            filas={datos.por_aseguradora.map((f) => [
              f.aseguradora,
              f.auditados,
              f.femenino,
              f.masculino,
              f.no_consta,
            ])}
          />
        </>
      )}
    </section>
  )
}

// ─────────────────────────── Piezas ───────────────────────────

function Cifra({
  etiqueta,
  valor,
  detalle,
  estado,
  destacada = false,
}: {
  etiqueta: string
  valor: string
  detalle?: string
  estado?: EstadoSla
  destacada?: boolean
}) {
  const Icono = estado ? ESTADO[estado].icono : null
  return (
    <div
      className={cn(
        'rounded-md border bg-superficie px-4 py-3.5',
        destacada ? 'border-marca/40' : 'border-borde',
      )}
    >
      <p className="flex items-center gap-1.5 font-display text-[0.6875rem] font-semibold uppercase tracking-[0.09em] text-tenue-fg">
        {Icono && estado && (
          <Icono className={cn('size-3.5', ESTADO[estado].tono)} aria-hidden="true" />
        )}
        {etiqueta}
      </p>
      <p className="tabular mt-1.5 font-display text-2xl font-semibold">{valor}</p>
      {detalle && <p className="mt-0.5 text-xs text-tenue-fg">{detalle}</p>}
    </div>
  )
}

function Tabla({
  titulo,
  columnas,
  filas,
  vacio,
  className,
}: {
  titulo: string
  columnas: string[]
  filas: ReactNode[][]
  vacio: string
  className?: string
}) {
  return (
    <div className={cn('overflow-hidden rounded-md border border-borde bg-superficie', className)}>
      <p className="border-b border-borde px-4 py-2.5 font-display text-xs font-semibold uppercase tracking-[0.09em] text-tenue-fg">
        {titulo}
      </p>
      {filas.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-tenue-fg">{vacio}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-borde bg-superficie-hundida text-left">
                {columnas.map((c) => (
                  <th
                    key={c}
                    className="whitespace-nowrap px-4 py-2 font-display text-[0.6875rem] font-semibold uppercase tracking-[0.09em] text-tenue-fg"
                  >
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filas.map((fila, i) => (
                <tr key={i} className="border-b border-borde last:border-b-0">
                  {fila.map((celda, j) => (
                    <td
                      key={j}
                      className={cn(
                        'whitespace-nowrap px-4 py-2.5',
                        j === 0 ? 'font-medium' : 'tabular text-tenue-fg',
                      )}
                    >
                      {celda}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function Esqueleto() {
  return (
    <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4" role="status" aria-label="Cargando">
      {Array.from({ length: 4 }, (_, i) => (
        <div key={i} className="h-20 animate-pulse rounded-md bg-tenue" />
      ))}
    </div>
  )
}

function Aviso({ texto }: { texto: string }) {
  return (
    <p className="mt-5 rounded-md border border-dashed border-borde px-4 py-6 text-center text-sm text-tenue-fg">
      {texto}
    </p>
  )
}
