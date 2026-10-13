/**
 * Qué subdominio sirve cada parte de la plataforma.
 *
 *   VITE_URL_ADMIN      p. ej. https://admin.pymes.ec — login, administración,
 *                       coordinación y todo lo que no sea de un módulo.
 *   VITE_URLS_MODULOS   JSON slug → URL, p. ej. {"concurrencia":"https://concurrencia.pymes.ec"}.
 *                       De ese dominio son las rutas `/<slug>/…` y la
 *                       supervisión del admin `/admin/auditorias/<slug>/…`.
 *
 * Sin VITE_URL_ADMIN (desarrollo local) no hay reparto: todo vive en el mismo
 * origen, como siempre. La sesión se comparte entre subdominios porque el
 * backend pone la cookie en el dominio padre (COOKIE_DOMAIN).
 */

const ADMIN = String(import.meta.env.VITE_URL_ADMIN ?? '').replace(/\/+$/, '')

function leerModulos(): Record<string, string> {
  try {
    const crudo = JSON.parse(String(import.meta.env.VITE_URLS_MODULOS ?? '{}')) as Record<string, string>
    return Object.fromEntries(
      Object.entries(crudo)
        // Solo https y sin barras finales: nada de javascript: ni rutas relativas.
        .filter(([, url]) => /^https:\/\/[a-z0-9.-]+$/i.test(url.replace(/\/+$/, '')))
        .map(([slug, url]) => [slug, url.replace(/\/+$/, '')]),
    )
  } catch {
    return {}
  }
}

const MODULOS = leerModulos()

function esDe(ruta: string, prefijo: string): boolean {
  return ruta === prefijo || ruta.startsWith(`${prefijo}/`)
}

/** El origen (https://…) que debe servir esta ruta, o null si es indiferente. */
export function origenDe(ruta: string): string | null {
  if (!ADMIN) return null
  for (const [slug, url] of Object.entries(MODULOS)) {
    if (esDe(ruta, `/${slug}`) || esDe(ruta, `/admin/auditorias/${slug}`)) return url
  }
  return ADMIN
}

/** La URL completa a la que hay que ir si esta ruta no es de este dominio; si no, null. */
export function destinoEnOtroDominio(ruta: string, resto = ''): string | null {
  const origen = origenDe(ruta)
  if (!origen || origen === window.location.origin) return null
  return `${origen}${ruta}${resto}`
}

/**
 * Si esta ruta es de un MÓDULO servido en otro subdominio, su URL completa; si
 * no, null. Es lo que el menú de admin abre en una PESTAÑA NUEVA (p. ej. las
 * auditorías de Concurrencia desde admin.pymes.ec): admin queda abierto donde
 * estaba. El sentido contrario (de un módulo hacia admin) sigue en la misma
 * pestaña, como siempre.
 */
export function destinoDeModuloEnOtraPestana(ruta: string): string | null {
  const origen = origenDe(ruta)
  if (!origen || origen === ADMIN || origen === window.location.origin) return null
  return `${origen}${ruta}`
}
