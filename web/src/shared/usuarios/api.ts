import { api } from '@/core/api/client'

// El personal de la plataforma: usuarios del propio administrador, sin
// aseguradora. Desde el 14/10/2026 cada persona tiene UN ROL EN CADA
// APLICACIÓN (o ninguno) y, aparte, puede llevar UNA función transversal:
//
//   por aplicación → auditor · coordinador (varios por app) · call center
//                    (solo donde la app lo admite).
//   función        → convenio · contabilidad (una persona a la vez en cada una).
//
// Ejemplo: Mario es coordinador de Calificación y además Convenio; un auditor
// de Concurrencia puede coordinar Vida. Quitar algo NUNCA lo borra: su tramo
// se cierra en el historial de accesos.
export type RolEnApp = 'auditor' | 'coordinador' | 'call_center'
export type FuncionPlataforma = 'convenio' | 'contabilidad'
export type GrupoPlataforma = 'suscripcion' | 'siniestro'
export const ETIQUETA_GRUPO: Record<GrupoPlataforma, string> = {
  suscripcion: 'Suscripción',
  siniestro: 'Siniestro',
}
export const ETIQUETA_ROL: Record<string, string> = {
  auditor: 'Auditor',
  coordinador: 'Coordinador',
  call_center: 'Call center',
  operador: 'Operador',
  consulta: 'Consulta',
  convenio: 'Convenio',
  contabilidad: 'Contabilidad',
}

/** Una aplicación a la que entra HOY, con su rol. */
export interface AsignacionApp {
  module_code: string
  module_nombre: string
  rol: string
}

/** A qué entra HOY, ya resuelto por el servidor. */
export interface AccesoPlataforma {
  aplicaciones: AsignacionApp[]
  funcion: FuncionPlataforma | null
  /** «Coordinador de Calificación de Riesgo · Convenio». */
  resumen: string
}

/** Lo que el formulario envía: cada app con su rol, y la función si la tiene. */
export interface AccesoPlataformaCuerpo {
  aplicaciones: { module_code: string; rol: RolEnApp }[]
  funcion: FuncionPlataforma | null
}

export interface UsuarioPlataforma {
  id: string
  nombre_principal: string
  nombre_secundario: string | null
  apellido_paterno: string
  apellido_materno: string | null
  /** Ya compuesto por el servidor, para enseñarlo sin recomponer nada. */
  nombre_completo: string
  email: string
  tipo_documento_codigo: string | null
  tipo_documento_nombre: string | null
  numero_documento: string | null
  telefono: string | null
  provincia_codigo: string | null
  provincia_nombre: string | null
  ciudad_codigo: string | null
  ciudad_nombre: string | null
  is_active: boolean
  password_definida: boolean
  invitacion_pendiente: boolean
  ultimo_acceso: string | null
  acceso: AccesoPlataforma
}

/**
 * Lo que el formulario envía. Obligatorios: nombre principal, apellido paterno
 * y correo; el nombre secundario y el apellido materno viajan como null si no
 * se escriben.
 */
export interface UsuarioPlataformaCuerpo {
  nombre_principal: string
  nombre_secundario: string | null
  apellido_paterno: string
  apellido_materno: string | null
  email: string
  tipo_documento_codigo: string | null
  numero_documento: string | null
  telefono: string | null
  /** Dónde está: al derivar un caso se ofrecen primero los auditores cercanos. */
  provincia_codigo: string | null
  ciudad_codigo: string | null
  acceso: AccesoPlataformaCuerpo
}

/** Un tramo del historial: qué rol tuvo alguien, dónde, desde y hasta cuándo. */
export interface Tramo {
  user_id: string
  nombre: string
  email: string | null
  rol: string
  rol_etiqueta: string
  desde: string
  hasta: string | null
  vigente: boolean
  otorgado_por: string | null
  retirado_por: string | null
}

export interface HistorialDeApp {
  module_code: string
  module_nombre: string
  tramos: Tramo[]
}

export interface TramoDeUsuario extends Tramo {
  ambito: 'aplicacion' | 'funcion' | 'compania'
  donde: string
}

/** Por aplicación: quién la coordina, audita o atiende hoy, y quién antes. */
export async function historialPorAplicacion() {
  const { data } = await api.get<HistorialDeApp[]>('/shared/usuarios/historial-por-aplicacion')
  return data
}

/** La trayectoria de una persona: cada rol que tuvo, dónde y cuándo. */
export async function historialDeUsuario(id: string) {
  const { data } = await api.get<TramoDeUsuario[]>(`/shared/usuarios/${id}/historial`)
  return data
}

export async function listarUsuariosPlataforma() {
  const { data } = await api.get<UsuarioPlataforma[]>('/shared/usuarios')
  return data
}

export async function obtenerUsuarioPlataforma(id: string) {
  const { data } = await api.get<UsuarioPlataforma>(`/shared/usuarios/${id}`)
  return data
}

export async function crearUsuarioPlataforma(cuerpo: UsuarioPlataformaCuerpo) {
  const { data } = await api.post<UsuarioPlataforma>('/shared/usuarios', cuerpo)
  return data
}

export async function actualizarUsuarioPlataforma(
  id: string,
  cambios: Partial<UsuarioPlataformaCuerpo> & { is_active?: boolean },
) {
  const { data } = await api.patch<UsuarioPlataforma>(`/shared/usuarios/${id}`, cambios)
  return data
}

export async function reenviarInvitacionPlataforma(id: string) {
  const { data } = await api.post<{ detail: string }>(`/shared/usuarios/${id}/invitacion`)
  return data
}
