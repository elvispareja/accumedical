import { Construction } from 'lucide-react'
import { useParams } from 'react-router-dom'

import { nombreDeRol } from '@/core/auth/roles'
import { useSesion } from '@/core/auth/useSesion'

/** Lo que se ve en un módulo que todavía no tiene pantallas propias. */
export function ModuloPendientePage() {
  const { slug } = useParams<{ slug: string }>()
  const { data: sesion } = useSesion()
  const modulo = sesion?.modulos.find((m) => m.slug === slug)

  return (
    <div className="rounded-md border border-dashed border-borde px-6 py-16 text-center">
      <Construction className="mx-auto size-6 text-tenue-fg" aria-hidden="true" />
      <h1 className="mt-3 font-display text-lg font-semibold">{modulo?.nombre}</h1>
      <p className="mx-auto mt-1 max-w-md text-sm text-tenue-fg">
        Entraste como {nombreDeRol(modulo?.rol, Boolean(sesion?.aseguradora))}. Este módulo todavía no tiene pantallas: se
        construye en su propio hito y aterrizará justo aquí.
      </p>
    </div>
  )
}
