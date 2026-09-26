import { keepPreviousData, useQuery } from '@tanstack/react-query'

import {
  listarPrestadores,
  obtenerPrestador,
  type FiltrosPrestadores,
} from '@/shared/prestadores/api'

export const CLAVES = {
  lista: (filtros: FiltrosPrestadores) => ['prestadores', filtros] as const,
  detalle: (id: string) => ['prestador', id] as const,
}

export function usePrestadores(filtros: FiltrosPrestadores) {
  return useQuery({
    queryKey: CLAVES.lista(filtros),
    queryFn: () => listarPrestadores(filtros),
    // Al paginar o filtrar se conservan los datos anteriores mientras llega la
    // página nueva: la tabla no parpadea a vacío en cada pulsación.
    placeholderData: keepPreviousData,
  })
}

export function usePrestador(id: string | null) {
  return useQuery({
    queryKey: CLAVES.detalle(id ?? ''),
    queryFn: () => obtenerPrestador(id!),
    enabled: Boolean(id),
  })
}
