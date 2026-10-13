import { useMutation, useQueryClient } from '@tanstack/react-query'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import {
  Building2,
  ChevronLeft,
  ChevronRight,
  Map,
  Pencil,
  Plus,
  RotateCw,
  Power,
  Search,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { cn } from '@/lib/utils'
import { useSesion } from '@/core/auth/useSesion'
import { actualizarAseguradora, urlLogo, type Estado } from '@/shared/aseguradoras/api'
import { useAseguradoras } from '@/shared/aseguradoras/hooks'
import { useProvincias } from '@/shared/catalogos/hooks'
import { EstadoBadge } from '@/shared/components/ui/badge'
import { Boton } from '@/shared/components/ui/button'
import { Input } from '@/shared/components/ui/input'
import { Select } from '@/shared/components/ui/select'
import { useToast } from '@/shared/components/ui/toast'
import { useApp } from '@/core/app/contexto'

const EASE: [number, number, number, number] = [0.22, 0.61, 0.36, 1]
const POR_PAGINA = 20

export function AseguradorasPage() {
  const { raiz, alcance } = useApp()
  const toast = useToast()
  const navegar = useNavigate()
  const queryClient = useQueryClient()
  const sinMovimiento = useReducedMotion()
  // Quien lleva los convenios entra a este listado solo para llegar a la red de
  // una compañía: ni la crea ni la da de baja.
  const { data: sesion } = useSesion()
  // En la app de Convenios (D50) la lista es solo para entrar a la red de cada una.
  const soloConvenios = alcance === 'convenios' || sesion?.user.funcion === 'convenio'

  const [busqueda, setBusqueda] = useState('')
  const [busquedaAplicada, setBusquedaAplicada] = useState('')
  const [estado, setEstado] = useState('')
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
  const consulta = useAseguradoras({
    search: busquedaAplicada,
    estado,
    provincia_codigo: provincia,
    page: pagina,
    page_size: POR_PAGINA,
  })

  // Una aseguradora no se elimina: se desactiva. Tiene expedientes, convenios y
  // usuarios colgando, y su historial pierde sentido si desaparece. El backend
  // tampoco expone un DELETE, así que esto no es solo un botón escondido.
  const cambiarEstado = useMutation({
    mutationFn: ({ id, estado }: { id: string; estado: Estado }) =>
      actualizarAseguradora(id, { estado }),
    onSuccess: (aseguradora) => {
      queryClient.invalidateQueries({ queryKey: ['aseguradoras'] })
      toast.exito(
        aseguradora.estado === 'activo' ? 'Aseguradora activada' : 'Aseguradora desactivada',
      )
    },
    onError: () => toast.error('No se pudo cambiar el estado'),
  })

  const datos = consulta.data
  const totalPaginas = datos ? Math.max(1, Math.ceil(datos.total / datos.page_size)) : 1
  const hayFiltros = Boolean(busquedaAplicada || estado || provincia)

  return (
    <div className="w-full">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-display text-[0.6875rem] font-semibold uppercase tracking-[0.16em] text-tenue-fg">
            Administración
          </p>
          <h1 className="mt-1.5 font-display text-2xl font-semibold tracking-tight">
            Aseguradoras
          </h1>
          <p className="mt-1 text-sm text-tenue-fg">
            Compañías con las que opera la plataforma.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* El mapa lo ve todo el que ve el listado, la función Convenio
              incluida: es la misma información, sobre un mapa. */}
          <Boton variante="contorno" onClick={() => navegar(`${raiz}/aseguradoras/mapa`)}>
            <Map aria-hidden="true" />
            Mapa
          </Boton>
          {!soloConvenios && (
            <Boton onClick={() => navegar(`${raiz}/aseguradoras/nueva`)}>
              <Plus aria-hidden="true" />
              Nueva aseguradora
            </Boton>
          )}
        </div>
      </header>

      {/* ── Filtros ── */}
      <div className="mt-7 grid gap-3 sm:grid-cols-[minmax(0,1fr)_12rem_14rem]">
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
            placeholder="Buscar por razón social, nombre comercial, RUC o código"
            aria-label="Buscar aseguradoras"
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
          <option value="activo">Activo</option>
          <option value="inactivo">Inactivo</option>
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
          <Vacio hayFiltros={hayFiltros} onCrear={() => navegar(`${raiz}/aseguradoras/nueva`)} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[46rem] text-sm">
              <thead>
                <tr className="border-b border-borde bg-superficie-hundida text-left">
                  <Th>Aseguradora</Th>
                  <Th>Código</Th>
                  <Th>RUC</Th>
                  <Th>Ubicación</Th>
                  <Th>Estado</Th>
                  <th className="w-24 px-4 py-2.5">
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
                              <Building2 className="size-4 text-tenue-fg" aria-hidden="true" />
                            )}
                          </div>
                          <div className="min-w-0">
                            <p className="truncate font-medium">{fila.razon_social}</p>
                            {fila.nombre_comercial && (
                              <p className="truncate text-xs text-tenue-fg">
                                {fila.nombre_comercial}
                              </p>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-tenue-fg">
                        {fila.codigo_interno}
                      </td>
                      <td className="tabular px-4 py-3 text-tenue-fg">{fila.ruc}</td>
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
                            onClick={() => navegar(`${raiz}/aseguradoras/${fila.id}/editar`)}
                            aria-label={
                              soloConvenios
                                ? `Convenios de ${fila.razon_social}`
                                : `Editar ${fila.razon_social}`
                            }
                          >
                            <Pencil aria-hidden="true" />
                          </Boton>
                          {/* Dar de baja una compañía es del administrador; quien
                              lleva los convenios solo entra a su red. */}
                          {!soloConvenios && (
                            <Boton
                              variante="fantasma"
                              tamano="icono"
                              onClick={() =>
                                cambiarEstado.mutate({
                                  id: fila.id,
                                  estado: fila.estado === 'activo' ? 'inactivo' : 'activo',
                                })
                              }
                              aria-label={`${
                                fila.estado === 'activo' ? 'Desactivar' : 'Activar'
                              } ${fila.razon_social}`}
                              className={fila.estado === 'activo' ? 'hover:text-aviso' : undefined}
                            >
                              <Power aria-hidden="true" />
                            </Boton>
                          )}
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
            {datos.total} {datos.total === 1 ? 'aseguradora' : 'aseguradoras'} · página {datos.page}{' '}
            de {totalPaginas}
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
    <th className="px-4 py-2.5 font-display text-[0.6875rem] font-semibold uppercase tracking-[0.09em] text-tenue-fg">
      {children}
    </th>
  )
}

function Esqueleto() {
  return (
    <div className="divide-y divide-borde" role="status" aria-label="Cargando aseguradoras">
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
      <p className="font-display text-sm font-medium">No pudimos cargar las aseguradoras</p>
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
    <div className={cn('px-6 py-16 text-center')}>
      <Building2 className="mx-auto size-6 text-tenue-fg" aria-hidden="true" />
      <p className="mt-3 font-display text-sm font-medium">
        {hayFiltros ? 'Ninguna aseguradora coincide' : 'Todavía no hay aseguradoras'}
      </p>
      <p className="mx-auto mt-1 max-w-sm text-sm text-tenue-fg">
        {hayFiltros
          ? 'Prueba con otro término de búsqueda o quita los filtros.'
          : 'Crea la primera para empezar a operar con ella.'}
      </p>
      {!hayFiltros && (
        <Boton onClick={onCrear} className="mt-4" tamano="sm">
          <Plus aria-hidden="true" />
          Nueva aseguradora
        </Boton>
      )}
    </div>
  )
}
