import { useQuery } from '@tanstack/react-query'
import { RotateCw, UserRound } from 'lucide-react'
import { useState, type ReactNode } from 'react'

import { cn } from '@/lib/utils'
import { listarOperadores, obtenerDashboard } from '@/modules/concurrencia/api'
import { CuadrosDeVisitas } from '@/modules/concurrencia/components/cifras'
import { BandejaPage, type FiltrosDeEntrada } from '@/modules/concurrencia/pages/BandejaPage'
import { Boton } from '@/shared/components/ui/button'
import { Select } from '@/shared/components/ui/select'

/**
 * El panel del supervisor de la aseguradora, en dos pestañas: **Historial**,
 * con las cifras arriba —cuántas visitas hay en cada estado y cuántas tocan
 * hoy— y debajo TODOS los casos con buscador (paciente, documento o código),
 * filtros de fecha y paginación de 25 en 25; y **Operadores**, donde primero
 * se elige un operador y se ven SOLO los casos que él creó, con los mismos
 * filtros. Pulsar una cifra no navega a ningún sitio: repinta la lista de
 * abajo con ese filtro puesto. Todo lo calcula el backend acotado por
 * `aseguradora_id`.
 */
export function DashboardPage() {
  const [pestana, setPestana] = useState<'historial' | 'operadores'>('historial')
  const [filtros, setFiltros] = useState<FiltrosDeEntrada>({})
  // La clave fuerza a la lista a releer el filtro aunque ya pinte otro:
  // pulsar «Culminadas» estando en «Hoy» tiene que repintar, no quedarse igual.
  const [version, setVersion] = useState(0)
  const [operador, setOperador] = useState('')

  function filtrar(nuevos: FiltrosDeEntrada = {}) {
    setFiltros(nuevos)
    setVersion((v) => v + 1)
    setPestana('historial')
  }

  const consulta = useQuery({
    queryKey: ['concurrencia-dashboard'],
    queryFn: obtenerDashboard,
    // Un panel que se queda abierto en la oficina no debe mentir: se refresca solo.
    refetchInterval: 60_000,
  })
  const datos = consulta.data

  // La lista de operadores solo hace falta al abrir su pestaña.
  const operadores = useQuery({
    queryKey: ['concurrencia-operadores'],
    queryFn: listarOperadores,
    enabled: pestana === 'operadores',
    staleTime: 60_000,
  })

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

      <div
        role="tablist"
        aria-label="Vistas del panel"
        className="mt-6 flex gap-1 border-b border-borde"
      >
        <Pestana activa={pestana === 'historial'} onClick={() => setPestana('historial')}>
          Historial
        </Pestana>
        <Pestana activa={pestana === 'operadores'} onClick={() => setPestana('operadores')}>
          Operadores
        </Pestana>
      </div>

      {pestana === 'operadores' ? (
        <section className="mt-6" aria-label="Casos por operador">
          <div className="max-w-sm">
            <label
              htmlFor="operador"
              className="font-display text-xs font-medium uppercase tracking-[0.09em] text-tenue-fg"
            >
              Operador
            </label>
            <Select
              id="operador"
              value={operador}
              onChange={(e) => setOperador(e.target.value)}
              disabled={operadores.isPending}
              className="mt-2"
            >
              <option value="">
                {operadores.isPending ? 'Cargando operadores…' : 'Elige un operador'}
              </option>
              {operadores.data?.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.nombre_completo}
                  {o.activo ? '' : ' (inactivo)'}
                </option>
              ))}
            </Select>
          </div>

          {operadores.isError ? (
            <div className="mt-5 rounded-md border border-borde bg-superficie px-6 py-10 text-center">
              <p className="text-sm text-tenue-fg">No pudimos cargar los operadores.</p>
              <Boton
                variante="contorno"
                tamano="sm"
                onClick={() => operadores.refetch()}
                className="mt-3"
              >
                <RotateCw aria-hidden="true" />
                Reintentar
              </Boton>
            </div>
          ) : operador ? (
            // La clave reinicia búsqueda, filtros y página al cambiar de operador.
            <div className="mt-5">
              <BandejaPage key={operador} empotrada creadoPor={operador} />
            </div>
          ) : (
            <div className="mt-5 rounded-md border border-dashed border-borde px-6 py-14 text-center">
              <UserRound className="mx-auto size-6 text-tenue-fg" aria-hidden="true" />
              <p className="mt-3 font-display text-sm font-medium">Elige un operador</p>
              <p className="mx-auto mt-1 max-w-sm text-sm text-tenue-fg">
                Verás solo los casos que ese operador creó, con los mismos filtros de siempre.
              </p>
            </div>
          )}
        </section>
      ) : (
        <>
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
        </>
      )}
    </div>
  )
}

/** Una pestaña del panel: subrayado con el color de marca cuando está activa. */
function Pestana({
  activa,
  onClick,
  children,
}: {
  activa: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={activa}
      onClick={onClick}
      className={cn(
        '-mb-px border-b-2 px-3 pb-2.5 pt-1 font-display text-sm font-medium transition-colors duration-150',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-marca',
        activa ? 'border-marca text-tinta' : 'border-transparent text-tenue-fg hover:text-tinta',
      )}
    >
      {children}
    </button>
  )
}
