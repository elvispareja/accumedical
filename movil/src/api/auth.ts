import { api } from './cliente'
import { borrarToken, guardarToken } from '../sesion/almacen'

export interface ModuloDelUsuario {
  codigo: string
  slug: string
  nombre: string
  rol: string
}

export interface Sesion {
  user: { id: string; email: string; nombre_completo: string }
  aseguradora: { nombre: string; tiene_logo: boolean } | null
  modulos: ModuloDelUsuario[]
  token: string | null
}

/**
 * Login con `cliente: "movil"`: el backend responde el token de sesión UNA vez
 * en el cuerpo —sin cookies— y aquí se guarda de inmediato en el llavero. La
 * sesión resultante es la misma que la del navegador: opaca, en servidor y
 * revocable en el acto.
 */
export async function iniciarSesion(email: string, password: string): Promise<Sesion> {
  const sesion = await api<Sesion>('/auth/login', {
    metodo: 'POST',
    cuerpo: { email, password, cliente: 'movil' },
    conToken: false,
  })
  if (!sesion.token) throw new Error('El servidor no entregó el token de sesión')
  await guardarToken(sesion.token)
  return sesion
}

/** La sesión viva, si el token del llavero sigue siendo válido. */
export async function sesionActual(): Promise<Sesion> {
  return api<Sesion>('/auth/me')
}

/** Revoca en el SERVIDOR y solo después limpia el llavero. */
export async function cerrarSesion(): Promise<void> {
  try {
    await api<void>('/auth/logout', { metodo: 'POST' })
  } finally {
    await borrarToken()
  }
}
