import { Check, ChevronDown, Search } from 'lucide-react'
import {
  Children,
  Fragment,
  isValidElement,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react'
import { createPortal } from 'react-dom'

import { cn } from '@/lib/utils'

/**
 * Desplegable propio con buscador, en lugar del select nativo: las listas de
 * catálogo (24 provincias, 25 ciudades por provincia…) obligaban a dar scroll
 * y cansan. Conserva la API del select de siempre —`value`, `onChange` con
 * `e.target.value`, hijos `<option>` y `<optgroup>`— para que TODOS los
 * desplegables de la plataforma lo hereden sin tocar cada formulario.
 *
 * Teclado completo: Enter/Espacio/flechas abren, escribir filtra, flechas
 * recorren, Enter elige, Esc cierra y devuelve el foco. El buscador ignora
 * tildes y mayúsculas.
 */

interface Opcion {
  valor: string
  etiqueta: string
  deshabilitada: boolean
  grupo: string | null
}

/** El texto plano de un `<option>`: sus hijos pueden ser trozos y plantillas. */
function textoDe(children: ReactNode): string {
  const partes: string[] = []
  const recorrer = (nodo: ReactNode) => {
    if (nodo === null || nodo === undefined || typeof nodo === 'boolean') return
    if (typeof nodo === 'string' || typeof nodo === 'number') {
      partes.push(String(nodo))
      return
    }
    if (Array.isArray(nodo)) {
      nodo.forEach(recorrer)
      return
    }
    if (isValidElement(nodo)) recorrer((nodo.props as { children?: ReactNode }).children)
  }
  recorrer(children)
  return partes.join('').replace(/\s+/g, ' ').trim()
}

/** Aplana los hijos JSX —option, optgroup, fragmentos, arrays— a la lista real. */
function extraerOpciones(children: ReactNode, grupo: string | null = null): Opcion[] {
  const lista: Opcion[] = []
  Children.forEach(children, (hijo) => {
    if (!isValidElement(hijo)) return
    const props = hijo.props as {
      value?: unknown
      label?: string
      disabled?: boolean
      children?: ReactNode
    }
    if (hijo.type === 'option') {
      const etiqueta = textoDe(props.children)
      lista.push({
        valor: props.value === undefined ? etiqueta : String(props.value),
        etiqueta,
        deshabilitada: Boolean(props.disabled),
        grupo,
      })
    } else if (hijo.type === 'optgroup') {
      lista.push(...extraerOpciones(props.children, props.label ?? null))
    } else if (hijo.type === Fragment) {
      lista.push(...extraerOpciones(props.children, grupo))
    }
  })
  return lista
}

/** Sin tildes y en minúsculas: «Cañar» se encuentra tecleando «canar». */
function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase()
}

