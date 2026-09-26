import type { ReactNode } from 'react'
import { useRef } from 'react'

import { cn } from '@/lib/utils'

export interface Opcion<T extends string> {
  valor: T
  etiqueta: ReactNode
}

/**
 * Un grupo de opciones excluyentes, todas a la vista: **lo que en otro sitio
 * sería un desplegable de tres valores**.
 *
 * Se usa cuando las opciones son pocas y la elección cambia lo que se pide
 * debajo —cómo se pacta un concepto del convenio, por ejemplo—: con un
 * desplegable habría que abrirlo para saber qué hay, y aquí se lee de un
 * vistazo.
 *
 * Es un `radiogroup` de verdad, no botones sueltos: solo la opción marcada
 * entra en el tabulador, y dentro del grupo se navega con las flechas, que es
 * como se espera que funcione un grupo de opciones.
 */
export function GrupoDeOpciones<T extends string>({
  etiqueta,
  valor,
  opciones,
  onCambiar,
  disabled,
  className,
}: {
  /** Qué se está eligiendo. Lo lee el lector de pantalla al entrar al grupo. */
  etiqueta: string
  valor: T
  opciones: Opcion<T>[]
  onCambiar: (valor: T) => void
  disabled?: boolean
  className?: string
}) {
  const grupo = useRef<HTMLDivElement>(null)

  function alTeclado(evento: React.KeyboardEvent<HTMLDivElement>) {
    const avance = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[evento.key]
    if (!avance) return
    evento.preventDefault()
    const actual = opciones.findIndex((o) => o.valor === valor)
    const siguiente = opciones[(actual + avance + opciones.length) % opciones.length]
    if (!siguiente) return
    onCambiar(siguiente.valor)
    // El foco acompaña a la selección, como en cualquier grupo de opciones.
    grupo.current
      ?.querySelectorAll<HTMLButtonElement>('[role="radio"]')
      [opciones.indexOf(siguiente)]?.focus()
  }

  return (
    <div
      ref={grupo}
      role="radiogroup"
      aria-label={etiqueta}
      onKeyDown={alTeclado}
      className={cn('flex w-full gap-1 rounded-md bg-tenue p-1', className)}
    >
      {opciones.map((opcion) => {
        const marcada = opcion.valor === valor
        return (
          <button
            key={opcion.valor}
            type="button"
            role="radio"
            aria-checked={marcada}
            disabled={disabled}
            tabIndex={marcada ? 0 : -1}
            onClick={() => onCambiar(opcion.valor)}
            className={cn(
              'flex-1 rounded-[5px] px-3 py-1.5 text-sm font-medium transition-colors duration-150 ease-natural',
              'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-marca',
              marcada
                ? 'bg-superficie text-tinta shadow-sm'
                : 'text-tenue-fg hover:text-tinta',
              disabled && 'cursor-not-allowed opacity-60',
            )}
          >
            {opcion.etiqueta}
          </button>
        )
      })}
    </div>
  )
}
