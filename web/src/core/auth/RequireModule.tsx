import type { ReactNode } from 'react'
import { Navigate, useLocation, useParams } from 'react-router-dom'

import { useSesion } from '@/core/auth/useSesion'

/**
 * Comprueba que el módulo de la RUTA esté entre los del usuario.
 *
 * Es solo para no pintar una pantalla a la que no se puede entrar: **no
 * autoriza nada**. La autorización la ejerce el backend en cada petición, contra
 * `user_module_access` y sin cachear, de modo que revocar un acceso surte efecto
 * al instante aunque esta pantalla siga abierta.
 *
 * Un slug desconocido y uno sin permiso llevan al mismo sitio a propósito: así
 * la interfaz tampoco delata qué módulos existen.
 */
export function RequireModule({ children, slug: fijo }: { children: ReactNode; slug?: string }) {
  // La ruta de un módulo con pantallas propias es estática (`/concurrencia`),
  // así que no hay parámetro que leer: se recibe el slug o se toma el primer
  // segmento de la dirección.
  const { slug: parametro } = useParams<{ slug: string }>()
  const { pathname } = useLocation()
  const slug = fijo ?? parametro ?? pathname.split('/')[1]
  const { data: sesion, isPending } = useSesion()

  if (isPending) {
    return (
      <div className="grid min-h-dvh place-items-center bg-fondo px-6">
        <div className="w-full max-w-sm space-y-3" role="status" aria-label="Comprobando accesos">
          <div className="h-3 w-28 animate-pulse rounded bg-tenue" />
          <div className="h-10 animate-pulse rounded bg-tenue" />
        </div>
      </div>
    )
  }

  if (!sesion) return <Navigate to="/login" replace />
  if (sesion.modulos.length === 0) return <Navigate to="/sin-accesos" replace />
  if (!sesion.modulos.some((m) => m.slug === slug)) {
    return <Navigate to="/seleccionar-modulo" replace />
  }

  return <>{children}</>
}
