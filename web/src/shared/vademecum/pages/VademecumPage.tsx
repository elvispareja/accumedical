import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import { Boton } from '@/shared/components/ui/button'
import { buscarVademecum, filtrosVademecum, POR_PAGINA, type Medicamento } from '@/shared/vademecum/api'
import { FILTRO_VACIO, FiltrosVademecum, type ValoresFiltro } from '@/shared/vademecum/Filtros'

function mensajeDeError(error: unknown, porDefecto: string): string {
  const detalle = (error as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
  return typeof detalle === 'string' ? detalle : porDefecto
}

/** Espera a que se deje de teclear: una consulta por pulsación es ruido. */
export function useTextoDiferido(texto: string): string {
  const [diferido, setDiferido] = useState(texto)
  useEffect(() => {
    const t = window.setTimeout(() => setDiferido(texto.trim()), 300)
    return () => window.clearTimeout(t)
  }, [texto])
  return diferido
}

export function DatosMedicamento({ m }: { m: Medicamento }) {
  return (
    <div className="min-w-0">
      <p className="text-sm font-medium">
        {m.nombre}
        {!m.activo && <span className="ml-2 text-xs text-peligro">(retirado del Cuadro)</span>}
      </p>
      <p className="mt-0.5 text-xs text-tenue-fg">
        <span className="tabular">{m.codigo}</span> · ATC {m.codigo_atc}
        {m.forma_farmaceutica ? ` · ${m.forma_farmaceutica}` : ''}
        {m.via ? ` · ${m.via}` : ''}
        {m.nivel_prescripcion ? ` · prescripción ${m.nivel_prescripcion}` : ''}
      </p>
    </div>
  )
}

/**
 * **Vademécum** en admin.pymes.ec (6/11/2026): el maestro de medicamentos de
 * AccuMedical, para consultarlo. Es el de la central —el mismo para todas las
 * apps—; de él salen el vademécum de cada producto y las listas de precios de
 * las farmacias. Aquí solo se consulta: se carga desde el Cuadro Nacional.
 */
export function VademecumPage() {
  const [filtro, setFiltro] = useState<ValoresFiltro>(FILTRO_VACIO)
  const q = useTextoDiferido(filtro.texto)
  const filtros = useQuery({ queryKey: ['vademecum', 'filtros'], queryFn: filtrosVademecum, staleTime: Infinity })
  const resultados = useInfiniteQuery({
    queryKey: ['vademecum', 'pagina', q, filtro.forma, filtro.via, filtro.nivel],
    queryFn: ({ pageParam }) =>
      buscarVademecum({
        q: q.length >= 2 ? q : undefined,
        forma: filtro.forma,
        via: filtro.via,
        nivel_prescripcion: filtro.nivel,
        limit: POR_PAGINA,
        offset: pageParam,
      }),
    initialPageParam: 0,
    getNextPageParam: (ultima, todas) =>
      ultima.length === POR_PAGINA ? todas.length * POR_PAGINA : undefined,
  })
  const filas = resultados.data?.pages.flat() ?? []

  return (
    <div className="w-full">
      <header>
        <p className="font-display text-[0.6875rem] font-semibold uppercase tracking-[0.16em] text-tenue-fg">
          Catálogos
        </p>
        <h1 className="mt-1.5 font-display text-2xl font-semibold tracking-tight">Vademécum</h1>
        <p className="mt-1 max-w-3xl text-sm text-tenue-fg">
          El maestro de medicamentos de AccuMedical, uno para todas las apps: de aquí salen el
          vademécum de cada producto y las listas de precios de las farmacias.
          {filtros.data
            ? ` ${filtros.data.total.toLocaleString('es-EC')} medicamentos · fuente: ${filtros.data.fuente ?? '—'} (Cuadro Nacional de Medicamentos Básicos del MSP).`
            : ''}
        </p>
      </header>

      <div className="mt-6 rounded-md border border-borde bg-superficie p-4 sm:p-5">
        <FiltrosVademecum prefijo="vademecum" valor={filtro} onCambiar={setFiltro} />
      </div>

      <section className="mt-6" aria-label="Medicamentos">
        {resultados.isError ? (
          <p className="text-sm text-tenue-fg">
            {mensajeDeError(resultados.error, 'No pudimos consultar el vademécum.')}
          </p>
        ) : resultados.isLoading ? (
          <div className="space-y-2" role="status" aria-label="Buscando">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-14 animate-pulse rounded-md bg-tenue" />
            ))}
          </div>
        ) : filas.length === 0 ? (
          <div className="rounded-md border border-dashed border-borde p-8 text-center">
            <p className="font-medium">Ningún medicamento coincide</p>
            <p className="mt-1 text-sm text-tenue-fg">
              Pruebe con menos palabras o con el inicio de una («amoxi» encuentra «amoxicilina»).
            </p>
          </div>
        ) : (
          <>
            <p className="mb-2 text-xs text-tenue-fg">
              {filas.length}
              {resultados.hasNextPage ? '+' : ''} {filas.length === 1 ? 'medicamento' : 'medicamentos'}
            </p>
            <ul className="divide-y divide-borde overflow-hidden rounded-md border border-borde bg-superficie">
              {filas.map((m) => (
                <li key={m.codigo} className="px-4 py-3">
                  <DatosMedicamento m={m} />
                </li>
              ))}
            </ul>
            {resultados.hasNextPage && (
              <div className="mt-4 flex justify-center">
                <Boton
                  variante="contorno"
                  onClick={() => resultados.fetchNextPage()}
                  cargando={resultados.isFetchingNextPage}
                >
                  Ver más
                </Boton>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  )
}
