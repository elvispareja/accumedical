import { Directory, File, Paths } from 'expo-file-system'
import { useEffect, useState } from 'react'

import { ErrorDeApi } from './api/cliente'
import { crearNota, dictar, subirFoto, type CasoAsignado, type TipoNota } from './api/visitas'

/**
 * **Lo que el auditor hace sin internet** (28/10/2026, pedido del usuario):
 * notas escritas, dictados y fotos se guardan en el teléfono y se envían
 * solos cuando vuelve la señal.
 *
 * Dónde: el directorio de documentos DE LA APP, una carpeta por usuario. Es el
 * espacio privado de la app —ninguna otra lo lee, no pasa a la galería— y el
 * propio teléfono lo cifra (cifrado de almacenamiento de Android, Data
 * Protection de iOS). Cada cosa se borra en cuanto el servidor la confirma, y
 * todo lo del usuario al cerrar sesión.
 *
 * Un reenvío no duplica: el servidor reconoce la misma nota y la misma foto.
 * Un dictado transcrito queda aquí como «transcrito» hasta que el auditor abre
 * el caso y el texto cae en su cuadro, para revisarlo antes de guardarlo.
 */

type Base = { id: string; visitaId: string; creado: string; error?: string }
export type Pendiente =
  | (Base & { clase: 'nota'; tipo: TipoNota; texto: string })
  | (Base & { clase: 'foto'; archivo: string })
  | (Base & { clase: 'dictado'; archivo: string; destino: 'nota' | 'correccion' })
  | (Base & { clase: 'transcrito'; texto: string; destino: 'nota' | 'correccion' })

const RAIZ = new Directory(Paths.document, 'pendientes')
let usuario: string | null = null
let lista: Pendiente[] = []
const oyentes = new Set<() => void>()

function carpeta(): Directory {
  return new Directory(RAIZ, usuario ?? 'sin-sesion')
}

function nuevoId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function avisar() {
  for (const oyente of oyentes) oyente()
}

async function guardarIndice() {
  await new File(carpeta(), 'indice.json').write(JSON.stringify(lista))
  avisar()
}

/** Para repintar cuando algo se agrega, se envía o falla. */
export function suscribir(oyente: () => void): () => void {
  oyentes.add(oyente)
  return () => {
    oyentes.delete(oyente)
  }
}

/** Los pendientes (de un caso, o todos), y repinta cuando cambian. */
export function usePendientes(visitaId?: string): Pendiente[] {
  const [, setVersion] = useState(0)
  useEffect(() => suscribir(() => setVersion((v) => v + 1)), [])
  return pendientes(visitaId)
}

/** Abre la carpeta del usuario que entró y carga lo que dejó pendiente. */
export async function abrirParaUsuario(id: string): Promise<void> {
  usuario = id
  const dir = carpeta()
  dir.create({ intermediates: true, idempotent: true })
  const indice = new File(dir, 'indice.json')
  try {
    lista = indice.exists ? (JSON.parse(await indice.text()) as Pendiente[]) : []
  } catch {
    lista = []
  }
  avisar()
}

export function pendientes(visitaId?: string): Pendiente[] {
  return visitaId ? lista.filter((p) => p.visitaId === visitaId) : lista
}

/** Lo que todavía no llegó al servidor (un transcrito ya llegó: solo espera al auditor). */
export function porEnviar(visitaId?: string): Pendiente[] {
  return pendientes(visitaId).filter((p) => p.clase !== 'transcrito')
}

/**
 * ¿Falló por falta de red (o un tropiezo del servidor) y vale la pena guardar
 * y reintentar? Un 4xx no: es un error de verdad y se dice tal cual.
 */
export function esFaltaDeRed(error: unknown): boolean {
  if (error instanceof ErrorDeApi) {
    return error.status >= 500 || [401, 408, 429].includes(error.status)
  }
  return true
}

export async function guardarNota(visitaId: string, tipo: TipoNota, texto: string) {
  const creado = new Date().toISOString()
  lista = [...lista, { id: nuevoId(), visitaId, creado, clase: 'nota', tipo, texto }]
  await guardarIndice()
}

