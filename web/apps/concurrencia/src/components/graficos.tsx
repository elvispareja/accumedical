import type { LucideIcon } from 'lucide-react'
import { useRef, useState, type ReactNode } from 'react'

import { cn } from '@/lib/utils'

/**
 * **Gráficos de la Reportería** (27/10/2026), hechos a mano sin librería:
 * dona/torta y columnas (simples o apiladas). Pedido del usuario: «no quiero
 * tanta tabla; hazlos con charts, círculos, tortas, escaleras, colores».
 *
 * Reglas de la guía de visualización que se cumplen aquí:
 * - 2 px de superficie entre segmentos y columnas (el hueco separa, no un borde);
 * - columnas de máx. 28 px, extremo superior redondeado, base recta;
 * - leyenda SIEMPRE con nombre (e icono si lo hay) y el valor: el color nunca
 *   va solo;
 * - globo al pasar el ratón Y al enfocar con el teclado: el valor primero.
 */
export interface SerieGrafico {
  clave: string
  etiqueta: string
  /** Relleno para HTML (leyenda, columnas), ya con su paso oscuro. */
  fondo: string
  /** Relleno para SVG (dona), los mismos colores. */
  relleno: string
  icono?: LucideIcon
}

interface EstadoGlobo {
  x: number
  y: number
  valor: string
  nombre: string
}

/** El globo compartido: posición relativa a su contenedor. */
function useGlobo() {
  const marco = useRef<HTMLDivElement>(null)
  const [globo, setGlobo] = useState<EstadoGlobo | null>(null)
  function mostrar(evento: { clientX?: number; clientY?: number; currentTarget: Element }, valor: string, nombre: string) {
    const caja = marco.current?.getBoundingClientRect()
    if (!caja) return
    const r = evento.currentTarget.getBoundingClientRect()
    // Con ratón, junto al puntero; con teclado, sobre el centro de la marca.
    const x = (evento.clientX ?? r.left + r.width / 2) - caja.left
    const y = (evento.clientY ?? r.top) - caja.top
    setGlobo({ x, y, valor, nombre })
  }
  const nodo = globo && (
    <div
      role="tooltip"
      className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-[calc(100%+10px)] whitespace-nowrap rounded-md border border-borde bg-superficie px-2.5 py-1.5 shadow-md"
      style={{ left: globo.x, top: globo.y }}
    >
      <p className="text-sm font-semibold tabular-nums">{globo.valor}</p>
      <p className="text-xs text-tenue-fg">{globo.nombre}</p>
    </div>
  )
  return { marco, mostrar, ocultar: () => setGlobo(null), nodo }
}

const pct = (n: number, total: number) => (total ? Math.round((100 * n) / total) : 0)

export function Leyenda({
  series,
  valores,
  className,
}: {
  series: SerieGrafico[]
  /** Con valores, cada fila los dice: el número no depende del globo. */
  valores?: Record<string, number>
  className?: string
}) {
  const total = valores ? series.reduce((s, x) => s + (valores[x.clave] ?? 0), 0) : 0
  return (
    <ul className={cn('flex flex-wrap gap-x-5 gap-y-2', className)} aria-label="Leyenda">
      {series.map((s) => {
        const Icono = s.icono
        const v = valores?.[s.clave]
        return (
          <li key={s.clave} className="flex items-center gap-1.5 text-sm">
            <span className={cn('size-3 shrink-0 rounded-sm', s.fondo)} aria-hidden="true" />
            {Icono && <Icono className="size-3.5 text-tenue-fg" aria-hidden="true" />}
            <span className="text-tenue-fg">{s.etiqueta}</span>
            {v !== undefined && (
              <span className="font-semibold tabular-nums">
                {v}
                <span className="ml-1 font-normal text-tenue-fg">({pct(v, total)} %)</span>
              </span>
            )}
          </li>
        )
      })}
    </ul>
  )
}

// ───────────────────────────── Dona / torta ─────────────────────────────

function punto(cx: number, cy: number, r: number, angulo: number) {
  return [cx + r * Math.sin(angulo), cy - r * Math.cos(angulo)] as const
}

/** El sector entre dos ángulos (radianes, 0 arriba, en sentido del reloj). */
function sector(cx: number, cy: number, rExt: number, rInt: number, a0: number, a1: number) {
  const grande = a1 - a0 > Math.PI ? 1 : 0
  const [x0, y0] = punto(cx, cy, rExt, a0)
  const [x1, y1] = punto(cx, cy, rExt, a1)
  if (rInt <= 0) {
    return `M ${cx} ${cy} L ${x0} ${y0} A ${rExt} ${rExt} 0 ${grande} 1 ${x1} ${y1} Z`
  }
  const [x2, y2] = punto(cx, cy, rInt, a1)
  const [x3, y3] = punto(cx, cy, rInt, a0)
  return `M ${x0} ${y0} A ${rExt} ${rExt} 0 ${grande} 1 ${x1} ${y1} L ${x2} ${y2} A ${rInt} ${rInt} 0 ${grande} 0 ${x3} ${y3} Z`
}

