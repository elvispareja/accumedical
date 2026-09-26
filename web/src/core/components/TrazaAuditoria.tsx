import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { useEffect, useMemo, useState } from 'react'

const EASE: [number, number, number, number] = [0.22, 0.61, 0.36, 1]

/** Registros ilustrativos: entidades y acciones del dominio, sin ningún dato real. */
const EVENTOS = [
  { entidad: 'Póliza', accion: 'verificada' },
  { entidad: 'Prestador', accion: 'validado' },
  { entidad: 'Expediente', accion: 'auditado' },
  { entidad: 'Carta de crédito', accion: 'aprobada' },
  { entidad: 'Convenio', accion: 'revisado' },
  { entidad: 'Siniestro', accion: 'conciliado' },
  { entidad: 'Aseguradora', accion: 'actualizada' },
  { entidad: 'Acceso a módulo', accion: 'registrado' },
] as const

const VISIBLES = 5
const PASO_MS = 2800
const SEGUNDOS_ENTRE_EVENTOS = 41

function reloj(base: number, desplazamiento: number) {
  const d = new Date(base + desplazamiento * SEGUNDOS_ENTRE_EVENTOS * 1000)
  return [d.getHours(), d.getMinutes(), d.getSeconds()]
    .map((n) => String(n).padStart(2, '0'))
    .join(':')
}

/**
 * Traza de auditoría: el motivo visual del login. No es decoración abstracta —
 * es la representación del AuditLog, que es la columna vertebral del producto.
 * Cada cierto tiempo entra un registro nuevo por arriba y el más antiguo se
 * desvanece por abajo, como una bitácora viva.
 */
export function TrazaAuditoria() {
  const sinMovimiento = useReducedMotion()
  const [paso, setPaso] = useState(0)

  // Se ancla una sola vez al montar: las horas avanzan con el contador, no con el reloj real.
  const base = useMemo(() => Date.now() - VISIBLES * SEGUNDOS_ENTRE_EVENTOS * 1000, [])

  useEffect(() => {
    if (sinMovimiento) return
    const id = window.setInterval(() => setPaso((p) => p + 1), PASO_MS)
    return () => window.clearInterval(id)
  }, [sinMovimiento])

  const filas = Array.from({ length: VISIBLES }, (_, k) => {
    const indice = (((paso - k) % EVENTOS.length) + EVENTOS.length) % EVENTOS.length
    const evento = EVENTOS[indice]!
    return {
      clave: `${indice}-${Math.floor((paso - k) / EVENTOS.length)}`,
      hora: reloj(base, paso - k),
      ...evento,
    }
  })

  return (
    <div className="w-full max-w-sm">
      <div className="mb-4 flex items-center gap-2.5">
        <span className="relative flex size-1.5">
          {!sinMovimiento && (
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-300/70" />
          )}
          <span className="relative inline-flex size-1.5 rounded-full bg-emerald-300" />
        </span>
        <span className="font-display text-[0.6875rem] font-semibold uppercase tracking-[0.16em] text-white/55">
          Traza de auditoría
        </span>
      </div>

      <ul className="relative space-y-px" aria-hidden="true">
        {/* Línea de tiempo: la trazabilidad, dibujada. */}
        <span className="pointer-events-none absolute left-[0.4375rem] top-2 bottom-2 w-px bg-gradient-to-b from-white/25 via-white/12 to-transparent" />

        <AnimatePresence initial={false} mode="popLayout">
          {filas.map((fila, indice) => (
            <motion.li
              key={fila.clave}
              layout={!sinMovimiento}
              initial={sinMovimiento ? { opacity: 0 } : { opacity: 0, y: -14, filter: 'blur(3px)' }}
              animate={{
                opacity: 1 - indice * 0.16,
                y: 0,
                filter: 'blur(0px)',
                transition: { duration: 0.28, ease: EASE },
              }}
              exit={
                sinMovimiento
                  ? { opacity: 0 }
                  : { opacity: 0, y: 10, filter: 'blur(3px)', transition: { duration: 0.22, ease: EASE } }
              }
              className="relative flex items-center gap-3 py-[0.4375rem] pl-6"
            >
              <span className="absolute left-0 top-1/2 grid size-3.5 -translate-y-1/2 place-items-center rounded-full border border-emerald-300/50 bg-[hsl(168_60%_9%)]">
                <motion.svg
                  viewBox="0 0 24 24"
                  className="size-2 text-emerald-300"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <motion.path
                    d="m4 12.5 5.5 5.5L20 6"
                    initial={sinMovimiento ? { pathLength: 1 } : { pathLength: 0 }}
                    animate={{ pathLength: 1 }}
                    transition={{ duration: 0.34, delay: 0.1, ease: EASE }}
                  />
                </motion.svg>
              </span>

              <span className="tabular font-mono text-[0.6875rem] text-white/45">{fila.hora}</span>
              <span className="min-w-0 flex-1 truncate font-display text-[0.8125rem] text-white/85">
                {fila.entidad}
              </span>
              <span className="shrink-0 rounded-sm border border-emerald-300/25 bg-emerald-300/10 px-1.5 py-0.5 font-mono text-[0.625rem] lowercase text-emerald-200/90">
                {fila.accion}
              </span>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
    </div>
  )
}
