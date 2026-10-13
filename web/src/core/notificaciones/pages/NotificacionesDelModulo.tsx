import { useLocation } from 'react-router-dom'

import { useSesion } from '@/core/auth/useSesion'
import { NotificacionesPage } from '@/core/notificaciones/pages/NotificacionesPage'

/**
 * `/<slug>/notificaciones`: la lista de avisos de ESE módulo, dentro de su app
 * (D47). El slug sale de la dirección y el `code` de la sesión, que es quien
 * sabe qué módulos tiene cada uno.
 */
export function NotificacionesDelModulo() {
  const { pathname } = useLocation()
  const { data: sesion } = useSesion()
  const slug = pathname.split('/')[1]
  const modulo = sesion?.modulos.find((m) => m.slug === slug)
  if (!modulo) return null
  return <NotificacionesPage key={modulo.codigo} moduloFijo={modulo.codigo} />
}