/** El círculo entero (torta) o el anillo entero (dona), para un único segmento. */
function anillo(c: number, rExt: number, rInt: number) {
  const circulo = (r: number) =>
    `M ${c - r} ${c} a ${r} ${r} 0 1 0 ${2 * r} 0 a ${r} ${r} 0 1 0 ${-2 * r} 0 Z`
  return rInt > 0 ? `${circulo(rExt)} ${circulo(rInt)}` : circulo(rExt)
}

export function Dona({
  series,
  valores,
  centro,
  torta = false,
  etiqueta,
  tamano = 200,
  leyendaAbajo = false,
}: {
  series: SerieGrafico[]
  valores: Record<string, number>
  /** Lo que va en el agujero de la dona (la cifra que manda). */
  centro?: { valor: string; detalle: string }
  /** Torta: sin agujero. */
  torta?: boolean
  etiqueta: string
  tamano?: number
  /** En tarjetas angostas (un tercio de fila), la leyenda va bajo el círculo. */
  leyendaAbajo?: boolean
}) {
  const { marco, mostrar, ocultar, nodo } = useGlobo()
  const total = series.reduce((s, x) => s + (valores[x.clave] ?? 0), 0)
  const c = tamano / 2
  const rExt = c - 2
  const rInt = torta ? 0 : rExt * 0.64
  let angulo = 0

  return (
    <div
      className={cn(
        'flex flex-col items-center gap-5',
        !leyendaAbajo && 'sm:flex-row sm:items-center sm:gap-8',
      )}
    >
      <div ref={marco} className="relative shrink-0" onPointerLeave={ocultar}>
        <svg
          width={tamano}
          height={tamano}
          viewBox={`0 0 ${tamano} ${tamano}`}
          role="img"
          aria-label={etiqueta}
        >
          {total === 0 ? (
            <circle cx={c} cy={c} r={rExt - (rExt - rInt) / 2} fill="none" strokeWidth={rExt - rInt || rExt} className="stroke-tenue" />
          ) : (
            series.map((s) => {
              const v = valores[s.clave] ?? 0
              if (v === 0) return null
              const a0 = angulo
              const a1 = angulo + (2 * Math.PI * v) / total
              angulo = a1
              const texto = `${v} · ${pct(v, total)} %`
              // Un solo segmento es el círculo (o el anillo) entero, sin costura:
              // un arco de 360° no se dibuja y dos mitades dejan ver el hueco.
              const entero = v === total
              const d = entero ? anillo(c, rExt, rInt) : sector(c, c, rExt, rInt, a0, a1)
              return (
                <path
                  key={s.clave}
                  d={d}
                  tabIndex={0}
                  role="img"
                  aria-label={`${s.etiqueta}: ${texto}`}
                  className={cn(
                    s.relleno,
                    'stroke-superficie outline-none transition-opacity duration-100 hover:opacity-85 focus-visible:opacity-85',
                  )}
                  strokeWidth={entero ? 0 : 2}
                  fillRule="evenodd"
                  strokeLinejoin="round"
                  onPointerMove={(e) => mostrar(e, texto, s.etiqueta)}
                  onFocus={(e) => mostrar(e, texto, s.etiqueta)}
                  onBlur={ocultar}
                />
              )
            })
          )}
        </svg>
        {!torta && centro && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
            <div>
              <p className="font-display text-3xl font-semibold">{centro.valor}</p>
              <p className="text-xs text-tenue-fg">{centro.detalle}</p>
            </div>
          </div>
        )}
        {nodo}
      </div>
      <Leyenda
        series={series}
        valores={valores}
        className={leyendaAbajo ? 'justify-center' : 'flex-col !gap-y-3'}
      />
    </div>
  )
}

// ───────────────────────────── Columnas ─────────────────────────────

export interface Columna {
  etiqueta: string
  valores: Record<string, number>
}

