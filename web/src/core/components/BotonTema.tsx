import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { Moon, Sun } from 'lucide-react'

import { useTema } from '@/core/theme/tema'
import { Boton } from '@/shared/components/ui/button'

export function BotonTema({ className }: { className?: string }) {
  const { tema, alternar } = useTema()
  const sinMovimiento = useReducedMotion()
  const oscuro = tema === 'oscuro'

  return (
    <Boton
      variante="fantasma"
      tamano="icono"
      onClick={alternar}
      className={className}
      aria-label={oscuro ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro'}
      title={oscuro ? 'Tema claro' : 'Tema oscuro'}
    >
      <span className="relative grid size-4 place-items-center">
        <AnimatePresence initial={false} mode="wait">
          <motion.span
            key={tema}
            initial={sinMovimiento ? { opacity: 0 } : { opacity: 0, rotate: -70, scale: 0.7 }}
            animate={sinMovimiento ? { opacity: 1 } : { opacity: 1, rotate: 0, scale: 1 }}
            exit={sinMovimiento ? { opacity: 0 } : { opacity: 0, rotate: 70, scale: 0.7 }}
            transition={{ duration: 0.18, ease: [0.22, 0.61, 0.36, 1] }}
            className="absolute inset-0 grid place-items-center"
          >
            {oscuro ? <Moon aria-hidden="true" /> : <Sun aria-hidden="true" />}
          </motion.span>
        </AnimatePresence>
      </span>
    </Boton>
  )
}