/** Copia el archivo (la foto ya en JPEG, o el audio) a la carpeta privada. */
export async function guardarArchivo(
  visitaId: string,
  uri: string,
  clase: 'foto' | 'dictado',
  destino: 'nota' | 'correccion' = 'nota',
) {
  const id = nuevoId()
  const copia = new File(carpeta(), `${id}${clase === 'foto' ? '.jpg' : '.m4a'}`)
  await new File(uri).copy(copia)
  const base = { id, visitaId, creado: new Date().toISOString(), archivo: copia.uri }
  lista = [...lista, clase === 'foto' ? { ...base, clase } : { ...base, clase, destino }]
  await guardarIndice()
}

function borrarArchivo(p: Pendiente) {
  if (p.clase === 'foto' || p.clase === 'dictado') {
    try {
      const archivo = new File(p.archivo)
      if (archivo.exists) archivo.delete()
    } catch {
      // ya no estaba: nada que borrar
    }
  }
}

export async function descartar(id: string) {
  const p = lista.find((x) => x.id === id)
  if (p) borrarArchivo(p)
  lista = lista.filter((x) => x.id !== id)
  await guardarIndice()
}

/** Los dictados ya transcritos de un caso: salen de la cola para ir a su cuadro. */
export async function tomarTranscritos(visitaId: string) {
  const listos = lista.filter(
    (p): p is Extract<Pendiente, { clase: 'transcrito' }> =>
      p.visitaId === visitaId && p.clase === 'transcrito',
  )
  if (listos.length === 0) return []
  lista = lista.filter((p) => !listos.includes(p as never))
  await guardarIndice()
  return listos
}

let enviando = false

/**
 * Manda lo pendiente, en el orden en que se hizo. Sin red se detiene en el
 * primero y espera al siguiente intento; un error de verdad (un 4xx) se anota
 * en ESE pendiente, que deja de reintentarse y se le enseña al auditor.
 */
export async function enviarPendientes(): Promise<void> {
  if (enviando || !usuario) return
  enviando = true
  try {
    for (const p of [...lista]) {
      if (p.clase === 'transcrito' || p.error) continue
      try {
        if (p.clase === 'nota') {
          await crearNota(p.visitaId, p.tipo, p.texto)
          lista = lista.filter((x) => x.id !== p.id)
        } else if (p.clase === 'foto') {
          await subirFoto(p.visitaId, p.archivo)
          borrarArchivo(p)
          lista = lista.filter((x) => x.id !== p.id)
        } else {
          const { texto } = await dictar(p.visitaId, p.archivo)
          borrarArchivo(p)
          lista = lista.map((x) =>
            x.id !== p.id
              ? x
              : texto
                ? {
                    id: p.id,
                    visitaId: p.visitaId,
                    creado: p.creado,
                    clase: 'transcrito',
                    texto,
                    destino: p.destino,
                  }
                : { ...p, error: 'No se entendió nada en el audio.' },
          )
        }
      } catch (error) {
        if (esFaltaDeRed(error)) break
        const motivo = error instanceof Error ? error.message : String(error)
        lista = lista.map((x) => (x.id === p.id ? { ...x, error: motivo } : x))
      }
      await guardarIndice()
    }
  } finally {
    enviando = false
    avisar()
  }
}

// ─── Los casos, para abrir la app sin señal ─────────────────────────────────

export async function guardarCasos(casos: CasoAsignado[]) {
  if (!usuario) return
  try {
    await new File(carpeta(), 'casos.json').write(JSON.stringify(casos))
  } catch {
    // sin espacio o sin carpeta: la próxima carga lo intenta de nuevo
  }
}

export async function leerCasos(): Promise<CasoAsignado[] | null> {
  const archivo = new File(carpeta(), 'casos.json')
  try {
    return archivo.exists ? (JSON.parse(await archivo.text()) as CasoAsignado[]) : null
  } catch {
    return null
  }
}

/** Al cerrar sesión: nada del usuario se queda en el teléfono. */
export function borrarTodo() {
  try {
    const dir = carpeta()
    if (dir.exists) dir.delete()
  } catch {
    // ya no estaba
  }
  lista = []
  usuario = null
  avisar()
}
