import { ArrowLeft } from 'lucide-react'
import { Link } from 'react-router-dom'

import { MapaAseguradoras } from '@/shared/mapa/MapaAseguradoras'

/**
 * Las compañías sobre el mapa del Ecuador. Se llega con el botón «Mapa» del
 * listado, y se vuelve por donde se vino.
 */
export function AseguradorasMapaPage() {
  return (
    <div className="w-full">
      <Link
        to="/admin/aseguradoras"
        className="inline-flex items-center gap-1.5 rounded text-sm text-tenue-fg transition-colors duration-150 hover:text-tinta"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Aseguradoras
      </Link>

      <header className="mt-3">
        <p className="font-display text-[0.6875rem] font-semibold uppercase tracking-[0.16em] text-tenue-fg">
          Administración
        </p>
        <h1 className="mt-1.5 font-display text-2xl font-semibold tracking-tight">
          Aseguradoras en el mapa
        </h1>
        <p className="mt-1 text-sm text-tenue-fg">
          Un punto por compañía, en su domicilio. Elige una provincia y al lado quedan las
          suyas; elige una ciudad y quedan solo las de esa ciudad.
        </p>
      </header>

      <div className="mt-6">
        <MapaAseguradoras />
      </div>
    </div>
  )
}