export function Select({
  className,
  children,
  value,
  onChange,
  disabled,
  id,
  'aria-label': ariaLabel,
  'aria-invalid': ariaInvalid,
}: SelectHTMLAttributes<HTMLSelectElement>) {
  const idBase = useId()
  const gatillo = useRef<HTMLButtonElement>(null)
  const cajaBusqueda = useRef<HTMLInputElement>(null)
  const contenedor = useRef<HTMLDivElement>(null)

  const [abierto, setAbierto] = useState(false)
  const [busqueda, setBusqueda] = useState('')
  const [resaltada, setResaltada] = useState(0)
  // La lista vive en un portal con posición fija: dentro de una tabla con
  // overflow, un `absolute` quedaría recortado por el contenedor.
  const [posicion, setPosicion] = useState<{
    izquierda: number
    ancho: number
    arriba: number | null
    abajo: number | null
  } | null>(null)
  const panel = useRef<HTMLDivElement>(null)

  const opciones = useMemo(() => extraerOpciones(children), [children])
  const valorActual = String(value ?? '')
  const elegida = opciones.find((o) => o.valor === valorActual)

  const visibles = useMemo(() => {
    const termino = normalizar(busqueda.trim())
    if (!termino) return opciones
    return opciones.filter(
      (o) => normalizar(o.etiqueta).includes(termino) || (o.grupo && normalizar(o.grupo).includes(termino)),
    )
  }, [opciones, busqueda])

  function abrir() {
    if (disabled) return
    const caja = gatillo.current?.getBoundingClientRect()
    if (!caja) return
    // Al menos 15rem de ancho —un gatillo estrecho no achica los nombres— y
    // sin salirse del borde derecho. Si abajo no cabe, se despliega hacia arriba.
    const ancho = Math.max(caja.width, 240)
    const izquierda = Math.min(caja.left, window.innerWidth - ancho - 8)
    const haciaArriba = window.innerHeight - caja.bottom < 340 && caja.top > 340
    setPosicion({
      izquierda: Math.max(8, izquierda),
      ancho,
      arriba: haciaArriba ? null : caja.bottom + 4,
      abajo: haciaArriba ? window.innerHeight - caja.top + 4 : null,
    })
    setBusqueda('')
    const indice = opciones.findIndex((o) => o.valor === valorActual && !o.deshabilitada)
    setResaltada(indice >= 0 ? indice : opciones.findIndex((o) => !o.deshabilitada))
    setAbierto(true)
  }

  function cerrar(devolverFoco = true) {
    setAbierto(false)
    if (devolverFoco) gatillo.current?.focus()
  }

  function elegir(opcion: Opcion) {
    if (opcion.deshabilitada) return
    cerrar()
    // La forma mínima que los formularios ya leen: `e.target.value`.
    onChange?.({ target: { value: opcion.valor } } as unknown as ChangeEvent<HTMLSelectElement>)
  }

  // El buscador toma el foco al abrir; clic fuera cierra sin robar el foco. Y
  // como la lista está anclada a la ventana, un scroll o un cambio de tamaño
  // la cierran en vez de dejarla flotando donde ya no está el campo.
  useEffect(() => {
    if (!abierto) return
    cajaBusqueda.current?.focus()
    const fuera = (e: MouseEvent) => {
      const donde = e.target as Node
      if (!contenedor.current?.contains(donde) && !panel.current?.contains(donde)) {
        setAbierto(false)
      }
    }
    const cerrarPorMovimiento = (e: Event) => {
      if (!panel.current?.contains(e.target as Node)) setAbierto(false)
    }
    document.addEventListener('mousedown', fuera)
    window.addEventListener('scroll', cerrarPorMovimiento, true)
    window.addEventListener('resize', cerrarPorMovimiento)
    return () => {
      document.removeEventListener('mousedown', fuera)
      window.removeEventListener('scroll', cerrarPorMovimiento, true)
      window.removeEventListener('resize', cerrarPorMovimiento)
    }
  }, [abierto])

  // La opción resaltada se mantiene a la vista mientras se recorre con flechas.
  useEffect(() => {
    if (!abierto) return
    document
      .getElementById(`${idBase}-op-${resaltada}`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [abierto, resaltada, idBase])

  function mover(paso: number) {
    if (visibles.length === 0) return
    let indice = visibles.findIndex((o) => o === opciones[resaltada])
    if (indice < 0) indice = paso > 0 ? -1 : 0
    for (let i = 0; i < visibles.length; i++) {
      indice = (indice + paso + visibles.length) % visibles.length
      const candidata = visibles[indice]!
      if (!candidata.deshabilitada) {
        setResaltada(opciones.indexOf(candidata))
        return
      }
    }
  }

  function tecladoLista(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      mover(1)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      mover(-1)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const opcion = opciones[resaltada]
      if (opcion && visibles.includes(opcion)) elegir(opcion)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      cerrar()
    } else if (e.key === 'Tab') {
      e.preventDefault()
      cerrar()
    }
  }

  // El grupo se pinta como cabecera la primera vez que aparece en lo visible.
  let grupoPintado: string | null = null

  return (
    <div ref={contenedor} className={cn('relative', className)}>
      <button
        ref={gatillo}
        type="button"
        id={id}
        role="combobox"
        aria-expanded={abierto}
        aria-haspopup="listbox"
        aria-controls={`${idBase}-lista`}
        aria-label={ariaLabel}
        aria-invalid={ariaInvalid}
        disabled={disabled}
        onClick={() => (abierto ? cerrar() : abrir())}
        onKeyDown={(e) => {
          if (!abierto && (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === ' ')) {
            e.preventDefault()
            abrir()
          }
        }}
        className={cn(
          'flex h-11 w-full items-center gap-2 rounded border border-borde bg-superficie pl-3 pr-3',
          'text-left text-[0.9375rem] text-tinta',
          'transition-[border-color,box-shadow] duration-150 ease-natural',
          'hover:border-borde/80',
          'focus-visible:border-marca focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-anillo/35',
          'disabled:cursor-not-allowed disabled:opacity-60',
          'aria-[invalid=true]:border-peligro',
          className,
        )}
      >
        <span className="min-w-0 flex-1 truncate">{elegida?.etiqueta ?? ''}</span>
        <ChevronDown className="size-4 shrink-0 text-tenue-fg" aria-hidden="true" />
      </button>

      {abierto &&
        posicion &&
        createPortal(
        <div
          ref={panel}
          style={{
            left: posicion.izquierda,
            width: posicion.ancho,
            top: posicion.arriba ?? undefined,
            bottom: posicion.abajo ?? undefined,
          }}
          className="fixed z-[70] overflow-hidden rounded-md border border-borde bg-superficie shadow-lg"
        >
          <div className="relative border-b border-borde">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-tenue-fg"
              aria-hidden="true"
            />
            <input
              ref={cajaBusqueda}
              value={busqueda}
              onChange={(e) => {
                setBusqueda(e.target.value)
                // Al filtrar, la resaltada cae a la primera coincidencia útil.
                const termino = normalizar(e.target.value.trim())
                const primera = opciones.find(
                  (o) =>
                    !o.deshabilitada &&
                    (!termino ||
                      normalizar(o.etiqueta).includes(termino) ||
                      (o.grupo && normalizar(o.grupo).includes(termino))),
                )
                if (primera) setResaltada(opciones.indexOf(primera))
              }}
              onKeyDown={tecladoLista}
              placeholder="Buscar…"
              aria-label="Buscar en la lista"
              aria-controls={`${idBase}-lista`}
              aria-activedescendant={`${idBase}-op-${resaltada}`}
              role="combobox"
              aria-expanded="true"
              autoComplete="off"
              spellCheck={false}
              className="h-9 w-full bg-transparent pl-9 pr-3 text-sm text-tinta placeholder:text-tenue-fg/70 focus:outline-none"
            />
          </div>

          <ul
            id={`${idBase}-lista`}
            role="listbox"
            aria-label={ariaLabel}
            className="max-h-64 overflow-y-auto py-1"
          >
            {visibles.length === 0 && (
              <li className="px-3 py-3 text-sm text-tenue-fg" role="presentation">
                Nada coincide con la búsqueda.
              </li>
            )}
            {visibles.map((opcion) => {
              const cabecera = opcion.grupo !== grupoPintado ? opcion.grupo : null
              grupoPintado = opcion.grupo
              const indice = opciones.indexOf(opcion)
              return (
                <Fragment key={`${opcion.valor}|${indice}`}>
                  {cabecera && (
                    <li
                      role="presentation"
                      className="px-3 pb-1 pt-2 font-display text-[0.6875rem] font-semibold uppercase tracking-[0.09em] text-tenue-fg"
                    >
                      {cabecera}
                    </li>
                  )}
                  <li
                    id={`${idBase}-op-${indice}`}
                    role="option"
                    aria-selected={opcion.valor === valorActual}
                    aria-disabled={opcion.deshabilitada || undefined}
                    onMouseEnter={() => !opcion.deshabilitada && setResaltada(indice)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => elegir(opcion)}
                    className={cn(
                      'flex cursor-pointer items-center gap-2 px-3 py-2 text-sm',
                      indice === resaltada && 'bg-tenue',
                      opcion.deshabilitada && 'cursor-not-allowed opacity-50',
                      opcion.grupo && 'pl-5',
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate">{opcion.etiqueta || '—'}</span>
                    {opcion.valor === valorActual && (
                      <Check className="size-4 shrink-0 text-marca" aria-hidden="true" />
                    )}
                  </li>
                </Fragment>
              )
            })}
          </ul>
        </div>,
        document.body,
      )}
    </div>
  )
}
