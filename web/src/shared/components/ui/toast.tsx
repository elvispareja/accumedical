import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { AlertCircle, Bell, CheckCircle2, type LucideIcon } from 'lucide-react'
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'

import { cn } from '@/lib/utils'

const EASE: [number, number, number, number] = [0.22, 0.61, 0.36, 1]
const DURACION_MS = 4500
// El aviso de una notificación dura más: no confirma algo que acabas de hacer,
// te cuenta algo que pasó por su cuenta, y hay que darte tiempo a leerlo y a
// decidir si lo abres.
const DURACION_NOTIFICACION_MS = 8000

type Tono = 'exito' | 'error' | 'notificacion'

interface Aviso {
  id: number
  tono: Tono
  mensaje: string
  /** Segunda línea, más tenue. Hoy solo la usan las notificaciones. */
  secundario?: string
  /** Si viene, el aviso entero es pulsable. */
  onAbrir?: () => void
  icono?: LucideIcon
}

/** Lo que hace falta para anunciar una notificación que acaba de llegar. */
export interface AvisoNotificacion {
  titulo: string
  secundario: string
  icono?: LucideIcon
  onAbrir: () => void
}

const Contexto = createContext<{
  exito: (mensaje: string) => void
  error: (mensaje: string) => void
  notificacion: (aviso: AvisoNotificacion) => void
} | null>(null)

export function useToast() {
  const ctx = useContext(Contexto)
  if (!ctx) throw new Error('useToast necesita estar dentro de <ToastProvider>')
  return ctx
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [avisos, setAvisos] = useState<Aviso[]>([])
  const siguienteId = useRef(0)
  const sinMovimiento = useReducedMotion()

  const anadir = useCallback((aviso: Omit<Aviso, 'id'>, duracion: number) => {
    const id = siguienteId.current++
    setAvisos((previos) => [...previos, { ...aviso, id }])
    window.setTimeout(() => {
      setAvisos((previos) => previos.filter((a) => a.id !== id))
    }, duracion)
  }, [])

  const cerrar = useCallback((id: number) => {
    setAvisos((previos) => previos.filter((a) => a.id !== id))
  }, [])

  const valor = useMemo(
    () => ({
      exito: (mensaje: string) => anadir({ tono: 'exito', mensaje }, DURACION_MS),
      error: (mensaje: string) => anadir({ tono: 'error', mensaje }, DURACION_MS),
      notificacion: (aviso: AvisoNotificacion) =>
        anadir(
          {
            tono: 'notificacion',
            mensaje: aviso.titulo,
            secundario: aviso.secundario,
            icono: aviso.icono,
            onAbrir: aviso.onAbrir,
          },
          DURACION_NOTIFICACION_MS,
        ),
    }),
    [anadir],
  )

  return (
    <Contexto.Provider value={valor}>
      {children}
      {/* aria-live para que el lector de pantalla anuncie el resultado de la
          acción: sin esto, quien no ve la pantalla no se entera de que guardó.
          Y lo mismo vale para una notificación que entra sola. */}
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2"
      >
        <AnimatePresence initial={false}>
          {avisos.map((aviso) => {
            const Icono =
              aviso.icono ??
              (aviso.tono === 'exito' ? CheckCircle2 : aviso.tono === 'error' ? AlertCircle : Bell)
            const cuerpo = (
              <>
                <Icono
                  className={cn(
                    'mt-px size-4 shrink-0',
                    aviso.tono === 'exito'
                      ? 'text-exito'
                      : aviso.tono === 'error'
                        ? 'text-peligro'
                        : 'text-marca',
                  )}
                  aria-hidden="true"
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-[0.8125rem] font-medium leading-snug text-tinta">
                    {aviso.mensaje}
                  </span>
                  {aviso.secundario && (
                    <span className="mt-0.5 block truncate text-[0.8125rem] leading-snug text-tenue-fg">
                      {aviso.secundario}
                    </span>
                  )}
                </span>
              </>
            )
            const clases = cn(
              'pointer-events-auto flex w-full items-start gap-2.5 rounded-md border px-4 py-3 text-left',
              'bg-superficie shadow-elevada',
              // El aviso que entra solo se distingue del que confirma una acción:
              // el borde de marca dice «esto no lo hiciste tú».
              aviso.tono === 'notificacion' ? 'border-marca/40' : 'border-borde',
            )

            return (
              <motion.div
                key={aviso.id}
                layout={!sinMovimiento}
                initial={sinMovimiento ? { opacity: 0 } : { opacity: 0, y: 12, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={sinMovimiento ? { opacity: 0 } : { opacity: 0, y: 8, scale: 0.98 }}
                transition={{ duration: 0.24, ease: EASE }}
              >
                {aviso.onAbrir ? (
                  <button
                    type="button"
                    onClick={() => {
                      aviso.onAbrir?.()
                      cerrar(aviso.id)
                    }}
                    className={cn(clases, 'transition-colors duration-150 hover:bg-tenue')}
                  >
                    {cuerpo}
                  </button>
                ) : (
                  <div className={clases}>{cuerpo}</div>
                )}
              </motion.div>
            )
          })}
        </AnimatePresence>
      </div>
    </Contexto.Provider>
  )
}
