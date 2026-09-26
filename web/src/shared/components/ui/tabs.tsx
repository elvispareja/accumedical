import { motion, useReducedMotion } from 'framer-motion'
import { useId, type KeyboardEvent, type ReactNode } from 'react'

import { cn } from '@/lib/utils'

export interface Pestana {
  id: string
  etiqueta: string
}

/**
 * Pestañas accesibles: `tablist`/`tab`/`tabpanel` con navegación por flechas,
 * Inicio y Fin, tal como espera un lector de pantalla. El indicador se desliza
 * con `layoutId` para que el movimiento comunique la relación entre pestañas.
 */
export function Tabs({
  pestanas,
  activa,
  onCambiar,
  children,
  className,
}: {
  pestanas: Pestana[]
  activa: string
  onCambiar: (id: string) => void
  children: ReactNode
  className?: string
}) {
  const base = useId()
  const sinMovimiento = useReducedMotion()

  function alTeclado(evento: KeyboardEvent<HTMLDivElement>) {
    const indice = pestanas.findIndex((p) => p.id === activa)
    let siguiente = indice
    if (evento.key === 'ArrowRight') siguiente = (indice + 1) % pestanas.length
    else if (evento.key === 'ArrowLeft') siguiente = (indice - 1 + pestanas.length) % pestanas.length
    else if (evento.key === 'Home') siguiente = 0
    else if (evento.key === 'End') siguiente = pestanas.length - 1
    else return
    evento.preventDefault()
    const destino = pestanas[siguiente]
    if (destino) {
      onCambiar(destino.id)
      document.getElementById(`${base}-tab-${destino.id}`)?.focus()
    }
  }

  return (
    <div className={className}>
      <div
        role="tablist"
        aria-label="Secciones de la aseguradora"
        onKeyDown={alTeclado}
        className="flex gap-1 border-b border-borde"
      >
        {pestanas.map((p) => {
          const seleccionada = p.id === activa
          return (
            <button
              key={p.id}
              id={`${base}-tab-${p.id}`}
              role="tab"
              type="button"
              aria-selected={seleccionada}
              aria-controls={`${base}-panel-${p.id}`}
              tabIndex={seleccionada ? 0 : -1}
              onClick={() => onCambiar(p.id)}
              className={cn(
                'relative px-4 py-2.5 font-display text-sm font-medium transition-colors duration-150 ease-natural',
                seleccionada ? 'text-marca' : 'text-tenue-fg hover:text-tinta',
              )}
            >
              {p.etiqueta}
              {seleccionada && (
                // Subrayado propio de cada pestaña, sin `layoutId`. La versión con
                // layout compartido se veía mejor, pero dejaba una animación
                // pendiente cuando el panel entero se desmontaba con esta pestaña
                // activa, y AnimatePresence no daba nunca por terminada la salida:
                // el drawer se quedaba abierto para siempre tras guardar.
                <motion.span
                  initial={sinMovimiento ? { opacity: 0 } : { opacity: 0, scaleX: 0.4 }}
                  animate={{ opacity: 1, scaleX: 1 }}
                  transition={{ duration: 0.18, ease: [0.22, 0.61, 0.36, 1] }}
                  className="absolute inset-x-2 -bottom-px h-0.5 origin-center rounded-full bg-marca"
                />
              )}
            </button>
          )
        })}
      </div>

      {pestanas.map((p) => (
        <div
          key={p.id}
          id={`${base}-panel-${p.id}`}
          role="tabpanel"
          aria-labelledby={`${base}-tab-${p.id}`}
          hidden={p.id !== activa}
          tabIndex={0}
          className="focus-visible:outline-none"
        >
          {p.id === activa && children}
        </div>
      ))}
    </div>
  )
}
