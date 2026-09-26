import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { motion, useReducedMotion } from 'framer-motion'
import { ArrowLeft, Download, FileSpreadsheet, UploadCloud } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { subirListadoPrecios, urlListadoPrecios } from '@/shared/aseguradoras/api'
import {
  guardarValoresFC,
  obtenerValoresFC,
  MODOS_FC,
  type ConceptoFCFormulario,
  type ModoFC,
} from '@/shared/prestadores/api'
import { Boton } from '@/shared/components/ui/button'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { GrupoDeOpciones } from '@/shared/components/ui/opciones'
import { Select } from '@/shared/components/ui/select'
import { useToast } from '@/shared/components/ui/toast'

const EASE: [number, number, number, number] = [0.22, 0.61, 0.36, 1]

/** Cómo se llama la cifra según cómo se pacte el concepto. */
const ETIQUETA_DEL_VALOR: Record<ModoFC, string> = {
  punto: 'Valor por punto',
  porcentaje: 'Porcentaje',
  fijo: 'Precio fijo',
}

const EJEMPLO: Record<ModoFC, string> = {
  punto: '45,00',
  porcentaje: '30',
  fijo: '120,00',
}

const dinero = new Intl.NumberFormat('es-EC', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
})

function mensajeDeError(error: unknown, porDefecto: string): string {
  const detalle = (error as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
  return typeof detalle === 'string' ? detalle : porDefecto
}

/** Texto a número, aceptando la coma decimal que se teclea aquí. */
function aNumero(texto: string): number | null {
  const limpio = texto.trim().replace(',', '.')
  if (!limpio) return null
  const valor = Number(limpio)
  return Number.isFinite(valor) ? valor : null
}

function aTexto(valor: number | null): string {
  return valor === null || valor === undefined ? '' : String(valor)
}

/**
 * El importe al que sale un porcentaje, sobre el concepto que se haya elegido
 * como base. Se calcula aquí y también en el servidor, con la misma fórmula:
 * esto es para verlo mientras se teclea, no la fuente de verdad.
 */
function derivado(conceptos: ConceptoFCFormulario[], fila: ConceptoFCFormulario): string {
  const base = conceptos.find((c) => c.concepto === fila.base)
  // Un porcentaje de un porcentaje no es un importe: no se encadenan.
  if (!base || base.modo === 'porcentaje') return '—'
  const b = aNumero(base.valor)
  const p = aNumero(fila.valor)
  if (b === null || p === null) return '—'
  return dinero.format(Math.round(((b * p) / 100) * 100) / 100)
}

/**
 * Los conceptos que pueden servir de base a un porcentaje: cualquiera menos él
 * mismo y menos los que también son porcentajes. **No se encadenan**: un
 * porcentaje se calcula sobre un valor, no sobre otro porcentaje.
 */
function basesPosibles(
  conceptos: ConceptoFCFormulario[],
  fila: ConceptoFCFormulario,
): ConceptoFCFormulario[] {
  return conceptos.filter((c) => c.concepto !== fila.concepto && c.modo !== 'porcentaje')
}

type Pestana = 'listado' | 'fc'

/** Cómo se lee la red del convenio. Las dos casillas marcadas son «ambas». */
function rotuloDeRed({ privada, publica }: { privada: boolean; publica: boolean }): string {
  if (privada && publica) return 'privada y pública'
  return publica ? 'pública' : 'privada'
}

/**
 * El detalle de UN convenio de la red, como página dentro de la pestaña:
 * «Editar» reemplaza la lista por esta vista y «Volver a la red» la devuelve.
 * Dos secciones: el listado de precios (un solo archivo, PDF o Excel, que se
 * reemplaza al subir otro) y los valores FC con los que se liquida.
 *
 * **No sabe desde qué lado se abre.** El convenio es una fila entre una
 * compañía y un prestador, así que recibe los dos identificadores y el rótulo
 * ya compuesto: desde la aseguradora se lee el nombre del prestador, y desde el
 * prestador el de la compañía. La misma pieza, los mismos endpoints.
 */
export function ConvenioDetalle({
  aseguradoraId,
  prestadorId,
  convenioId,
  titulo,
  subtitulo,
  listadoNombre,
  red,
  onListadoSubido,
  onVolver,
}: {
  aseguradoraId: string
  prestadorId: string
  convenioId: string
  titulo: string
  /** Lo que identifica a la contraparte: código, tipo, ciudad… */
  subtitulo: string
  listadoNombre: string | null
  red: { privada: boolean; publica: boolean }
  /** Para que quien monta el detalle refresque SU lista sin esperar un refetch. */
  onListadoSubido: (nombre: string) => void
  onVolver: () => void
}) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const sinMovimiento = useReducedMotion()

  const [pestana, setPestana] = useState<Pestana>('listado')
  const [archivo, setArchivo] = useState<File | null>(null)
  const [form, setForm] = useState<ConceptoFCFormulario[]>([])
  const inputArchivo = useRef<HTMLInputElement>(null)

  const valores = useQuery({
    queryKey: ['valores-fc', convenioId],
    queryFn: () => obtenerValoresFC(prestadorId, convenioId),
  })

  // El catálogo de conceptos, su orden y el modo con el que nace cada uno los
  // manda el servidor: esta pantalla solo los pinta.
  useEffect(() => {
    if (!valores.data) return
    setForm(
      valores.data.conceptos.map((c) => ({
        concepto: c.concepto,
        nombre: c.nombre,
        modo: c.modo,
        valor: aTexto(c.valor),
        base: c.base,
      })),
    )
  }, [valores.data])

  const subida = useMutation({
    mutationFn: () => subirListadoPrecios(aseguradoraId, prestadorId, archivo!),
    onSuccess: ({ listado_precios_nombre }) => {
      // La fila de la lista se actualiza en sitio: sin esperar un refetch.
      onListadoSubido(listado_precios_nombre)
      setArchivo(null)
      if (inputArchivo.current) inputArchivo.current.value = ''
      toast.exito('Listado de precios guardado')
    },
    onError: (error) => toast.error(mensajeDeError(error, 'No se pudo subir el listado')),
  })

  const guardarFC = useMutation({
    mutationFn: () =>
      guardarValoresFC(
        prestadorId,
        convenioId,
        form.map((c) => ({
          concepto: c.concepto,
          modo: c.modo,
          valor: aNumero(c.valor),
          base: c.modo === 'porcentaje' ? c.base : null,
        })),
      ),
    onSuccess: (nuevos) => {
      queryClient.setQueryData(['valores-fc', convenioId], nuevos)
      toast.exito('Valores FC guardados')
    },
    onError: (error) => toast.error(mensajeDeError(error, 'No se pudieron guardar los valores')),
  })

  function subir() {
    if (!archivo) return toast.error('Elige el archivo del listado: un PDF o un Excel')
    subida.mutate()
  }

  function enviarFC() {
    for (const fila of form) {
      const valor = aNumero(fila.valor)
      if (valor !== null && valor < 0) {
        return toast.error(`«${fila.nombre}»: el valor no puede ser negativo`)
      }
      if (fila.modo !== 'porcentaje') continue
      if (valor !== null && valor > 100) {
        return toast.error(`«${fila.nombre}»: el porcentaje tiene que estar entre 0 y 100`)
      }
      if (!fila.base) {
        return toast.error(`«${fila.nombre}» es un porcentaje: indica de qué concepto sale`)
      }
    }
    guardarFC.mutate()
  }

  /** Cambia un campo de UN concepto; los demás se quedan como están. */
  function cambiar(concepto: string, cambios: Partial<ConceptoFCFormulario>) {
    setForm((previo) =>
      previo.map((c) => (c.concepto === concepto ? { ...c, ...cambios } : c)),
    )
  }

  /**
   * Cambiar cómo se pacta un concepto arrastra dos cosas: al dejar de ser
   * porcentaje pierde su base, y al PASAR a serlo deja de poder ser base de
   * otros —no se encadenan—, así que quien lo tuviera elegido se queda sin base
   * y tendrá que elegir otra. Vale más que se note aquí que un error al guardar.
   */
  function cambiarModo(concepto: string, modo: ModoFC) {
    setForm((previo) =>
      previo.map((c) => {
        if (c.concepto === concepto) {
          const base =
            modo !== 'porcentaje'
              ? null
              : (c.base ??
                previo.find((o) => o.concepto !== concepto && o.modo !== 'porcentaje')?.concepto ??
                null)
          return { ...c, modo, base }
        }
        if (modo === 'porcentaje' && c.base === concepto) return { ...c, base: null }
        return c
      }),
    )
  }

  return (
    <motion.div
      initial={sinMovimiento ? { opacity: 0 } : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: EASE }}
      className="space-y-5"
    >
      <div className="flex flex-wrap items-center gap-3">
        <Boton type="button" variante="contorno" tamano="sm" onClick={onVolver}>
          <ArrowLeft aria-hidden="true" />
          Volver a la red
        </Boton>
        <div className="min-w-0">
          <h3 className="truncate font-display text-sm font-semibold">{titulo}</h3>
          <p className="truncate text-xs text-tenue-fg">
            {/* La red que cubre, de solo lectura: se elige en la lista, junto
                a la casilla que crea el convenio. */}
            {[subtitulo, `Red ${rotuloDeRed(red)}`].filter(Boolean).join(' · ')}
          </p>
        </div>
      </div>

      <div
        role="tablist"
        aria-label="Secciones del convenio"
        className="flex w-full gap-1 rounded-md bg-tenue p-1"
      >
        {(
          [
            ['listado', 'Listado de precios'],
            ['fc', 'Valor FC'],
          ] as const
        ).map(([clave, etiqueta]) => (
          <button
            key={clave}
            type="button"
            role="tab"
            aria-selected={pestana === clave}
            onClick={() => setPestana(clave)}
            className={
              pestana === clave
                ? 'flex-1 rounded-[5px] bg-superficie px-3 py-1.5 text-sm font-medium shadow-sm'
                : 'flex-1 rounded-[5px] px-3 py-1.5 text-sm font-medium text-tenue-fg transition-colors hover:text-tinta'
            }
          >
            {etiqueta}
          </button>
        ))}
      </div>

      {pestana === 'listado' ? (
        <div className="space-y-4">
          {listadoNombre ? (
            <div className="flex items-center justify-between gap-3 rounded-md border border-borde bg-tenue/40 px-4 py-3">
              <p className="flex min-w-0 items-center gap-2 text-sm">
                <FileSpreadsheet className="size-4 shrink-0 text-oro" aria-hidden="true" />
                <span className="truncate">{listadoNombre}</span>
              </p>
              <a
                href={urlListadoPrecios(aseguradoraId, prestadorId)}
                className="flex shrink-0 items-center gap-1.5 text-sm font-medium text-oro hover:underline"
              >
                <Download className="size-4" aria-hidden="true" />
                Descargar
              </a>
            </div>
          ) : (
            <p className="rounded-md border border-dashed border-borde px-4 py-6 text-center text-sm text-tenue-fg">
              Este convenio todavía no tiene listado de precios.
            </p>
          )}

          <div className="space-y-2">
            <Label htmlFor="listado-archivo">Archivo (PDF o Excel) — solo uno</Label>
            <input
              ref={inputArchivo}
              id="listado-archivo"
              type="file"
              accept=".pdf,.xls,.xlsx,application/pdf,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={(e) => setArchivo(e.target.files?.[0] ?? null)}
              className="block w-full cursor-pointer rounded-md border border-borde bg-fondo text-sm text-tenue-fg file:mr-3 file:cursor-pointer file:rounded-l-md file:border-0 file:bg-tenue file:px-4 file:py-2.5 file:text-sm file:font-medium file:text-tinta"
            />
            <p className="text-xs text-tenue-fg">
              Subir otro archivo reemplaza al vigente. El tipo se comprueba en el servidor
              sobre el contenido real.
            </p>
          </div>

          <Boton
            type="button"
            onClick={subir}
            cargando={subida.isPending}
            disabled={!archivo}
          >
            <UploadCloud aria-hidden="true" />
            {listadoNombre ? 'Reemplazar listado' : 'Subir listado'}
          </Boton>
        </div>
      ) : valores.isPending ? (
        <div className="space-y-3" role="status" aria-label="Cargando los valores">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="h-16 animate-pulse rounded-md bg-tenue" />
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          {/* Un bloque por concepto, uno debajo de otro: se leen en el orden en
              que se pactan y cada uno ocupa el ancho entero, que es lo que
              necesita el que tiene tres decisiones dentro. */}
          <p className="text-sm text-tenue-fg">
            Cada concepto se pacta como toque: por punto del tarifario, como porcentaje de
            otro concepto, o a precio fijo.
          </p>

          {form.map((fila, indice) => {
            const bases = basesPosibles(form, fila)
            return (
              <motion.div
                key={fila.concepto}
                initial={sinMovimiento ? { opacity: 0 } : { opacity: 0, y: 6 }}
                animate={{
                  opacity: 1,
                  y: 0,
                  transition: {
                    duration: 0.2,
                    delay: sinMovimiento ? 0 : Math.min(indice, 8) * 0.03,
                    ease: EASE,
                  },
                }}
                className="rounded-md border border-borde bg-superficie p-4"
              >
                <p className="font-display text-sm font-medium">{fila.nombre}</p>

                <GrupoDeOpciones
                  className="mt-3"
                  etiqueta={`Cómo se pacta ${fila.nombre}`}
                  valor={fila.modo}
                  opciones={MODOS_FC.map((m) => ({ valor: m.modo, etiqueta: m.etiqueta }))}
                  onCambiar={(modo) => cambiarModo(fila.concepto, modo)}
                />
                <p className="mt-2 text-xs text-tenue-fg">
                  {MODOS_FC.find((m) => m.modo === fila.modo)?.ayuda}
                </p>

                <div className="mt-3 grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor={`fc-${fila.concepto}`}>
                      {ETIQUETA_DEL_VALOR[fila.modo]}
                      {fila.modo === 'porcentaje' && ' (%)'}
                    </Label>
                    <Input
                      id={`fc-${fila.concepto}`}
                      inputMode="decimal"
                      value={fila.valor}
                      onChange={(e) => cambiar(fila.concepto, { valor: e.target.value })}
                      placeholder={EJEMPLO[fila.modo]}
                      className="tabular"
                    />
                  </div>

                  {fila.modo === 'porcentaje' && (
                    <div className="space-y-2">
                      <Label htmlFor={`base-${fila.concepto}`}>
                        Sobre qué concepto <span className="text-peligro">*</span>
                      </Label>
                      <Select
                        id={`base-${fila.concepto}`}
                        value={fila.base ?? ''}
                        onChange={(e) => cambiar(fila.concepto, { base: e.target.value || null })}
                      >
                        <option value="">Elige un concepto…</option>
                        {bases.map((b) => (
                          <option key={b.concepto} value={b.concepto}>
                            {b.nombre}
                          </option>
                        ))}
                      </Select>
                      {/* El importe no se guarda: se calcula sobre el concepto
                          base, aquí para verlo mientras se teclea y en el
                          servidor para cualquiera que lo consulte. */}
                      <p className="tabular text-xs text-tenue-fg" aria-live="polite">
                        = {derivado(form, fila)}
                      </p>
                    </div>
                  )}
                </div>
              </motion.div>
            )
          })}


          <Boton type="button" onClick={enviarFC} cargando={guardarFC.isPending}>
            Guardar valores
          </Boton>
        </div>
      )}
    </motion.div>
  )
}
