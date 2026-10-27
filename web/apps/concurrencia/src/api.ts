import { api } from '@/core/api/client'

/**
 * Los seis estados de un caso. **Ninguno se elige**: cada uno lo pone una
 * acción —crear, derivar, «ya llegué», enviar el informe, cancelar— o el
 * servidor al vencer la ventana. Por eso no viajan nunca hacia el servidor.
 */
export type EstadoVisita =
  | 'programada'
  | 'asignada'
  | 'auditando'
  | 'cancelada'
  | 'culminada'
  | 'no_auditado'

/**
 * Un contacto del prestador, para marcar a quién se avisa. Lo que se guarda es
 * su correo; el nombre y el cargo son para reconocer a la persona al marcarla.
 */
export interface ContactoElegible {
  id: string
  nombre_completo: string
  cargo: string | null
  email: string
  /** Su sede; null = la sede principal. */
  sede_id: string | null
}

export interface SedeElegible {
  id: string
  nombre: string
  direccion: string
  ciudad_nombre: string | null
  provincia_nombre: string | null
  estado: string
}

/** Un prestador de la red, con sus sedes: de ahí sale a dónde va el auditor. */
export interface PrestadorElegible {
  id: string
  codigo_interno: string
  nombre: string
  tipo_nombre: string
  direccion: string | null
  ciudad_nombre: string | null
  provincia_nombre: string | null
  sedes: SedeElegible[]
  contactos: ContactoElegible[]
}

export interface VisitaResumen {
  id: string
  codigo_interno: string
  /** Ya compuesto por el servidor; quien edita usa el detalle, con sus partes. */
  paciente_nombre_completo: string
  paciente_tipo_documento_codigo: string
  paciente_numero_documento: string
  prestador_id: string
  prestador_nombre: string
  sede_id: string | null
  sede_nombre: string | null
  /** La calle del destino, si la tiene: la dirección del prestador es opcional. */
  lugar: string | null
  ciudad_nombre: string | null
  provincia_nombre: string | null
  /**
   * A qué hora va el auditor. **`null` para la compañía**: la fija la
   * coordinación al derivar y la aseguradora no la ve (26/10/2026).
   */
  desde: string | null
  /** Cuándo vence la entrega del informe: `desde` + el SLA de la compañía. */
  hasta: string | null
  /** Hasta cuándo se le acepta la llegada al auditor, prórrogas incluidas. */
  llegada_limite: string | null
  estado: string
  total_correos: number
}

/** Un correo del caso con la etiqueta de quién es (ficha del contacto o a mano). */
export interface CorreoVisita {
  email: string
  etiqueta: string | null
}

/** El parentesco del PACIENTE con el titular de la póliza. */
export type Parentesco = 'conyuge' | 'hijo' | 'padre_madre' | 'otro'

/**
 * Póliza y titular del caso (26/10/2026). Nulos en los casos de antes y, el
 * titular, cuando el paciente lo es.
 */
export interface PolizaYTitular {
  poliza_numero: string | null
  paciente_es_titular: boolean
  titular_parentesco: Parentesco | null
  titular_nombre_principal: string | null
  titular_nombre_secundario: string | null
  titular_apellido_paterno: string | null
  titular_apellido_materno: string | null
  titular_tipo_documento_codigo: string | null
  titular_numero_documento: string | null
}

export interface VisitaDetalle extends VisitaResumen, PolizaYTitular {
  /** Las cuatro partes, para reabrir el formulario con cada una en su casilla. */
  paciente_nombre_principal: string
  paciente_nombre_secundario: string | null
  paciente_apellido_paterno: string
  paciente_apellido_materno: string | null
  observaciones: string | null
  correos: CorreoVisita[]
  /** Si el auditor ya generó el informe; el PDF se pide a su propio endpoint. */
  tiene_informe: boolean
}

/** El PDF del informe, para la vista de compañía (operador y su supervisor). */
export function urlInformePdf(id: string) {
  return `/api/v1/concurrencia/visitas/${id}/informe.pdf`
}

/** El PDF del informe, para la supervisión de plataforma y el panel del admin. */
export function urlInformePdfSupervision(id: string) {
  return `/api/v1/concurrencia/supervision/visitas/${id}/informe.pdf`
}

export interface PaginaVisitas {
  items: VisitaResumen[]
  total: number
  page: number
  page_size: number
}

export interface FiltrosVisitas {
  search?: string
  estado?: string
  desde?: string
  hasta?: string
  /** Id del operador que creó el caso: el filtro del tab Operadores. */
  creado_por?: string
  page: number
  page_size: number
}

