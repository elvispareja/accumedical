import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { obtenerDashboard, REFRESCO_MS } from '@concurrencia/api'
import { CuadrosDeVisitas } from '@concurrencia/components/cifras'
import { BandejaPage, type FiltrosDeEntrada } from '@concurrencia/pages/BandejaPage'

/**
 * El panel del supervisor de la aseguradora: las cifras arriba —cuántas
 * visitas hay en cada estado y cuántas tocan hoy— y debajo TODOS los casos con
 * buscador, Desde/Hasta, estado y **operador** (un selector; hasta el
 * 14/10/2026 era una pestaña aparte), con paginación de 25 en 25. Pulsar una
 * cifra no navega: repinta la lista con ese filtro. Todo lo calcula el backend
 * acotado por `aseguradora_id`.
 */
export function DashboardPage() {
  const [filtros, setFiltros] = useState<FiltrosDeEntrada>({})
  // La clave fuerza a la lista a releer el filtro aunque ya pinte otro:
  // pulsar «Culminadas» estando en «Hoy» tiene que repintar, no quedarse igual.
  const [version, setVersion] = useState(0)

  function filtrar(nuevos: FiltrosDeEntrada = {}) {
    setFiltros(nuevos)
    setVersion((v) => v + 1)
  }

  const consulta = useQuery({
    queryKey: ['concurrencia-dashboard'],
    queryFn: obtenerDashboard,
    // Un panel que se queda abierto en la oficina no debe mentir: se refresca solo.
    refetchInterval: REFRESCO_MS,
  })
  const datos = consulta.data

  return (
    <div>
      <header>
        <p className="font-display text-[0.6875rem] font-semibold uppercase tracking-[0.16em] text-tenue-fg">
          Concurrencia
        </p>
        <h1 className="mt-1.5 font-display text-2xl font-semibold tracking-tight">
          Panel de supervisión
        </h1>
        <p className="mt-1 text-sm text-tenue-fg">
          El pulso de las visitas de tu aseguradora, de un vistazo.
        </p>
      </header>

      {/* ── Las cifras: cada una es también un filtro de la lista de abajo ── */}
      <CuadrosDeVisitas
        className="mt-7"
        cifras={datos}
        cargando={consulta.isPending}
        error={consulta.isError}
        onReintentar={() => consulta.refetch()}
        alFiltrar={filtrar}
      />

      {/* ── Todos los casos, aquí mismo ── */}
      <section className="mt-8" aria-label="Casos">
        <div className="flex items-baseline justify-between">
          <h2 className="font-display text-sm font-semibold uppercase tracking-[0.09em] text-tenue-fg">
            Casos
          </h2>
          <button
            type="button"
            onClick={() => filtrar()}
            className="text-sm font-medium text-marca transition-opacity duration-150 hover:opacity-80"
          >
            Quitar filtros
          </button>
        </div>
        <div className="mt-3">
          <BandejaPage key={version} empotrada filtrosIniciales={filtros} />
        </div>
      </section>
    </div>
  )
}
