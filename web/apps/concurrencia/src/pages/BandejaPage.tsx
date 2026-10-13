import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import {
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  Eye,
  Inbox,
  Mail,
  MapPin,
  Pencil,
  Plus,
  RotateCw,
  Search,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'

import { cn } from '@/lib/utils'
import { useSesion } from '@/core/auth/useSesion'
import {
  ESTADOS_VISITA,
  EstadoVisitaBadge,
  sePuedeEditar,
  Ventana,
} from '@concurrencia/components/visitas'
import { listarVisitas } from '@concurrencia/api'
import { Boton } from '@/shared/components/ui/button'
import { MenuAcciones } from '@/shared/components/ui/menu'
import { Input } from '@/shared/components/ui/input'
import { Select } from '@/shared/components/ui/select'

const EASE: [number, number, number, number] = [0.22, 0.61, 0.36, 1]
const POR_PAGINA = 25

export interface FiltrosDeEntrada {
  estado?: string
  desde?: string
  hasta?: string
}

/**
 * La bandeja de entrada del módulo: las visitas del médico auditor de MI
 * aseguradora. El backend acota por `aseguradora_id` en cada consulta, así que
 * esta pantalla no puede ver lo de otra compañía ni por error.
 *
 * Vive de dos maneras: como página propia (el operador entra directo aquí) y
 * `empotrada` dentro del panel del supervisor, como pestaña, sin cabecera
 * propia y con los filtros que le pasa el cuadro pulsado.
 */
export function BandejaPage({
  empotrada = false,
  filtrosIniciales,
  creadoPor,
}: {
  empotrada?: boolean
  filtrosIniciales?: FiltrosDeEntrada
  /** Fija la lista a los casos creados por ese operador (tab Operadores). */
  creadoPor?: string
} = {}) {
  const navegar = useNavigate()
  const sinMovimiento = useReducedMotion()
  const { data: sesion } = useSesion()

  // El supervisor de la compañía solo mira y supervisa: crear y editar visitas
  // es trabajo del operador. Esto solo esconde botones; la puerta real está en
  // el backend, que le devuelve 403 si fuerza la llamada.
  const soloMira = sesion?.modulos.find((m) => m.codigo === 'concurrencia')?.rol === 'supervisor'

  // El filtro inicial llega por props (la pestaña del panel) o por la URL
  // (?estado=…&desde=…&hasta=…). Se lee una vez, validado —un valor raro se
  // ignora, no viaja al backend—, y desde ahí mandan los controles de siempre.
  const [parametros] = useSearchParams()
  const estadoInicial = filtrosIniciales?.estado ?? parametros.get('estado') ?? ''
  const fecha = (clave: 'desde' | 'hasta') => {
    const valor = filtrosIniciales?.[clave] ?? parametros.get(clave) ?? ''
    return /^\d{4}-\d{2}-\d{2}$/.test(valor) ? valor : ''
  }

  const [busqueda, setBusqueda] = useState('')
  const [busquedaAplicada, setBusquedaAplicada] = useState('')
  const [estado, setEstado] = useState(() =>
    ESTADOS_VISITA.some((e) => e.valor === estadoInicial) ? estadoInicial : '',
  )
  const [desde, setDesde] = useState(() => fecha('desde'))
  const [hasta, setHasta] = useState(() => fecha('hasta'))
  const [pagina, setPagina] = useState(1)

  useEffect(() => {
    const id = window.setTimeout(() => {
      setBusquedaAplicada(busqueda)
      setPagina(1)
    }, 300)
    return () => window.clearTimeout(id)
  }, [busqueda])

  const consulta = useQuery({
    queryKey: ['visitas', { busquedaAplicada, estado, desde, hasta, creadoPor, pagina }],
    queryFn: () =>
      listarVisitas({
        search: busquedaAplicada,
        estado,
        desde,
        hasta,
        creado_por: creadoPor,
        page: pagina,
        page_size: POR_PAGINA,
      }),
    placeholderData: keepPreviousData,
  })

  const datos = consulta.data
  const totalPaginas = datos ? Math.max(1, Math.ceil(datos.total / datos.page_size)) : 1
  const hayFiltros = Boolean(busquedaAplicada || estado || desde || hasta)

  return (
    <div>
      {/* Empotrada en el panel, la cabecera es la del panel: aquí sobraría. */}
      {!empotrada && (
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="font-display text-[0.6875rem] font-semibold uppercase tracking-[0.16em] text-tenue-fg">
              Concurrencia
            </p>
            <h1 className="mt-1.5 font-display text-2xl font-semibold tracking-tight">
              Bandeja de entrada
            </h1>
            <p className="mt-1 text-sm text-tenue-fg">
              Las visitas que tú programaste a los prestadores de tu red.
            </p>
          </div>
          {!soloMira && (
            <Boton onClick={() => navegar('/nueva')}>
              <Plus aria-hidden="true" />
              Nueva visita
            </Boton>
          )}
        </header>
      )}

      {/* ── Filtros ── */}
      <div
        className={cn(
          'grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_11rem_10.5rem_10.5rem]',
          empotrada ? 'mt-0' : 'mt-7',
        )}
      >
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-tenue-fg"
            aria-hidden="true"
          />
          <Input
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar por paciente, documento, código o prestador"
            aria-label="Buscar visitas"
            mayusculas={false}
            className="pl-9"
          />
        </div>
        <Select
          value={estado}
          onChange={(e) => {
            setEstado(e.target.value)
            setPagina(1)
          }}
          aria-label="Filtrar por estado"
        >
          <option value="">Todos los estados</option>
          {ESTADOS_VISITA.map((e) => (
            <option key={e.valor} value={e.valor}>
              {e.etiqueta}
            </option>
          ))}
        </Select>
        <div>
          <Input
            type="date"
            value={desde}
            onChange={(e) => {
              setDesde(e.target.value)
              setPagina(1)
            }}
            aria-label="Desde esta fecha"
          />
        </div>
        <div>
          <Input
            type="date"
            value={hasta}
            min={desde || undefined}
            onChange={(e) => {
              setHasta(e.target.value)
              setPagina(1)
            }}
            aria-label="Hasta esta fecha"
          />
        </div>
      </div>

      {/* ── Tabla ── */}
      <div className="mt-5 overflow-hidden rounded-md border border-borde bg-superficie">
        {consulta.isPending ? (
          <Esqueleto />
        ) : consulta.isError ? (
          <EstadoError onReintentar={() => consulta.refetch()} />
        ) : datos && datos.items.length === 0 ? (
          <Vacio
            hayFiltros={hayFiltros}
            deOperador={Boolean(creadoPor)}
            onCrear={soloMira ? undefined : () => navegar('/nueva')}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[58rem] text-sm">
              <thead>
                <tr className="border-b border-borde bg-superficie-hundida text-left">
                  <Th>Código</Th>
                  <Th>Paciente</Th>
                  <Th>Prestador</Th>
                  <Th>Dónde</Th>
                  <Th>Cuándo</Th>
                  <Th>Avisos</Th>
                  <Th>Estado</Th>
                  <th className="w-12 px-3 py-2.5">
                    <span className="sr-only">Acciones</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                <AnimatePresence initial={false}>
                  {datos?.items.map((fila, indice) => (
                    <motion.tr
                      key={fila.id}
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
                      className="border-b border-borde last:border-b-0 align-top hover:bg-tenue/50"
                    >
                      <td className="whitespace-nowrap px-3 py-3 font-mono text-xs text-tenue-fg">
                        {fila.codigo_interno}
                      </td>
                      <td className="px-3 py-3">
                        {/* Los `max-w` con elipsis mantienen la fila en una
                            línea: un nombre kilométrico se corta, no la rompe.
                            Crecen a partir de 1536 px —la tabla va a todo el
                            ancho— para que el corte sea la excepción y no la
                            regla. Ni antes: con 18 rem por columna la tabla no
                            cabría y habría que desplazarla a mano, que es peor
                            que un nombre con puntos suspensivos. */}
                        <div className="max-w-[11rem] 2xl:max-w-[18rem]">
                          <p className="truncate font-medium">
                            {fila.paciente_nombre_completo}
                          </p>
                          <p className="tabular truncate text-xs text-tenue-fg">
                            {fila.paciente_numero_documento}
                          </p>
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <p className="max-w-[12rem] truncate 2xl:max-w-[18rem]">{fila.prestador_nombre}</p>
                      </td>
                      <td className="px-3 py-3 text-tenue-fg">
                        {/* Sin sede la visita es a la casa matriz: se nombra
                            igual que en el formulario para que no parezcan
                            cosas distintas. */}
                        <div className="max-w-[13rem] 2xl:max-w-[18rem]">
                          <span className="flex items-center gap-1.5">
                            <MapPin className="size-3.5 shrink-0" aria-hidden="true" />
                            <span className="truncate">{fila.sede_nombre ?? 'Casa matriz'}</span>
                          </span>
                          {/* Dónde está, no en qué calle: en una columna estrecha
                              la ciudad se lee entera y la dirección se cortaría. */}
                          <span className="block truncate text-xs">
                            {[fila.ciudad_nombre, fila.provincia_nombre]
                              .filter(Boolean)
                              .join(', ') || fila.lugar}
                          </span>
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-tenue-fg">
                        <Ventana desde={fila.desde} hasta={fila.hasta} />
                      </td>
                      <td className="tabular px-3 py-3 text-tenue-fg">
                        {fila.total_correos > 0 ? (
                          <span className="flex items-center gap-1.5">
                            <Mail className="size-3.5" aria-hidden="true" />
                            {fila.total_correos}
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <EstadoVisitaBadge estado={fila.estado} />
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex justify-end">
                          {/* Ver siempre; editar solo mientras el caso siga
                              abierto —culminado o cancelado ya no se toca— y
                              nunca para quien solo mira. El servidor impone lo
                              mismo con un 409: esto no autoriza. */}
                          <MenuAcciones
                            etiqueta={`Acciones de ${fila.codigo_interno}`}
                            opciones={[
                              {
                                etiqueta: 'Ver',
                                icono: Eye,
                                onSelect: () => navegar(`/${fila.id}/ver`),
                              },
                              ...(soloMira || !sePuedeEditar(fila.estado)
                                ? []
                                : [
                                    {
                                      etiqueta: 'Editar',
                                      icono: Pencil,
                                      onSelect: () => navegar(`/${fila.id}`),
                                    },
                                  ]),
                            ]}
                          />
                        </div>
                      </td>
                    </motion.tr>
                  ))}
                </AnimatePresence>
              </tbody>
            </table>
          </div>
        )}
      </div>

      {datos && datos.total > 0 && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-tenue-fg">
            {datos.total} {datos.total === 1 ? 'visita' : 'visitas'} · página {datos.page} de{' '}
            {totalPaginas}
          </p>
          <div className="flex gap-2">
            <Boton
              variante="contorno"
              tamano="sm"
              disabled={pagina <= 1}
              onClick={() => setPagina((p) => Math.max(1, p - 1))}
            >
              <ChevronLeft aria-hidden="true" />
              Anterior
            </Boton>
            <Boton
              variante="contorno"
              tamano="sm"
              disabled={pagina >= totalPaginas}
              onClick={() => setPagina((p) => p + 1)}
            >
              Siguiente
              <ChevronRight aria-hidden="true" />
            </Boton>
          </div>
        </div>
      )}
    </div>
  )
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-3 py-2.5 font-display text-[0.6875rem] font-semibold uppercase tracking-[0.09em] text-tenue-fg">
      {children}
    </th>
  )
}

function Esqueleto() {
  return (
    <div className="divide-y divide-borde" role="status" aria-label="Cargando visitas">
      {Array.from({ length: 5 }, (_, i) => (
        <div key={i} className="flex items-center gap-4 px-4 py-4">
          <div className="h-3 w-20 animate-pulse rounded bg-tenue" />
          <div className="h-3 w-1/3 animate-pulse rounded bg-tenue" />
          <div className="ml-auto h-3 w-24 animate-pulse rounded bg-tenue" />
          <div className="h-5 w-20 animate-pulse rounded-full bg-tenue" />
        </div>
      ))}
    </div>
  )
}

function EstadoError({ onReintentar }: { onReintentar: () => void }) {
  return (
    <div className="px-6 py-14 text-center">
      <p className="font-display text-sm font-medium">No pudimos cargar la bandeja</p>
      <p className="mx-auto mt-1 max-w-sm text-sm text-tenue-fg">
        Puede ser un corte momentáneo de conexión con el servidor.
      </p>
      <Boton variante="contorno" tamano="sm" onClick={onReintentar} className="mt-4">
        <RotateCw aria-hidden="true" />
        Reintentar
      </Boton>
    </div>
  )
}

function Vacio({
  hayFiltros,
  deOperador = false,
  onCrear,
}: {
  hayFiltros: boolean
  deOperador?: boolean
  onCrear?: () => void
}) {
  const Icono = hayFiltros ? CalendarClock : Inbox
  return (
    <div className="px-6 py-16 text-center">
      <Icono className="mx-auto size-6 text-tenue-fg" aria-hidden="true" />
      <p className="mt-3 font-display text-sm font-medium">
        {hayFiltros
          ? 'Ninguna visita coincide'
          : deOperador
            ? 'Este operador no tiene casos'
            : 'La bandeja está vacía'}
      </p>
      <p className="mx-auto mt-1 max-w-sm text-sm text-tenue-fg">
        {hayFiltros
          ? 'Prueba con otro término o quita los filtros.'
          : deOperador
            ? 'Cuando este operador programe visitas, aparecerán aquí.'
            : onCrear
              ? 'Programa la primera visita del médico auditor a un prestador de tu red.'
              : 'Cuando tu equipo programe visitas, aparecerán aquí.'}
      </p>
      {!hayFiltros && !deOperador && onCrear && (
        <Boton onClick={onCrear} className="mt-4" tamano="sm">
          <Plus aria-hidden="true" />
          Nueva visita
        </Boton>
      )}
    </div>
  )
}
