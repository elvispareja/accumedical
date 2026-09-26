import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import { cn } from '@/lib/utils'
import { fijarSla, listarSla, type SlaModulo } from '@/shared/aseguradoras/api'
import { Boton } from '@/shared/components/ui/button'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { useToast } from '@/shared/components/ui/toast'

function mensajeDeError(error: unknown, porDefecto: string): string {
  const detalle = (error as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
  if (typeof detalle === 'string') return detalle
  if (Array.isArray(detalle) && detalle.length > 0) {
    return (detalle[0] as { mensaje?: string }).mensaje ?? porDefecto
  }
  return porDefecto
}

/** Texto a número, aceptando la coma decimal que se teclea aquí. */
function aNumero(texto: string): number | null {
  const limpio = texto.trim().replace(',', '.')
  if (!limpio) return null
  const valor = Number(limpio)
  return Number.isFinite(valor) && valor >= 0 ? valor : null
}

function aTexto(valor: number | null): string {
  return valor === null || valor === undefined ? '' : String(valor)
}

/** Solo números y una coma o punto decimal: un plazo y un precio no llevan otra cosa. */
function soloNumero(valor: string): string {
  return valor.replace(/[^0-9.,]/g, '').replace(/([.,].*)[.,]/g, '$1')
}

const ETIQUETA_GRUPO: Record<string, string> = {
  suscripcion: 'Suscripción',
  siniestro: 'Siniestro',
}

interface Fila {
  horas: string
  precio: string
}

/**
 * El SLA pactado con la compañía: por cada módulo que ella tiene contratado,
 * cuántas horas y a qué precio.
 *
 * Solo aparecen sus módulos: la lista la arma el servidor, así que marcar uno
 * en la pestaña Módulos lo trae aquí, y destildarlo lo saca **sin borrar lo
 * pactado** —vuelve si se vuelve a marcar—.
 */
export function SlaPanel({ aseguradoraId }: { aseguradoraId: string | null }) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const [filas, setFilas] = useState<Record<string, Fila>>({})

  const sla = useQuery({
    queryKey: ['aseguradora-sla', aseguradoraId],
    queryFn: () => listarSla(aseguradoraId!),
    enabled: Boolean(aseguradoraId),
  })

  // El estado local nace de lo guardado y de ahí en adelante manda el usuario.
  useEffect(() => {
    if (!sla.data) return
    setFilas(
      Object.fromEntries(
        sla.data.map((m) => [m.module_code, { horas: aTexto(m.horas), precio: aTexto(m.precio) }]),
      ),
    )
  }, [sla.data])

  const guardar = useMutation({
    mutationFn: () =>
      fijarSla(
        aseguradoraId!,
        (sla.data ?? []).map((m) => ({
          module_code: m.module_code,
          horas: aNumero(filas[m.module_code]?.horas ?? '') ?? 0,
          precio: aNumero(filas[m.module_code]?.precio ?? '') ?? 0,
        })),
      ),
    onSuccess: (lista) => {
      queryClient.setQueryData(['aseguradora-sla', aseguradoraId], lista)
      toast.exito('SLA guardado')
    },
    onError: (error) => toast.error(mensajeDeError(error, 'No se pudo guardar el SLA')),
  })

  function cambiar(code: string, campo: keyof Fila, valor: string) {
    setFilas((previo) => ({
      ...previo,
      [code]: { ...(previo[code] ?? { horas: '', precio: '' }), [campo]: soloNumero(valor) },
    }))
  }

  /** Qué módulos están a medias. El SLA es obligatorio en todos los contratados. */
  function incompletos(modulos: SlaModulo[]): SlaModulo[] {
    return modulos.filter(
      (m) =>
        aNumero(filas[m.module_code]?.horas ?? '') === null ||
        aNumero(filas[m.module_code]?.precio ?? '') === null,
    )
  }

  if (!aseguradoraId) {
    return (
      <p className="rounded-md border border-dashed border-borde px-4 py-8 text-center text-sm text-tenue-fg">
        Guarda primero la aseguradora: el SLA se pacta sobre la ficha ya creada.
      </p>
    )
  }

  if (sla.isPending) {
    return (
      <div className="space-y-2" role="status" aria-label="Cargando el SLA">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="h-16 animate-pulse rounded-md bg-tenue" />
        ))}
      </div>
    )
  }

  if (sla.isError) {
    return <p className="text-sm text-peligro">No pudimos cargar el SLA.</p>
  }

  const modulos = sla.data ?? []
  if (modulos.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-borde px-4 py-8 text-center text-sm text-tenue-fg">
        Esta aseguradora no tiene ningún módulo contratado. Márcalos en la pestaña Módulos y
        vuelve aquí.
      </p>
    )
  }

  // Agrupados por familia, como en la pestaña Módulos: se lee igual en las dos.
  const familias = [...new Set(modulos.map((m) => m.grupo ?? ''))]
  const faltan = incompletos(modulos)

  function enviar() {
    if (faltan.length > 0) {
      return toast.error(
        `Falta el SLA de: ${faltan.map((m) => m.module_nombre).join(', ')}. ` +
          'Es obligatorio en cada módulo contratado',
      )
    }
    guardar.mutate()
  }

  return (
    <div className="space-y-5">
      {familias.map((familia) => (
        <div key={familia || 'sin-familia'}>
          {familia && (
            <p className="mb-2.5 font-display text-xs font-semibold uppercase tracking-[0.09em] text-tenue-fg">
              {ETIQUETA_GRUPO[familia] ?? familia}
            </p>
          )}
          <div className="space-y-3">
            {modulos
              .filter((m) => (m.grupo ?? '') === familia)
              .map((m: SlaModulo) => (
                <div
                  key={m.module_code}
                  className="grid items-end gap-4 rounded-md border border-borde p-4 sm:grid-cols-[1fr_9rem_9rem]"
                >
                  {/* `pb-2.5` alinea el nombre con los campos y no con el borde
                      de la fila: sin él queda hundido bajo las etiquetas. */}
                  <p className="truncate font-display text-sm font-medium sm:pb-2.5">
                    {m.module_nombre}
                  </p>
                  <div className="space-y-2">
                    <Label htmlFor={`horas-${m.module_code}`}>Horas</Label>
                    <Input
                      id={`horas-${m.module_code}`}
                      inputMode="decimal"
                      value={filas[m.module_code]?.horas ?? ''}
                      onChange={(e) => cambiar(m.module_code, 'horas', e.target.value)}
                      placeholder="24"
                      className="tabular"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor={`precio-${m.module_code}`}>Precio</Label>
                    <Input
                      id={`precio-${m.module_code}`}
                      inputMode="decimal"
                      value={filas[m.module_code]?.precio ?? ''}
                      onChange={(e) => cambiar(m.module_code, 'precio', e.target.value)}
                      placeholder="35,00"
                      className="tabular"
                    />
                  </div>
                </div>
              ))}
          </div>
        </div>
      ))}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p
          className={cn('text-xs', faltan.length > 0 ? 'text-peligro' : 'text-tenue-fg')}
          aria-live="polite"
        >
          {faltan.length > 0
            ? `Falta el SLA de ${faltan.length} módulo${faltan.length === 1 ? '' : 's'}: ` +
              faltan.map((m) => m.module_nombre).join(', ')
            : `${modulos.length} módulo${modulos.length === 1 ? '' : 's'} contratado${
                modulos.length === 1 ? '' : 's'
              }, todos con su SLA.`}
        </p>
        <Boton type="button" onClick={enviar} cargando={guardar.isPending}>
          Guardar SLA
        </Boton>
      </div>
    </div>
  )
}
