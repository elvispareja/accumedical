import { useLocation } from 'react-router-dom'

import { urlDelLogin } from '@/core/dominios'

/**
 * `/login` dentro de una app propia (D50): el login es UNO, el de admin, pero se
 * le pide volver a la página que se quería ver en ESTA app, y muestra su nombre
 * («Iniciar sesión en Convenios»). `RequireSession` deja en `state.desde` la
 * ruta pedida (relativa a la app).
 */
export function IrAlLogin() {
  const { state } = useLocation()
  const desde = (state as { desde?: string } | null)?.desde ?? '/'
  const base = import.meta.env.BASE_URL.replace(/\/$/, '')
  window.location.replace(urlDelLogin(`${window.location.origin}${base}${desde}`))
  return null
}
