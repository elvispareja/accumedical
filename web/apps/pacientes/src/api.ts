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

export async function pedirInforme(eventoId: string, motivo: string) {
  const { data } = await api.post<{ url: string; expira_at: string }>(
    `/pacientes/eventos/${eventoId}/informe`,
    { motivo },
  )
  return data
}
