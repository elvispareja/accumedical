import { api } from '@/core/api/client'
import type { ContactoFormulario, ContactoSalida } from '@/shared/contactos/ContactosPanel'

export type { ContactoFormulario, ContactoSalida }

/** Un prestador puede estar suspendido; una aseguradora, no. */
export type Estado = 'activo' | 'inactivo' | 'suspendido'

export type EstadoSede = 'activa' | 'inactiva'

export interface SedeSalida {
  id: string
  nombre: string
  provincia_codigo: string
  provincia_nombre: string | null
  ciudad_codigo: string
  ciudad_nombre: string | null
  direccion: string
  telefono: string | null
  email: string | null
  latitud: number
  longitud: number
  estado: string
}

/** Una sede del formulario. `_key` es solo para React y no se envía. */
export interface SedeFormulario {
  _key: string
  id?: string
  nombre: string
  provincia_codigo: string
  ciudad_codigo: string
  direccion: string
  telefono: string
  email: string
  latitud: number | null
  longitud: number | null
  estado: EstadoSede
}

export type EstadoConvenio = 'vigente' | 'suspendido' | 'terminado'

export interface ConvenioSalida {
  id: string
  aseguradora_id: string
  aseguradora_razon_social: string
  aseguradora_nombre_comercial: string | null
  aseguradora_ruc: string
  codigo_convenio: string | null
  fecha_inicio: string
  fecha_fin: string | null
  estado: string
  observaciones: string | null
}

export interface PrestadorResumen {
  id: string
  codigo_interno: string
  nombre: string
  tipo_codigo: string
  tipo_nombre: string
  ruc: string
  estado: string
  provincia_nombre: string | null
  ciudad_nombre: string | null
  tiene_logo: boolean
}

export interface PrestadorDetalle extends PrestadorResumen {
  provincia_codigo: string | null
  ciudad_codigo: string | null
  direccion: string | null
  latitud: number
  longitud: number
  contactos: ContactoSalida[]
  sedes: SedeSalida[]
  aseguradoras: ConvenioSalida[]
}

export interface PaginaPrestadores {
  items: PrestadorResumen[]
  total: number
  page: number
  page_size: number
}

export interface FiltrosPrestadores {
  search?: string
  estado?: string
  tipo_codigo?: string
  provincia_codigo?: string
  page: number
  page_size: number
}

/** Lo que el formulario envía. Los vacíos van como null, no como cadena vacía. */
export interface PrestadorFormulario {
  tipo_codigo: string
  nombre: string
  ruc: string
  estado: Estado
  provincia_codigo: string | null
  ciudad_codigo: string | null
  direccion: string | null
  /** Punto en el mapa. Obligatorio al guardar; null solo mientras se rellena. */
  latitud: number | null
  longitud: number | null
  contactos: ContactoFormulario[]
  /** Tener sedes es opcional; la sede que se crea va entera. */
  sedes: SedeFormulario[]
}

export async function listarPrestadores(filtros: FiltrosPrestadores) {
  const { data } = await api.get<PaginaPrestadores>('/shared/prestadores', {
    params: {
      search: filtros.search || undefined,
      estado: filtros.estado || undefined,
      tipo_codigo: filtros.tipo_codigo || undefined,
      provincia_codigo: filtros.provincia_codigo || undefined,
      page: filtros.page,
      page_size: filtros.page_size,
    },
  })
  return data
}

export async function obtenerPrestador(id: string) {
  const { data } = await api.get<PrestadorDetalle>(`/shared/prestadores/${id}`)
  return data
}

export async function crearPrestador(cuerpo: PrestadorFormulario) {
  const { data } = await api.post<PrestadorDetalle>('/shared/prestadores', cuerpo)
  return data
}

export async function actualizarPrestador(id: string, cuerpo: Partial<PrestadorFormulario>) {
  const { data } = await api.patch<PrestadorDetalle>(`/shared/prestadores/${id}`, cuerpo)
  return data
}

export async function eliminarPrestador(id: string) {
  await api.delete(`/shared/prestadores/${id}`)
}

export async function subirLogo(id: string, archivo: File) {
  const cuerpo = new FormData()
  cuerpo.append('archivo', archivo)
  // Sin Content-Type explícito: el navegador debe poner el boundary del multipart.
  const { data } = await api.post<PrestadorDetalle>(`/shared/prestadores/${id}/logo`, cuerpo, {
    headers: { 'Content-Type': undefined },
  })
  return data
}

export function urlLogo(id: string) {
  return `/api/v1/shared/prestadores/${id}/logo`
}

// ─────────────── Valores del convenio (Factor de Cobertura) ─────────────────

/** Las tres formas de pactar un concepto del convenio. */
export type ModoFC = 'punto' | 'porcentaje' | 'fijo'

