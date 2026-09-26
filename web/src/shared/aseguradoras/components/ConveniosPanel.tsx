import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo } from 'react'

import {
  fijarConvenios,
  listarConvenios,
  type ConvenioPrestador,
} from '@/shared/aseguradoras/api'
import { PanelDeRed, type SocioDeConvenio } from '@/shared/convenios/PanelDeRed'
import { useToast } from '@/shared/components/ui/toast'

function mensajeDeError(error: unknown, porDefecto: string): string {
  const detalle = (error as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
  return typeof detalle === 'string' ? detalle : porDefecto
}

/** Traduce un prestador del catálogo a la ficha que el panel marca. */
function traducir(c: ConvenioPrestador): SocioDeConvenio {
  return {
    id: c.prestador_id,
    titulo: c.nombre,
    subtitulo: [c.codigo_interno, c.tipo_nombre, c.ciudad_nombre].filter(Boolean).join(' · '),
    marcado: c.marcado,
    convenioId: c.convenio_id,
    listadoNombre: c.listado_precios_nombre,
    redPrivada: c.red_privada,
    redPublica: c.red_publica,
  }
}

/**
 * La red de la aseguradora: qué PRESTADORES tienen convenio con ella. La
 * mecánica entera la pone `PanelDeRed`, que es la misma pieza que usa el
 * prestador para lo simétrico; aquí solo se dice qué se lista y contra qué
 * endpoints se guarda.
 */
export function ConveniosPanel({ aseguradoraId }: { aseguradoraId: string | null }) {
  const toast = useToast()
  const queryClient = useQueryClient()

  const convenios = useQuery({
    queryKey: ['aseguradora-convenios', aseguradoraId],
    queryFn: () => listarConvenios(aseguradoraId!),
    enabled: Boolean(aseguradoraId),
  })
  const socios = useMemo(() => (convenios.data ?? []).map(traducir), [convenios.data])

  const guardar = useMutation({
    mutationFn: (marcados: { id: string; redPrivada: boolean; redPublica: boolean }[]) =>
      fijarConvenios(
        aseguradoraId!,
        marcados.map((m) => ({
          prestador_id: m.id,
          red_privada: m.redPrivada,
          red_publica: m.redPublica,
        })),
      ),
    onSuccess: (lista) => {
      queryClient.setQueryData(['aseguradora-convenios', aseguradoraId], lista)
      toast.exito('Red de prestadores guardada')
    },
    onError: (error) => toast.error(mensajeDeError(error, 'No se pudo guardar la red')),
  })

  if (!aseguradoraId) {
    return (
      <p className="rounded-md border border-dashed border-borde px-4 py-8 text-center text-sm text-tenue-fg">
        Guarda primero la aseguradora: su red se marca sobre la ficha ya creada.
      </p>
    )
  }

  return (
    <PanelDeRed
      socios={socios}
      cargando={convenios.isPending}
      error={convenios.isError}
      guardando={guardar.isPending}
      onGuardar={(marcados) => guardar.mutate(marcados)}
      onListadoSubido={(prestadorId, listado_precios_nombre) =>
        queryClient.setQueryData<ConvenioPrestador[]>(
          ['aseguradora-convenios', aseguradoraId],
          (lista) =>
            lista?.map((c) =>
              c.prestador_id === prestadorId ? { ...c, listado_precios_nombre } : c,
            ),
        )
      }
      identificadores={(prestadorId) => ({ aseguradoraId, prestadorId })}
      textos={{
        buscar: 'Buscar por nombre, código, tipo o ciudad',
        sinNada: 'Todavía no hay prestadores registrados en la plataforma.',
        sinCoincidencias: 'Ningún prestador coincide con la búsqueda.',
        contador: 'en la red',
      }}
    />
  )
}
