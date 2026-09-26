import { api } from '@/core/api/client'
import type {
  ContactoFormulario,
  ContactoSalida,
} from '@/shared/contactos/ContactosPanel'

export type { ContactoFormulario, ContactoSalida }

export type Estado = 'activo' | 'inactivo'

export interface AseguradoraResumen {
  id: string
  codigo_interno: string
  razon_social: string
  nombre_comercial: string | null
  ruc: string
  estado: string
  provincia_nombre: string | null
  ciudad_nombre: string | null
  tiene_logo: boolean
}

export interface CoberturaHabilitada {
  codigo: string
  nombre: string
  activo: boolean
}

export interface ModuloHabilitado {
  codigo: string
  slug: string
  nombre: string
  color_acento: string
  orden: number
  activo: boolean
  /** Subramas del módulo. Vacío en los que no tienen. */
  coberturas: CoberturaHabilitada[]
}

export interface AseguradoraDetalle extends AseguradoraResumen {
  provincia_codigo: string | null
  ciudad_codigo: string | null
  direccion_fiscal: string | null
  latitud: number
  longitud: number
  modulos: ModuloHabilitado[]
  contactos: ContactoSalida[]
}

export interface PaginaAseguradoras {
  items: AseguradoraResumen[]
  total: number
  page: number
  page_size: number
}

export interface FiltrosAseguradoras {
  search?: string
  estado?: string
  provincia_codigo?: string
  page: number
  page_size: number
}

/** Lo que el formulario envía. Los vacíos van como null, no como cadena vacía. */
export interface AseguradoraFormulario {
  razon_social: string
  nombre_comercial: string | null
  ruc: string
  estado: Estado
  provincia_codigo: string | null
  ciudad_codigo: string | null
  direccion_fiscal: string | null
  /** Punto en el mapa. Obligatorio al guardar; null solo mientras se rellena. */
  latitud: number | null
  longitud: number | null
  /** Códigos de los módulos marcados en la pestaña Requerimientos. */
  modulos: string[]
  /** Coberturas marcadas, por código de módulo. */
  coberturas: Record<string, string[]>
  contactos: ContactoFormulario[]
}

export async function listarAseguradoras(filtros: FiltrosAseguradoras) {
  const { data } = await api.get<PaginaAseguradoras>('/shared/aseguradoras', {
    params: {
      search: filtros.search || undefined,
      estado: filtros.estado || undefined,
      provincia_codigo: filtros.provincia_codigo || undefined,
      page: filtros.page,
      page_size: filtros.page_size,
    },
  })
  return data
}

export async function obtenerAseguradora(id: string) {
  const { data } = await api.get<AseguradoraDetalle>(`/shared/aseguradoras/${id}`)
  return data
}

export async function crearAseguradora(cuerpo: AseguradoraFormulario) {
  const { data } = await api.post<AseguradoraDetalle>('/shared/aseguradoras', cuerpo)
  return data
}

export async function actualizarAseguradora(id: string, cuerpo: Partial<AseguradoraFormulario>) {
  const { data } = await api.patch<AseguradoraDetalle>(`/shared/aseguradoras/${id}`, cuerpo)
  return data
}

export async function subirLogo(id: string, archivo: File) {
  const cuerpo = new FormData()
  cuerpo.append('archivo', archivo)
  // Sin Content-Type explícito: el navegador debe poner el boundary del multipart.
  const { data } = await api.post<AseguradoraDetalle>(`/shared/aseguradoras/${id}/logo`, cuerpo, {
    headers: { 'Content-Type': undefined },
  })
  return data
}

export function urlLogo(id: string) {
  return `/api/v1/shared/aseguradoras/${id}/logo`
}

/**
 * Solo el nombre de una compañía. Es lo que recibe quien lleva los convenios:
 * su ficha completa —módulos, contactos, documentos— no le corresponde.
 */
export async function obtenerAseguradoraBasica(id: string) {
  const { data } = await api.get<{ id: string; nombre: string }>(
    `/shared/aseguradoras/${id}/basico`,
  )
  return data
}

/** La ficha interna de Accumedical: la dueña de la «Red convenio» propia. */
export async function aseguradoraPropia() {
  const { data } = await api.get<{ id: string; nombre: string }>('/shared/aseguradoras/propia')
  return data
}

