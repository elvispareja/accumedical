import axios from 'axios'

/**
 * Cliente único de la plataforma. Todos los hooks de TanStack Query lo usan, de
 * modo que la protección CSRF es transparente y no depende de que nadie se acuerde.
 *
 * `withCredentials` es imprescindible: la sesión viaja en una cookie httpOnly que
 * el JavaScript no puede leer. Nunca se guarda un token en localStorage.
 */
export const api = axios.create({
  baseURL: '/api/v1',
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
})

const METODOS_MUTANTES = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

function leerCookie(nombre: string): string | undefined {
  const escapado = nombre.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return document.cookie.match(new RegExp(`(?:^|;\\s*)${escapado}=([^;]+)`))?.[1]
}

api.interceptors.request.use((config) => {
  if (METODOS_MUTANTES.has((config.method ?? 'get').toUpperCase())) {
    // El nombre depende de COOKIE_PREFIX: `__Host-` en un solo dominio, `__Secure-`
    // con la sesión compartida entre subdominios (COOKIE_DOMAIN, D33: `__Host-`
    // prohíbe Domain) y sin prefijo en desarrollo. Faltar uno aquí deja TODA
    // escritura con sesión de navegador en 403 (pasó con `__Secure-`).
    const csrf =
      leerCookie('__Host-csrf_token') ?? leerCookie('__Secure-csrf_token') ?? leerCookie('csrf_token')
    if (csrf) config.headers['X-CSRF-Token'] = decodeURIComponent(csrf)
  }
  return config
})
