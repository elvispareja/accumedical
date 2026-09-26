import { api } from '@/core/api/client'

export interface Invitacion {
  nombre_completo: string
  email: string
}

/**
 * Rutas públicas: quien abre la invitación todavía no tiene contraseña, así que
 * no puede tener sesión. El token del enlace es la credencial.
 */
export async function leerInvitacion(token: string) {
  const { data } = await api.get<Invitacion>('/auth/invitacion', { params: { token } })
  return data
}

export async function definirPassword(token: string, password: string) {
  await api.post('/auth/definir-password', { token, password })
}
