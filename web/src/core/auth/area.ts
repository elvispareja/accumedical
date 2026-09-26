import { useLocation } from 'react-router-dom'

import type { Sesion } from '@/core/auth/api'
import { useSesion } from '@/core/auth/useSesion'

/**
 * Las dos áreas con menú lateral de la plataforma. **Cada quien trabaja en la
 * suya y la dirección lo dice**: quien coordina no está administrando la
 * plataforma, así que su bandeja, sus usuarios y sus notificaciones no cuelgan
 * de `/admin`.
 *
 * Son las mismas pantallas montadas bajo dos prefijos, no dos copias. El
 * prefijo solo decide el rótulo y a dónde llevan los enlaces de dentro; **no
 * autoriza nada**: cada endpoint lo revalida el servidor, y escribir `/admin` a
 * mano no convierte a nadie en administrador.
 */
export const AREA_COORDINACION = '/coordinacion'
export const AREA_ADMIN = '/admin'
export type Area = typeof AREA_COORDINACION | typeof AREA_ADMIN

/** El code del rol de coordinación, congelado; «Coordinador» es su nombre visible. */
export const ROL_COORDINADOR = 'supervisor'

/**
 * Coordina ALGO: una familia de Accumedical o una compañía. Para la pantalla los
 * dos son la misma persona —mismo menú, misma área—, y por eso se mira el rol y
 * no `grupo_coordinado`, que solo lleva el de familia.
 */
export function esCoordinador(sesion?: Sesion | null): boolean {
  return Boolean(sesion?.modulos.some((m) => m.rol === ROL_COORDINADOR))
}

/**
 * Coordina DESDE PLATAFORMA. El de una aseguradora queda fuera por su compañía:
 * no tiene varias auditorías que juntar en una bandeja ni auditores propios que
 * dar de alta, así que hay pantallas del área que no son suyas.
 */
export function coordinaDesdePlataforma(sesion?: Sesion | null): boolean {
  return Boolean(sesion && !sesion.aseguradora && esCoordinador(sesion))
}

/**
 * El área de QUIEN mira. Sirve estando donde esté, también dentro de un módulo.
 * **Coordinar es coordinar**, venga de Accumedical o de una compañía: los dos
 * trabajan en `/coordinacion`; el resto, en `/admin`.
 */
export function useArea(): Area {
  const { data: sesion } = useSesion()
  return esCoordinador(sesion) ? AREA_COORDINACION : AREA_ADMIN
}

/**
 * El área de la PÁGINA abierta. Es la que usan las pantallas que se montan bajo
 * los dos prefijos —usuarios, notificaciones— para que sus enlaces se queden en
 * el área por la que se entró en vez de saltar a la otra.
 */
export function useAreaDeLaRuta(): Area {
  const { pathname } = useLocation()
  return pathname.startsWith(AREA_COORDINACION) ? AREA_COORDINACION : AREA_ADMIN
}

/** El rótulo pequeño de la cabecera, según el área. */
export function rotuloDeArea(area: Area): string {
  return area === AREA_COORDINACION ? 'Coordinación' : 'Administración'
}
