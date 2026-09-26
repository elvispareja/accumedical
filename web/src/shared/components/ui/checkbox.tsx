import { Check } from 'lucide-react'
import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

/**
 * Casilla accesible construida sobre un `input` nativo escondido: conserva el
 * comportamiento de teclado, el foco y el anuncio del lector de pantalla, y solo
 * se sustituye su apariencia. `peer` es lo que permite reaccionar al estado real
 * del input en lugar de duplicarlo en JavaScript.
 */
export function Checkbox({
  id,
  checked,
  onChange,
  disabled,
  titulo,
  descripcion,
  acento,
  compacto,
}: {
  id: string
  checked: boolean
  onChange: (marcado: boolean) => void
  disabled?: boolean
  titulo: ReactNode
  descripcion?: ReactNode
  /** Clase de color del módulo. Sin ella, la casilla usa el verde institucional. */
  acento?: string
  /**
   * Sin tarjeta: casilla y texto en línea. Para pares de opciones que cuelgan de
   * otra cosa —la red de un convenio dentro de su fila—, donde un recuadro más
   * alrededor de otro recuadro se lee como otro nivel que no existe.
   */
  compacto?: boolean
}) {
  return (
    <label
      htmlFor={id}
      className={cn(
        'flex cursor-pointer items-start transition-colors duration-150 ease-natural',
        compacto
          ? 'gap-2 rounded'
          : cn(
              'gap-3 rounded-md border p-4',
              checked
                ? 'border-marca/40 bg-marca-suave/50'
                : 'border-borde bg-superficie hover:bg-tenue/50',
            ),
        disabled && 'cursor-not-allowed opacity-60',
      )}
    >
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="peer sr-only"
      />
      <span
        aria-hidden="true"
        className={cn(
          'grid shrink-0 place-items-center rounded border transition-colors duration-150',
          compacto ? 'mt-[0.0625rem] size-4' : 'mt-0.5 size-[1.125rem]',
          'peer-focus-visible:ring-2 peer-focus-visible:ring-anillo peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-fondo',
          checked ? cn('border-transparent text-white', acento ?? 'bg-marca') : 'border-borde bg-superficie',
        )}
      >
        {checked && <Check className="size-3" strokeWidth={3} />}
      </span>
      <span className="min-w-0">
        <span
          className={cn(
            'block font-display font-medium',
            compacto ? 'text-[0.8125rem]' : 'text-sm',
          )}
        >
          {titulo}
        </span>
        {descripcion && <span className="mt-0.5 block text-xs text-tenue-fg">{descripcion}</span>}
      </span>
    </label>
  )
}
