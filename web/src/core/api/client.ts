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
    // En producción la cookie lleva el prefijo __Host-; en desarrollo no, porque
    // ese prefijo exige Secure y el entorno local va por http.
    const csrf = leerCookie('__Host-csrf_token') ?? leerCookie('csrf_token')
    if (csrf) config.headers['X-CSRF-Token'] = decodeURIComponent(csrf)
  }
  return config
})
