import { api } from '@/core/api/client'

export interface OpcionCatalogo {
  codigo: string
  nombre: string
}

export interface ModuloCatalogo extends OpcionCatalogo {
  slug: string
  color_acento: string
  orden: number
  /** La familia comercial con la que se agrupa en pantalla. */
  grupo: 'suscripcion' | 'siniestro' | null
  /** La rama dentro de la familia (el subtítulo): «siniestros_hospitalarios»… */
  subgrupo: string | null
  /** Si admite el rol «Call center» (14/10/2026; hoy solo Calificación de Riesgo). */
  con_call_center?: boolean
}

export interface TipoPrestadorCatalogo extends OpcionCatalogo {
  /** Un médico es persona; un hospital, un establecimiento. Cambia qué campos pide el formulario. */
  es_persona: boolean
}

export async function listarTiposDocumento() {
  const { data } = await api.get<OpcionCatalogo[]>('/shared/catalogos/tipos-documento')
  return data
}

export async function listarTiposPrestador() {
  const { data } = await api.get<TipoPrestadorCatalogo[]>('/shared/catalogos/tipos-prestador')
  return data
}

export interface CoberturaCatalogo {
  module_code: string
  codigo: string
  nombre: string
}

/** En qué coberturas se divide cada módulo (hoy, solo Calificación). */
export async function listarCoberturas() {
  const { data } = await api.get<CoberturaCatalogo[]>('/shared/catalogos/coberturas')
  return data
}

export async function listarModulos() {
  const { data } = await api.get<ModuloCatalogo[]>('/shared/catalogos/modulos')
  return data
}

export async function listarProvincias() {
  const { data } = await api.get<OpcionCatalogo[]>('/shared/catalogos/provincias')
  return data
}

export async function listarCiudades(provinciaCodigo: string) {
  const { data } = await api.get<OpcionCatalogo[]>('/shared/catalogos/ciudades', {
    params: { provincia_codigo: provinciaCodigo },
  })
  return data
}
