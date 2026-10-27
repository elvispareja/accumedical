import type { LucideIcon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { cn } from '@/lib/utils'

/**
 * **Barras apiladas al 100 %**, una fila por grupo (el total y cada
 * aseguradora): la parte de cada estado en el todo. Hecho a mano, sin librería
 * de gráficos, con las reglas de la guía de visualización:
 *
 * - barra de 24 px, extremos redondeados de 4 px y 2 px de superficie entre
 *   segmentos (el hueco separa, nunca un borde);
 * - leyenda SIEMPRE (con icono si la serie lo trae: el color nunca va solo);
 * - el número dentro del segmento solo si cabe; si no, lo dicen el globo y la
 *   tabla («Ver como tabla»);
 * - globo al pasar el ratón Y al enfocar con el teclado: el valor primero,
 *   luego el nombre.
 */
export interface Serie {
  clave: string
  etiqueta: string
  /** Clases de fondo del segmento, ya con su paso para el modo oscuro. */
  relleno: string
  /** Tinta del número dentro del segmento: blanca o casi negra según el relleno. */
  tinta: 'blanca' | 'negra'
  icono?: LucideIcon
}

export interface FilaApilada {
  etiqueta: string
  valores: Record<string, number>
  /** Lo que se lee a la derecha de la barra (p. ej. «66,7 %» o «5 casos»). */
  resumen: string
  destacada?: boolean
}

interface Globo {
  x: number
  y: number
  valor: string
  nombre: string
}

/** El ancho real de la barra, para saber si un número cabe en su segmento. */
function useAncho<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [ancho, setAncho] = useState(0)
  useEffect(() => {
    if (!ref.current) return
    const observador = new ResizeObserver(([e]) => setAncho(e?.contentRect.width ?? 0))
    observador.observe(ref.current)
    return () => observador.disconnect()
  }, [])
  return [ref, ancho] as const
}

export function BarrasApiladas({
  series,
  filas,
  etiquetaDelGrafico,
  className,
}: {
  series: Serie[]
  filas: FilaApilada[]
  etiquetaDelGrafico: string
  className?: string
}) {
  const [caja, anchoCaja] = useAncho<HTMLDivElement>()
  const [globo, setGlobo] = useState<Globo | null>(null)
  // La barra ocupa la caja menos la etiqueta (10rem) y el resumen (5rem).
  const anchoBarra = Math.max(0, anchoCaja - 15 * 16 - 24)

  function mostrar(evento: { currentTarget: HTMLElement }, valor: string, nombre: string) {
    const marco = caja.current?.getBoundingClientRect()
    const r = evento.currentTarget.getBoundingClientRect()
    if (!marco) return
    setGlobo({ x: r.left - marco.left + r.width / 2, y: r.top - marco.top, valor, nombre })
  }

  return (
    <figure className={cn('relative', className)} aria-label={etiquetaDelGrafico}>
      {/* La leyenda: rectángulo como el segmento, icono y nombre. */}
      <ul className="mb-4 flex flex-wrap gap-x-5 gap-y-2" aria-label="Leyenda">
        {series.map((s) => {
          const Icono = s.icono
          return (
            <li key={s.clave} className="flex items-center gap-1.5 text-xs text-tenue-fg">
              <span className={cn('h-2.5 w-3.5 rounded-sm', s.relleno)} aria-hidden="true" />
              {Icono && <Icono className="size-3.5" aria-hidden="true" />}
              {s.etiqueta}
            </li>
          )
        })}
      </ul>

      <div ref={caja} className="space-y-3" onPointerLeave={() => setGlobo(null)}>
        {filas.map((fila) => {
          const total = series.reduce((suma, s) => suma + (fila.valores[s.clave] ?? 0), 0)
          const presentes = series.filter((s) => (fila.valores[s.clave] ?? 0) > 0)
          return (
            <div key={fila.etiqueta} className="flex items-center gap-3">
              <span
                className={cn(
                  'w-40 shrink-0 truncate text-sm',
                  fila.destacada ? 'font-semibold' : 'text-tenue-fg',
                )}
                title={fila.etiqueta}
              >
                {fila.etiqueta}
              </span>
              {/* Sin fondo propio: el hueco de 2 px entre segmentos es la superficie. */}
              <div
                className={cn(
                  'flex h-6 min-w-0 flex-1 gap-0.5 overflow-hidden rounded',
                  total === 0 && 'bg-tenue/60',
                )}
              >
                {total === 0 ? (
                  <span className="flex items-center px-2 text-xs text-tenue-fg">Sin casos</span>
                ) : (
                  presentes.map((s) => {
                    const valor = fila.valores[s.clave] ?? 0
                    const parte = valor / total
                    const texto = String(valor)
                    // Cabe si el segmento deja aire a los dos lados del número.
                    const cabe = parte * anchoBarra >= texto.length * 8 + 14
                    const porcentaje = `${Math.round(parte * 100)} %`
                    return (
                      <span
                        key={s.clave}
                        tabIndex={0}
                        role="img"
                        aria-label={`${fila.etiqueta} · ${s.etiqueta}: ${valor} (${porcentaje})`}
                        style={{ width: `${parte * 100}%` }}
                        className={cn(
                          'flex h-full min-w-[3px] items-center justify-center text-xs font-semibold',
                          'outline-none transition-[filter] duration-100 hover:brightness-110',
                          'focus-visible:ring-2 focus-visible:ring-anillo focus-visible:ring-offset-1',
                          s.relleno,
                          s.tinta === 'blanca' ? 'text-white' : 'text-[#0b0b0b]',
                        )}
                        onPointerEnter={(e) => mostrar(e, `${valor} · ${porcentaje}`, s.etiqueta)}
                        onFocus={(e) => mostrar(e, `${valor} · ${porcentaje}`, s.etiqueta)}
                        onBlur={() => setGlobo(null)}
                      >
                        {cabe ? texto : null}
                      </span>
                    )
                  })
                )}
              </div>
              <span
                className={cn(
                  'w-20 shrink-0 text-right text-sm tabular-nums',
                  fila.destacada ? 'font-semibold' : 'text-tenue-fg',
                )}
              >
                {fila.resumen}
              </span>
            </div>
          )
        })}
      </div>

      {globo && (
        <div
          role="tooltip"
          className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-md border border-borde bg-superficie px-2.5 py-1.5 shadow-md"
          style={{ left: globo.x, top: globo.y + (caja.current?.offsetTop ?? 0) - 6 }}
        >
          <p className="text-sm font-semibold tabular-nums">{globo.valor}</p>
          <p className="text-xs text-tenue-fg">{globo.nombre}</p>
        </div>
      )}
    </figure>
  )
}
