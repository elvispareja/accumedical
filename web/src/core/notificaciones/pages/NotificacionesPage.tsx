import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { motion, useReducedMotion } from 'framer-motion'
import { Bell, CheckCheck, ChevronLeft, ChevronRight, RotateCw } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'

import { esCoordinador } from '@/core/auth/area'
import { useSesion } from '@/core/auth/useSesion'
import { identidadDe } from '@/core/modulos/identidad'
import {
  listarNotificaciones,
  marcarLeida,
  marcarTodasLeidas,
  type Notificacion,
} from '@/core/notificaciones/api'
import { cn } from '@/lib/utils'
import { Boton } from '@/shared/components/ui/button'

const EASE: [number, number, number, number] = [0.22, 0.61, 0.36, 1]
const POR_PAGINA = 20

/**
 * Una pastilla del filtro. Es un interruptor —`aria-pressed`—, no un enlace: no
 * lleva a otro sitio, acota lo que ya se está mirando.
 */
function Pastilla({
  activa,
  onClick,
  icono,
  children,
}: {
  activa: boolean
  onClick: () => void
  icono?: ReactNode
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={activa}
      className={cn(
        'inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5',
        'font-display text-sm font-medium transition-colors duration-150',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-marca',
        activa
          ? 'border-marca/50 bg-marca-suave text-marca'
          : 'border-borde text-tenue-fg hover:bg-tenue hover:text-tinta',
      )}
    >
      {icono}
      {children}
    </button>
  )
}

