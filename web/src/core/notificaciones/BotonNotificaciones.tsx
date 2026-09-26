import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { Bell, CheckCheck } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { useArea } from '@/core/auth/area'
import { identidadDe } from '@/core/modulos/identidad'
import {
  listarNotificaciones,
  marcarLeida,
  marcarTodasLeidas,
  type BandejaNotificaciones,
  type Notificacion,
} from '@/core/notificaciones/api'
import { cn } from '@/lib/utils'
import { Boton } from '@/shared/components/ui/button'
import { useToast } from '@/shared/components/ui/toast'

const EASE: [number, number, number, number] = [0.22, 0.61, 0.36, 1]
const CLAVE = ['notificaciones'] as const

/**
 * Cada cuánto se pregunta al servidor. El «tiempo real» de esta plataforma es
 * un sondeo corto, no una conexión abierta: funciona a través de nginx, con
 * varios procesos del servidor y sin nada que mantener vivo. Un aviso tarda como
 * mucho este intervalo en aparecer.
 */
const CADA_MS = 15_000

/** «hace 2 min», «hace 3 h», «12/09». Lo justo para situar el aviso. */
function hace(iso: string): string {
  const minutos = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
  if (minutos < 1) return 'ahora mismo'
  if (minutos < 60) return `hace ${minutos} min`
  const horas = Math.round(minutos / 60)
  if (horas < 24) return `hace ${horas} h`
  return new Date(iso).toLocaleDateString('es-EC', { day: '2-digit', month: '2-digit' })
}

