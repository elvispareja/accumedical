import { api } from '@/core/api/client'

/**
 * La firma electrónica de los informes, gestionada por el superadmin. La
 * contraseña viaja UNA vez al guardar (y el servidor la cifra); jamás vuelve.
 */
export interface FirmaEstado {
  configurada: boolean
  /** 'entorno' = fijada por variables del servidor (el panel queda bloqueado). */
  fuente: 'entorno' | 'panel' | null
  titular: string | null
}

export async function estadoFirma() {
  const { data } = await api.get<FirmaEstado>('/shared/configuracion/firma')
  return data
}

export async function guardarFirma(archivo: File, contrasena: string) {
  const cuerpo = new FormData()
  cuerpo.append('archivo', archivo)
  cuerpo.append('contrasena', contrasena)
  // Sin Content-Type explícito: el navegador debe poner el boundary del multipart.
  const { data } = await api.post<FirmaEstado>('/shared/configuracion/firma', cuerpo, {
    headers: { 'Content-Type': undefined },
  })
  return data
}
