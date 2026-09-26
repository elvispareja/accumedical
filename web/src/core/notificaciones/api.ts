import { api } from '@/core/api/client'

/** Un aviso de la campana. El texto llega ya compuesto por el servidor. */
export interface Notificacion {
  id: string
  module_code: string
  /** El módulo donde pasó: «Auditoría de Concurrencia». */
  titulo: string
  /** De quién viene: la aseguradora. */
  subtitulo: string
  /** Qué pasó: «Programada». */
  detalle: string
  /** A dónde lleva el clic. Lo decide el servidor, no la pantalla. */
  url: string
  leida: boolean
  creada_at: string
}

/**
 * Un módulo del filtro, con lo que hay detrás de su pastilla.
 *
 * La lista la decide el servidor —como toda lista de módulos—: son aquellos de
 * los que esta persona puede recibir avisos, con nombre y cuentas ya resueltos.
 */
export interface ModuloDeNotificaciones {
  codigo: string
  nombre: string
  total: number
  sin_leer: number
}

export interface BandejaNotificaciones {
  items: Notificacion[]
  /** El del punto rojo: cuenta TODAS las no leídas, no solo las de esta página. */
  sin_leer: number
  total: number
  page: number
  page_size: number
  /** Vacío salvo que se pidan con `con_modulos`: la campana no los usa. */
  modulos: ModuloDeNotificaciones[]
}

export interface FiltrosNotificaciones {
  solo_sin_leer?: boolean
  /** El código del módulo, no su slug: es lo que guarda cada aviso. */
  module_code?: string
  /** Pide también las pastillas del filtro. Cuesta dos consultas más. */
  con_modulos?: boolean
  page?: number
  page_size?: number
}

/** Sin filtros son las últimas, que es lo que pide la campana. */
export async function listarNotificaciones(filtros: FiltrosNotificaciones = {}) {
  const { data } = await api.get<BandejaNotificaciones>('/shared/notificaciones', {
    params: {
      solo_sin_leer: filtros.solo_sin_leer || undefined,
      module_code: filtros.module_code || undefined,
      con_modulos: filtros.con_modulos || undefined,
      page: filtros.page,
      page_size: filtros.page_size,
    },
  })
  return data
}

export async function marcarLeida(id: string) {
  const { data } = await api.post<BandejaNotificaciones>(`/shared/notificaciones/${id}/leida`)
  return data
}

export async function marcarTodasLeidas() {
  const { data } = await api.post<BandejaNotificaciones>('/shared/notificaciones/leidas')
  return data
}
