import { Outlet, useLocation } from 'react-router-dom'

import { destinoEnOtroDominio } from '@/core/dominios'

/**
 * Envuelve TODAS las rutas: si la ruta pedida es de otro subdominio (p. ej. la
 * supervisión de Concurrencia abierta desde admin.pymes.ec), se va allí con una
 * navegación completa del navegador. La sesión viaja con la cookie del dominio
 * padre, así que se llega ya dentro.
 */
export function GuardaDeDominio() {
  const { pathname, search, hash } = useLocation()
  const destino = destinoEnOtroDominio(pathname, `${search}${hash}`)
  if (destino) {
    window.location.replace(destino)
    return null
  }
  return <Outlet />
}
