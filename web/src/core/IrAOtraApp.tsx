import { useLocation } from 'react-router-dom'

import { destinoEnOtroDominio } from '@/core/dominios'

const CLAVE = 'accumedical:salto-entre-apps'

/**
 * La ruta pedida es de OTRA aplicación del mismo origen (admin ↔ un módulo con
 * su propio frontend, p. ej. `/concurrencia/…`): se carga con una navegación
 * completa del navegador para que nginx la entregue a su app. La sesión viaja
 * con la cookie, así que se llega ya dentro.
 *
 * Con subdominios, `GuardaDeDominio` hace el salto antes de llegar aquí; esto
 * cubre el mismo origen (desarrollo local o un despliegue sin subdominios).
 *
 * Protección contra bucles: si en unos segundos se vuelve a pedir el mismo salto
 * desde aquí, nginx no está enrutando esa ruta a su app; se muestra un aviso en
 * vez de recargar sin fin.
 */
export function IrAOtraApp() {
  const { pathname, search, hash } = useLocation()
  // Con subdominios, la otra app está en otro origen (p. ej. desde
  // concurrencia.pymes.ec, `/admin/…` es de admin.pymes.ec).
  const otroDominio = destinoEnOtroDominio(pathname, `${search}${hash}`)
  if (otroDominio) {
    window.location.replace(otroDominio)
    return null
  }
  const destino = `${pathname}${search}${hash}`
  let repetido = false
  try {
    const previo = JSON.parse(sessionStorage.getItem(CLAVE) ?? 'null') as
      | { destino: string; en: number }
      | null
    repetido = Boolean(previo && previo.destino === destino && Date.now() - previo.en < 5000)
    sessionStorage.setItem(CLAVE, JSON.stringify({ destino, en: Date.now() }))
  } catch {
    /* almacenamiento bloqueado: se intenta el salto igual */
  }
  if (repetido) {
    return (
      <div className="grid min-h-dvh place-items-center bg-fondo px-6 text-center text-sm text-tenue-fg">
        Esta página pertenece a otra aplicación de la plataforma y no se pudo abrir.
      </div>
    )
  }
  window.location.replace(destino)
  return null
}
