import type { ReactNode } from 'react'
import { Navigate, useLocation, useParams } from 'react-router-dom'

import { useSesion } from '@/core/auth/useSesion'
import { SinAccesoApp } from '@/core/pages/SinAccesoApp'

/**
 * Comprueba que el módulo de la RUTA esté entre los del usuario.
 *
 * Es solo para no pintar una pantalla a la que no se puede entrar: **no
 * autoriza nada**. La autorización la ejerce el backend en cada petición, contra
 * `user_module_access` y sin cachear, de modo que revocar un acceso surte efecto
 * al instante aunque esta pantalla siga abierta.
 *
 * Sin el módulo, la app no se abre: aviso «No tienes acceso» (D52). Con un
 * subdominio por app, el nombre de la app ya está a la vista; ocultarlo no
 * protegía nada.
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
  // Cada app es independiente (D52): sin el módulo, no se entra. Ni selector de
  // módulos ni otra puerta: un aviso claro y nada más.
  if (!sesion.modulos.some((m) => m.slug === slug)) return <SinAccesoApp />

  return <>{children}</>
}
