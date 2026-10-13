import { useQuery } from '@tanstack/react-query'
import { motion, useReducedMotion } from 'framer-motion'
import { Handshake, Map } from 'lucide-react'

import { useNavigate } from 'react-router-dom'

import { aseguradoraPropia } from '@/shared/aseguradoras/api'
import { ConveniosPanel } from '@/shared/aseguradoras/components/ConveniosPanel'
import { Boton } from '@/shared/components/ui/button'
import { useApp } from '@/core/app/contexto'

const EASE: [number, number, number, number] = [0.22, 0.61, 0.36, 1]

/**
 * La red de convenios de ACCUMEDICAL con los prestadores: el mismo mecanismo
 * que la pestaña Convenios de una aseguradora —marcar la red, listado de
 * precios, valores FC—, pero la contraparte es la propia empresa. La dueña es
 * la ficha interna (`es_propia`), que nunca aparece como aseguradora.
 */
export function RedConvenioPage() {
  const { raiz } = useApp()
  const sinMovimiento = useReducedMotion()
  const navegar = useNavigate()
  const propia = useQuery({ queryKey: ['aseguradora-propia'], queryFn: aseguradoraPropia })

  return (
    <div className="w-full">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-display text-[0.6875rem] font-semibold uppercase tracking-[0.16em] text-tenue-fg">
            Administración
          </p>
          <h1 className="mt-1.5 font-display text-2xl font-semibold tracking-tight">
            Red convenio
          </h1>
          <p className="mt-1 text-sm text-tenue-fg">
            Los convenios de Accumedical con los prestadores: marca tu red y captura el
            listado de precios y los valores FC de cada uno.
          </p>
        </div>
        <Boton variante="contorno" onClick={() => navegar(`${raiz}/red-convenio/mapa`)}>
          <Map aria-hidden="true" />
          Mapa
        </Boton>
      </header>

      <motion.section
        initial={sinMovimiento ? { opacity: 0 } : { opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.26, ease: EASE }}
        className="mt-7 rounded-md border border-borde bg-superficie p-5 sm:p-6"
      >
        <h2 className="flex items-center gap-2 font-display text-sm font-semibold">
          <Handshake className="size-4 text-oro" aria-hidden="true" />
          Nuestra red de prestadores
        </h2>
        <p className="mb-5 mt-0.5 text-sm text-tenue-fg">
          Marcar crea el convenio; desmarcar lo retira. «Editar» abre el detalle del
          convenio guardado.
        </p>

        {propia.isPending ? (
          <div className="space-y-2" role="status" aria-label="Cargando la red">
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="h-12 animate-pulse rounded-md bg-tenue" />
            ))}
          </div>
        ) : propia.isError ? (
          <p className="text-sm text-peligro">
            No pudimos cargar la ficha de Accumedical. Recarga la página.
          </p>
        ) : (
          <ConveniosPanel aseguradoraId={propia.data.id} />
        )}
      </motion.section>
    </div>
  )
}
