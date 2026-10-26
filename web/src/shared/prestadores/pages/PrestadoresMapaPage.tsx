import { ArrowLeft } from 'lucide-react'
import { Link } from 'react-router-dom'

import { MapaPrestadores } from '@/shared/mapa/MapaPrestadores'
import { useApp } from '@/core/app/contexto'

/**
 * El catálogo entero de prestadores sobre el mapa del Ecuador. Se llega con el
 * botón «Mapa» del listado, y se vuelve por donde se vino.
 */
export function PrestadoresMapaPage() {
  const { raiz } = useApp()
  return (
    <div className="w-full">
      <Link
        to={`${raiz}/prestadores`}
        className="inline-flex items-center gap-1.5 rounded text-sm text-tenue-fg transition-colors duration-150 hover:text-tinta"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Prestadores
      </Link>

      <header className="mt-3">
        <p className="font-display text-[0.6875rem] font-semibold uppercase tracking-[0.16em] text-tenue-fg">
          Administración
        </p>
        <h1 className="mt-1.5 font-display text-2xl font-semibold tracking-tight">
          Prestadores en el mapa
        </h1>
        <p className="mt-1 text-sm text-tenue-fg">
          Un punto por cada sitio donde se atiende: el del prestador y el de cada una de sus
          sedes. Elige una provincia o una ciudad para acotar el mapa, y busca el prestador
          por su nombre o código.
        </p>
      </header>

      <div className="mt-6">
        <MapaPrestadores />
      </div>
    </div>
  )
}
