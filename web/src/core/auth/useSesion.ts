import { useQuery } from '@tanstack/react-query'

import { obtenerSesion } from '@/core/auth/api'

export const CLAVE_SESION = ['sesion'] as const

/**
 * La sesión se pregunta SIEMPRE al backend. `retry: false` porque un 401 es una
 * respuesta legítima ("no hay sesión"), no un fallo transitorio que reintentar.
 */
export function useSesion() {
  return useQuery({
    queryKey: CLAVE_SESION,
    queryFn: obtenerSesion,
    retry: false,
    staleTime: 15_000,
    refetchOnWindowFocus: true,
  })
}
