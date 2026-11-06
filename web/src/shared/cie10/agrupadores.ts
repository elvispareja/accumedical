import { api } from '@/core/api/client'

/**
 * **Diagnósticos agrupadores de la CIE-10** (6/11/2026; especificación de la
 * Central, págs. 3 y 12–13). El tope se aplica por evento y un evento es la
 * misma enfermedad: cada código CIE-10 pertenece a UN agrupador. Viven en la
 * central; nacen de las categorías y AccuMedical los junta y separa.
 */
export interface AgrupadorResumen {
  codigo: string
  nombre: string
  /** «categoria»: nació de una categoría CIE-10; «accumedical»: lo creó AccuMedical. */
  origen: 'categoria' | 'accumedical'
  categoria_base: string | null
  activo: boolean
  /** Si quedó sin códigos: el agrupador al que pasaron. */
  fusionado_en: string | null
  /** AccuMedical lo cambió (nuevo, con códigos de otra categoría o sin parte de la suya). */
  ajustado: boolean
  total_codigos: number
  categorias: string[]
}

export interface CodigoDelAgrupador {
  codigo: string
  descripcion: string
  nivel: number
  categoria: string
  capitulo: string | null
  seleccionable: boolean
  activo: boolean
}

export interface AgrupadorDetalle extends AgrupadorResumen {
  codigos: CodigoDelAgrupador[]
  fusionados: { codigo: string; nombre: string }[]
}

export interface PaginaAgrupadores {
  total: number
  items: AgrupadorResumen[]
}

export interface SugerenciaAgrupador {
  codigo: string
  nombre: string
  categorias: string[]
  motivo: string
}

export const AGRUPADORES_POR_PAGINA = 50
const RUTA = '/shared/catalogos/cie10-agrupadores'

export async function buscarAgrupadores(filtros: {
  q?: string
  solo_ajustados?: boolean
  incluir_inactivos?: boolean
  offset?: number
}) {
  const { data } = await api.get<PaginaAgrupadores>(RUTA, { params: filtros })
  return data
}

export async function verAgrupador(codigo: string) {
  const { data } = await api.get<AgrupadorDetalle>(`${RUTA}/${codigo}`)
  return data
}

export async function renombrarAgrupador(codigo: string, nombre: string, motivo?: string) {
  const { data } = await api.put<AgrupadorDetalle>(`${RUTA}/${codigo}`, {
    nombre,
    motivo: motivo || null,
  })
  return data
}

/** Mueve códigos a otro agrupador (`destino`) o a uno nuevo (`nombre_nuevo`). */
export async function moverCodigos(d: { codigos: string[]; destino?: string; nombre_nuevo?: string; motivo?: string }) {
  const { data } = await api.post<AgrupadorDetalle>(`${RUTA}/mover`, {
    codigos: d.codigos,
    destino: d.destino ?? null,
    nombre_nuevo: d.nombre_nuevo ?? null,
    motivo: d.motivo || null,
  })
  return data
}

/** Trae TODOS los códigos de `otros` al agrupador `codigo`. */
export async function juntarAgrupadores(codigo: string, otros: string[], motivo?: string) {
  const { data } = await api.post<AgrupadorDetalle>(`${RUTA}/${codigo}/juntar`, {
    otros,
    motivo: motivo || null,
  })
  return data
}

export async function sugerirAgrupacion(codigo: string) {
  const { data } = await api.post<SugerenciaAgrupador[]>(`${RUTA}/${codigo}/sugerencias`)
  return data
}
