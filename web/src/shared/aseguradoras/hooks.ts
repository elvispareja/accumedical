import { keepPreviousData, useQuery } from '@tanstack/react-query'

import {
  listarAseguradoras,
  obtenerAseguradora,
  obtenerAseguradoraBasica,
  type AseguradoraDetalle,
  type FiltrosAseguradoras,
} from '@/shared/aseguradoras/api'

export const CLAVES = {
  lista: (filtros: FiltrosAseguradoras) => ['aseguradoras', filtros] as const,
  detalle: (id: string) => ['aseguradora', id] as const,
}

export function useAseguradoras(filtros: FiltrosAseguradoras) {
  return useQuery({
    queryKey: CLAVES.lista(filtros),
    queryFn: () => listarAseguradoras(filtros),
    // Al paginar o filtrar se conservan los datos anteriores mientras llega la
    // página nueva: la tabla no parpadea a vacío en cada pulsación.
    placeholderData: keepPreviousData,
  })
}

/**
 * Cuánta ficha recibe quien mira, que no es lo mismo para todos:
 *
 *   completo → el administrador global y la función «contabilidad».
 *   basico   → la función «convenio»: solo el nombre, para encabezar su red.
 *
 * No es una cortesía de la interfaz: cada vista es una RUTA distinta con su
 * propia dependencia, y el servidor no serviría la otra.
 */
export type VistaAseguradora = 'completo' | 'basico'

export function useAseguradora(id: string | null, vista: VistaAseguradora = 'completo') {
  return useQuery({
    queryKey: [...CLAVES.detalle(id ?? ''), vista],
    queryFn: async (): Promise<AseguradoraDetalle> => {
      if (vista === 'completo') return obtenerAseguradora(id!)
      const basico = await obtenerAseguradoraBasica(id!)
      return { id: basico.id, razon_social: basico.nombre } as AseguradoraDetalle
    },
    enabled: Boolean(id),
  })
}