export function Columnas({
  series,
  columnas,
  etiqueta,
  maximo,
  formato = (n) => String(n),
  alto = 220,
  vacio = 'Sin datos en el periodo.',
}: {
  series: SerieGrafico[]
  columnas: Columna[]
  etiqueta: string
  /** Tope fijo del eje (p. ej. 100 para porcentajes); si no, el mayor redondeado. */
  maximo?: number
  formato?: (n: number) => string
  alto?: number
  vacio?: string
}) {
  const { marco, mostrar, ocultar, nodo } = useGlobo()
  const totales = columnas.map((col) =>
    series.reduce((s, x) => s + (col.valores[x.clave] ?? 0), 0),
  )
  const mayor = Math.max(0, ...totales)
  const tope = maximo ?? techo(mayor)
  const marcas = [0, 0.25, 0.5, 0.75, 1].map((f) => f * tope)

  if (columnas.length === 0 || mayor === 0) {
    return <p className="py-10 text-center text-sm text-tenue-fg">{vacio}</p>
  }

  return (
    <figure aria-label={etiqueta}>
      {/* Aire arriba para la marca superior del eje y la cifra de la columna más alta. */}
      <div ref={marco} className="relative pt-6" onPointerLeave={ocultar}>
        <div className="flex" style={{ height: alto }}>
          {/* Eje: marcas redondas, líneas finas y recesivas. */}
          <div className="relative w-12 shrink-0">
            {marcas.map((m) => (
              <span
                key={m}
                className="absolute right-2 translate-y-1/2 whitespace-nowrap text-[0.6875rem] tabular-nums text-tenue-fg"
                style={{ bottom: `${(m / tope) * 100}%` }}
              >
                {formato(Math.round(m))}
              </span>
            ))}
          </div>
          <div className="relative flex-1 border-b border-borde">
            {marcas.slice(1).map((m) => (
              <span
                key={m}
                className="absolute inset-x-0 border-t border-borde/60"
                style={{ bottom: `${(m / tope) * 100}%` }}
                aria-hidden="true"
              />
            ))}
            <div className="absolute inset-0 flex items-end justify-around gap-2 px-2">
              {columnas.map((col, i) => {
                const total = totales[i] ?? 0
                const presentes = series.filter((s) => (col.valores[s.clave] ?? 0) > 0)
                return (
                  <div key={col.etiqueta} className="relative flex h-full flex-1 items-end justify-center">
                    {/* El total, SOBRE la columna y fuera de su alto: la barra mide
                        exactamente su valor. */}
                    {total > 0 && (
                      <span
                        className="absolute left-1/2 -translate-x-1/2 whitespace-nowrap text-xs font-semibold tabular-nums"
                        style={{ bottom: `calc(${(total / tope) * 100}% + 4px)` }}
                        aria-hidden="true"
                      >
                        {formato(total)}
                      </span>
                    )}
                    <div
                      className="flex w-full max-w-[28px] flex-col-reverse gap-0.5 overflow-hidden rounded-t"
                      style={{ height: `${(total / tope) * 100}%` }}
                    >
                      {presentes.map((s) => {
                        const v = col.valores[s.clave] ?? 0
                        const texto = series.length > 1 ? `${formato(v)} de ${formato(total)}` : formato(v)
                        return (
                          <span
                            key={s.clave}
                            tabIndex={0}
                            role="img"
                            aria-label={`${col.etiqueta} · ${s.etiqueta}: ${texto}`}
                            className={cn(
                              'block w-full outline-none transition-opacity duration-100 hover:opacity-85 focus-visible:opacity-85',
                              s.fondo,
                            )}
                            style={{ flexGrow: v, flexBasis: 0 }}
                            onPointerMove={(e) => mostrar(e, texto, `${s.etiqueta} · ${col.etiqueta}`)}
                            onFocus={(e) => mostrar(e, texto, `${s.etiqueta} · ${col.etiqueta}`)}
                            onBlur={ocultar}
                          />
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
        {/* Las etiquetas de las columnas, bajo la base. */}
        <div className="ml-12 flex justify-around gap-2 px-2 pt-2">
          {columnas.map((col) => (
            <span key={col.etiqueta} className="flex-1 truncate text-center text-xs text-tenue-fg" title={col.etiqueta}>
              {col.etiqueta}
            </span>
          ))}
        </div>
        {nodo}
      </div>
      {series.length > 1 && <Leyenda series={series} className="mt-4" />}
    </figure>
  )
}

/** El tope del eje: el mayor valor subido a un número redondo (1, 2, 5 × 10ⁿ). */
function techo(n: number) {
  if (n <= 4) return 4
  const base = 10 ** Math.floor(Math.log10(n))
  for (const f of [1, 2, 2.5, 5, 10]) if (f * base >= n) return f * base
  return 10 * base
}

/** La tarjeta de cada gráfico. */
export function TarjetaGrafico({
  titulo,
  nota,
  className,
  children,
}: {
  titulo: string
  nota?: string
  className?: string
  children: ReactNode
}) {
  return (
    <div className={cn('rounded-md border border-borde bg-superficie p-5', className)}>
      <p className="font-display text-sm font-semibold">{titulo}</p>
      {nota && <p className="mt-0.5 text-xs text-tenue-fg">{nota}</p>}
      <div className="mt-5">{children}</div>
    </div>
  )
}
