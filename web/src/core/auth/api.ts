import { api } from '@/core/api/client'

export interface ModuloDelUsuario {
  codigo: string
  slug: string
  nombre: string
  icono: string
  color_acento: string
  orden: number
  rol: string
}

export interface Sesion {
  user: {
    id: string
    email: string
    nombre_completo: string
    es_admin_global: boolean
    /**
     * La función transversal, si la tiene. Sirve para pintar solo lo suyo en el
     * armazón; JAMÁS autoriza: cada request lo revalida el servidor.
     */
    funcion: 'convenio' | 'contabilidad' | null
    /**
     * La familia que coordina, si es coordinador de PLATAFORMA. `null` en todos
     * los demás, incluido el coordinador de una aseguradora. Mismo aviso que
     * `funcion`: pinta, no autoriza.
     */
    grupo_coordinado: 'siniestro' | 'suscripcion' | null
  }
  /**
   * La compañía del usuario, para pintar su marca en el armazón. `null` para el
   * personal de plataforma. El logo no viaja aquí: se pide a
   * `/auth/mi-aseguradora/logo`, que solo sirve el de la propia compañía.
   */
  aseguradora: { nombre: string; tiene_logo: boolean } | null
  modulos: ModuloDelUsuario[]
  ultimo_modulo_usado: string | null
  modulo_activo: string | null
  permisos: string[]
  /** A dónde entra el usuario. Lo decide el backend, nunca el frontend. */
  redireccion: string
}

export async function iniciarSesion(credenciales: { email: string; password: string }) {
  const { data } = await api.post<Sesion>('/auth/login', credenciales)
  return data
}

/**
 * Única fuente de verdad de la sesión. Los guards consultan esto contra el
 * backend; ningún flag local sustituye esta llamada.
 */
export async function obtenerSesion() {
  const { data } = await api.get<Sesion>('/auth/me')
  return data
}

export async function cerrarSesion() {
  await api.post('/auth/logout')
}

export async function cambiarModulo(slug: string) {
  const { data } = await api.post<Sesion>('/auth/modulo-activo', { slug })
  return data
}
