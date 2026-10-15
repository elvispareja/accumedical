import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { MoreVertical, type LucideIcon } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { cn } from '@/lib/utils'

const EASE: [number, number, number, number] = [0.22, 0.61, 0.36, 1]
const ANCHO = 176
const ALTO_OPCION = 36

export interface OpcionDeMenu {
  etiqueta: string
  icono?: LucideIcon
  onSelect: () => void
  /** Se pinta en rojo: borrar, cancelar, revocar. */
  peligro?: boolean
}

/**
 * El menú de acciones de una fila: los tres puntos.
 *
 * Existe porque una fila acaba teniendo más de una acción —ver, editar, y lo
 * que venga— y alinear tres iconos sueltos en cada tabla se lee peor que un
 * solo punto de entrada. Vive en `shared/` y lo usan todas las tablas: no se
 * reinventa por pantalla.
 *
 * **Se pinta en un portal, con posición fija.** Dentro de una tabla el envoltorio
 * lleva `overflow-x-auto` y un desplegable absoluto quedaría cortado por ese
 * recorte —o le sacaría barras al contenedor—. Por lo mismo se cierra al
 * desplazar: la posición se calcula una vez, no se persigue.
 *
 * Teclado completo: abre con Enter o Espacio, las flechas recorren, `Esc`
 * cierra y devuelve el foco al botón, y pulsar fuera lo cierra.
 */
export function MenuAcciones({
  etiqueta,
  opciones,
  grande = false,
}: {
  /** Para quién es: «Acciones de CONC-0011». Lo lee quien no ve la pantalla. */
  etiqueta: string
  opciones: OpcionDeMenu[]
  /** Botón más grande y trazo más grueso: para tarjetas, donde es la única acción visible. */
  grande?: boolean
}) {
  const sinMovimiento = useReducedMotion()
  const boton = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const items = useRef<(HTMLButtonElement | null)[]>([])
  const [abierto, setAbierto] = useState(false)
  const [caja, setCaja] = useState({ top: 0, left: 0 })

  function colocar() {
    const r = boton.current?.getBoundingClientRect()
    if (!r) return
    const alto = opciones.length * ALTO_OPCION + 8
    // Hacia arriba si abajo no cabe: el menú de la última fila no puede quedar
    // medio fuera de la ventana.
    const top = r.bottom + alto > window.innerHeight - 8 ? r.top - alto - 4 : r.bottom + 4
    setCaja({ top, left: Math.max(8, r.right - ANCHO) })
  }

  useLayoutEffect(() => {
    if (abierto) colocar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abierto])

  useEffect(() => {
    if (!abierto) return
    items.current[0]?.focus()

    function fuera(evento: MouseEvent) {
      const destino = evento.target as Node
      if (!panel.current?.contains(destino) && !boton.current?.contains(destino)) {
        setAbierto(false)
      }
    }
    function tecla(evento: KeyboardEvent) {
      if (evento.key === 'Escape') {
        setAbierto(false)
        boton.current?.focus()
        return
      }
      if (evento.key !== 'ArrowDown' && evento.key !== 'ArrowUp') return
      evento.preventDefault()
      const vivos = items.current.filter(Boolean) as HTMLButtonElement[]
      const actual = vivos.indexOf(document.activeElement as HTMLButtonElement)
      const siguiente =
        evento.key === 'ArrowDown'
          ? (actual + 1) % vivos.length
          : (actual - 1 + vivos.length) % vivos.length
      vivos[siguiente]?.focus()
    }
    // La posición se calcula al abrir; si la página se mueve, se cierra.
    const cerrar = () => setAbierto(false)

    document.addEventListener('mousedown', fuera)
    document.addEventListener('keydown', tecla)
    window.addEventListener('scroll', cerrar, true)
    window.addEventListener('resize', cerrar)
    return () => {
      document.removeEventListener('mousedown', fuera)
      document.removeEventListener('keydown', tecla)
      window.removeEventListener('scroll', cerrar, true)
      window.removeEventListener('resize', cerrar)
    }
  }, [abierto])

  return (
    <>
      <button
        ref={boton}
        type="button"
        onClick={() => setAbierto((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={abierto}
        aria-label={etiqueta}
        title={etiqueta}
        className={cn(
          'grid place-items-center rounded text-tenue-fg',
          grande ? 'size-11' : 'size-9',
          'transition-colors duration-150 hover:bg-tenue hover:text-tinta',
          abierto && 'bg-tenue text-tinta',
        )}
      >
        <MoreVertical
          className={grande ? 'size-6' : 'size-4'}
          strokeWidth={grande ? 3 : 2}
          aria-hidden="true"
        />
      </button>

      {createPortal(
        <AnimatePresence>
          {abierto && (
            <motion.div
              ref={panel}
              role="menu"
              aria-label={etiqueta}
              initial={sinMovimiento ? { opacity: 0 } : { opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={sinMovimiento ? { opacity: 0 } : { opacity: 0, y: -4 }}
              transition={{ duration: 0.15, ease: EASE }}
              style={{ position: 'fixed', top: caja.top, left: caja.left, width: ANCHO }}
              className="z-50 rounded-md border border-borde bg-superficie p-1 shadow-elevada"
            >
              {opciones.map((opcion, indice) => (
                <button
                  key={opcion.etiqueta}
                  ref={(nodo) => {
                    items.current[indice] = nodo
                  }}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setAbierto(false)
                    opcion.onSelect()
                  }}
                  className={cn(
                    'flex w-full items-center gap-2.5 rounded px-2.5 py-2 text-left text-sm',
                    'transition-colors duration-150 focus-visible:outline-none',
                    opcion.peligro
                      ? 'text-peligro hover:bg-peligro-suave focus-visible:bg-peligro-suave'
                      : 'text-tinta hover:bg-tenue focus-visible:bg-tenue',
                  )}
                >
                  {opcion.icono && <opcion.icono className="size-4 shrink-0" aria-hidden="true" />}
                  {opcion.etiqueta}
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  )
}