/** Lo que el formulario envía. Las fechas viajan en ISO con zona. */
export interface VisitaFormulario {
  prestador_id: string
  paciente_nombre_principal: string
  paciente_nombre_secundario: string | null
  paciente_apellido_paterno: string
  paciente_apellido_materno: string | null
  paciente_tipo_documento_codigo: string
  paciente_numero_documento: string
  sede_id: string | null
  // Póliza y titular: la póliza es obligatoria; el titular, si no es el paciente.
  poliza_numero: string
  paciente_es_titular: boolean
  titular_parentesco: Parentesco | null
  titular_nombre_principal: string | null
  titular_nombre_secundario: string | null
  titular_apellido_paterno: string | null
  titular_apellido_materno: string | null
  titular_tipo_documento_codigo: string | null
  titular_numero_documento: string | null
  // La hora la fija la coordinación AL DERIVAR (26/10/2026): el alta ya no la
  // manda y el servidor pone la del registro como provisional. Solo viaja al
  // reprogramar un caso vencido. La entrega sale siempre del SLA del servidor.
  desde?: string
  correos: CorreoVisita[]
  observaciones: string | null
  // Sin `estado`: el servidor ni lo acepta. Un caso nace programado y de ahí lo
  // mueven las acciones —derivar, llegar, informar, cancelar—, nunca un campo.
}

export async function listarVisitas(filtros: FiltrosVisitas) {
  const { data } = await api.get<PaginaVisitas>('/concurrencia/visitas', {
    params: {
      search: filtros.search || undefined,
      estado: filtros.estado || undefined,
      desde: filtros.desde || undefined,
      hasta: filtros.hasta || undefined,
      creado_por: filtros.creado_por || undefined,
      page: filtros.page,
      page_size: filtros.page_size,
    },
  })
  return data
}

/** Un operador de la compañía, para filtrar el historial por sus casos. */
export interface OperadorElegible {
  id: string
  nombre_completo: string
  email: string
  activo: boolean
}

export async function listarOperadores() {
  const { data } = await api.get<OperadorElegible[]>('/concurrencia/operadores')
  return data
}

export async function obtenerVisita(id: string) {
  const { data } = await api.get<VisitaDetalle>(`/concurrencia/visitas/${id}`)
  return data
}

export async function crearVisita(cuerpo: VisitaFormulario) {
  const { data } = await api.post<VisitaDetalle>('/concurrencia/visitas', cuerpo)
  return data
}

export async function actualizarVisita(id: string, cuerpo: Partial<VisitaFormulario>) {
  const { data } = await api.patch<VisitaDetalle>(`/concurrencia/visitas/${id}`, cuerpo)
  return data
}

/** Si el documento ya pasó por un caso de la aseguradora, sus nombres. */
export interface PacienteConocido {
  encontrado: boolean
  nombre_principal: string | null
  nombre_secundario: string | null
  apellido_paterno: string | null
  apellido_materno: string | null
}

export async function buscarPaciente(tipo: string, numero: string) {
  const { data } = await api.get<PacienteConocido>('/concurrencia/pacientes/buscar', {
    params: { tipo, numero },
  })
  return data
}

export async function buscarPacienteSupervision(
  aseguradoraId: string,
  tipo: string,
  numero: string,
) {
  const { data } = await api.get<PacienteConocido>('/concurrencia/supervision/pacientes/buscar', {
    params: { aseguradora_id: aseguradoraId, tipo, numero },
  })
  return data
}

export async function listarPrestadoresDeLaRed() {
  const { data } = await api.get<PrestadorElegible[]>('/concurrencia/prestadores')
  return data
}

/** Las cifras del panel del supervisor de la compañía, ya acotadas por el backend. */
/** Los cuadros del panel. Las mismas cifras para los dos paneles. */
export interface CifrasVisitas {
  /** Sin auditor, en cualquier estado. Solo en supervisión (0 para la compañía). */
  sin_asignar: number
  programadas: number
  /** Derivadas a un auditor que todavía no ha llegado. */
  asignadas: number
  /** El auditor marcó «Ya llegué»; el informe no ha salido. */
  auditando: number
  canceladas: number
  culminadas: number
  no_auditadas: number
  /** Visitas programadas cuya ventana toca el día de HOY, hora de Ecuador. */
  hoy: number
}

export interface DashboardResumen extends CifrasVisitas {
  proximas: VisitaResumen[]
}

