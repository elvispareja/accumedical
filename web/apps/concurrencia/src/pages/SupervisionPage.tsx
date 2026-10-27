import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import {
  ChevronLeft,
  ChevronRight,
  Inbox,
  MapPin,
  Pencil,
  Plus,
  RotateCw,
  Search,
  UserCheck,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'

import { cn } from '@/lib/utils'
import {
  listarAuditores,
  listarSupervision,
  obtenerDashboardSupervision,
  obtenerFiltrosSupervision,
  usuariosDeAseguradoraSupervision,
} from '@concurrencia/api'
import { FechaConEtiqueta } from '@concurrencia/components/filtros'
import {
  CuadrosDeVisitas,
  type FiltroDeCuadro,
} from '@concurrencia/components/cifras'
import {
  EstadoVisitaBadge,
  FueraDeSla,
  Ventana,
} from '@concurrencia/components/visitas'
import { Boton } from '@/shared/components/ui/button'
import { Input } from '@/shared/components/ui/input'
import { Select } from '@/shared/components/ui/select'

const EASE: [number, number, number, number] = [0.22, 0.61, 0.36, 1]
const POR_PAGINA = 20
/**
 * La bandeja del supervisor de plataforma: los casos que llegan de TODAS las
 * aseguradoras, para derivar cada uno a un médico auditor (desde la ficha del caso).
 * El backend solo sirve esta vista a personal de plataforma con rol supervisor.
 *
 * Arriba, **los mismos cuadros que ve el supervisor de una compañía de lo suyo**
 * —es el mismo componente, no una copia—, aquí con las cifras de todas; pulsar
 * uno no navega, acota la lista de abajo. Y los filtros: búsqueda, estado,
 * **rango de fechas**, solo los que están sin asignar y, para la
 * trazabilidad, **la aseguradora y la persona del personal** —esté o no
 * todavía en Concurrencia— que intervino en el caso.
 *
 * La misma pantalla sirve al coordinador de plataforma y al administrador
 * global, que entra al módulo como él (D45).
 */
export function SupervisionPage() {
  const sinMovimiento = useReducedMotion()
  const navegar = useNavigate()

  const [busqueda, setBusqueda] = useState('')
  const [busquedaAplicada, setBusquedaAplicada] = useState('')
  const [estado, setEstado] = useState('')
  const [soloSinAsignar, setSoloSinAsignar] = useState(false)
  const [soloFueraSla, setSoloFueraSla] = useState(false)
  // El rango, en `YYYY-MM-DD`. Acota por la VENTANA del caso: entra el que
  // toque cualquier día del rango, no solo el que empiece dentro.
  const [desde, setDesde] = useState('')
  const [hasta, setHasta] = useState('')
  const [aseguradoraId, setAseguradoraId] = useState('')
  const [personaId, setPersonaId] = useState('')
  const [usuarioId, setUsuarioId] = useState('')
  const [pagina, setPagina] = useState(1)

  // El caso se abre siempre en el módulo: el administrador global entra como
  // coordinador de plataforma (D45), con la misma ruta que él.
  const rutaDelCaso = (id: string) => `/supervision/${id}`

  // Una notificación vieja llega como `?caso=<id>`: se redirige a la página del
  // caso. Las nuevas ya apuntan ahí directamente; esto es solo la puerta de
  // atrás para las que se escribieron antes.
  const [parametros] = useSearchParams()
  const casoDeLaUrl = parametros.get('caso')
  useEffect(() => {
    if (casoDeLaUrl) navegar(rutaDelCaso(casoDeLaUrl), { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [casoDeLaUrl])

  useEffect(() => {
    const id = window.setTimeout(() => {
      setBusquedaAplicada(busqueda)
      setPagina(1)
    }, 300)
    return () => window.clearTimeout(id)
  }, [busqueda])

  const consulta = useQuery({
    queryKey: [
      'supervision',
      {
        busquedaAplicada,
        estado,
        soloSinAsignar,
        soloFueraSla,
        desde,
        hasta,
        aseguradoraId,
        personaId,
        usuarioId,
        pagina,
      },
    ],
    queryFn: () =>
      listarSupervision({
        search: busquedaAplicada,
        estado,
        sin_asignar: soloSinAsignar,
        fuera_sla: soloFueraSla,
        desde,
        hasta,
        aseguradora_id: aseguradoraId,
        persona_id: personaId,
        usuario_id: usuarioId,
        page: pagina,
        page_size: POR_PAGINA,
      }),
    placeholderData: keepPreviousData,
  })

  // Las cifras de TODAS las compañías, las mismas que ve cada aseguradora de lo
  // suyo. No siguen al rango de fechas: son la foto completa, y pulsar una es
  // lo que acota la lista.
  const cifras = useQuery({
    queryKey: ['supervision-cifras'],
    queryFn: obtenerDashboardSupervision,
    // Un panel que se queda abierto en la oficina no debe mentir.
    refetchInterval: 60_000,
  })
  const auditores = useQuery({ queryKey: ['auditores'], queryFn: listarAuditores })
  const filtros = useQuery({
    queryKey: ['supervision-filtros'],
    queryFn: obtenerFiltrosSupervision,
  })
  const personal = filtros.data?.personal ?? []
  // El tercer selector se desbloquea al elegir la compañía: su gente, también
  // la que ya no está (a ellos tampoco se les borra, solo se les desactiva).
  const usuariosAseguradora = useQuery({
    queryKey: ['supervision-filtros', 'aseguradora', aseguradoraId],
    queryFn: () => usuariosDeAseguradoraSupervision(aseguradoraId),
    enabled: Boolean(aseguradoraId),
  })

  /**
   * Pulsar un cuadro pone ESE filtro y quita los demás: si se sumara a lo que ya
   * hubiera puesto, el número del cuadro y lo que se ve debajo no cuadrarían.
   * Sin argumentos, limpia.
   */
  function aplicarFiltro(filtro: FiltroDeCuadro = {}) {
    setBusqueda('')
    setBusquedaAplicada('')
    setSoloSinAsignar(filtro.sinAsignar ?? false)
    setSoloFueraSla(filtro.fueraSla ?? false)
    setEstado(filtro.estado ?? '')
    setDesde(filtro.desde ?? '')
    setHasta(filtro.hasta ?? '')
    setAseguradoraId('')
    setPersonaId('')
    setUsuarioId('')
    setPagina(1)
  }

  const datos = consulta.data
  const totalPaginas = datos ? Math.max(1, Math.ceil(datos.total / datos.page_size)) : 1
  const hayFiltros = Boolean(
    busquedaAplicada ||
      estado ||
      soloSinAsignar ||
      soloFueraSla ||
      desde ||
      hasta ||
      aseguradoraId ||
      personaId ||
      usuarioId,
  )
  const sinAuditores = auditores.data?.length === 0

  return (
    <div>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-display text-[0.6875rem] font-semibold uppercase tracking-[0.16em] text-tenue-fg">
            Concurrencia · Supervisión
          </p>
          <h1 className="mt-1.5 font-display text-2xl font-semibold tracking-tight">
            Casos de las aseguradoras
          </h1>
          <p className="mt-1 text-sm text-tenue-fg">
            Las visitas que programan todas las compañías, para derivarlas a tus médicos
            auditores — y las que programes tú, si el pedido te llega por correo.
          </p>
        </div>
        <Link
          to="/programar"
          className="inline-flex h-10 items-center gap-2 rounded bg-marca px-4 text-sm font-medium text-marca-fg transition-opacity duration-150 hover:opacity-90"
        >
          <Plus className="size-4" aria-hidden="true" />
          Programar visita
        </Link>
      </header>

      {sinAuditores && (
        <p className="mt-5 rounded-md border border-dashed border-borde px-4 py-3 text-sm text-tenue-fg">
          Todavía no hay médicos auditores activos en Concurrencia: créalos en la sección Usuarios
          del administrador y aparecerán aquí para derivarles casos.
        </p>
      )}

      {/* ── Los cuadros: los mismos que ve cada aseguradora de lo suyo, aquí
          con lo de TODAS. Cada uno es también un filtro de la lista. ── */}
      <CuadrosDeVisitas
        className="mt-7"
        cifras={cifras.data}
        cargando={cifras.isPending}
        error={cifras.isError}
        onReintentar={() => cifras.refetch()}
        alFiltrar={aplicarFiltro}
        conSinAsignar
      />

      {/* ── Filtros ── El estado se elige pulsando un cuadro de arriba: sin
          selector propio (pedido del usuario), así no hay dos controles para lo mismo. */}
      <div className="mt-6 grid items-center gap-3 sm:grid-cols-[minmax(0,1fr)_13rem_13rem]">
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-tenue-fg"
            aria-hidden="true"
          />
          <Input
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar por aseguradora, prestador o código"
            aria-label="Buscar casos"
            mayusculas={false}
            className="pl-9"
          />
        </div>
        <FechaConEtiqueta etiqueta="Desde">
          <Input
            type="date"
            value={desde}
            onChange={(e) => {
              setDesde(e.target.value)
              setPagina(1)
            }}
            aria-label="Desde esta fecha"
            className="pl-16"
          />
        </FechaConEtiqueta>
        <FechaConEtiqueta etiqueta="Hasta">
          <Input
            type="date"
            value={hasta}
            min={desde || undefined}
            onChange={(e) => {
              setHasta(e.target.value)
              setPagina(1)
            }}
            aria-label="Hasta esta fecha"
            className="pl-16"
          />
        </FechaConEtiqueta>
      </div>

      {/* La trazabilidad, en tres selectores que se combinan: nuestro
          personal, la compañía y —al elegirla se desbloquea— su gente. Todos
          incluyen a quien ya no está: en medicina no se borra nada. */}
      <div className="mt-3 grid items-center gap-3 sm:grid-cols-3">
        <Select
          value={personaId}
          onChange={(e) => {
            setPersonaId(e.target.value)
            setPagina(1)
          }}
          aria-label="Nuestro personal"
        >
          <option value="">Todo nuestro personal</option>
          {gruposDePersonas(personal, 'En Concurrencia')}
        </Select>
        <Select
          value={aseguradoraId}
          onChange={(e) => {
            setAseguradoraId(e.target.value)
            setUsuarioId('')
            setPagina(1)
          }}
          aria-label="Aseguradora"
        >
          <option value="">Todas las aseguradoras</option>
          {(filtros.data?.aseguradoras ?? []).map((a) => (
            <option key={a.id} value={a.id}>
              {a.nombre}
            </option>
          ))}
        </Select>
        <Select
          value={usuarioId}
          onChange={(e) => {
            setUsuarioId(e.target.value)
            setPagina(1)
          }}
          disabled={!aseguradoraId}
          aria-label="Usuarios de la aseguradora"
        >
          <option value="">
            {aseguradoraId ? 'Todos los usuarios de la aseguradora' : 'Elige primero la aseguradora'}
          </option>
          {gruposDePersonas(usuariosAseguradora.data ?? [], 'Activos')}
        </Select>
      </div>

      {/* La salida de cualquier filtro, incluida la de haber pulsado un cuadro:
          aparece solo cuando hay algo que quitar. */}
      {hayFiltros && (
        <div className="mt-3 flex justify-end">
          <button
            type="button"
            onClick={() => aplicarFiltro()}
            className="text-sm font-medium text-marca transition-opacity duration-150 hover:opacity-80"
          >
            Quitar filtros
          </button>
        </div>
      )}

      {/* ── Tabla ── */}
      <div className="mt-5 overflow-hidden rounded-md border border-borde bg-superficie">
        {consulta.isPending ? (
          <Esqueleto />
        ) : consulta.isError ? (
          <EstadoError onReintentar={() => consulta.refetch()} />
        ) : datos && datos.items.length === 0 ? (
          <Vacio hayFiltros={hayFiltros} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[58rem] text-sm">
              <thead>
                <tr className="border-b border-borde bg-superficie-hundida text-left">
                  <Th>Código</Th>
                  <Th>Aseguradora</Th>
                  <Th>Prestador</Th>
                  <Th>Cuándo</Th>
                  <Th>Estado</Th>
                  <Th>Auditor</Th>
                  <th className="w-14 px-4 py-2.5">
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
                      <td className="px-4 py-3 font-mono text-xs text-tenue-fg">
                        {fila.codigo_interno}
                      </td>
                      <td className="px-4 py-3">
                        <p className="max-w-[14rem] truncate font-medium">
                          {fila.aseguradora_nombre}
                        </p>
                      </td>
                      <td className="px-4 py-3 text-tenue-fg">
                        <span className="block max-w-[14rem] truncate text-tinta">
                          {fila.prestador_nombre}
                        </span>
                        <span className="flex max-w-[14rem] items-center gap-1 truncate text-xs">
                          <MapPin className="size-3 shrink-0" aria-hidden="true" />
                          <span className="truncate">
                            {fila.sede_nombre ?? 'SEDE PRINCIPAL'}
                            {fila.ciudad_nombre ? ` · ${fila.ciudad_nombre}` : ''}
                          </span>
                        </span>
                      </td>
                      <td className="px-4 py-3 text-tenue-fg">
                        {/* La ventana de la visita: desde y hasta (= plazo de llegada). */}
                        <Ventana
                          desde={fila.desde}
                          hasta={fila.llegada_limite}
                          porFijar={fila.estado === 'programada'}
                        />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <EstadoVisitaBadge estado={fila.estado} />
                          {fila.fuera_sla && <FueraDeSla />}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {/* Solo se ENSEÑA quién tiene el caso (pedido del
                            usuario, 26/10/2026): para derivar o cambiar de
                            auditor se abre el caso con el lápiz. */}
                        <span
                          className={cn(
                            'block max-w-[12rem] truncate text-sm',
                            !fila.auditor_nombre && 'text-tenue-fg',
                          )}
                        >
                          {fila.auditor_nombre ?? 'Sin asignar'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <Boton
                          variante="fantasma"
                          tamano="icono"
                          onClick={() => navegar(rutaDelCaso(fila.id))}
                          aria-label={`Abrir ${fila.codigo_interno}`}
                        >
                          <Pencil aria-hidden="true" />
                        </Boton>
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
            {datos.total} {datos.total === 1 ? 'caso' : 'casos'} · página {datos.page} de{' '}
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

/**
 * Las personas de un filtro en dos grupos: las que siguen y las que ya no
 * están. Es una función y no un componente: el `Select` propio lee sus
 * `<optgroup>` hijos directamente y no expande componentes.
 */
function gruposDePersonas(
  lista: { id: string; nombre_completo: string; detalle: string; vigente: boolean }[],
  vigentes: string,
) {
  return [
    { titulo: vigentes, filas: lista.filter((p) => p.vigente) },
    { titulo: 'Desvinculados', filas: lista.filter((p) => !p.vigente) },
  ]
    .filter((g) => g.filas.length > 0)
    .map((g) => (
      <optgroup key={g.titulo} label={g.titulo}>
        {g.filas.map((p) => (
          <option key={p.id} value={p.id}>
            {`${p.nombre_completo} · ${p.detalle}`}
          </option>
        ))}
      </optgroup>
    ))
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-4 py-2.5 text-left font-display text-[0.6875rem] font-semibold uppercase tracking-[0.09em] text-tenue-fg">
      {children}
    </th>
  )
}

function Esqueleto() {
  return (
    <div className="divide-y divide-borde" role="status" aria-label="Cargando los casos">
      {Array.from({ length: 5 }, (_, i) => (
        <div key={i} className="flex items-center gap-4 px-4 py-3.5">
          <div className="h-3 w-16 animate-pulse rounded bg-tenue" />
          <div className="h-3 w-1/4 animate-pulse rounded bg-tenue" />
          <div className="h-3 w-1/5 animate-pulse rounded bg-tenue" />
          <div className="ml-auto h-9 w-44 animate-pulse rounded bg-tenue" />
        </div>
      ))}
    </div>
  )
}

function EstadoError({ onReintentar }: { onReintentar: () => void }) {
  return (
    <div className="px-6 py-14 text-center">
      <p className="font-display text-sm font-medium">No pudimos cargar los casos</p>
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

function Vacio({ hayFiltros }: { hayFiltros: boolean }) {
  return (
    <div className="px-6 py-16 text-center">
      {hayFiltros ? (
        <Search className="mx-auto size-6 text-tenue-fg" aria-hidden="true" />
      ) : (
        <Inbox className="mx-auto size-6 text-tenue-fg" aria-hidden="true" />
      )}
      <p className="mt-3 font-display text-sm font-medium">
        {hayFiltros ? 'Ningún caso coincide' : 'Todavía no llegan casos'}
      </p>
      <p className="mx-auto mt-1 max-w-sm text-sm text-tenue-fg">
        {hayFiltros
          ? 'Prueba con otro término o quita los filtros.'
          : 'Cuando una aseguradora programe una visita, aparecerá aquí para que la derives.'}
      </p>
      {!hayFiltros && (
        <p className="mx-auto mt-3 flex max-w-sm items-center justify-center gap-1.5 text-xs text-tenue-fg">
          <UserCheck className="size-3.5" aria-hidden="true" />
          Para derivar un caso, ábrelo con el lápiz y elige ventana y auditor.
        </p>
      )}
    </div>
  )
}
