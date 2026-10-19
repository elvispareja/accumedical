import { api } from '@/core/api/client'

/**
 * La CIE-10 de Accumedical (19/10/2026): vive en la central y la plataforma
 * solo pasa la consulta (`/shared/catalogos/cie10`). OPS 2018 en español, con
 * las extensiones y restricciones del MSP de Ecuador.
 */
export interface Cie10 {
  codigo: string
  descripcion: string
  nivel: number
  categoria: string
  capitulo: string | null
  capitulo_titulo: string | null
  grupo: string | null
  grupo_titulo: string | null
  /** «†» etiología, «*» manifestación (sistema daga-asterisco). */
  simbolo: string | null
  /** Se puede usar en un diagnóstico (las categorías que agrupan, no). */
  seleccionable: boolean
  /** Falso si la OMS lo retiró: se conserva para leer casos viejos. */
  activo: boolean
  origen: string
  /** Solo para ese sexo del paciente, según el MSP. */
  sexo: 'F' | 'M' | null
  edad_min_dias: number | null
  edad_max_dias: number | null
}

export interface Cie10Capitulo {
  capitulo: string
  titulo: string
  desde: string
  hasta: string
  seleccionables: number
}

export interface FiltrosCie10 {
  q?: string
  capitulo?: string
  incluir_agrupadores?: boolean
  incluir_inactivos?: boolean
  offset?: number
}

export const POR_PAGINA = 30

export async function capitulosCie10() {
  const { data } = await api.get<Cie10Capitulo[]>('/shared/catalogos/cie10-capitulos')
  return data
}

export async function buscarCie10(filtros: FiltrosCie10) {
  const { data } = await api.get<Cie10[]>('/shared/catalogos/cie10', {
    params: { ...filtros, limit: POR_PAGINA },
  })
  return data
}