/**
 * Cancela el caso. **La única forma de mover el estado desde la compañía**: no
 * hay desplegable de estado en ninguna pantalla, porque el estado es la
 * consecuencia de lo que pasó, y esto es ese algo. El servidor solo lo permite
 * mientras nadie haya llegado.
 */
export async function cancelarVisita(id: string) {
  const { data } = await api.post<VisitaDetalle>(`/concurrencia/visitas/${id}/cancelar`)
  return data
}

/**
 * Una persona registrada por este módulo, ya agrupada por su documento. Es lo
 * que Concurrencia aporta al listado de pacientes de la plataforma.
 */
export interface PacienteRegistrado {
  tipo_documento_codigo: string
  numero_documento: string
  nombre_principal: string
  nombre_secundario: string | null
  apellido_paterno: string
  apellido_materno: string | null
  /** Ya compuesto por el servidor: ninguna pantalla decide el orden del nombre. */
  nombre_completo: string
  casos: number
  primer_caso: string
  ultimo_caso: string
}

export interface PaginaPacientes {
  items: PacienteRegistrado[]
  total: number
  page: number
  page_size: number
}

/** Una persona en concreto, por su documento. 404 si este módulo no la registró. */
export async function obtenerPaciente(tipo: string, numero: string) {
  const { data } = await api.get<PacienteRegistrado>(
    `/concurrencia/pacientes/${encodeURIComponent(tipo)}/${encodeURIComponent(numero)}`,
  )
  return data
}

/** Los pacientes que registró Concurrencia, de la A a la Z. Solo supervisión. */
export async function listarPacientes(filtros: {
  search?: string
  page: number
  page_size: number
}) {
  const { data } = await api.get<PaginaPacientes>('/concurrencia/pacientes', {
    params: {
      search: filtros.search || undefined,
      page: filtros.page,
      page_size: filtros.page_size,
    },
  })
  return data
}

/** Un correo al que el aviso llega siempre, se anote a quien se anote. */
export interface CorreoPorDefecto {
  email: string
  /** Quién es: «creó el caso», «coordinador de Concurrencia»… */
  quien: string
}

/**
 * A quién se avisa SIEMPRE de un caso, además de los correos que se anoten.
 * Sale de la misma función que usa el envío, así que lo que se enseña en el
 * formulario es exactamente lo que va a salir. `aseguradora_id` solo lo obedece
 * la supervisión; a quien es de una compañía se le impone la suya.
 */
export async function listarCorreosPorDefecto(aseguradoraId?: string) {
  const { data } = await api.get<CorreoPorDefecto[]>('/concurrencia/correos-por-defecto', {
    params: { aseguradora_id: aseguradoraId || undefined },
  })
  return data
}

export async function obtenerDashboard() {
  const { data } = await api.get<DashboardResumen>('/concurrencia/dashboard')
  return data
}

// ────────────────── Supervisión de plataforma: derivar casos ─────────────────

export interface VisitaSupervision extends VisitaResumen {
  // La coordinación siempre ve los plazos. En un caso `programada` la hora es
  // provisional —la del registro— hasta que se derive con la hora real.
  desde: string
  hasta: string
  llegada_limite: string
  aseguradora_nombre: string
  auditor_id: string | null
  auditor_nombre: string | null
  /** Si el caso ya tiene informe emitido: sin él no hay PDF que ofrecer. */
  tiene_informe: boolean
}

export interface PaginaSupervision {
  items: VisitaSupervision[]
  total: number
  page: number
  page_size: number
}

export interface AuditorElegible {
  id: string
  nombre_completo: string
  /** Dónde está, para ofrecer primero a los cercanos al destino del caso. */
  ciudad_nombre: string | null
  provincia_nombre: string | null
}

/** Alguien del personal que está o estuvo en Concurrencia. */
export interface PersonaDelFiltro {
  id: string
  nombre_completo: string
  /** «Coordinador», «Auditor · ya no está hasta 18/09/2026»… */
  detalle: string
  vigente: boolean
}

export interface FiltrosSupervision {
  personal: PersonaDelFiltro[]
  aseguradoras: { id: string; nombre: string }[]
}

export async function obtenerFiltrosSupervision() {
  const { data } = await api.get<FiltrosSupervision>('/concurrencia/supervision/filtros')
  return data
}

/** Los usuarios de una compañía que tienen, tuvieron o tocaron casos de Concurrencia. */
export async function usuariosDeAseguradoraSupervision(aseguradoraId: string) {
  const { data } = await api.get<PersonaDelFiltro[]>(
    `/concurrencia/supervision/filtros/aseguradoras/${aseguradoraId}/usuarios`,
  )
  return data
}

