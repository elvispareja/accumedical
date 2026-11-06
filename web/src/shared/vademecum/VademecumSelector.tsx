import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { Boton } from '@/shared/components/ui/button'
import { Checkbox } from '@/shared/components/ui/checkbox'
import { Modal } from '@/shared/components/ui/modal'
import { buscarVademecum, vademecumPorCodigos } from '@/shared/vademecum/api'
import { FILTRO_VACIO, FiltrosVademecum, type ValoresFiltro } from '@/shared/vademecum/Filtros'
import { DatosMedicamento, useTextoDiferido } from '@/shared/vademecum/pages/VademecumPage'

/**
 * Elegir el **vademécum de un producto** (6/11/2026, M5): qué medicamentos del
 * maestro cubre. Se busca y filtra (p. ej. nivel de prescripción G + vía oral,
 * lo que receta un médico general) y se marcan uno a uno o todos los mostrados.
 * Lo elegido se guarda con la ficha («Guardar cambios»).
 */
export function VademecumSelector({
  abierto,
  onCerrar,
  producto,
  elegidos,
  onCambiar,
}: {
  abierto: boolean
  onCerrar: () => void
  producto: string
  elegidos: string[]
  onCambiar: (codigos: string[]) => void
}) {
  const [filtro, setFiltro] = useState<ValoresFiltro>(FILTRO_VACIO)
  const [soloElegidos, setSoloElegidos] = useState(false)
  const q = useTextoDiferido(filtro.texto)
  const seleccion = new Set(elegidos)

  const resultados = useQuery({
    queryKey: ['vademecum', 'selector', q, filtro.forma, filtro.via, filtro.nivel],
    queryFn: () =>
      buscarVademecum({
        q: q.length >= 2 ? q : undefined,
        forma: filtro.forma,
        via: filtro.via,
        nivel_prescripcion: filtro.nivel,
        limit: 1000,
      }),
    enabled: abierto && !soloElegidos,
  })
  const deLosElegidos = useQuery({
    queryKey: ['vademecum', 'codigos', [...elegidos].sort().join(',')],
    queryFn: () => vademecumPorCodigos(elegidos),
    enabled: abierto && soloElegidos,
  })
  const filas = (soloElegidos ? deLosElegidos.data : resultados.data) ?? []
  const cargando = soloElegidos ? deLosElegidos.isLoading : resultados.isLoading

  function alternar(codigo: string, marcado: boolean) {
    const siguiente = new Set(seleccion)
    if (marcado) siguiente.add(codigo)
    else siguiente.delete(codigo)
    onCambiar([...siguiente].sort())
  }

  function todosLosMostrados(marcar: boolean) {
    const siguiente = new Set(seleccion)
    for (const m of filas) {
      if (marcar && m.activo) siguiente.add(m.codigo)
      if (!marcar) siguiente.delete(m.codigo)
    }
    onCambiar([...siguiente].sort())
  }

  return (
    <Modal
      abierto={abierto}
      onCerrar={onCerrar}
      titulo={`Vademécum de ${producto || 'este producto'}`}
      ancho="max-w-4xl"
    >
      <div className="space-y-4">
        <p className="text-sm text-tenue-fg">
          Marque los medicamentos del vademécum maestro que cubre este producto. Para lo que receta
          un médico general por teleconsulta, filtre «Nivel G» y «O - Oral» y marque todos los
          mostrados.
        </p>
        {!soloElegidos && <FiltrosVademecum prefijo="selector" valor={filtro} onCambiar={setFiltro} />}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Checkbox
            id="selector-solo-elegidos"
            compacto
            checked={soloElegidos}
            onChange={setSoloElegidos}
            titulo={`Ver solo los elegidos (${elegidos.length})`}
          />
          <div className="flex gap-2">
            <Boton type="button" variante="contorno" tamano="sm" onClick={() => todosLosMostrados(true)}>
              Marcar los {filas.length} mostrados
            </Boton>
            <Boton type="button" variante="contorno" tamano="sm" onClick={() => todosLosMostrados(false)}>
              Desmarcar los mostrados
            </Boton>
          </div>
        </div>
        <div className="max-h-[50vh] overflow-y-auto rounded-md border border-borde">
          {cargando ? (
            <div className="space-y-2 p-3" role="status" aria-label="Buscando">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-12 animate-pulse rounded-md bg-tenue" />
              ))}
            </div>
          ) : filas.length === 0 ? (
            <p className="p-6 text-center text-sm text-tenue-fg">
              {soloElegidos ? 'Todavía no hay medicamentos elegidos.' : 'Ningún medicamento coincide.'}
            </p>
          ) : (
            <ul className="divide-y divide-borde">
              {filas.map((m) => (
                <li key={m.codigo} className="flex items-start gap-3 px-3 py-2.5">
                  <input
                    type="checkbox"
                    id={`vad-${m.codigo}`}
                    checked={seleccion.has(m.codigo)}
                    disabled={!m.activo && !seleccion.has(m.codigo)}
                    onChange={(e) => alternar(m.codigo, e.target.checked)}
                    className="mt-1 size-4 shrink-0 accent-marca"
                  />
                  <label htmlFor={`vad-${m.codigo}`} className="min-w-0 cursor-pointer">
                    <DatosMedicamento m={m} />
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-borde pt-4">
          <p className="text-sm">
            <span className="font-medium tabular">{elegidos.length}</span>{' '}
            {elegidos.length === 1 ? 'medicamento elegido' : 'medicamentos elegidos'}
          </p>
          <Boton type="button" onClick={onCerrar}>
            Listo
          </Boton>
        </div>
        <p className="text-xs text-tenue-fg">Se guarda con «Guardar cambios» de la ficha.</p>
      </div>
    </Modal>
  )
}
