import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { ChevronDown, ChevronsLeft, Menu, X, type LucideIcon } from 'lucide-react'
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { NavLink, useLocation } from 'react-router-dom'

import { Marca } from '@/core/components/Marca'
import { useMenuLateral } from '@/core/layout/preferenciaMenu'
import { cn } from '@/lib/utils'
import { Boton } from '@/shared/components/ui/button'

const EASE: [number, number, number, number] = [0.22, 0.61, 0.36, 1]
const ID_MENU_LATERAL = 'menu-lateral'

/**
 * El armazón con menú lateral, UNO para toda la plataforma: lo usan igual el
 * área de administración y el módulo en el que trabaja un coordinador. Los
 * componentes se comparten, no se duplican: si el menú cambia, cambia para
 * todos.
 *
 * El contexto evita pasar `compacto` y «cierra el panel» por tres niveles de
 * props. Dentro del panel superpuesto del móvil vale `compacto = false`: ahí el
 * ancho no es un problema y contraerlo no ahorraría nada.
 */
const Contexto = createContext<{ compacto: boolean; alNavegar?: () => void }>({ compacto: false })

export function useContextoMenu() {
  return useContext(Contexto)
}

export interface EntradaLateral {
  a: string
  etiqueta: string
  icono: LucideIcon
}

export function EntradaMenu({
  a,
  etiqueta,
  icono: Icono,
  anidada = false,
  fin = false,
}: EntradaLateral & { anidada?: boolean; fin?: boolean }) {
  const { compacto, alNavegar } = useContextoMenu()
  return (
    <NavLink
      to={a}
      end={fin}
      onClick={alNavegar}
      // El `title` va SIEMPRE: contraído porque el icono es lo único que se ve,
      // y expandido porque un nombre largo —«Auditoría del Crédito
      // Hospitalario»— se corta con puntos suspensivos. El `aria-label` solo
      // hace falta contraído: expandido, el texto ya nombra el enlace.
      title={etiqueta}
      aria-label={compacto ? etiqueta : undefined}
      className={({ isActive }) =>
        cn(
          'group relative flex items-center gap-3 overflow-hidden whitespace-nowrap rounded py-2.5',
          'font-display text-sm font-medium transition-colors duration-150 ease-natural',
          compacto ? 'justify-center px-2' : 'px-3',
          anidada && !compacto && 'ml-4',
          isActive ? 'bg-marca-suave text-marca' : 'text-tenue-fg hover:bg-tenue hover:text-tinta',
        )
      }
    >
      {({ isActive }) => (
        <>
          <span
            className={cn(
              'absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-marca transition-opacity duration-150',
              isActive ? 'opacity-100' : 'opacity-0',
            )}
            aria-hidden="true"
          />
          <Icono className="size-4 shrink-0" aria-hidden="true" />
          {!compacto && <span className="truncate">{etiqueta}</span>}
        </>
      )}
    </NavLink>
  )
}

/**
 * Un grupo del menú con su submenú desplegable. Contraído no hay sitio para
 * desplegar nada, así que pulsarlo EXPANDE el menú y se abre: nada queda
 * inalcanzable por haberlo encogido. Y como el submenú no se ve, el grupo se
 * pinta activo por su cuenta cuando la página abierta está dentro.
 */
export function GrupoMenu({
  etiqueta,
  icono: Icono,
  dentro,
  children,
}: {
  etiqueta: string
  icono: LucideIcon
  /** Si la página abierta pertenece al grupo. */
  dentro: boolean
  children: ReactNode
}) {
  const { compacto } = useContextoMenu()
  const { alternar } = useMenuLateral()
  // Abierto si ya se está dentro; si no, recuerda lo que el usuario dejó.
  const [abierto, setAbierto] = useState(dentro)

  return (
    <>
      <button
        type="button"
        onClick={() => {
          if (compacto) {
            alternar()
            setAbierto(true)
            return
          }
          setAbierto((v) => !v)
        }}
        aria-expanded={compacto ? false : abierto}
        title={etiqueta}
        aria-label={compacto ? etiqueta : undefined}
        className={cn(
          'flex items-center gap-3 overflow-hidden whitespace-nowrap rounded py-2.5 text-left',
          'font-display text-sm font-medium transition-colors duration-150',
          'hover:bg-tenue hover:text-tinta',
          compacto ? 'justify-center px-2' : 'px-3',
          compacto && dentro ? 'bg-marca-suave text-marca' : 'text-tenue-fg',
        )}
      >
        <Icono className="size-4 shrink-0" aria-hidden="true" />
        {!compacto && (
          <>
            <span className="flex-1 truncate">{etiqueta}</span>
            <ChevronDown
              className={cn(
                'size-4 shrink-0 transition-transform duration-150',
                abierto && 'rotate-180',
              )}
              aria-hidden="true"
            />
          </>
        )}
      </button>
      {!compacto && abierto && children}
    </>
  )
}

