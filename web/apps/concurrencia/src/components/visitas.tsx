import { cn } from '@/lib/utils'
import type { EstadoVisita } from '@concurrencia/api'

// Piezas comunes de las dos bandejas —la de compañía y la de supervisión—:
// mismos estados, misma insignia y misma forma de pintar la ventana horaria.
// Se comparten, no se duplican por pantalla.

export const ESTADOS_VISITA: { valor: EstadoVisita; etiqueta: string; caja: string; punto: string }[] = [
  {
    valor: 'programada',
    etiqueta: 'Programada',
    caja: 'border-modulo-concurrencia/30 bg-modulo-concurrencia/10 text-modulo-concurrencia',
    punto: 'bg-modulo-concurrencia',
  },
  // La derivó el coordinador a un auditor; todavía no ha llegado.
  {
    valor: 'asignada',
    etiqueta: 'Asignada',
    caja: 'border-marca/30 bg-marca-suave text-marca',
    punto: 'bg-marca',
  },
  // El auditor marcó «Ya llegué»: está dentro del hospital.
  {
    valor: 'auditando',
    etiqueta: 'Auditando',
    caja: 'border-aviso/30 bg-aviso/10 text-aviso',
    punto: 'bg-aviso',
  },
  {
    valor: 'cancelada',
    etiqueta: 'Cancelada',
    caja: 'border-borde bg-tenue text-tenue-fg',
    punto: 'bg-tenue-fg/60',
  },
  {
    valor: 'culminada',
    etiqueta: 'Culminada',
    caja: 'border-exito/30 bg-exito/10 text-exito',
    punto: 'bg-exito',
  },
]

/**
 * Un caso CERRADO se lee, no se toca: culminado, el auditor ya mandó su informe;
 * cancelado, no hay visita que preparar. Espejo de `MOTIVOS_SIN_EDICION` en el
 * servicio, que es quien manda: esto solo evita ofrecer una puerta cerrada.
 */
export function sePuedeEditar(estado: string | undefined): boolean {
  return estado !== 'culminada' && estado !== 'cancelada'
}

/**
 * **Fuera del SLA** (pedido del usuario, 27/10/2026; reemplaza a «No
 * auditado»): el caso sigue abierto y ya pasó la entrega pactada con la
 * compañía. No es un estado —un caso asignado o auditando puede estarlo—, así
 * que va junto a la insignia de estado, no en su lugar. Solo para Accumedical.
 */
export function FueraDeSla() {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5',
        'border-peligro/30 bg-peligro/10 font-display text-[0.6875rem] font-medium text-peligro',
      )}
    >
      <span className="size-1.5 rounded-full bg-peligro" aria-hidden="true" />
      Fuera del SLA
    </span>
  )
}

export function EstadoVisitaBadge({ estado }: { estado: string }) {
  // Un estado desconocido se pinta neutro, como cancelada: sin color que mienta.
  const neutro = ESTADOS_VISITA.find((e) => e.valor === 'cancelada')!
  const aspecto = ESTADOS_VISITA.find((e) => e.valor === estado) ?? neutro
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5',
        'font-display text-[0.6875rem] font-medium',
        aspecto.caja,
      )}
    >
      <span className={cn('size-1.5 rounded-full', aspecto.punto)} aria-hidden="true" />
      {aspecto.etiqueta}
    </span>
  )
}

/**
 * «12 mar 2026, 09:00 → 13:30» y, si cruza días, con la fecha de fin.
 * `porFijar`: el caso aún no tiene hora —la pone la coordinación al derivar—,
 * así que lo guardado es provisional y no se enseña como si fuera la cita.
 */
export function Ventana({
  desde,
  hasta,
  porFijar = false,
}: {
  desde: string
  hasta: string
  porFijar?: boolean
}) {
  if (porFijar) return <span className="block text-xs italic">Hora por fijar</span>
  const inicio = new Date(desde)
  const fin = new Date(hasta)
  const mismoDia = inicio.toDateString() === fin.toDateString()
  const fecha = new Intl.DateTimeFormat('es-EC', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
  const hora = new Intl.DateTimeFormat('es-EC', { hour: '2-digit', minute: '2-digit' })

  return (
    <span className="block">
      <span className="block">{fecha.format(inicio)}</span>
      <span className="tabular block text-xs text-tenue-fg">
        {hora.format(inicio)} – {mismoDia ? hora.format(fin) : `${fecha.format(fin)} ${hora.format(fin)}`}
      </span>
    </span>
  )
}
