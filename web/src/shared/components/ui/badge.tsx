import { cn } from '@/lib/utils'

/**
 * El estado se codifica en forma y color, no solo en color: el punto y el borde
 * lo hacen distinguible también para quien no percibe bien el contraste cromático.
 *
 * Las aseguradoras solo están activas o inactivas; los prestadores además pueden
 * estar suspendidos, así que la tabla contempla los tres.
 */
interface Aspecto {
  etiqueta: string
  caja: string
  punto: string
}

/** Cualquier estado que no se reconozca se pinta como inactivo, nunca en blanco. */
const INACTIVO: Aspecto = {
  etiqueta: 'Inactivo',
  caja: 'border-borde bg-tenue text-tenue-fg',
  punto: 'bg-tenue-fg/60',
}

const ESTADOS: Record<string, Aspecto> = {
  activo: {
    etiqueta: 'Activo',
    caja: 'border-exito/30 bg-exito/10 text-exito',
    punto: 'bg-exito',
  },
  suspendido: {
    etiqueta: 'Suspendido',
    caja: 'border-aviso/30 bg-aviso/10 text-aviso',
    punto: 'bg-aviso',
  },
  inactivo: INACTIVO,
}

export function EstadoBadge({ estado, className }: { estado: string; className?: string }) {
  const { etiqueta, caja, punto } = ESTADOS[estado] ?? INACTIVO
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5',
        'font-display text-[0.6875rem] font-medium',
        caja,
        className,
      )}
    >
      <span className={cn('size-1.5 rounded-full', punto)} aria-hidden="true" />
      {etiqueta}
    </span>
  )
}
