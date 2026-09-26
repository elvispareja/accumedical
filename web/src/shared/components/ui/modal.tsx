import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { X } from 'lucide-react'
import { useEffect, useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

import { cn } from '@/lib/utils'
import { Boton } from '@/shared/components/ui/button'

const EASE: [number, number, number, number] = [0.22, 0.61, 0.36, 1]
const FOCALIZABLES =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * Diálogo modal con foco atrapado y cierre con Esc, como exige el sistema de
 * diseño. Se monta en un portal sobre `document.body` para que ningún
 * `overflow: hidden` de un contenedor lo recorte.
 *
 * Sin `layoutId` de Framer Motion a propósito: una animación de layout pendiente
 * deja la salida de `AnimatePresence` sin terminar y el diálogo no se cierra
 * nunca. Ya pasó una vez con el panel lateral.
 */
export function Modal({
  abierto,
  onCerrar,
  titulo,
  descripcion,
  children,
  pie,
  ancho = 'max-w-lg',
}: {
  abierto: boolean
  onCerrar: () => void
  titulo: string
  descripcion?: string
  children: ReactNode
  pie?: ReactNode
  ancho?: string
}) {
  const id = useId()
  const caja = useRef<HTMLDivElement>(null)
  const devolverFocoA = useRef<HTMLElement | null>(null)
  const sinMovimiento = useReducedMotion()

  useEffect(() => {
    if (!abierto) return

    devolverFocoA.current = document.activeElement as HTMLElement | null
    // Con el diálogo abierto, la página de detrás no se desplaza.
    const desbordeAnterior = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    // El foco entra al diálogo, no se queda en el botón que lo abrió.
    const entrar = window.setTimeout(() => {
      const primero = caja.current?.querySelector<HTMLElement>(FOCALIZABLES)
      ;(primero ?? caja.current)?.focus()
    }, 0)

    function alPulsar(evento: KeyboardEvent) {
      if (evento.key === 'Escape') {
        evento.stopPropagation()
        return onCerrar()
      }
      if (evento.key !== 'Tab' || !caja.current) return

      // Trampa de foco: el tabulador circula dentro del diálogo.
      const focalizables = Array.from(caja.current.querySelectorAll<HTMLElement>(FOCALIZABLES))
      if (focalizables.length === 0) return
      const primero = focalizables[0]!
      const ultimo = focalizables[focalizables.length - 1]!
      const activo = document.activeElement

      if (evento.shiftKey && (activo === primero || !caja.current.contains(activo))) {
        evento.preventDefault()
        ultimo.focus()
      } else if (!evento.shiftKey && activo === ultimo) {
        evento.preventDefault()
        primero.focus()
      }
    }

    document.addEventListener('keydown', alPulsar, true)
    return () => {
      window.clearTimeout(entrar)
      document.removeEventListener('keydown', alPulsar, true)
      document.body.style.overflow = desbordeAnterior
      devolverFocoA.current?.focus()
    }
  }, [abierto, onCerrar])

  return createPortal(
    <AnimatePresence>
      {abierto && (
        <div className="fixed inset-0 z-50 grid place-items-center p-4">
          <motion.div
            className="absolute inset-0 bg-tinta/40 backdrop-blur-[2px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18, ease: EASE }}
            onClick={onCerrar}
            aria-hidden="true"
          />
          <motion.div
            ref={caja}
            role="dialog"
            aria-modal="true"
            aria-labelledby={`${id}-titulo`}
            aria-describedby={descripcion ? `${id}-desc` : undefined}
            tabIndex={-1}
            initial={sinMovimiento ? { opacity: 0 } : { opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={sinMovimiento ? { opacity: 0 } : { opacity: 0, y: 8, scale: 0.99 }}
            transition={{ duration: 0.22, ease: EASE }}
            className={cn(
              'relative flex max-h-[85vh] w-full flex-col overflow-hidden rounded-md',
              'border border-borde bg-superficie shadow-elevada outline-none',
              ancho,
            )}
          >
            <header className="flex items-start justify-between gap-4 border-b border-borde px-5 py-4">
              <div className="min-w-0">
                <h2 id={`${id}-titulo`} className="font-display text-base font-semibold">
                  {titulo}
                </h2>
                {descripcion && (
                  <p id={`${id}-desc`} className="mt-0.5 text-sm text-tenue-fg">
                    {descripcion}
                  </p>
                )}
              </div>
              <Boton
                type="button"
                variante="fantasma"
                tamano="icono"
                onClick={onCerrar}
                aria-label="Cerrar"
              >
                <X aria-hidden="true" />
              </Boton>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>

            {pie && (
              <footer className="flex flex-wrap justify-end gap-2 border-t border-borde px-5 py-4">
                {pie}
              </footer>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  )
}
