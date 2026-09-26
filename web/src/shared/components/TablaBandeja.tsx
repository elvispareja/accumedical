import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { ChevronLeft, ChevronRight, Inbox, RotateCw, SearchX } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import type { ReactNode } from 'react'

import { Boton } from '@/shared/components/ui/button'

const EASE: [number, number, number, number] = [0.22, 0.61, 0.36, 1]

/**
 * Un caso en la bandeja de entrada, en la forma MÍNIMA que comparten todos los
 * módulos: código, de qué compañía llegó, a qué prestador, cuándo y en qué
 * estado. Nada más.
 *
 * Cada auditoría tiene su propio expediente —una visita no se parece a un
 * reembolso—, así que lo específico no entra aquí: entra en la página del caso,
 * a la que lleva `url`. Lo que sí varía en forma pero no en sitio —la ventana
 * horaria, la insignia de estado, cómo se nombra el destino— viaja ya pintado
 * por su módulo, que es quien sabe sus colores y sus etiquetas.
 */
export interface CasoDeBandeja {
  id: string
  codigo: string
  aseguradora: string
  prestador: ReactNode
  cuando: ReactNode
  estado: ReactNode
  /** A dónde lleva pulsar la fila: la página del caso, en su módulo. */
  url: string
  /**
   * La fila abre un ARCHIVO, no una pantalla: el PDF del informe. Se abre en
   * otra pestaña y no por el router, que dentro de la app buscaría una ruta que
   * no existe. La etiqueta también lo dice, para quien no ve el cursor.
   */
  descarga?: boolean
}

/**
 * La tabla de la bandeja de entrada: la misma para las ocho auditorías.
 *
 * Vive en `shared/` y no sabe de ningún módulo: recibe filas ya normalizadas.
 * Así, añadir una auditoría a la bandeja no toca esta tabla ni las secciones de
 * las demás.
 */
export function TablaBandeja({
  casos,
  cargando = false,
  error = false,
  onReintentar,
  pagina = 1,
  totalPaginas = 1,
  onPagina,
  total,
  filtrada = false,
}: {
  casos: CasoDeBandeja[]
  cargando?: boolean
  error?: boolean
  onReintentar?: () => void
  pagina?: number
  totalPaginas?: number
  onPagina?: (pagina: number) => void
  total?: number
  /** Si hay filtros puestos: cambia lo que dice el vacío, que no es lo mismo. */
  filtrada?: boolean
}) {
  const navegar = useNavigate()

  /**
   * Pulsar una fila: la página del caso por el router, o el archivo en otra
   * pestaña. Un PDF servido por la API no es una ruta de la aplicación, así que
   * navegar a él con el router acabaría en «página no encontrada».
   */
  function abrir(caso: CasoDeBandeja) {
    if (caso.descarga) window.open(caso.url, '_blank', 'noopener')
    else navegar(caso.url)
  }
  const sinMovimiento = useReducedMotion()

  if (cargando) {
    return (
      <div className="space-y-2" role="status" aria-label="Cargando casos">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="h-14 animate-pulse rounded-md bg-tenue" />
        ))}
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-md border border-borde bg-superficie px-6 py-10 text-center">
        <p className="font-display text-sm font-medium">No pudimos cargar estos casos.</p>
        {onReintentar && (
          <Boton variante="contorno" tamano="sm" className="mt-4" onClick={onReintentar}>
            <RotateCw aria-hidden="true" />
            Reintentar
          </Boton>
        )}
      </div>
    )
  }

  if (casos.length === 0) {
    return (
      <div className="rounded-md border border-borde bg-superficie px-6 py-12 text-center">
        {filtrada ? (
          <SearchX className="mx-auto size-5 text-tenue-fg" aria-hidden="true" />
        ) : (
          <Inbox className="mx-auto size-5 text-tenue-fg" aria-hidden="true" />
        )}
        <p className="mt-2 text-sm text-tenue-fg">
          {filtrada ? 'Ningún caso coincide con el filtro.' : 'Sin casos por ahora.'}
        </p>
      </div>
    )
  }

  return (
    <>
      <div className="overflow-x-auto rounded-md border border-borde bg-superficie">
        <table className="w-full min-w-[46rem] text-sm">
          <thead>
            <tr className="border-b border-borde bg-tenue/40 text-left">
              <Th>Código</Th>
              <Th>Aseguradora</Th>
              <Th>Prestador</Th>
              <Th>Cuándo</Th>
              <Th>Estado</Th>
            </tr>
          </thead>
          <tbody>
            <AnimatePresence initial={false}>
              {casos.map((caso, indice) => (
                <motion.tr
                  key={caso.id}
                  initial={sinMovimiento ? { opacity: 0 } : { opacity: 0, y: 6 }}
                  animate={{
                    opacity: 1,
                    y: 0,
                    transition: {
                      duration: 0.22,
                      delay: sinMovimiento ? 0 : Math.min(indice, 8) * 0.03,
                      ease: EASE,
                    },
                  }}
                  exit={{ opacity: 0, transition: { duration: 0.15 } }}
                  // La fila ENTERA abre el caso: en una bandeja de vistazo, el
                  // gesto es abrir, y obligar a apuntar a un icono sobra.
                  onClick={() => abrir(caso)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      abrir(caso)
                    }
                  }}
                  tabIndex={0}
                  role="link"
                  aria-label={
                    caso.descarga ? `Descargar el informe de ${caso.codigo}` : `Abrir ${caso.codigo}`
                  }
                  className={
                    'cursor-pointer border-b border-borde align-top last:border-b-0 ' +
                    'transition-colors duration-150 hover:bg-tenue/50 ' +
                    'focus-visible:bg-tenue/50 focus-visible:outline-none'
                  }
                >
                  <td className="px-4 py-3 font-mono text-xs text-tenue-fg">{caso.codigo}</td>
                  <td className="px-4 py-3">
                    <p className="max-w-[14rem] truncate font-medium">{caso.aseguradora}</p>
                  </td>
                  <td className="px-4 py-3 text-tenue-fg">{caso.prestador}</td>
                  <td className="px-4 py-3 text-tenue-fg">{caso.cuando}</td>
                  <td className="px-4 py-3">{caso.estado}</td>
                </motion.tr>
              ))}
            </AnimatePresence>
          </tbody>
        </table>
      </div>

      {totalPaginas > 1 && onPagina && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-tenue-fg">
            {total} {total === 1 ? 'caso' : 'casos'} · página {pagina} de {totalPaginas}
          </p>
          <div className="flex gap-2">
            <Boton
              variante="contorno"
              tamano="sm"
              onClick={() => onPagina(Math.max(1, pagina - 1))}
              disabled={pagina <= 1}
            >
              <ChevronLeft aria-hidden="true" />
              Anterior
            </Boton>
            <Boton
              variante="contorno"
              tamano="sm"
              onClick={() => onPagina(pagina + 1)}
              disabled={pagina >= totalPaginas}
            >
              Siguiente
              <ChevronRight aria-hidden="true" />
            </Boton>
          </div>
        </div>
      )}
    </>
  )
}

function Th({ children }: { children: ReactNode }) {
  return (
    <th className="px-4 py-2.5 font-display text-[0.6875rem] font-semibold uppercase tracking-[0.09em] text-tenue-fg">
      {children}
    </th>
  )
}
