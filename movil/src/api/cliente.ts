import Constants from 'expo-constants'
import { Platform } from 'react-native'

import { leerToken } from '../sesion/almacen'

/**
 * A dónde apunta la app. En orden:
 *
 * 1. `extra.apiUrl` de app.json — para un teléfono físico o producción.
 * 2. El emulador de Android ve el `localhost` de la máquina como 10.0.2.2.
 * 3. iOS (simulador) y el resto: localhost.
 *
 * En un teléfono físico Android por USB no hace falta exponer nada a la red:
 * `adb reverse tcp:8080 tcp:8080` hace que el localhost del teléfono sea el de
 * la máquina, y entonces `extra.apiUrl` = http://localhost:8080 funciona.
 */
function baseUrl(): string {
  const configurada = (Constants.expoConfig?.extra as { apiUrl?: string } | undefined)?.apiUrl
  if (configurada) return configurada
  if (Platform.OS === 'android') return 'http://10.0.2.2:8080'
  return 'http://localhost:8080'
}

/** La URL absoluta de una ruta de la API, para descargas fuera de `api()`. */
export function urlDeApi(ruta: string): string {
  return `${baseUrl()}/api/v1${ruta}`
}

export class ErrorDeApi extends Error {
  constructor(
    public readonly status: number,
    detalle: string,
  ) {
    super(detalle)
  }
}

/**
 * Todas las llamadas pasan por aquí: la base, el JSON y el token de sesión en
 * `Authorization: Bearer`, leído del llavero del sistema en cada petición. El
 * backend trata ese token exactamente como la cookie del navegador: misma
 * sesión en servidor, misma expiración, misma revocación inmediata.
 */
export async function api<T>(
  ruta: string,
  opciones: { metodo?: 'GET' | 'POST' | 'PATCH' | 'DELETE'; cuerpo?: unknown; conToken?: boolean } = {},
): Promise<T> {
  const { metodo = 'GET', cuerpo, conToken = true } = opciones
  // Un FormData (el audio del dictado) viaja como multipart: fetch pone solo el
  // Content-Type con su boundary; fijarlo a mano lo rompería.
  const esFormulario = typeof FormData !== 'undefined' && cuerpo instanceof FormData
  const cabeceras: Record<string, string> = esFormulario
    ? {}
    : { 'Content-Type': 'application/json' }
  if (conToken) {
    const token = await leerToken()
    if (token) cabeceras.Authorization = `Bearer ${token}`
  }

  const respuesta = await fetch(`${baseUrl()}/api/v1${ruta}`, {
    method: metodo,
    headers: cabeceras,
    body: cuerpo === undefined ? undefined : esFormulario ? cuerpo : JSON.stringify(cuerpo),
  })

  if (!respuesta.ok) {
    let detalle = 'Algo salió mal. Vuelve a intentarlo.'
    try {
      const datos = (await respuesta.json()) as { detail?: unknown }
      if (typeof datos.detail === 'string') detalle = datos.detail
    } catch {
      // sin cuerpo JSON: se queda el mensaje genérico
    }
    throw new ErrorDeApi(respuesta.status, detalle)
  }
  if (respuesta.status === 204) return undefined as T
  return (await respuesta.json()) as T
}