/** Cómo se lee cada modo. El orden es el del selector, de izquierda a derecha. */
export const MODOS_FC: { modo: ModoFC; etiqueta: string; ayuda: string }[] = [
  {
    modo: 'punto',
    etiqueta: 'Por punto',
    ayuda: 'El valor de CADA punto del tarifario: se multiplica por los puntos del procedimiento.',
  },
  {
    modo: 'porcentaje',
    etiqueta: 'Por porcentaje',
    ayuda: 'Un tanto por ciento de otro concepto del convenio, el que se elija debajo.',
  },
  {
    modo: 'fijo',
    etiqueta: 'Precio fijo',
    ayuda: 'Un importe cerrado, que no se multiplica por nada.',
  },
]

/** Un concepto del convenio tal como lo devuelve el servidor. */
export interface ConceptoFC {
  concepto: string
  /** Cómo se lee. Lo manda el servidor; la pantalla no mantiene su diccionario. */
  nombre: string
  modo: ModoFC
  valor: number | null
  /** De qué concepto sale el porcentaje. Nulo en los otros modos. */
  base: string | null
  /** Calculado por el servidor: `valor de la base × porcentaje / 100`. No se guarda. */
  importe: number | null
  /** False mientras el concepto no se ha guardado nunca. */
  pactado: boolean
}

export interface ValoresFC {
  convenio_id: string
  aseguradora_nombre: string
  /** Los conceptos del convenio, en el orden de la pantalla, pactados o no. */
  conceptos: ConceptoFC[]
}

/**
 * Lo que teclea el usuario. El valor va como TEXTO para poder escribir «45,»
 * sin que se borre mientras se completa el decimal.
 */
export interface ConceptoFCFormulario {
  concepto: string
  nombre: string
  modo: ModoFC
  valor: string
  base: string | null
}

export async function obtenerValoresFC(prestadorId: string, convenioId: string) {
  const { data } = await api.get<ValoresFC>(
    `/shared/prestadores/${prestadorId}/convenios/${convenioId}/valores`,
  )
  return data
}

export async function guardarValoresFC(
  prestadorId: string,
  convenioId: string,
  conceptos: { concepto: string; modo: ModoFC; valor: number | null; base: string | null }[],
) {
  const { data } = await api.put<ValoresFC>(
    `/shared/prestadores/${prestadorId}/convenios/${convenioId}/valores`,
    { conceptos },
  )
  return data
}

/**
 * Un sitio donde se atiende, con su punto en el mapa. El prestador aporta el
 * suyo y cada sede activa el propio: por eso `sede_nombre` distingue unos de
 * otros y un mismo `prestador_id` puede aparecer en varias ciudades.
 */
export interface PuntoMapa {
  prestador_id: string
  codigo_interno: string
  nombre: string
  tipo_nombre: string
  estado: string
  sede_nombre: string | null
  direccion: string | null
  provincia_codigo: string | null
  provincia_nombre: string | null
  ciudad_codigo: string | null
  ciudad_nombre: string | null
  latitud: number
  longitud: number
}

/** Con `aseguradoraId`, solo los prestadores con convenio vivo con esa compañía. */
export async function listarPuntosDelMapa(aseguradoraId?: string) {
  const { data } = await api.get<PuntoMapa[]>('/shared/prestadores/mapa', {
    params: aseguradoraId ? { aseguradora_id: aseguradoraId } : undefined,
  })
  return data
}

// ───────────── Convenios del prestador: su red, desde este lado ─────────────
//
// Espejo de los de la aseguradora: la MISMA tabla y la misma mecánica —marcar
// crea el convenio, desmarcar lo retira—, leída desde el prestador.

export interface ConvenioAseguradora {
  aseguradora_id: string
  codigo_interno: string
  razon_social: string
  nombre_comercial: string | null
  ruc: string
  ciudad_nombre: string | null
  marcado: boolean
  /** Solo cuando el convenio está guardado: habilita editar su detalle. */
  convenio_id: string | null
  listado_precios_nombre: string | null
  red_privada: boolean
  red_publica: boolean
}

/** Una compañía marcada, con la red que cubre su convenio. */
export interface AseguradoraEnRed {
  aseguradora_id: string
  red_privada: boolean
  red_publica: boolean
}

export async function listarConveniosDelPrestador(prestadorId: string) {
  const { data } = await api.get<ConvenioAseguradora[]>(
    `/shared/prestadores/${prestadorId}/convenios`,
  )
  return data
}

export async function fijarConveniosDelPrestador(
  prestadorId: string,
  aseguradoras: AseguradoraEnRed[],
) {
  const { data } = await api.put<ConvenioAseguradora[]>(
    `/shared/prestadores/${prestadorId}/convenios`,
    { aseguradoras },
  )
  return data
}