// ────────────────────── Convenios (la red de prestadores) ───────────────────

/** Un prestador del catálogo, con la marca de si está en la red de esta aseguradora. */
export interface ConvenioPrestador {
  prestador_id: string
  codigo_interno: string
  nombre: string
  tipo_nombre: string
  ciudad_nombre: string | null
  marcado: boolean
  /** Solo cuando el convenio está guardado: habilita editar su detalle. */
  convenio_id: string | null
  listado_precios_nombre: string | null
  /** Qué red cubre el convenio. Las dos a la vez significa ambas. */
  red_privada: boolean
  red_publica: boolean
}

/** Un prestador marcado, con la red que cubre su convenio. */
export interface PrestadorEnRed {
  prestador_id: string
  red_privada: boolean
  red_publica: boolean
}

export async function listarConvenios(aseguradoraId: string) {
  const { data } = await api.get<ConvenioPrestador[]>(
    `/shared/aseguradoras/${aseguradoraId}/convenios`,
  )
  return data
}

/** La red completa: lo marcado con su red. Marcar crea el convenio; desmarcar lo retira. */
export async function fijarConvenios(aseguradoraId: string, prestadores: PrestadorEnRed[]) {
  const { data } = await api.put<ConvenioPrestador[]>(
    `/shared/aseguradoras/${aseguradoraId}/convenios`,
    { prestadores },
  )
  return data
}

/** El listado de precios del convenio: UN archivo (PDF o Excel); subir reemplaza. */
export async function subirListadoPrecios(
  aseguradoraId: string,
  prestadorId: string,
  archivo: File,
) {
  const cuerpo = new FormData()
  cuerpo.append('archivo', archivo)
  // Sin Content-Type explícito: el navegador debe poner el boundary del multipart.
  const { data } = await api.post<{ listado_precios_nombre: string }>(
    `/shared/aseguradoras/${aseguradoraId}/convenios/${prestadorId}/listado-precios`,
    cuerpo,
    { headers: { 'Content-Type': undefined } },
  )
  return data
}

export function urlListadoPrecios(aseguradoraId: string, prestadorId: string) {
  return `/api/v1/shared/aseguradoras/${aseguradoraId}/convenios/${prestadorId}/listado-precios`
}

// ─────────────────────────────── SLA por módulo ─────────────────────────────

/** Un módulo contratado con su SLA. Nulos mientras no se pacte. */
export interface SlaModulo {
  module_code: string
  module_nombre: string
  grupo: string | null
  horas: number | null
  precio: number | null
}

export async function listarSla(aseguradoraId: string) {
  const { data } = await api.get<SlaModulo[]>(`/shared/aseguradoras/${aseguradoraId}/sla`)
  return data
}

/** Horas y precio son obligatorios en cada módulo contratado: el servidor los exige. */
export async function fijarSla(
  aseguradoraId: string,
  items: { module_code: string; horas: number; precio: number }[],
) {
  const { data } = await api.put<SlaModulo[]>(`/shared/aseguradoras/${aseguradoraId}/sla`, {
    items,
  })
  return data
}

// ─────────────────────────── Pólizas y planes ───────────────────────────────

/** Un PDF de pólizas y planes; el archivo se pide a su propio endpoint. */
export interface Poliza {
  id: string
  nombre: string
  creada_at: string
}

/** La pestaña a la que pertenece cada documento. */
export type CategoriaDocumento = 'polizas' | 'cobertura_condiciones' | 'sla' | 'convenios'

export async function listarPolizas(aseguradoraId: string, categoria: CategoriaDocumento) {
  const { data } = await api.get<Poliza[]>(`/shared/aseguradoras/${aseguradoraId}/polizas`, {
    params: { categoria },
  })
  return data
}

export async function subirPoliza(
  aseguradoraId: string,
  archivo: File,
  nombre: string,
  categoria: CategoriaDocumento,
) {
  const cuerpo = new FormData()
  cuerpo.append('archivo', archivo)
  cuerpo.append('nombre', nombre)
  cuerpo.append('categoria', categoria)
  // Sin Content-Type explícito: el navegador debe poner el boundary del multipart.
  const { data } = await api.post<Poliza[]>(
    `/shared/aseguradoras/${aseguradoraId}/polizas`,
    cuerpo,
    { headers: { 'Content-Type': undefined } },
  )
  return data
}