/** Fecha y hora completas: aquí sí se mira el historial, no el «hace un rato». */
function cuando(iso: string): string {
  return new Date(iso).toLocaleString('es-EC', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/**
 * Todas las notificaciones de quien mira. La campana del topbar es el vistazo;
 * esta es la lista entera, con sus filtros y su paginación.
 *
 * Dos ejes que se combinan: el estado —todas o sin ver— y el módulo. Las
 * pastillas de módulo las nombra el SERVIDOR, no esta pantalla, y están todos
 * los que pueden avisar a esta persona aunque todavía no le hayan avisado: así
 * se lee de dónde puede llegarle algo. Cada una dice cuántas hay detrás, y esa
 * cuenta va con el estado elegido para que el número sea el de lo que se verá.
 *
 * Comparte consulta con la campana —la misma ruta con parámetros— pero NO su
 * clave de caché: si compartieran clave, abrir la página segunda dejaría a la
 * campana pintando la segunda página. La campana no pide las pastillas.
 */
/**
 * `moduloFijo` (code): la página dentro de la app de un módulo, p. ej.
 * `/concurrencia/notificaciones`. Solo los avisos de ese módulo y sin el
 * selector de módulos: cada app enseña lo suyo (D47).
 */
export function NotificacionesPage({ moduloFijo }: { moduloFijo?: string } = {}) {
  const navegar = useNavigate()
  const queryClient = useQueryClient()
  const sinMovimiento = useReducedMotion()
  const { data: sesion } = useSesion()
  // Esta pantalla la lleva TODO el mundo, así que el rótulo lo decide quién
  // mira y no la ruta: a una operadora de compañía no se le dice que está en
  // «Administración» —no lo está—, y sin rótulo se lee igual de bien.
  const rotulo = esCoordinador(sesion)
    ? 'Coordinación'
    : sesion?.user.es_admin_global || sesion?.user.funcion
      ? 'Administración'
      : null
  const [soloSinLeer, setSoloSinLeer] = useState(false)
  // El módulo elegido, por `code` —lo que guarda cada aviso—; `null` es todos.
  const [modulo, setModulo] = useState<string | null>(moduloFijo ?? null)
  const [pagina, setPagina] = useState(1)

  const consulta = useQuery({
    queryKey: ['notificaciones-pagina', { soloSinLeer, modulo, pagina }],
    queryFn: () =>
      listarNotificaciones({
        solo_sin_leer: soloSinLeer,
        module_code: modulo ?? undefined,
        con_modulos: true,
        page: pagina,
        page_size: POR_PAGINA,
      }),
    placeholderData: keepPreviousData,
  })

  /** Cambiar de filtro vuelve a la primera página: la cuarta puede no existir. */
  function elegir(cambio: { sinLeer?: boolean; modulo?: string | null }) {
    if (cambio.sinLeer !== undefined) setSoloSinLeer(cambio.sinLeer)
    if (cambio.modulo !== undefined) setModulo(cambio.modulo)
    setPagina(1)
  }

  /** Tras marcar, se refrescan las dos vistas: esta y el punto rojo del topbar. */
  function refrescar() {
    queryClient.invalidateQueries({ queryKey: ['notificaciones-pagina'] })
    queryClient.invalidateQueries({ queryKey: ['notificaciones'] })
  }

  const leer = useMutation({ mutationFn: marcarLeida, onSuccess: refrescar })
  const leerTodas = useMutation({
    mutationFn: () => marcarTodasLeidas(moduloFijo),
    onSuccess: refrescar,
  })

  const datos = consulta.data
  const items = datos?.items ?? []
  const modulos = datos?.modulos ?? []
  const elegido = modulos.find((m) => m.codigo === modulo) ?? null
  const totalPaginas = datos ? Math.max(1, Math.ceil(datos.total / datos.page_size)) : 1

  // Cada pastilla cuenta lo que se verá al pulsarla, así que depende del estado
  // elegido arriba: en «Sin ver» cuenta las que no se han visto.
  const cuantas = (m: { total: number; sin_leer: number }) =>
    soloSinLeer ? m.sin_leer : m.total
  const sinVer = elegido ? elegido.sin_leer : (datos?.sin_leer ?? 0)
  const enTodos = modulos.reduce((suma, m) => suma + cuantas(m), 0)

  function abrir(n: Notificacion) {
    if (!n.leida) leer.mutate(n.id)
    navegar(n.url)
  }

  return (
    <div className="w-full">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          {rotulo && (
            <p className="font-display text-[0.6875rem] font-semibold uppercase tracking-[0.16em] text-tenue-fg">
              {rotulo}
            </p>
          )}
          <h1 className="mt-1.5 font-display text-2xl font-semibold tracking-tight">
            Notificaciones
          </h1>
          <p className="mt-1 text-sm text-tenue-fg">
            Lo que ha pasado en tus módulos. Las que tienen punto rojo están sin ver.
          </p>
        </div>
        {(datos?.sin_leer ?? 0) > 0 && (
          <Boton
            variante="contorno"
            onClick={() => leerTodas.mutate()}
            cargando={leerTodas.isPending}
          >
            <CheckCheck aria-hidden="true" />
            Marcar todas como vistas
          </Boton>
        )}
      </header>

      {/* ── Filtros: dos ejes, uno por fila, para que no se lean como una sola
          lista de opciones que se excluyen entre sí. Se combinan. ── */}
      <div className="mt-7 space-y-2.5">
        <div
          role="group"
          aria-label="Filtrar por estado"
          className="flex flex-wrap items-center gap-2"
        >
          <Pastilla activa={!soloSinLeer} onClick={() => elegir({ sinLeer: false })}>
            Todas
          </Pastilla>
          <Pastilla activa={soloSinLeer} onClick={() => elegir({ sinLeer: true })}>
            Sin ver{sinVer > 0 ? ` · ${sinVer}` : ''}
          </Pastilla>
        </div>

        {/* Los módulos salen del servidor, TODOS los que pueden avisar a esta
            persona, tengan avisos o no: la fila dice de dónde puede llegarle
            algo, no solo de dónde le ha llegado ya. */}
        {!moduloFijo && modulos.length > 0 && (
          <div
            role="group"
            aria-label="Filtrar por módulo"
            className="flex flex-wrap items-center gap-2"
          >
            <Pastilla activa={modulo === null} onClick={() => elegir({ modulo: null })}>
              Todos los módulos{enTodos > 0 ? ` · ${enTodos}` : ''}
            </Pastilla>
            {modulos.map((m) => {
              const identidad = identidadDe(m.codigo)
              const cuenta = cuantas(m)
              return (
                <Pastilla
                  key={m.codigo}
                  activa={modulo === m.codigo}
                  onClick={() => elegir({ modulo: m.codigo })}
                  icono={
                    <identidad.Icono
                      className={cn('size-3.5 shrink-0', identidad.texto)}
                      aria-hidden="true"
                    />
                  }
                >
                  {m.nombre}
                  {cuenta > 0 ? ` · ${cuenta}` : ''}
                </Pastilla>
              )
            })}
          </div>
        )}
      </div>

      {consulta.isPending ? (
        <div className="mt-5 space-y-2" role="status" aria-label="Cargando notificaciones">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="h-20 animate-pulse rounded-md bg-tenue" />
          ))}
        </div>
      ) : consulta.isError ? (
        <div className="mt-5 rounded-md border border-borde bg-superficie px-6 py-14 text-center">
          <p className="font-display text-sm font-medium">No pudimos cargar tus notificaciones.</p>
          <Boton
            variante="contorno"
            tamano="sm"
            className="mt-4"
            onClick={() => consulta.refetch()}
          >
            <RotateCw aria-hidden="true" />
            Reintentar
          </Boton>
        </div>
      ) : items.length === 0 ? (
        <div className="mt-5 rounded-md border border-borde bg-superficie px-6 py-16 text-center">
          <Bell className="mx-auto size-6 text-tenue-fg" aria-hidden="true" />
          <p className="mt-3 font-display text-sm font-medium">
            {soloSinLeer ? 'No tienes notificaciones sin ver' : 'Todavía no hay notificaciones'}
            {elegido ? ` de ${elegido.nombre}` : ''}
          </p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-tenue-fg">
            {soloSinLeer
              ? 'Estás al día.'
              : 'Aquí aparecerá lo que ocurra en tus módulos: casos nuevos y lo que venga después.'}
          </p>
          {/* Vacío por el filtro, no porque no haya nada: la salida, a mano. */}
          {elegido && !moduloFijo && (
            <Boton
              variante="contorno"
              tamano="sm"
              className="mt-4"
              onClick={() => elegir({ modulo: null })}
            >
              Ver todos los módulos
            </Boton>
          )}
        </div>
      ) : (
        <ul className="mt-5 overflow-hidden rounded-md border border-borde bg-superficie">
          {items.map((n, indice) => {
            const identidad = identidadDe(n.module_code)
            return (
              <motion.li
                key={n.id}
                initial={sinMovimiento ? { opacity: 0 } : { opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                  duration: 0.22,
                  delay: sinMovimiento ? 0 : Math.min(indice, 8) * 0.03,
                  ease: EASE,
                }}
                className="border-b border-borde last:border-b-0"
              >
                <button
                  type="button"
                  onClick={() => abrir(n)}
                  className={cn(
                    'flex w-full items-start gap-4 px-4 py-4 text-left',
                    'transition-colors duration-150 hover:bg-tenue',
                    !n.leida && 'bg-peligro-suave/50',
                  )}
                >
                  <span
                    className={cn(
                      'grid size-10 shrink-0 place-items-center rounded-md',
                      identidad.suave,
                    )}
                  >
                    <identidad.Icono
                      className={cn('size-5', identidad.texto)}
                      aria-hidden="true"
                    />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-baseline justify-between gap-x-3">
                      <span className="font-display text-sm font-semibold">{n.titulo}</span>
                      <span className="text-xs text-tenue-fg">{cuando(n.creada_at)}</span>
                    </span>
                    <span className="mt-0.5 block truncate text-sm">{n.subtitulo}</span>
                    <span className="mt-0.5 block truncate text-sm text-tenue-fg">
                      {n.detalle}
                    </span>
                  </span>
                  <span
                    className={cn(
                      'mt-1.5 size-2.5 shrink-0 rounded-full',
                      n.leida ? 'bg-transparent' : 'bg-peligro',
                    )}
                    aria-label={n.leida ? undefined : 'Sin ver'}
                  />
                </button>
              </motion.li>
            )
          })}
        </ul>
      )}

      {/* ── Paginación ── */}
      {datos && datos.total > datos.page_size && (
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-tenue-fg">
            {datos.total} {datos.total === 1 ? 'notificación' : 'notificaciones'} · página{' '}
            {datos.page} de {totalPaginas}
          </p>
          <div className="flex gap-2">
            <Boton
              variante="contorno"
              tamano="sm"
              onClick={() => setPagina((p) => Math.max(1, p - 1))}
              disabled={pagina <= 1}
            >
              <ChevronLeft aria-hidden="true" />
              Anterior
            </Boton>
            <Boton
              variante="contorno"
              tamano="sm"
              onClick={() => setPagina((p) => p + 1)}
              disabled={pagina >= totalPaginas}
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