/** Marca, navegación y —solo en escritorio— el botón que contrae a iconos. */
function PanelLateral({
  marca,
  nav,
  onAlternar,
}: {
  marca?: ReactNode
  nav: ReactNode
  /** Sin esto no se pinta el botón: es el caso del panel de móvil. */
  onAlternar?: () => void
}) {
  const { compacto } = useContextoMenu()
  return (
    <div className="flex h-full flex-col gap-6 px-3 py-5">
      <div className={cn('flex shrink-0', compacto ? 'justify-center' : 'px-2')}>
        {marca ?? <Marca className="text-marca" conTexto={!compacto} />}
      </div>
      {/* SOLO la navegación se desplaza: la marca se queda arriba y el botón de
          contraer abajo, siempre a la vista. `min-h-0` no es decorativo —sin él
          un hijo de flex no baja de su altura natural y, con un grupo abierto,
          la lista se sale del panel en vez de desplazarse—. */}
      <div className="barra-fina min-h-0 flex-1 overflow-y-auto">{nav}</div>

      {onAlternar && (
        <div className="shrink-0 border-t border-borde pt-3">
          <button
            type="button"
            onClick={onAlternar}
            aria-expanded={!compacto}
            aria-controls={ID_MENU_LATERAL}
            aria-label={compacto ? 'Expandir el menú' : 'Contraer el menú'}
            title={compacto ? 'Expandir el menú' : 'Contraer el menú'}
            className={cn(
              'flex w-full items-center gap-3 overflow-hidden whitespace-nowrap rounded py-2.5',
              'font-display text-sm font-medium text-tenue-fg',
              'transition-colors duration-150 hover:bg-tenue hover:text-tinta',
              compacto ? 'justify-center px-2' : 'px-3',
            )}
          >
            <ChevronsLeft
              className={cn(
                'size-4 shrink-0 transition-transform duration-200',
                compacto && 'rotate-180',
              )}
              aria-hidden="true"
            />
            {!compacto && 'Contraer'}
          </button>
        </div>
      )}
    </div>
  )
}

export function ArmazonLateral({
  nav,
  marca,
  topbarIzquierda,
  topbarDerecha,
  franja,
  children,
}: {
  /** La navegación. Lee `useContextoMenu()` para saber si va contraída. */
  nav: ReactNode
  /** La cabecera del panel. Por defecto, la marca de Accumedical. */
  marca?: ReactNode
  topbarIzquierda?: ReactNode
  topbarDerecha: ReactNode
  /** Clase de color para la franja de acento sobre la cabecera, si la hay. */
  franja?: string
  children: ReactNode
}) {
  const { compacto, alternar } = useMenuLateral()
  const sinMovimiento = useReducedMotion()
  const ubicacion = useLocation()
  const [menuAbierto, setMenuAbierto] = useState(false)

  // En móvil el menú es un panel superpuesto: al cambiar de ruta debe cerrarse
  // solo, o el usuario se queda mirando el menú en vez de la página que abrió.
  useEffect(() => setMenuAbierto(false), [ubicacion.pathname])

  return (
    // La primera columna se mide por el ancho del propio `aside`, que es lo que
    // se anima al contraer: con un ancho fijo en la rejilla habría que mantener
    // los dos números a la vez.
    <div className="min-h-dvh bg-fondo lg:grid lg:grid-cols-[auto_minmax(0,1fr)]">
      {/* Menú lateral fijo en escritorio */}
      <aside
        id={ID_MENU_LATERAL}
        className={cn(
          'sticky top-0 hidden h-dvh border-r border-borde bg-superficie lg:block',
          !sinMovimiento && 'transition-[width] duration-200 ease-natural',
          compacto ? 'w-[4.5rem]' : 'w-60',
        )}
      >
        <Contexto.Provider value={{ compacto }}>
          <PanelLateral marca={marca} nav={nav} onAlternar={alternar} />
        </Contexto.Provider>
      </aside>

      {/* Menú lateral como panel superpuesto en móvil */}
      <AnimatePresence>
        {menuAbierto && (
          <div className="fixed inset-0 z-50 flex lg:hidden">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2, ease: EASE }}
              onClick={() => setMenuAbierto(false)}
              className="absolute inset-0 bg-tinta/40"
              aria-hidden="true"
            />
            <motion.aside
              initial={sinMovimiento ? { opacity: 0 } : { x: '-100%' }}
              animate={sinMovimiento ? { opacity: 1 } : { x: 0 }}
              exit={sinMovimiento ? { opacity: 0 } : { x: '-100%' }}
              transition={{ duration: 0.26, ease: EASE }}
              className="relative w-64 border-r border-borde bg-superficie"
            >
              <button
                type="button"
                onClick={() => setMenuAbierto(false)}
                aria-label="Cerrar menú"
                className="absolute right-2 top-3 grid size-9 place-items-center rounded text-tenue-fg hover:bg-tenue hover:text-tinta"
              >
                <X className="size-4" aria-hidden="true" />
              </button>
              <Contexto.Provider
                value={{ compacto: false, alNavegar: () => setMenuAbierto(false) }}
              >
                <PanelLateral marca={marca} nav={nav} />
              </Contexto.Provider>
            </motion.aside>
          </div>
        )}
      </AnimatePresence>

      <div className="flex min-w-0 flex-col">
        {franja && <div className={cn('sticky top-0 z-30 h-1', franja)} aria-hidden="true" />}
        <header
          className={cn(
            'sticky z-30 flex h-16 items-center justify-between gap-3',
            'border-b border-borde bg-fondo/85 px-4 backdrop-blur sm:px-6',
            franja ? 'top-1' : 'top-0',
          )}
        >
          <div className="flex min-w-0 items-center gap-2">
            <Boton
              variante="fantasma"
              tamano="icono"
              className="lg:hidden"
              onClick={() => setMenuAbierto(true)}
              aria-label="Abrir menú"
            >
              <Menu aria-hidden="true" />
            </Boton>
            {topbarIzquierda ?? (
              <span className="lg:hidden">
                <Marca className="text-marca" conTexto={false} />
              </span>
            )}
          </div>

          <div className="flex items-center gap-1.5">{topbarDerecha}</div>
        </header>

        <main className="min-w-0 flex-1 px-4 py-8 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  )
}
