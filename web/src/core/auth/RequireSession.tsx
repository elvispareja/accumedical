import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'

import { useSesion } from '@/core/auth/useSesion'

/**
 * Guard de sesión. Consulta /auth/me contra el backend: el frontend solo oculta
 * o muestra interfaz, la autorización de verdad la ejerce el servidor en cada
 * petición. Ningún estado local decide si alguien está autenticado.
 */
export function RequireSession({ children }: { children: ReactNode }) {
  const { data, isPending, isError } = useSesion()
  const ubicacion = useLocation()

  if (isPending) {
    return (
      <div className="grid min-h-dvh place-items-center bg-fondo px-6">
        <div className="w-full max-w-sm space-y-3" role="status" aria-label="Comprobando sesión">
          <div className="h-3 w-28 animate-pulse rounded bg-tenue" />
          <div className="h-10 animate-pulse rounded bg-tenue" />
          <div className="h-10 w-2/3 animate-pulse rounded bg-tenue" />
        </div>
      </div>
    )
  }

  if (isError || !data) {
    return <Navigate to="/login" replace state={{ desde: ubicacion.pathname }} />
  }

  return <>{children}</>
}
