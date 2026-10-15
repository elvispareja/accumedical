import { api } from '@/core/api/client'

/** El registro de pacientes (D49): vive en la central; la plataforma lo sirve aquí. */

export interface PacienteFila {
  id: string
  tipo_documento_codigo: string
  numero_documento: string
  nombre_principal: string
  nombre_secundario: string | null
  apellido_paterno: string
  apellido_materno: string | null
  eventos: number
  ultimo_evento: string | null
}

export interface PaginaPacientes {
  items: PacienteFila[]
  total: number
  page: number
  page_size: number
}

export interface EventoPaciente {
  id: string
  tipo_evento: string
  fecha_evento: string
  aplicacion_codigo: string
  aplicacion_nombre: string
  aseguradora_nombre: string | null
  resumen: Record<string, unknown>
  ruta_caso: string | null
  documento: {
    tipo: string | null
    numero_entrega: number | null
    firmado: boolean | null
    firmante: string | null
    entregado_at: string | null
    tamano_bytes: number | null
    visita_codigo: string | null
  } | null
}

/** Un cuadro de la ficha: un módulo y cuántos casos de la persona finalizaron en él. */
export interface ResumenModulo {
  codigo: string
  nombre: string
  color_acento: string
  finalizados: number
}

/**
 * Un caso de la persona en una app, en UN renglón: la visita o el cierre y su
 * informe final. Lo que se puede hacer ya viene decidido por el servidor.
 */
export interface CasoPaciente {
  clave: string
  aplicacion_codigo: string
  aplicacion_nombre: string
  tipo_evento: string
  codigo: string | null
  fecha: string
  aseguradora_nombre: string | null
  /** El informe final más reciente: lo ve todo el personal. */
  informe_evento_id: string | null
  informe: EventoPaciente['documento']
  /** Solo si quien mira puede entrar a esa app como coordinador (o es superadmin). */
  ruta_caso: string | null
  /** Quién intervino: Auditor, Coordinador… (hoy, Concurrencia). */
  participantes: { rol: string; nombre: string }[]
}

export interface Paciente {
  id: string
  tipo_documento_codigo: string
  numero_documento: string
  nombre_principal: string
  nombre_secundario: string | null
  apellido_paterno: string
  apellido_materno: string | null
  email: string | null
  telefono: string | null
  fecha_nacimiento: string | null
  sexo: 'femenino' | 'masculino' | null
  telefono_secundario: string | null
  provincia_codigo: string | null
  provincia_nombre: string | null
  ciudad_codigo: string | null
  ciudad_nombre: string | null
  direccion: string | null
  created_at: string
  updated_at: string
  eventos: EventoPaciente[]
  /** Un cuadro por módulo activo de Accumedical, con sus casos finalizados. */
  modulos: ResumenModulo[]
  /** Los eventos agrupados por caso, con sus acciones. */
  casos: CasoPaciente[]
}

export interface IdentidadPaciente {
  nombre_principal: string
  nombre_secundario: string | null
  apellido_paterno: string
  apellido_materno: string | null
  email: string | null
  telefono: string | null
  fecha_nacimiento: string | null
  sexo: 'femenino' | 'masculino' | null
  telefono_secundario: string | null
  provincia_codigo: string | null
  ciudad_codigo: string | null
  direccion: string | null
}

export async function listarPacientes(q: string, page: number) {
  const { data } = await api.get<PaginaPacientes>('/pacientes', {
    params: { q: q.trim().length >= 2 ? q.trim() : undefined, page },
  })
  return data
}

export async function obtenerPaciente(id: string) {
  const { data } = await api.get<Paciente>(`/pacientes/${id}`)
  return data
}

export async function corregirPaciente(id: string, datos: IdentidadPaciente) {
  const { data } = await api.put<Paciente>(`/pacientes/${id}`, datos)
  return data
}

/**
 * El enlace de un solo uso al informe final. Desde la ficha se abre sin pedir
 * motivo (15/10/2026): el servidor registra uno fijo y la consulta queda
 * auditada igual.
 */
export async function pedirInforme(eventoId: string) {
  const { data } = await api.post<{ url: string; expira_at: string }>(
    `/pacientes/eventos/${eventoId}/informe`,
    {},
  )
  return data
}
