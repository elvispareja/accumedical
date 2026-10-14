import { api } from '@/core/api/client'

// El personal de la plataforma: usuarios del propio administrador —coordinadores
// y médicos auditores—, sin aseguradora. Cada persona tiene UN rol:
//
//   coordinador → una familia entera (toda Suscripción o todo Siniestro), y solo
//                 puede haber uno por familia.
//   auditor     → los módulos que se le marquen, uno a uno.

//   convenio     → lleva la red de convenios. Uno solo.
//   contabilidad → su sección está por definir. Uno solo.
//
// Los dos últimos son transversales: no marcan familia ni módulos.
export type RolPlataforma = 'coordinador' | 'auditor' | 'call_center' | 'convenio' | 'contabilidad'
export type GrupoPlataforma = 'suscripcion' | 'siniestro'

export const ETIQUETA_GRUPO: Record<GrupoPlataforma, string> = {
  suscripcion: 'Suscripción',
  siniestro: 'Siniestro',
}

/** Un módulo al que entra el usuario, ya resuelto por el servidor. */
export interface ModuloAlcanzado {
  module_code: string
  module_nombre: string
}

/**
 * A qué entra, ya resuelto. Para el coordinador, `modulos` son los que su
 * familia abarca HOY: los calcula el servidor, así que un módulo nuevo aparece
 * solo, sin reeditar a nadie.
 */
export interface AccesoPlataforma {
  rol: RolPlataforma
  grupo: GrupoPlataforma | null
  modulos: ModuloAlcanzado[]
}

/** Lo que el formulario envía: la familia si coordina, los módulos si audita. */
export interface AccesoPlataformaCuerpo {
  rol: RolPlataforma
  grupo?: GrupoPlataforma | null
  modulos?: string[]
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

/** Un tramo de coordinación: quién coordinó una aplicación, desde y hasta cuándo. */
export interface TramoCoordinacion {
  user_id: string
  nombre: string
  email: string | null
  desde: string
  hasta: string | null
  vigente: boolean
  otorgado_por: string | null
  retirado_por: string | null
}

export interface CoordinacionDeApp {
  module_code: string
  module_nombre: string
  tramos: TramoCoordinacion[]
}

/** Quién coordina cada aplicación hoy y quién la coordinó antes (la trazabilidad). */
export async function listarCoordinaciones() {
  const { data } = await api.get<CoordinacionDeApp[]>('/shared/usuarios/coordinaciones')
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
