import { motion, useReducedMotion } from 'framer-motion'
import { CalendarClock, ChevronRight, RotateCw } from 'lucide-react'

import { cn } from '@/lib/utils'
import type { CifrasVisitas } from '@concurrencia/api'
import { Boton } from '@/shared/components/ui/button'

const EASE: [number, number, number, number] = [0.22, 0.61, 0.36, 1]

/** La fecha local de hoy en `YYYY-MM-DD`, como la esperan los filtros de fecha. */
export function hoyLocal(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Lo que pone un cuadro al pulsarlo: un estado y, el de hoy, además el día. */
export interface FiltroDeCuadro {
  estado?: string
  /** El cuadro «Sin asignar» de supervisión: casos sin auditor. */
  sinAsignar?: boolean
  /** El cuadro «Fuera del SLA» de supervisión: abiertos con la entrega vencida. */
  fueraSla?: boolean
  desde?: string
  hasta?: string
}

/**
 * Los cuadros del panel: **uno por estado**, más el de hoy. Cuántas visitas hay
 * en cada uno y cuántas tocan hoy. **Cada uno es también un filtro**: pulsarlo no navega, repinta la
 * lista de abajo acotada a lo que cuenta.
 *
 * Es UN componente y no dos copias: lo usan igual el panel del supervisor de la
 * compañía y el de supervisión de plataforma, que solo se diferencian en lo que
 * abarcan sus cifras —las suyas o las de todas—. Quien lo usa le pasa los
 * números ya pedidos y qué hacer al pulsar; él no sabe de rutas ni de permisos.
 */
export function CuadrosDeVisitas({
  cifras,
  cargando = false,
  error = false,
  onReintentar,
  alFiltrar,
  conSinAsignar = false,
  className,
}: {
  cifras?: CifrasVisitas
  /** Supervisión suma «Fuera del SLA» y «Sin asignar»: quedan 4 y 4. */
  conSinAsignar?: boolean
  cargando?: boolean
  error?: boolean
  onReintentar?: () => void
  alFiltrar: (filtro: FiltroDeCuadro) => void
  className?: string
}) {
  // Con los ocho de supervisión la rejilla es de 4 en 4 (pedido del usuario);
  // los seis de la compañía caben en una fila en pantallas muy anchas.
  const rejilla = conSinAsignar
    ? 'grid grid-cols-2 gap-3 sm:grid-cols-4'
    : 'grid grid-cols-2 gap-3 sm:grid-cols-3 2xl:grid-cols-6'
  if (cargando) return <Esqueleto className={cn(rejilla, className)} cuantos={conSinAsignar ? 8 : 6} />
  if (error) return <EstadoError className={className} onReintentar={onReintentar} />
  if (!cifras) return null

  // Los cinco estados y el de hoy. Ninguno se puede esconder sin que las
  // cuentas dejen de cuadrar con el total.
  return (
    <div className={cn(rejilla, className)}>
      <Cifra
        indice={0}
        etiqueta="Hoy"
        valor={cifras.hoy}
        // La compañía no ve la hora de la visita (26/10/2026): su «hoy» son los
        // casos que registró hoy. Supervisión sí cuenta los que tocan hoy.
        detalle={
          conSinAsignar
            ? cifras.hoy === 1
              ? 'visita toca hoy'
              : 'visitas tocan hoy'
            : cifras.hoy === 1
              ? 'caso registrado hoy'
              : 'casos registrados hoy'
        }
        acento
        // Solo el día, sin estado: «hoy» cuenta las que siguen en pie
        // —programada, asignada o auditando—, y fijar uno solo dejaría fuera
        // justo las que ya tienen auditor, que son las más.
        alPulsar={() => alFiltrar({ desde: hoyLocal(), hasta: hoyLocal() })}
      />
      <Cifra
        indice={1}
        etiqueta="Programadas"
        valor={cifras.programadas}
        detalle="en agenda"
        punto="bg-modulo-concurrencia"
        alPulsar={() => alFiltrar({ estado: 'programada' })}
      />
      <Cifra
        indice={2}
        etiqueta="Asignadas"
        valor={cifras.asignadas}
        detalle="con auditor"
        punto="bg-marca"
        alPulsar={() => alFiltrar({ estado: 'asignada' })}
      />
      <Cifra
        indice={3}
        etiqueta="Auditando"
        valor={cifras.auditando}
        detalle="el auditor llegó"
        punto="bg-aviso"
        alPulsar={() => alFiltrar({ estado: 'auditando' })}
      />
      <Cifra
        indice={4}
        etiqueta="Culminadas"
        valor={cifras.culminadas}
        detalle="ya realizadas"
        punto="bg-exito"
        alPulsar={() => alFiltrar({ estado: 'culminada' })}
      />
      <Cifra
        indice={5}
        etiqueta="Canceladas"
        valor={cifras.canceladas}
        detalle="no se hicieron"
        punto="bg-tenue-fg/60"
        alPulsar={() => alFiltrar({ estado: 'cancelada' })}
      />
      {/* Fuera del SLA (27/10/2026, reemplaza a «No auditadas»): no es un
          estado, atraviesa asignadas y auditando. Solo Accumedical lo ve. */}
      {conSinAsignar && (
        <Cifra
          indice={6}
          etiqueta="Fuera del SLA"
          valor={cifras.fuera_sla}
          detalle="sin informe a tiempo"
          punto="bg-peligro"
          alPulsar={() => alFiltrar({ fueraSla: true })}
        />
      )}
      {conSinAsignar && (
        <Cifra
          indice={7}
          etiqueta="Sin asignar"
          valor={cifras.sin_asignar}
          detalle="sin auditor todavía"
          punto="bg-tenue-fg"
          alPulsar={() => alFiltrar({ sinAsignar: true })}
        />
      )}
    </div>
  )
}

/**
 * Una cifra del panel, y también un filtro. El número viste tinta de texto,
 * nunca el color del estado: la identidad la lleva el punto de color junto a la
 * etiqueta —el mismo que usa la insignia de estado en la lista— y la etiqueta
 * misma.
 */
function Cifra({
  indice,
  etiqueta,
  valor,
  detalle,
  punto,
  acento = false,
  alPulsar,
}: {
  indice: number
  etiqueta: string
  valor: number
  detalle: string
  punto?: string
  acento?: boolean
  alPulsar: () => void
}) {
  const sinMovimiento = useReducedMotion()
  return (
    <motion.button
      type="button"
      onClick={alPulsar}
      aria-label={`Filtrar casos: ${etiqueta.toLocaleLowerCase()} (${valor})`}
      initial={sinMovimiento ? { opacity: 0 } : { opacity: 0, y: 6 }}
      animate={{
        opacity: 1,
        y: 0,
        transition: { duration: 0.22, delay: sinMovimiento ? 0 : indice * 0.05, ease: EASE },
      }}
      className={cn(
        'group rounded-md border bg-superficie px-4 py-4 text-left transition-colors duration-150',
        'hover:bg-tenue/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-marca',
        acento
          ? 'border-modulo-concurrencia/40 hover:border-modulo-concurrencia/70'
          : 'border-borde hover:border-tenue-fg/40',
      )}
    >
      <span className="flex items-center gap-1.5 font-display text-[0.6875rem] font-semibold uppercase tracking-[0.09em] text-tenue-fg">
        {acento ? (
          <CalendarClock className="size-3.5 text-modulo-concurrencia" aria-hidden="true" />
        ) : (
          punto && <span className={cn('size-1.5 rounded-full', punto)} aria-hidden="true" />
        )}
        {etiqueta}
        <ChevronRight
          className="ml-auto size-3.5 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100"
          aria-hidden="true"
        />
      </span>
      <span className="tabular mt-2 block font-display text-3xl font-semibold tracking-tight">
        {valor}
      </span>
      <span className="mt-0.5 block text-xs text-tenue-fg">{detalle}</span>
    </motion.button>
  )
}

function Esqueleto({ className, cuantos }: { className?: string; cuantos: number }) {
  return (
    <div className={className} role="status" aria-label="Cargando las cifras">
      {Array.from({ length: cuantos }, (_, i) => (
        <div key={i} className="rounded-md border border-borde bg-superficie px-4 py-4">
          <div className="h-3 w-20 animate-pulse rounded bg-tenue" />
          <div className="mt-3 h-8 w-14 animate-pulse rounded bg-tenue" />
          <div className="mt-2 h-3 w-24 animate-pulse rounded bg-tenue" />
        </div>
      ))}
    </div>
  )
}

function EstadoError({
  className,
  onReintentar,
}: {
  className?: string
  onReintentar?: () => void
}) {
  return (
    <div
      className={cn('rounded-md border border-borde bg-superficie px-6 py-10 text-center', className)}
    >
      <p className="font-display text-sm font-medium">No pudimos cargar las cifras</p>
      <p className="mx-auto mt-1 max-w-sm text-sm text-tenue-fg">
        Puede ser un corte momentáneo de conexión con el servidor.
      </p>
      {onReintentar && (
        <Boton variante="contorno" tamano="sm" onClick={onReintentar} className="mt-4">
          <RotateCw aria-hidden="true" />
          Reintentar
        </Boton>
      )}
    </div>
  )
}
