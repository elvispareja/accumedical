import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo } from 'react'

import { PanelDeRed, type SocioDeConvenio } from '@/shared/convenios/PanelDeRed'
import { useToast } from '@/shared/components/ui/toast'
import {
  fijarConveniosDelPrestador,
  listarConveniosDelPrestador,
  type ConvenioAseguradora,
} from '@/shared/prestadores/api'

function mensajeDeError(error: unknown, porDefecto: string): string {
  const detalle = (error as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
  return typeof detalle === 'string' ? detalle : porDefecto
}

/** Traduce una compañía del catálogo a la ficha que el panel marca. */
function traducir(c: ConvenioAseguradora): SocioDeConvenio {
  return {
    id: c.aseguradora_id,
    // Por su razón social, que es como se lista en toda la plataforma.
    titulo: c.razon_social,
    subtitulo: [c.codigo_interno, c.nombre_comercial, c.ruc, c.ciudad_nombre]
      .filter(Boolean)
      .join(' · '),
    marcado: c.marcado,
    convenioId: c.convenio_id,
    listadoNombre: c.listado_precios_nombre,
    redPrivada: c.red_privada,
    redPublica: c.red_publica,
  }
}

/**
 * La red del prestador: con qué ASEGURADORAS tiene convenio. Es el espejo de la
 * pestaña Convenios de la aseguradora —misma pieza, misma tabla, misma
 * mecánica—, leída desde este lado.
 *
 * La ficha interna de Accumedical no aparece aquí, como en ningún listado de
 * compañías: su red se arma en «Red convenio». Guardar desde esta pantalla
 * tampoco la toca.
 */
export function ConveniosPanel({ prestadorId }: { prestadorId: string | null }) {
  const toast = useToast()
  const queryClient = useQueryClient()

  const convenios = useQuery({
    queryKey: ['prestador-convenios', prestadorId],
    queryFn: () => listarConveniosDelPrestador(prestadorId!),
    enabled: Boolean(prestadorId),
  })
  const socios = useMemo(() => (convenios.data ?? []).map(traducir), [convenios.data])

  const guardar = useMutation({
    mutationFn: (marcados: { id: string; redPrivada: boolean; redPublica: boolean }[]) =>
      fijarConveniosDelPrestador(
        prestadorId!,
        marcados.map((m) => ({
          aseguradora_id: m.id,
          red_privada: m.redPrivada,
          red_publica: m.redPublica,
        })),
      ),
    onSuccess: (lista) => {
      queryClient.setQueryData(['prestador-convenios', prestadorId], lista)
      toast.exito('Red de aseguradoras guardada')
    },
    onError: (error) => toast.error(mensajeDeError(error, 'No se pudo guardar la red')),
  })

  if (!prestadorId) {
    return (
      <p className="rounded-md border border-dashed border-borde px-4 py-8 text-center text-sm text-tenue-fg">
        Guarda primero el prestador: su red se marca sobre la ficha ya creada.
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
      onListadoSubido={(aseguradoraId, listado_precios_nombre) =>
        queryClient.setQueryData<ConvenioAseguradora[]>(
          ['prestador-convenios', prestadorId],
          (lista) =>
            lista?.map((c) =>
              c.aseguradora_id === aseguradoraId ? { ...c, listado_precios_nombre } : c,
            ),
        )
      }
      identificadores={(aseguradoraId) => ({ aseguradoraId, prestadorId })}
      textos={{
        buscar: 'Buscar por razón social, nombre comercial, código o RUC',
        sinNada: 'Todavía no hay aseguradoras registradas en la plataforma.',
        sinCoincidencias: 'Ninguna aseguradora coincide con la búsqueda.',
        contador: 'en la red',
      }}
    />
  )
}
