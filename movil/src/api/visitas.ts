import { Directory, File, Paths } from 'expo-file-system'

import { api, urlDeApi } from './cliente'
import { leerToken } from '../sesion/almacen'

export interface CasoAsignado {
  id: string
  codigo_interno: string
  /** Ya compuesto por el servidor: nombres y después apellidos. */
  paciente_nombre_completo: string
  paciente_numero_documento: string
  aseguradora_nombre: string
  prestador_nombre: string
  sede_nombre: string | null
  lugar: string | null
  ciudad_nombre: string | null
  provincia_nombre: string | null
  desde: string
  hasta: string
  estado: string
  observaciones: string | null
  /** A quién se avisa, con la etiqueta de quién es cada correo (si la anotaron). */
  correos: { email: string; etiqueta: string | null }[]
  /** El punto exacto del destino, para abrir el mapa. Nulos si no consta. */
  destino_latitud: number | null
  destino_longitud: number | null
}

/**
 * Los casos derivados al propio auditor, completos. El servidor los acota por
 * `auditor_id = su id`: la app no manda parámetros y no puede pedir los de otro.
 */
export async function misCasos(): Promise<CasoAsignado[]> {
  return api<CasoAsignado[]>('/concurrencia/auditor/visitas')
}

// ─── El panel del caso: notas dictadas + informe de la IA ────────────────────

export type TipoNota = 'historial_clinico' | 'charla_enfermeria' | 'charla_medico' | 'observacion'

export interface Nota {
  id: string
  tipo: TipoNota
  texto: string
  creada_at: string
}

export interface FotoCaso {
  id: string
  creada_at: string
}

export interface PanelCaso {
  notas: Nota[]
  fotos: FotoCaso[]
  informe: string | null
  informe_actualizado_at: string | null
  /** Cuándo el auditor marcó «Ya llegué»; nulo si todavía no llegó. */
  llegada_at: string | null
}

export async function panelDeCaso(visitaId: string): Promise<PanelCaso> {
  return api<PanelCaso>(`/concurrencia/auditor/visitas/${visitaId}/panel`)
}

/**
 * Marca la llegada al destino. El servidor la guarda con su propia hora: si la
 * ventana vence sin esta marca, el caso pasa solo a «no auditado».
 */
export async function registrarLlegada(visitaId: string): Promise<void> {
  return api<void>(`/concurrencia/auditor/visitas/${visitaId}/llegada`, { metodo: 'POST' })
}

export async function crearNota(visitaId: string, tipo: TipoNota, texto: string): Promise<Nota> {
  return api<Nota>(`/concurrencia/auditor/visitas/${visitaId}/notas`, {
    metodo: 'POST',
    cuerpo: { tipo, texto },
  })
}

export async function eliminarNota(visitaId: string, notaId: string): Promise<void> {
  return api<void>(`/concurrencia/auditor/visitas/${visitaId}/notas/${notaId}`, {
    metodo: 'DELETE',
  })
}

/**
 * Sube una foto del caso (expediente, resultados, estado de cuenta). El
 * servidor valida que sea imagen de verdad y la guarda con el caso: la IA la
 * recibirá junto a las notas al redactar el informe.
 */
export async function subirFoto(visitaId: string, uri: string): Promise<FotoCaso> {
  const cuerpo = new FormData()
  // El fetch estándar del SDK 57 ya no acepta la parte {uri, name, type} de
  // React Native («unsupported FormDataPart implementation»): se adjunta un
  // File de expo-file-system, que implementa la interfaz Blob y pone solo su
  // nombre y tipo. El servidor igual valida el contenido real con magic.
  cuerpo.append('archivo', new File(uri) as unknown as Blob)
  return api(`/concurrencia/auditor/visitas/${visitaId}/fotos`, {
    metodo: 'POST',
    cuerpo,
  })
}

export async function eliminarFoto(visitaId: string, fotoId: string): Promise<void> {
  return api<void>(`/concurrencia/auditor/visitas/${visitaId}/fotos/${fotoId}`, {
    metodo: 'DELETE',
  })
}

/** La URL de la imagen; la miniatura la pide con el Bearer en la cabecera. */
export function urlFoto(visitaId: string, fotoId: string): string {
  return urlDeApi(`/concurrencia/auditor/visitas/${visitaId}/fotos/${fotoId}`)
}

/**
 * Sube el audio dictado y devuelve su texto, transcrito en el servidor con
 * Whisper local: el audio clínico no sale de ahí y no se conserva.
 */
export async function dictar(visitaId: string, uri: string): Promise<{ texto: string }> {
  const cuerpo = new FormData()
  // Igual que la foto: un File de expo-file-system, no el {uri} legacy de RN.
  cuerpo.append('archivo', new File(uri) as unknown as Blob)
  return api(`/concurrencia/auditor/visitas/${visitaId}/dictado`, {
    metodo: 'POST',
    cuerpo,
  })
}

/**
 * Baja el PDF del informe (con el Bearer en la cabecera) a la caché del
 * teléfono y devuelve su URI local, lista para abrir o compartir.
 */
export async function descargarInformePdf(visitaId: string): Promise<string> {
  const token = await leerToken()
  const archivo = await File.downloadFileAsync(
    urlDeApi(`/concurrencia/auditor/visitas/${visitaId}/informe.pdf`),
    new Directory(Paths.cache),
    {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      idempotent: true,
    },
  )
  return archivo.uri
}

/**
 * Envía el informe en PDF a todos los correos marcados del caso. El servidor
 * valida y responde al instante; los correos salen detrás, en su tarea de
 * fondo, para que una red con el SMTP lento no cuelgue el botón.
 */
export async function enviarInforme(visitaId: string): Promise<{ destinatarios: number }> {
  return api(`/concurrencia/auditor/visitas/${visitaId}/informe/enviar`, { metodo: 'POST' })
}

/**
 * Corrige el informe con lo que el auditor dicta tras revisarlo: la IA aplica
 * SOLO esas correcciones y conserva el resto palabra por palabra.
 */
export async function corregirInforme(
  visitaId: string,
  instrucciones: string,
): Promise<{ informe: string; informe_actualizado_at: string }> {
  return api(`/concurrencia/auditor/visitas/${visitaId}/informe/corregir`, {
    metodo: 'POST',
    cuerpo: { instrucciones },
  })
}

/** Manda las notas a la IA y devuelve el informe redactado (o el error claro). */
export async function generarInforme(
  visitaId: string,
): Promise<{ informe: string; informe_actualizado_at: string }> {
  return api(`/concurrencia/auditor/visitas/${visitaId}/informe`, { metodo: 'POST' })
}
