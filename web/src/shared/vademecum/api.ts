import { api } from '@/core/api/client'

/**
 * El vademécum maestro (6/11/2026, M5 de la especificación): vive en la central,
 * como el CIE-10, y la plataforma solo pasa la consulta. Fuente: Cuadro Nacional
 * de Medicamentos Básicos del MSP (revisión XII, 2026). `codigo` es de
 * AccuMedical («VAD-00001»): el ATC se repite entre presentaciones.
 */
export interface Medicamento {
  codigo: string
  codigo_atc: string
  grupo_atc: string | null
  clasificacion_atc: string | null
  /** Principio activo (denominación común internacional). */
  dci: string
  nombre: string
  concentracion: string | null
  forma_farmaceutica: string | null
  via: string | null
  nivel_prescripcion: string | null
  nivel_atencion: string | null
  uso_terapeutico: string | null
  riesgo_embarazo: string | null
  fuente: string
  activo: boolean
}

export interface ValorFiltro {
  valor: string
  cantidad: number
}

export interface FiltrosVademecum {
  total: number
  fuente: string | null
  formas: ValorFiltro[]
  vias: ValorFiltro[]
  niveles_prescripcion: ValorFiltro[]
}

export interface BusquedaVademecum {
  q?: string
  forma?: string
  via?: string
  nivel_prescripcion?: string
  limit?: number
  offset?: number
}

export const POR_PAGINA = 100

export async function buscarVademecum(filtros: BusquedaVademecum) {
  const params = Object.fromEntries(
    Object.entries(filtros).filter(([, v]) => v !== undefined && v !== ''),
  )
  const { data } = await api.get<Medicamento[]>('/shared/catalogos/vademecum', { params })
  return data
}

export async function filtrosVademecum() {
  const { data } = await api.get<FiltrosVademecum>('/shared/catalogos/vademecum-filtros')
  return data
}

export async function vademecumPorCodigos(codigos: string[]) {
  if (codigos.length === 0) return []
  const { data } = await api.post<Medicamento[]>('/shared/catalogos/vademecum/codigos', { codigos })
  return data
}

/** El Excel que llena cada farmacia con sus precios. */
export const URL_PLANTILLA_PRECIOS = '/api/v1/shared/catalogos/vademecum/plantilla-precios'
