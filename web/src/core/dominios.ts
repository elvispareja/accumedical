/**
 * Qué subdominio sirve cada parte de la plataforma.
 *
 *   VITE_URL_ADMIN      p. ej. https://admin.pymes.ec — login, administración,
 *                       coordinación y todo lo que no sea de un módulo.
 *   VITE_URLS_MODULOS   JSON slug → URL, p. ej. {"concurrencia":"https://concurrencia.pymes.ec"}.
 *                       De ese dominio son las rutas lógicas `/<slug>/…`; en su
 *                       subdominio el prefijo `/<slug>` se quita (lo dice el subdominio).
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

/** El slug del módulo con subdominio propio al que pertenece esta ruta lógica. */
function moduloDe(ruta: string): string | null {
  return Object.keys(MODULOS).find((slug) => esDe(ruta, `/${slug}`)) ?? null
}

/** El origen (https://…) que debe servir esta ruta, o null si es indiferente. */
export function origenDe(ruta: string): string | null {
  if (!ADMIN) return null
  const slug = moduloDe(ruta)
  return slug ? (MODULOS[slug] ?? ADMIN) : ADMIN
}

/**
 * La dirección REAL de una ruta lógica. En toda la plataforma (avisos guardados,
 * menús, la redirección del login) un caso se nombra `/concurrencia/…`; en su
 * subdominio ese prefijo sobra, porque el subdominio ya lo dice (pedido del
 * usuario): `/concurrencia/supervision/7` → `https://concurrencia.pymes.ec/supervision/7`.
 */
function urlReal(origen: string, ruta: string, resto = ''): string {
  const slug = moduloDe(ruta)
  const enSuSubdominio = slug && MODULOS[slug] === origen
  const camino = enSuSubdominio ? ruta.slice(slug.length + 1) || '/' : ruta
  return `${origen}${camino}${resto}`
}

/** La URL completa a la que hay que ir si esta ruta no es de este dominio; si no, null. */
export function destinoEnOtroDominio(ruta: string, resto = ''): string | null {
  const origen = origenDe(ruta)
  if (!origen || origen === window.location.origin) return null
  return urlReal(origen, ruta, resto)
}

/**
 * Abre una ruta lógica (p. ej. el destino de un aviso): si es de OTRA app —otro
 * subdominio—, en una PESTAÑA NUEVA y la actual se queda donde está (pedido del
 * usuario); si es de esta misma app, con `navegar`, como cualquier enlace.
 */
export function abrirRuta(ruta: string, navegar: (ruta: string) => void): void {
  const vigente = rutaVigente(ruta)
  const otra = destinoEnOtroDominio(vigente)
  if (otra) window.open(otra, '_blank', 'noopener')
  else navegar(vigente)
}

/**
 * Avisos guardados ANTES de D45 apuntan a la supervisión vieja dentro de admin
 * (`/admin/auditorias/<slug>/<caso>`); hoy ese caso vive en su módulo.
 */
function rutaVigente(ruta: string): string {
  const vieja = /^\/admin\/auditorias\/([a-z0-9-]+)(?:\/([^/?#]+))?/.exec(ruta)
  if (!vieja) return ruta
  const [, slug, caso] = vieja
  if (!caso || caso === 'programar') return `/${slug}/${caso ?? 'dashboard'}`
  return `/${slug}/supervision/${caso}`
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
  return urlReal(origen, ruta)
}

/** Nombre visible de cada app con frontend propio, para el login (D50). */
const NOMBRES: Record<string, string> = {
  concurrencia: 'Concurrencia',
  pacientes: 'Pacientes',
  convenios: 'Convenios',
  contabilidad: 'Contabilidad',
}

/**
 * La dirección a la que volver tras el login, SOLO si es de una app de la
 * plataforma: el origen de admin o el de un módulo conocido (VITE_URLS_MODULOS),
 * o una ruta interna en el mismo origen. Cualquier otra cosa → null. Es la
 * defensa contra la redirección abierta (`/login?volver=https://malo.com`).
 */
export function volverSeguro(valor: string | null): { url: string; app: string | null } | null {
  if (!valor) return null
  if (valor.startsWith('/') && !valor.startsWith('//') && !valor.startsWith('/\\')) {
    return { url: valor, app: null }
  }
  let url: URL
  try {
    url = new URL(valor)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' || url.username || url.password) return null
  if (ADMIN && url.origin === ADMIN) return { url: url.href, app: null }
  const slug = Object.entries(MODULOS).find(([, origen]) => origen === url.origin)?.[0]
  return slug ? { url: url.href, app: NOMBRES[slug] ?? slug } : null
}

/** El login (siempre el de admin) pidiendo volver a `volver` después. */
export function urlDelLogin(volver: string): string {
  return `${ADMIN}/login?volver=${encodeURIComponent(volver)}`
}