export function BotonNotificaciones() {
  const navegar = useNavigate()
  // La lista entera vive en el área de quien mira: `/coordinacion` para quien
  // coordina, `/admin` para el resto. La campana es la misma en las dos.
  const area = useArea()
  const queryClient = useQueryClient()
  const toast = useToast()
  const sinMovimiento = useReducedMotion()
  const [abierto, setAbierto] = useState(false)
  const caja = useRef<HTMLDivElement>(null)
  // Qué avisos ya se conocían. `null` hasta la primera respuesta: entrar no
  // puede disparar una ráfaga de toasts de cosas que llevaban ahí desde ayer.
  const conocidas = useRef<Set<string> | null>(null)

  const bandeja = useQuery({
    queryKey: CLAVE,
    // Sin argumentos: TanStack le pasaría su contexto de consulta como filtros.
    queryFn: () => listarNotificaciones(),
    refetchInterval: CADA_MS,
    // Volver a la pestaña es el momento en que más se quiere estar al día.
    refetchOnWindowFocus: true,
    // Un 401 aquí es «no hay sesión», no un fallo que reintentar.
    retry: false,
  })

  const leer = useMutation({
    mutationFn: marcarLeida,
    onSuccess: (datos: BandejaNotificaciones) => queryClient.setQueryData(CLAVE, datos),
  })
  const leerTodas = useMutation({
    mutationFn: marcarTodasLeidas,
    onSuccess: (datos: BandejaNotificaciones) => queryClient.setQueryData(CLAVE, datos),
  })

  // Cerrar al pulsar fuera o con Esc: el panel no atrapa el foco —no es un
  // diálogo— así que tiene que soltarse con lo que uno espera.
  useEffect(() => {
    if (!abierto) return
    function fuera(evento: MouseEvent) {
      if (!caja.current?.contains(evento.target as Node)) setAbierto(false)
    }
    function tecla(evento: KeyboardEvent) {
      if (evento.key === 'Escape') setAbierto(false)
    }
    document.addEventListener('mousedown', fuera)
    document.addEventListener('keydown', tecla)
    return () => {
      document.removeEventListener('mousedown', fuera)
      document.removeEventListener('keydown', tecla)
    }
  }, [abierto])

  const items = bandeja.data?.items ?? []
  const sinLeer = bandeja.data?.sin_leer ?? 0

  function abrir(n: Notificacion) {
    setAbierto(false)
    if (!n.leida) leer.mutate(n.id)
    navegar(n.url)
  }

  // Lo que llega DESPUÉS de haber entrado se anuncia con un toast abajo a la
  // derecha, pulsable: el punto rojo dice que hay algo, el toast dice qué.
  useEffect(() => {
    const items = bandeja.data?.items
    if (!items) return
    if (conocidas.current === null) {
      conocidas.current = new Set(items.map((n) => n.id))
      return
    }
    const nuevas = items.filter((n) => !n.leida && !conocidas.current!.has(n.id))
    items.forEach((n) => conocidas.current!.add(n.id))
    // De lo más antiguo a lo más nuevo, para que el último quede arriba del todo.
    for (const n of [...nuevas].reverse()) {
      toast.notificacion({
        titulo: n.titulo,
        secundario: `${n.subtitulo} · ${n.detalle}`,
        icono: identidadDe(n.module_code).Icono,
        onAbrir: () => abrir(n),
      })
    }
    // `abrir` y `toast` se rehacen en cada render; disparar por ellos repetiría
    // el aviso sin que haya llegado nada.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bandeja.data])

  return (
    <div className="relative" ref={caja}>
      <Boton
        variante="fantasma"
        tamano="icono"
        onClick={() => setAbierto((v) => !v)}
        aria-expanded={abierto}
        aria-haspopup="true"
        aria-label={
          sinLeer > 0 ? `Notificaciones: ${sinLeer} sin leer` : 'Notificaciones'
        }
        title="Notificaciones"
      >
        <span className="relative grid size-4 place-items-center">
          <Bell aria-hidden="true" />
          {/* Un punto rojo en la esquina y nada más: dice que hay algo sin ver,
              que es lo único que hace falta saber de un vistazo. El cuántas y el
              cuáles están dentro. El anillo del color del fondo lo despega del
              icono para que no se lea como parte de la campana. */}
          {sinLeer > 0 && (
            <span
              className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-peligro ring-2 ring-fondo"
              aria-hidden="true"
            />
          )}
        </span>
      </Boton>

      <AnimatePresence>
        {abierto && (
          <motion.div
            initial={sinMovimiento ? { opacity: 0 } : { opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={sinMovimiento ? { opacity: 0 } : { opacity: 0, y: -6 }}
            transition={{ duration: 0.18, ease: EASE }}
            className={cn(
              'absolute right-0 z-40 mt-2 w-80 overflow-hidden rounded-md sm:w-96',
              'border border-borde bg-superficie shadow-elevada',
            )}
          >
            <div className="flex items-center justify-between gap-2 border-b border-borde px-4 py-2.5">
              <p className="font-display text-sm font-semibold">Notificaciones</p>
              {sinLeer > 0 && (
                <button
                  type="button"
                  onClick={() => leerTodas.mutate()}
                  className="inline-flex items-center gap-1.5 rounded text-xs text-tenue-fg transition-colors duration-150 hover:text-tinta"
                >
                  <CheckCheck className="size-3.5" aria-hidden="true" />
                  Marcar todas
                </button>
              )}
            </div>

            {items.length === 0 ? (
              <div className="px-4 py-10 text-center">
                <Bell className="mx-auto size-5 text-tenue-fg" aria-hidden="true" />
                <p className="mt-2 text-sm text-tenue-fg">No tienes notificaciones.</p>
              </div>
            ) : (
              <ul className="max-h-80 overflow-y-auto">
                {items.map((n) => {
                  const identidad = identidadDe(n.module_code)
                  return (
                    <li key={n.id} className="border-b border-borde last:border-b-0">
                      <button
                        type="button"
                        onClick={() => abrir(n)}
                        className={cn(
                          'flex w-full items-start gap-3 px-4 py-3 text-left',
                          'transition-colors duration-150 hover:bg-tenue',
                          !n.leida && 'bg-peligro-suave/50',
                        )}
                      >
                        <span
                          className={cn(
                            'mt-0.5 grid size-8 shrink-0 place-items-center rounded-md',
                            identidad.suave,
                          )}
                        >
                          <identidad.Icono
                            className={cn('size-4', identidad.texto)}
                            aria-hidden="true"
                          />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-baseline justify-between gap-2">
                            <span className="truncate font-display text-sm font-medium">
                              {n.titulo}
                            </span>
                            <span className="shrink-0 text-[0.6875rem] text-tenue-fg">
                              {hace(n.creada_at)}
                            </span>
                          </span>
                          <span className="mt-0.5 block truncate text-sm text-tenue-fg">
                            {n.subtitulo}
                          </span>
                          <span className="mt-0.5 block truncate text-xs text-tenue-fg">
                            {n.detalle}
                          </span>
                        </span>
                        {!n.leida && (
                          <span
                            className="mt-1.5 size-2 shrink-0 rounded-full bg-peligro"
                            aria-label="Sin leer"
                          />
                        )}
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
            <div className="border-t border-borde px-4 py-2.5 text-center">
              <Link
                to={`${area}/notificaciones`}
                onClick={() => setAbierto(false)}
                className="font-display text-sm font-medium text-marca transition-opacity duration-150 hover:opacity-80"
              >
                Ver todas las notificaciones
              </Link>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