export async function eliminarPoliza(aseguradoraId: string, polizaId: string) {
  await api.delete(`/shared/aseguradoras/${aseguradoraId}/polizas/${polizaId}`)
}

export function urlPoliza(aseguradoraId: string, polizaId: string) {
  return `/api/v1/shared/aseguradoras/${aseguradoraId}/polizas/${polizaId}`
}

// ─────────────────────────────── Usuarios ───────────────────────────────────

// Los usuarios de una compañía tienen UN rol:
//
//   coordinador → la compañía entera: todo lo que ella tenga contratado. Uno
//                 solo por aseguradora.
//   operador    → los requerimientos que se le marquen.
export type Rol = 'coordinador' | 'operador'

/** Una hoja de lo contratado: un módulo sin coberturas, o una cobertura. */
export interface Requerimiento {
  module_code: string
  module_nombre: string
  cobertura_codigo: string | null
  cobertura_nombre: string | null
}

/** Un requerimiento concedido a un operador. */
export interface Acceso {
  module_code: string
  cobertura_codigo: string | null
  rol: string
}

/** Lo que el formulario envía: el rol y, si opera, sus requerimientos. */
export interface AccesoUsuarioCuerpo {
  rol: Rol
  accesos: Acceso[]
}

export interface AccesoSalida extends Acceso {
  module_nombre: string
  cobertura_nombre: string | null
}

export interface Usuario {
  id: string
  /** El usuario de aseguradora sale de su contacto: aquí el nombre solo se enseña. */
  nombre_completo: string
  email: string
  is_active: boolean
  contacto_id: string | null
  password_definida: boolean
  invitacion_pendiente: boolean
  ultimo_acceso: string | null
  rol: Rol
  /** Ya resueltos: los del coordinador salen de lo que la compañía contrató. */
  accesos: AccesoSalida[]
}

/** Identidad estable de un requerimiento, para usarla como clave y como Set. */
export function claveRequerimiento(r: {
  module_code: string
  cobertura_codigo: string | null
}): string {
  return `${r.module_code}|${r.cobertura_codigo ?? ''}`
}

export async function listarRequerimientos(aseguradoraId: string) {
  const { data } = await api.get<Requerimiento[]>(
    `/shared/aseguradoras/${aseguradoraId}/requerimientos`,
  )
  return data
}

export async function listarUsuarios(aseguradoraId: string) {
  const { data } = await api.get<Usuario[]>(`/shared/aseguradoras/${aseguradoraId}/usuarios`)
  return data
}

export async function crearUsuario(
  aseguradoraId: string,
  cuerpo: { contacto_id: string; acceso: AccesoUsuarioCuerpo },
) {
  const { data } = await api.post<Usuario>(
    `/shared/aseguradoras/${aseguradoraId}/usuarios`,
    cuerpo,
  )
  return data
}

export async function actualizarUsuario(
  aseguradoraId: string,
  userId: string,
  cuerpo: { acceso?: AccesoUsuarioCuerpo; is_active?: boolean },
) {
  const { data } = await api.patch<Usuario>(
    `/shared/aseguradoras/${aseguradoraId}/usuarios/${userId}`,
    cuerpo,
  )
  return data
}

export async function reenviarInvitacion(aseguradoraId: string, userId: string) {
  await api.post(`/shared/aseguradoras/${aseguradoraId}/usuarios/${userId}/invitacion`)
}

/**
 * Una compañía sobre el mapa. Un solo punto por compañía —su domicilio—: no
 * lleva sedes, que es lo que hace que un prestador aparezca varias veces.
 */
export interface PuntoMapaAseguradora {
  id: string
  codigo_interno: string
  razon_social: string
  nombre_comercial: string | null
  ruc: string
  estado: string
  direccion_fiscal: string | null
  provincia_codigo: string | null
  provincia_nombre: string | null
  ciudad_codigo: string | null
  ciudad_nombre: string | null
  latitud: number
  longitud: number
}

export async function listarPuntosDeAseguradoras() {
  const { data } = await api.get<PuntoMapaAseguradora[]>('/shared/aseguradoras/mapa')
  return data
}