export async function listarSupervision(filtros: {
  search?: string
  estado?: string
  sin_asignar?: boolean
  /** `YYYY-MM-DD`. Acota por la ventana de la visita, no por su inicio. */
  desde?: string
  hasta?: string
  /** Los casos de UNA persona: los dos juntos o ninguno. */
  paciente_tipo_documento?: string
  paciente_numero_documento?: string
  /** Trazabilidad: los casos de una compañía y/o en los que intervino una persona. */
  aseguradora_id?: string
  persona_id?: string
  /** Un usuario de la compañía elegida: misma regla de «intervino». */
  usuario_id?: string
  page: number
  page_size: number
}) {
  const { data } = await api.get<PaginaSupervision>('/concurrencia/supervision/visitas', {
    params: {
      search: filtros.search || undefined,
      estado: filtros.estado || undefined,
      sin_asignar: filtros.sin_asignar || undefined,
      desde: filtros.desde || undefined,
      hasta: filtros.hasta || undefined,
      paciente_tipo_documento: filtros.paciente_tipo_documento || undefined,
      paciente_numero_documento: filtros.paciente_numero_documento || undefined,
      aseguradora_id: filtros.aseguradora_id || undefined,
      persona_id: filtros.persona_id || undefined,
      usuario_id: filtros.usuario_id || undefined,
      page: filtros.page,
      page_size: filtros.page_size,
    },
  })
  return data
}

/** Los cuadros del panel de supervisión: las cifras de TODAS las compañías. */
export async function obtenerDashboardSupervision() {
  const { data } = await api.get<CifrasVisitas>('/concurrencia/supervision/dashboard')
  return data
}

export interface VisitaSupervisionDetalle extends VisitaSupervision, PolizaYTitular {
  /** Cómo llegó el requerimiento, si lo programó la coordinación (interno). */
  requerimiento_medio: 'correo' | 'otro' | null
  requerimiento_medio_detalle: string | null
  requerimiento_recibido_at: string | null
  /** Las cuatro partes: esta vista enseña el caso tal como se capturó. */
  paciente_nombre_principal: string
  paciente_nombre_secundario: string | null
  paciente_apellido_paterno: string
  paciente_apellido_materno: string | null
  observaciones: string | null
  correos: CorreoVisita[]
  tiene_comprobante: boolean
  tiene_informe: boolean
}

/** El caso entero, tal como lo capturó la compañía, para verlo tal cual. */
export async function obtenerVisitaSupervision(id: string) {
  const { data } = await api.get<VisitaSupervisionDetalle>(
    `/concurrencia/supervision/visitas/${id}`,
  )
  return data
}

export async function listarAuditores() {
  const { data } = await api.get<AuditorElegible[]>('/concurrencia/supervision/auditores')
  return data
}

/** Una compañía activa con Concurrencia, para el alta desde plataforma. */
export interface AseguradoraElegible {
  id: string
  nombre: string
}

export async function listarAseguradorasSupervision() {
  const { data } = await api.get<AseguradoraElegible[]>('/concurrencia/supervision/aseguradoras')
  return data
}

/** La red de ESA aseguradora: el coordinador elige compañía y luego prestador. */
export async function listarPrestadoresDeAseguradora(aseguradoraId: string) {
  const { data } = await api.get<PrestadorElegible[]>(
    `/concurrencia/supervision/aseguradoras/${aseguradoraId}/prestadores`,
  )
  return data
}

/** El alta desde plataforma: el mismo formulario más la aseguradora elegida. */
export async function crearVisitaSupervision(
  cuerpo: VisitaFormulario & {
    aseguradora_id: string
    // Cómo llegó el requerimiento (26/10/2026): obligatorio en este alta.
    requerimiento_medio: 'correo' | 'otro'
    requerimiento_medio_detalle: string | null
    requerimiento_recibido_at: string
  },
) {
  const { data } = await api.post<VisitaSupervisionDetalle>(
    '/concurrencia/supervision/visitas',
    cuerpo,
  )
  return data
}

/**
 * `null` deja el caso sin asignar; un id lo deriva a ese auditor, **con la
 * ventana en que debe ir** —desde y hasta, ISO con zona—: sin ella el servidor
 * no deriva. El «hasta» es el plazo de llegada.
 */
