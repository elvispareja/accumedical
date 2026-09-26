import { useMutation, useQueryClient } from '@tanstack/react-query'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import {
  ChevronLeft,
  ChevronRight,
  Map,
  Pencil,
  Plus,
  RotateCw,
  Search,
  Stethoscope,
  Trash2,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { cn } from '@/lib/utils'
import { useProvincias, useTiposPrestador } from '@/shared/catalogos/hooks'
import { EstadoBadge } from '@/shared/components/ui/badge'
import { Boton } from '@/shared/components/ui/button'
import { Input } from '@/shared/components/ui/input'
import { Select } from '@/shared/components/ui/select'
import { useToast } from '@/shared/components/ui/toast'
import { eliminarPrestador, urlLogo } from '@/shared/prestadores/api'
import { usePrestadores } from '@/shared/prestadores/hooks'

const EASE: [number, number, number, number] = [0.22, 0.61, 0.36, 1]
const POR_PAGINA = 20

export function PrestadoresPage() {
  const toast = useToast()
  const navegar = useNavigate()
  const queryClient = useQueryClient()
  const sinMovimiento = useReducedMotion()

  const [busqueda, setBusqueda] = useState('')
  const [busquedaAplicada, setBusquedaAplicada] = useState('')
  const [estado, setEstado] = useState('')
  const [tipo, setTipo] = useState('')
  const [provincia, setProvincia] = useState('')
  const [pagina, setPagina] = useState(1)

  // La búsqueda va al servidor, así que se espera a que el usuario deje de
  // escribir en lugar de disparar una petición por tecla.
  useEffect(() => {
    const id = window.setTimeout(() => {
      setBusquedaAplicada(busqueda)
      setPagina(1)
    }, 300)
    return () => window.clearTimeout(id)
  }, [busqueda])

  const provincias = useProvincias()
  const tipos = useTiposPrestador()
  const consulta = usePrestadores({
    search: busquedaAplicada,
    estado,
    tipo_codigo: tipo,
    provincia_codigo: provincia,
    page: pagina,
    page_size: POR_PAGINA,
  })

  const borrar = useMutation({
    mutationFn: eliminarPrestador,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['prestadores'] })
      toast.exito('Prestador eliminado')
    },
    onError: () => toast.error('No se pudo eliminar el prestador'),
  })

  const datos = consulta.data
  const totalPaginas = datos ? Math.max(1, Math.ceil(datos.total / datos.page_size)) : 1
  const hayFiltros = Boolean(busquedaAplicada || estado || tipo || provincia)

  return (
    <div className="w-full">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-display text-[0.6875rem] font-semibold uppercase tracking-[0.16em] text-tenue-fg">
            Administración
          </p>
          <h1 className="mt-1.5 font-display text-2xl font-semibold tracking-tight">Prestadores</h1>
          <p className="mt-1 text-sm text-tenue-fg">
            Médicos y establecimientos que atienden a los asegurados.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Boton variante="contorno" onClick={() => navegar('/admin/prestadores/mapa')}>
            <Map aria-hidden="true" />
            Mapa
          </Boton>
          <Boton onClick={() => navegar('/admin/prestadores/nuevo')}>
            <Plus aria-hidden="true" />
            Nuevo prestador
          </Boton>
        </div>
      </header>

      {/* ── Filtros ── */}
      <div className="mt-7 grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_11rem_12rem_13rem]">
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-tenue-fg"
            aria-hidden="true"
          />
          <Input
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            // Buscar no es capturar un dato: se teclea como salga.
            mayusculas={false}
            placeholder="Buscar por nombre, RUC o código"
            aria-label="Buscar prestadores"
            className="pl-9"
          />
        </div>
        <Select
          value={tipo}
          onChange={(e) => {
            setTipo(e.target.value)
            setPagina(1)
          }}
          aria-label="Filtrar por tipo"
        >
          <option value="">Todos los tipos</option>
          {tipos.data?.map((t) => (
            <option key={t.codigo} value={t.codigo}>
              {t.nombre}
            </option>
          ))}
        </Select>
        <Select
          value={estado}
          onChange={(e) => {
            setEstado(e.target.value)
            setPagina(1)
          }}
          aria-label="Filtrar por estado"
        >
          <option value="">Todos los estados</option>
          <option value="activo">Activo</option>
          <option value="inactivo">Inactivo</option>
          <option value="suspendido">Suspendido</option>
        </Select>
        <Select
          value={provincia}
          onChange={(e) => {
            setProvincia(e.target.value)
            setPagina(1)
          }}
          aria-label="Filtrar por provincia"
        >
          <option value="">Todas las provincias</option>
          {provincias.data?.map((p) => (
            <option key={p.codigo} value={p.codigo}>
              {p.nombre}
            </option>
          ))}
        </Select>
      </div>

      {/* ── Tabla ── */}
      <div className="mt-5 overflow-hidden rounded-md border border-borde bg-superficie">
        {consulta.isPending ? (
          <Esqueleto />
        ) : consulta.isError ? (
          <EstadoError onReintentar={() => consulta.refetch()} />
        ) : datos && datos.items.length === 0 ? (
          <Vacio hayFiltros={hayFiltros} onCrear={() => navegar('/admin/prestadores/nuevo')} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[44rem] table-fixed text-sm">
              <thead>
                <tr className="border-b border-borde bg-superficie-hundida text-left">
                  {/* La primera se queda con lo que sobre; las demás llevan
                      ancho fijo para que ninguna se estire con su contenido. */}
                  <Th>Prestador</Th>
                  <Th className="w-[7rem]">Código</Th>
                  <Th className="w-[6.5rem]">Tipo</Th>
                  <Th className="w-[9.5rem]">RUC</Th>
                  <Th className="w-[10.5rem]">Ubicación</Th>
                  <Th className="w-[6.75rem]">Estado</Th>
                  <th className="w-[5.5rem] px-4 py-2.5">
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
                      className="border-b border-borde last:border-b-0 hover:bg-tenue/50"
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="grid size-9 shrink-0 place-items-center overflow-hidden rounded border border-borde bg-fondo">
                            {fila.tiene_logo ? (
                              <img
                                src={urlLogo(fila.id)}
                                alt=""
                                className="size-full object-contain"
                              />
                            ) : (
                              <Stethoscope className="size-4 text-tenue-fg" aria-hidden="true" />
                            )}
                          </div>
                          <div className="min-w-0">
                            <p className="truncate font-medium">{fila.nombre}</p>
                          </div>
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-tenue-fg">
                        {fila.codigo_interno}
                      </td>
                      <td className="truncate px-4 py-3 text-tenue-fg">{fila.tipo_nombre}</td>
                      <td className="tabular whitespace-nowrap px-4 py-3 text-tenue-fg">{fila.ruc}</td>
                      <td className="px-4 py-3 text-tenue-fg">
                        {fila.provincia_nombre ? (
                          <>
                            <span className="block truncate">{fila.ciudad_nombre ?? '—'}</span>
                            <span className="block truncate text-xs">{fila.provincia_nombre}</span>
                          </>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <EstadoBadge estado={fila.estado} />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-1">
                          <Boton
                            variante="fantasma"
                            tamano="icono"
                            onClick={() => navegar(`/admin/prestadores/${fila.id}/editar`)}
                            aria-label={`Editar ${fila.nombre}`}
                          >
                            <Pencil aria-hidden="true" />
                          </Boton>
                          <Boton
                            variante="fantasma"
                            tamano="icono"
                            onClick={() => {
                              if (
                                window.confirm(
                                  `¿Eliminar «${fila.nombre}»? Dejará de aparecer en el listado, pero su historial se conserva.`,
                                )
                              ) {
                                borrar.mutate(fila.id)
                              }
                            }}
                            aria-label={`Eliminar ${fila.nombre}`}
                            className="hover:text-peligro"
                          >
                            <Trash2 aria-hidden="true" />
                          </Boton>
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

      {/* ── Paginación ── */}
      {datos && datos.total > 0 && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-tenue-fg">
            {datos.total} {datos.total === 1 ? 'prestador' : 'prestadores'} · página {datos.page} de{' '}
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

function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <th
      className={cn(
        'px-4 py-2.5 text-left font-display text-[0.6875rem] font-semibold uppercase tracking-[0.09em] text-tenue-fg',
        className,
      )}
    >
      {children}
    </th>
  )
}

function Esqueleto() {
  return (
    <div className="divide-y divide-borde" role="status" aria-label="Cargando prestadores">
      {Array.from({ length: 5 }, (_, i) => (
        <div key={i} className="flex items-center gap-4 px-4 py-3.5">
          <div className="size-9 shrink-0 animate-pulse rounded bg-tenue" />
          <div className="h-3 w-1/3 animate-pulse rounded bg-tenue" />
          <div className="ml-auto h-3 w-20 animate-pulse rounded bg-tenue" />
          <div className="h-5 w-16 animate-pulse rounded-full bg-tenue" />
        </div>
      ))}
    </div>
  )
}

function EstadoError({ onReintentar }: { onReintentar: () => void }) {
  return (
    <div className="px-6 py-14 text-center">
      <p className="font-display text-sm font-medium">No pudimos cargar los prestadores</p>
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

function Vacio({ hayFiltros, onCrear }: { hayFiltros: boolean; onCrear: () => void }) {
  return (
    <div className="px-6 py-16 text-center">
      <Stethoscope className="mx-auto size-6 text-tenue-fg" aria-hidden="true" />
      <p className="mt-3 font-display text-sm font-medium">
        {hayFiltros ? 'Ningún prestador coincide' : 'Todavía no hay prestadores'}
      </p>
      <p className="mx-auto mt-1 max-w-sm text-sm text-tenue-fg">
        {hayFiltros
          ? 'Prueba con otro término de búsqueda o quita los filtros.'
          : 'Crea el primero para empezar a operar con él.'}
      </p>
      {!hayFiltros && (
        <Boton onClick={onCrear} className="mt-4" tamano="sm">
          <Plus aria-hidden="true" />
          Nuevo prestador
        </Boton>
      )}
    </div>
  )
}
