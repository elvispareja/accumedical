import { motion, useReducedMotion } from 'framer-motion'
import { ChevronRight, type LucideIcon } from 'lucide-react'
import { Link } from 'react-router-dom'

import { cn } from '@/lib/utils'

const EASE: [number, number, number, number] = [0.22, 0.61, 0.36, 1]

/**
 * El cuadro de una auditoría en la bandeja de entrada: su nombre, cuántos casos
 * tiene y su acento. **Pulsarlo lleva a la bandeja de esa auditoría**, que es
 * donde está todo lo suyo: sus filtros, sus acciones y su expediente.
 *
 * Es el mismo cuadro que las cifras del panel de la compañía —etiqueta pequeña,
 * número grande, chevron al pasar por encima—: la misma idea se pinta igual en
 * toda la plataforma, no se reinventa por pantalla.
 *
 * Es un **enlace**, no un botón: lleva a otro sitio, así que se abre en otra
 * pestaña con el botón central y el navegador lo trata como lo que es. Vive en
 * `shared/` y no sabe de ningún módulo: recibe nombre, icono, acento y destino
 * ya resueltos.
 *
 * La auditoría que todavía no tiene expediente sale igual, con `enConstruccion`:
 * en vez de un número —que sería un cero mentiroso— dice en qué está. Enseñarla
 * es lo honesto: su sitio ya existe y se sabe qué falta.
 */
export function CuadroAuditoria({
  indice,
  nombre,
  icono: Icono,
  acento,
  total,
  cargando = false,
  enConstruccion = false,
  a,
}: {
  indice: number
  nombre: string
  icono: LucideIcon
  /** Clases del acento del módulo. */
  acento: { suave: string; texto: string; borde: string }
  total?: number
  cargando?: boolean
  /** Sin expediente todavía: ni número ni «casos», sino en qué está. */
  enConstruccion?: boolean
  /** La bandeja de esa auditoría. */
  a: string
}) {
  const sinMovimiento = useReducedMotion()
  return (
    <motion.div
      initial={sinMovimiento ? { opacity: 0 } : { opacity: 0, y: 6 }}
      animate={{
        opacity: 1,
        y: 0,
        transition: { duration: 0.22, delay: sinMovimiento ? 0 : indice * 0.05, ease: EASE },
      }}
    >
      <Link
        to={a}
        aria-label={`Abrir ${nombre}`}
        className={cn(
          'group block rounded-md border bg-superficie px-4 py-4 transition-colors duration-150',
          'border-borde hover:border-tenue-fg/40 hover:bg-tenue/40',
          'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-marca',
        )}
      >
        <span className="flex items-center gap-2 font-display text-[0.6875rem] font-semibold uppercase tracking-[0.09em] text-tenue-fg">
          <span className={cn('grid size-5 shrink-0 place-items-center rounded', acento.suave)}>
            <Icono className={cn('size-3', acento.texto)} aria-hidden="true" />
          </span>
          <span className="min-w-0 truncate">{nombre}</span>
          <ChevronRight
            className="ml-auto size-3.5 shrink-0 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100"
            aria-hidden="true"
          />
        </span>
        <span
          className={cn(
            'tabular mt-2 block font-display font-semibold tracking-tight',
            enConstruccion ? 'text-3xl text-tenue-fg/50' : 'text-3xl',
          )}
        >
          {enConstruccion ? '—' : cargando ? '—' : (total ?? 0)}
        </span>
        <span className="mt-0.5 block text-xs text-tenue-fg">
          {enConstruccion ? 'en construcción' : total === 1 ? 'caso' : 'casos'}
        </span>
      </Link>
    </motion.div>
  )
}