export async function asignarAuditor(
  visitaId: string,
  auditorId: string | null,
  desde?: string,
  hasta?: string,
) {
  const { data } = await api.patch<VisitaSupervision>(
    `/concurrencia/supervision/visitas/${visitaId}/auditor`,
    { auditor_id: auditorId, desde, hasta },
  )
  return data
}

/** Cambia la ventana de la visita y dispara el aviso de reprogramación. */
export async function subirComprobante(id: string, archivo: File) {
  const cuerpo = new FormData()
  cuerpo.append('archivo', archivo)
  // Sin Content-Type explícito: el navegador debe poner el boundary del multipart.
  const { data } = await api.post<VisitaSupervisionDetalle>(
    `/concurrencia/supervision/visitas/${id}/comprobante`,
    cuerpo,
    { headers: { 'Content-Type': undefined } },
  )
  return data
}

export function urlComprobante(id: string) {
  return `/api/v1/concurrencia/supervision/visitas/${id}/comprobante`
}

/** Las horas de SLA de MI compañía para Concurrencia: de ahí sale la entrega. */
export async function obtenerSla() {
  const { data } = await api.get<{ horas: number }>('/concurrencia/sla')
  return data
}

/** Lo mismo para el coordinador, que elige de qué compañía nace el caso. */
export async function obtenerSlaSupervision(aseguradoraId: string) {
  const { data } = await api.get<{ horas: number }>('/concurrencia/supervision/sla', {
    params: { aseguradora_id: aseguradoraId },
  })
  return data
}

/**
 * La prórroga del coordinador: más horas para que llegue el auditor, contadas
 * desde ahora. Devuelve el plazo nuevo y el estado en el que queda el caso.
 */
export async function prorrogarVisita(visitaId: string, horas: number) {
  const { data } = await api.post<{ llegada_limite: string; estado: string }>(
    `/concurrencia/supervision/visitas/${visitaId}/prorroga`,
    { horas },
  )
  return data
}

// ─────────────── Reportería del coordinador (27/10/2026) ───────────────

export type EstadoSla = 'a_tiempo' | 'fuera_de_plazo' | 'vencido' | 'en_plazo' | 'cancelado'

export interface CuentaSla {
  casos: number
  a_tiempo: number
  fuera_de_plazo: number
  vencido: number
  en_plazo: number
  cancelado: number
  /** A tiempo entre lo que ya se puede juzgar (entregado o vencido); null si nada. */
  cumplimiento: number | null
}

export interface CasoSla {
  id: string
  codigo_interno: string
  aseguradora: string
  /** «correo» / «otro» si lo programó la coordinación; «sistema» si la compañía. */
  origen: string
  inicio_sla: string
  limite: string
  entregado_at: string | null
  horas: number
  horas_sla: number
  estado_sla: EstadoSla
}

export interface ReporteSla {
  total: CuentaSla
  por_aseguradora: (CuentaSla & { aseguradora: string })[]
  casos: CasoSla[]
}

export interface CuentaSexo {
  auditados: number
  femenino: number
  masculino: number
  no_consta: number
}

export interface ReporteSexo {
  total: CuentaSexo
  por_aseguradora: (CuentaSexo & { aseguradora: string })[]
}

export interface FiltrosReporte {
  desde?: string
  hasta?: string
  aseguradora_id?: string
}

function paramsDeReporte(f: FiltrosReporte) {
  return {
    desde: f.desde || undefined,
    hasta: f.hasta || undefined,
    aseguradora_id: f.aseguradora_id || undefined,
  }
}

export async function obtenerReporteSla(filtros: FiltrosReporte) {
  const { data } = await api.get<ReporteSla>('/concurrencia/supervision/reportes/sla', {
    params: paramsDeReporte(filtros),
  })
  return data
}

export async function obtenerReporteSexo(filtros: FiltrosReporte) {
  const { data } = await api.get<ReporteSexo>('/concurrencia/supervision/reportes/sexo', {
    params: paramsDeReporte(filtros),
  })
  return data
}

export interface CuentaEdad {
  auditados: number
  de_1_a_20: number
  de_21_a_40: number
  de_41_a_60: number
  mas_de_60: number
  no_consta: number
}

export interface ReporteEdad {
  total: CuentaEdad
  por_aseguradora: (CuentaEdad & { aseguradora: string })[]
}

export async function obtenerReporteEdad(filtros: FiltrosReporte) {
  const { data } = await api.get<ReporteEdad>('/concurrencia/supervision/reportes/edad', {
    params: paramsDeReporte(filtros),
  })
  return data
}
