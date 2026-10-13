import { useQuery } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import { Link } from 'react-router-dom'

import { aseguradoraPropia } from '@/shared/aseguradoras/api'
import { MapaPrestadores } from '@/shared/mapa/MapaPrestadores'
import { useApp } from '@/core/app/contexto'

/**
 * La red de Accumedical sobre el mapa: **solo los prestadores con convenio
 * vivo**, no el catálogo entero. La contraparte es la ficha interna
 * (`es_propia`), la misma que arma la red en la pantalla anterior.
 */
export function RedConvenioMapaPage() {
  const { raiz } = useApp()
  const propia = useQuery({ queryKey: ['aseguradora-propia'], queryFn: aseguradoraPropia })

  return (
    <div className="w-full">
      <Link
        to={`${raiz}/red-convenio`}
        className="inline-flex items-center gap-1.5 rounded text-sm text-tenue-fg transition-colors duration-150 hover:text-tinta"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Red convenio
      </Link>

      <header className="mt-3">
        <p className="font-display text-[0.6875rem] font-semibold uppercase tracking-[0.16em] text-tenue-fg">
          Administración
        </p>
        <h1 className="mt-1.5 font-display text-2xl font-semibold tracking-tight">
          Nuestra red en el mapa
        </h1>
        <p className="mt-1 text-sm text-tenue-fg">
          Los prestadores con convenio vigente con Accumedical, con un punto por cada sitio
          donde atienden. Elige una provincia y al lado quedan los suyos; elige una ciudad y
          quedan solo los de esa ciudad.
        </p>
      </header>

      <div className="mt-6">
        {propia.isPending ? (
          <div
            className="h-[34rem] animate-pulse rounded-md bg-tenue"
            role="status"
            aria-label="Cargando la red"
          />
        ) : propia.isError ? (
          <p className="text-sm text-peligro">
            No pudimos cargar la ficha de Accumedical. Recarga la página.
          </p>
        ) : (
          <MapaPrestadores aseguradoraId={propia.data.id} />
        )}
      </div>
    </div>
  )
}
