import { api } from '@/core/api/client'

/**
 * Un tipo de prestador del catálogo. `codigo` es la identidad técnica —lo que
 * guardan los prestadores— y lo genera el servidor a partir del nombre; nadie
 * lo teclea ni lo cambia.
 */
export interface TipoPrestador {
  codigo: string
  nombre: string
  es_persona: boolean
  activo: boolean
  /** Cuántos prestadores vivos lo usan. Con uno solo, ya no se puede retirar. */
  en_uso: number
  /** Tipo fijo del sistema (centro médico, clínica, hospital): nunca se retira. */
  fijo: boolean
}

export async function listarTiposPrestador() {
  const { data } = await api.get<TipoPrestador[]>('/shared/parametros/tipos-prestador')
  return data
}

export async function crearTipoPrestador(cuerpo: { nombre: string; es_persona: boolean }) {
  const { data } = await api.post<TipoPrestador>('/shared/parametros/tipos-prestador', cuerpo)
  return data
}

export async function actualizarTipoPrestador(
  codigo: string,
  cuerpo: { nombre?: string; es_persona?: boolean; activo?: boolean },
) {
  const { data } = await api.patch<TipoPrestador>(
    `/shared/parametros/tipos-prestador/${codigo}`,
    cuerpo,
  )
  return data
}
