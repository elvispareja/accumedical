import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FileText, Pencil, Trash2, UploadCloud } from 'lucide-react'
import { useRef, useState } from 'react'

import { cn } from '@/lib/utils'
import {
  eliminarPoliza,
  fijarContrato,
  FORMAS_PAGO_MEDICAMENTOS,
  listarPolizas,
  subirPoliza,
  UNIDADES_TARIFA,
  urlPoliza,
  type CategoriaDocumento,
  type Contrato,
  type ContratoEntrada,
  type FormaPagoMedicamentos,
  type Poliza,
  type UnidadTarifa,
} from '@/shared/aseguradoras/api'
import { Boton } from '@/shared/components/ui/button'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { Select } from '@/shared/components/ui/select'
import { useToast } from '@/shared/components/ui/toast'

function mensajeDeError(error: unknown, porDefecto: string): string {
  const detalle = (error as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
  return typeof detalle === 'string' ? detalle : porDefecto
}

// ─── Los datos del contrato (6/11/2026, especificación de la Central, M1) ────

/** Mientras se escribe: todo texto («0,0» a medias no es un número). */
interface ContratoFormulario {
  vigencia_desde: string
  vigencia_hasta: string
  tarifa: string
  tarifa_unidad: UnidadTarifa | ''
  revision_tarifa: string
  forma_pago_medicamentos: FormaPagoMedicamentos | ''
}

function contratoVacio(): ContratoFormulario {
  return {
    vigencia_desde: '',
    vigencia_hasta: '',
    tarifa: '',
    tarifa_unidad: '',
    revision_tarifa: '',
    forma_pago_medicamentos: '',
  }
}

/** «0.0500» → «0,05»; «0.0450» → «0,045»; «1500.0000» → «1500,00». Con coma, como se teclea. */
function tarifaParaEditar(tarifa: string): string {
  const [entero, decimales = ''] = tarifa.split('.')
  return `${entero},${decimales.replace(/0+$/, '').padEnd(2, '0')}`
}

function contratoDesdeApi(c: Contrato): ContratoFormulario {
  return {
    vigencia_desde: c.vigencia_desde,
    vigencia_hasta: c.vigencia_hasta,
    tarifa: c.tarifa === null ? '' : tarifaParaEditar(c.tarifa),
    tarifa_unidad: c.tarifa_unidad ?? '',
    revision_tarifa: c.revision_tarifa ?? '',
    forma_pago_medicamentos: c.forma_pago_medicamentos ?? '',
  }
}

/**
 * «0,05» o «0.05» → «0.05». Sin separador de miles («1.500» sería ambiguo) y
 * hasta cuatro decimales, como la base. Inválido → null.
 */
function tarifaNormal(texto: string): string | null {
  const limpio = texto.trim().replace(/\s/g, '').replace(',', '.')
  return /^\d{1,10}(\.\d{1,4})?$/.test(limpio) ? limpio : null
}

/**
 * El primer problema, en palabras; null si se puede guardar. Mismas reglas que
 * el servidor: la tarifa, su unidad y la forma de pago, solo con Farmacovigilancia.
 */
function validarContrato(f: ContratoFormulario, conFarmacia: boolean): string | null {
  if (!f.vigencia_desde) return 'Falta la fecha de inicio de la vigencia'
  if (!f.vigencia_hasta) return 'Falta la fecha de fin de la vigencia'
  const fechas = [f.vigencia_desde, f.vigencia_hasta, f.revision_tarifa].filter(Boolean)
  if (fechas.some((x) => x < '2000-01-01' || x > '2100-12-31')) {
    return 'Las fechas del contrato deben estar entre el año 2000 y el 2100'
  }
  if (f.vigencia_hasta < f.vigencia_desde) return 'La vigencia del contrato termina antes de empezar'
  if (f.revision_tarifa && f.revision_tarifa < f.vigencia_desde) {
    return 'La revisión de la tarifa no puede ser antes del inicio de la vigencia'
  }
  if (!conFarmacia) return null
  if (tarifaNormal(f.tarifa) === null) {
    return 'La tarifa debe ser un número con hasta cuatro decimales y sin separador de miles (por ejemplo 0,05)'
  }
  if (!f.tarifa_unidad) return 'Elige la unidad de la tarifa'
  if (!f.forma_pago_medicamentos) return 'Elige la forma de pago de los medicamentos'
  return null
}

/** Solo tras `validarContrato`: ahí ya se comprobó cada campo. */
function contratoHaciaApi(f: ContratoFormulario, conFarmacia: boolean): ContratoEntrada {
  return {
    vigencia_desde: f.vigencia_desde,
    vigencia_hasta: f.vigencia_hasta,
    tarifa: conFarmacia ? tarifaNormal(f.tarifa) : null,
    tarifa_unidad: conFarmacia ? (f.tarifa_unidad as UnidadTarifa) : null,
    revision_tarifa: f.revision_tarifa || null,
    forma_pago_medicamentos: conFarmacia
      ? (f.forma_pago_medicamentos as FormaPagoMedicamentos)
      : null,
  }
}

// ─── Para leerlos ────────────────────────────────────────────────────────────

const FECHA = new Intl.DateTimeFormat('es-EC', { day: 'numeric', month: 'short', year: 'numeric' })
const MONTO = new Intl.NumberFormat('es-EC', { minimumFractionDigits: 2, maximumFractionDigits: 4 })

/** «2026-01-31» → «31 ene 2026», como fecha local (sin el corrimiento de UTC). */
function fechaCorta(iso: string): string {
  const [a = 0, m = 1, d = 1] = iso.split('-').map(Number)
  return FECHA.format(new Date(a, m - 1, d))
}

function hoyIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function diasEntre(desde: string, hasta: string): number {
  return Math.round((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / 86_400_000)
}

function tarifaTexto(c: Contrato): string {
  const unidad = UNIDADES_TARIFA.find((u) => u.valor === c.tarifa_unidad)?.texto ?? ''
  return `USD ${MONTO.format(Number(c.tarifa))} ${unidad}`.trim()
}

/** ¿Al contrato le faltan datos que este cliente sí debe llevar? */
function faltaTarifa(c: Contrato, conFarmacia: boolean): boolean {
  return conFarmacia && c.tarifa === null
}

function formaPagoTexto(forma: FormaPagoMedicamentos): string {
  return FORMAS_PAGO_MEDICAMENTOS.find((f) => f.valor === forma)?.etiqueta ?? forma
}

/** Vigente, por iniciar o vencido según la fecha de hoy; el aviso de que vence va 30 días antes. */
function EstadoContrato({ contrato }: { contrato: Contrato }) {
  const hoy = hoyIso()
  let etiqueta = 'Vigente'
  let tono = 'border-exito/30 bg-exito/10 text-exito'
  let punto = 'bg-exito'
  if (hoy < contrato.vigencia_desde) {
    etiqueta = 'Por iniciar'
    tono = 'border-borde bg-tenue text-tenue-fg'
    punto = 'bg-tenue-fg/60'
  } else if (hoy > contrato.vigencia_hasta) {
    etiqueta = 'Vencido'
    tono = 'border-peligro/30 bg-peligro/10 text-peligro'
    punto = 'bg-peligro'
  } else {
    const dias = diasEntre(hoy, contrato.vigencia_hasta)
    if (dias <= 30) {
      etiqueta = dias === 0 ? 'Vence hoy' : dias === 1 ? 'Vence mañana' : `Vence en ${dias} días`
      tono = 'border-aviso/30 bg-aviso/10 text-aviso'
      punto = 'bg-aviso'
    }
  }
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-0.5',
        'font-display text-[0.6875rem] font-medium',
        tono,
      )}
    >
      <span className={cn('size-1.5 rounded-full', punto)} aria-hidden="true" />
      {etiqueta}
    </span>
  )
}

/**
 * Los campos del contrato; los usan el alta y la edición. La tarifa, su unidad
 * y la forma de pago de los medicamentos, solo si el cliente tiene
 * Farmacovigilancia (6/11/2026).
 */
function ContratoCampos({
  prefijo,
  valor,
  onCambiar,
  conFarmacia,
}: {
  prefijo: string
  valor: ContratoFormulario
  onCambiar: (valor: ContratoFormulario) => void
  conFarmacia: boolean
}) {
  function poner<K extends keyof ContratoFormulario>(campo: K, v: ContratoFormulario[K]) {
    onCambiar({ ...valor, [campo]: v })
  }
  const id = (campo: string) => `${prefijo}-${campo}`
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-2">
        <Label htmlFor={id('desde')}>
          Vigencia desde <span className="text-peligro">*</span>
        </Label>
        <Input
          id={id('desde')}
          type="date"
          value={valor.vigencia_desde}
          min="2000-01-01"
          max="2100-12-31"
          onChange={(e) => poner('vigencia_desde', e.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor={id('hasta')}>
          Vigencia hasta <span className="text-peligro">*</span>
        </Label>
        <Input
          id={id('hasta')}
          type="date"
          value={valor.vigencia_hasta}
          min={valor.vigencia_desde || '2000-01-01'}
          max="2100-12-31"
          onChange={(e) => poner('vigencia_hasta', e.target.value)}
        />
      </div>
      {conFarmacia && (
      <>
      <div className="space-y-2">
        <Label htmlFor={id('tarifa')}>
          Tarifa a AccuMedical (USD) <span className="text-peligro">*</span>
        </Label>
        <Input
          id={id('tarifa')}
          value={valor.tarifa}
          onChange={(e) => poner('tarifa', e.target.value)}
          inputMode="decimal"
          placeholder="0,05"
          className="tabular"
          maxLength={16}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor={id('unidad')}>
          Unidad de la tarifa <span className="text-peligro">*</span>
        </Label>
        <Select
          id={id('unidad')}
          value={valor.tarifa_unidad}
          onChange={(e) => poner('tarifa_unidad', e.target.value as UnidadTarifa)}
          required
        >
          <option value="" disabled>
            Elige la unidad
          </option>
          {UNIDADES_TARIFA.map((u) => (
            <option key={u.valor} value={u.valor}>
              {u.etiqueta}
            </option>
          ))}
        </Select>
      </div>
      </>
      )}
      <div className="space-y-2">
        <Label htmlFor={id('revision')}>Fecha de revisión de la tarifa</Label>
        <Input
          id={id('revision')}
          type="date"
          value={valor.revision_tarifa}
          min={valor.vigencia_desde || '2000-01-01'}
          max="2100-12-31"
          onChange={(e) => poner('revision_tarifa', e.target.value)}
          aria-describedby={id('revision-ayuda')}
        />
        <p id={id('revision-ayuda')} className="text-xs text-tenue-fg">
          Opcional. Por ejemplo, a los 3 meses.
        </p>
      </div>
      {conFarmacia && (
      <div className="space-y-2">
        <Label htmlFor={id('forma-pago')}>
          Forma de pago de los medicamentos <span className="text-peligro">*</span>
        </Label>
        <Select
          id={id('forma-pago')}
          value={valor.forma_pago_medicamentos}
          onChange={(e) =>
            poner('forma_pago_medicamentos', e.target.value as FormaPagoMedicamentos)
          }
          required
        >
          <option value="" disabled>
            Elige quién los paga
          </option>
          {FORMAS_PAGO_MEDICAMENTOS.map((f) => (
            <option key={f.valor} value={f.valor}>
              {f.etiqueta}
            </option>
          ))}
        </Select>
      </div>
      )}
    </div>
  )
}

function DatosContrato({ contrato }: { contrato: Contrato }) {
  return (
    <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
      <div>
        <dt className="text-xs text-tenue-fg">Vigencia</dt>
        <dd className="tabular">
          {fechaCorta(contrato.vigencia_desde)} – {fechaCorta(contrato.vigencia_hasta)}
        </dd>
      </div>
      {contrato.tarifa !== null && (
        <div>
          <dt className="text-xs text-tenue-fg">Tarifa a AccuMedical</dt>
          <dd className="tabular">{tarifaTexto(contrato)}</dd>
        </div>
      )}
      <div>
        <dt className="text-xs text-tenue-fg">Revisión de la tarifa</dt>
        <dd className="tabular">
          {contrato.revision_tarifa ? fechaCorta(contrato.revision_tarifa) : 'Sin fecha'}
        </dd>
      </div>
      {contrato.forma_pago_medicamentos !== null && (
        <div>
          <dt className="text-xs text-tenue-fg">Medicamentos</dt>
          <dd>{formaPagoTexto(contrato.forma_pago_medicamentos)}</dd>
        </div>
      )}
    </dl>
  )
}

/**
 * **Contratos y pólizas** del cliente: subir, ver y retirar sus PDF. Desde el
 * 6/11/2026 (especificación de la Central, M1) cada uno lleva sus datos —
 * vigencia y revisión de la tarifa; con Farmacovigilancia, además la tarifa con
 * su unidad y la forma de pago de los medicamentos— y se sube CON ellos. Los
 * PDF anteriores aparecen con «Faltan los datos del contrato» para completarlos.
 *
 * `conFarmacia` es lo GUARDADO (el servidor decide con eso);
 * `farmaciaSinGuardar` avisa si en la pestaña Módulos se cambió sin guardar.
 *
 * El servidor valida que sea PDF de verdad (contenido, no extensión) y el
 * borrado es lógico, como todo en la casa.
 */
export function PolizasPanel({
  aseguradoraId,
  categoria = 'polizas',
  conFarmacia = false,
  farmaciaSinGuardar = false,
}: {
  aseguradoraId: string | null
  categoria?: CategoriaDocumento
  conFarmacia?: boolean
  farmaciaSinGuardar?: boolean
}) {
  const toast = useToast()
  const queryClient = useQueryClient()
  // Solo la pestaña de contratos lleva datos; las demás categorías son PDF sueltos.
  const esContrato = categoria === 'polizas'

  const [archivo, setArchivo] = useState<File | null>(null)
  const [nombre, setNombre] = useState('')
  const [nuevo, setNuevo] = useState<ContratoFormulario>(contratoVacio)
  const [editando, setEditando] = useState<string | null>(null)
  const [borrador, setBorrador] = useState<ContratoFormulario>(contratoVacio)
  const inputArchivo = useRef<HTMLInputElement>(null)
  const clave = ['aseguradora-polizas', aseguradoraId, categoria]

  const polizas = useQuery({
    queryKey: clave,
    queryFn: () => listarPolizas(aseguradoraId!, categoria),
    enabled: Boolean(aseguradoraId),
  })

  const subir = useMutation({
    mutationFn: () =>
      subirPoliza(
        aseguradoraId!,
        archivo!,
        nombre.trim(),
        categoria,
        esContrato ? contratoHaciaApi(nuevo, conFarmacia) : undefined,
      ),
    onSuccess: (lista) => {
      queryClient.setQueryData(clave, lista)
      setArchivo(null)
      setNombre('')
      setNuevo(contratoVacio())
      if (inputArchivo.current) inputArchivo.current.value = ''
      toast.exito(esContrato ? 'Contrato subido' : 'Documento subido')
    },
    onError: (error) => toast.error(mensajeDeError(error, 'No se pudo subir el documento')),
  })

  const guardarDatos = useMutation({
    mutationFn: (polizaId: string) =>
      fijarContrato(aseguradoraId!, polizaId, contratoHaciaApi(borrador, conFarmacia)),
    onSuccess: (lista) => {
      queryClient.setQueryData(clave, lista)
      setEditando(null)
      toast.exito('Datos del contrato guardados')
    },
    onError: (error) =>
      toast.error(mensajeDeError(error, 'No se pudieron guardar los datos del contrato')),
  })

  const quitar = useMutation({
    mutationFn: (polizaId: string) => eliminarPoliza(aseguradoraId!, polizaId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['aseguradora-polizas', aseguradoraId] })
      toast.exito('Documento retirado')
    },
    onError: (error) => toast.error(mensajeDeError(error, 'No se pudo retirar el documento')),
  })

  if (!aseguradoraId) {
    return (
      <p className="rounded-md border border-dashed border-borde px-4 py-8 text-center text-sm text-tenue-fg">
        Guarda primero la aseguradora: los documentos se suben sobre la ficha ya creada.
      </p>
    )
  }

  function alSubir() {
    if (!archivo) return toast.error('Elige el archivo PDF a subir')
    if (esContrato) {
      const problema = validarContrato(nuevo, conFarmacia)
      if (problema) return toast.error(problema)
    }
    subir.mutate()
  }

  function abrirEdicion(poliza: Poliza) {
    setEditando(poliza.id)
    setBorrador(poliza.contrato ? contratoDesdeApi(poliza.contrato) : contratoVacio())
  }

  function alGuardarDatos(polizaId: string) {
    const problema = validarContrato(borrador, conFarmacia)
    if (problema) return toast.error(problema)
    guardarDatos.mutate(polizaId)
  }

  function confirmarQuitar(poliza: Poliza) {
    if (window.confirm(`¿Retirar «${poliza.nombre}»? El registro queda como retirado.`)) {
      quitar.mutate(poliza.id)
    }
  }

  return (
    <div className="space-y-5">
      {esContrato && farmaciaSinGuardar && (
        <p className="rounded-md border border-aviso/30 bg-aviso/10 px-4 py-3 text-sm text-aviso">
          Cambiaste Farmacovigilancia en la pestaña Módulos. Guarda los cambios de la ficha para
          que el contrato pida (o deje de pedir) la tarifa y la forma de pago de los medicamentos.
        </p>
      )}
      {/* ── Subir ── */}
      <div className="space-y-4 rounded-md border border-borde bg-fondo/40 p-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="poliza-archivo">
              Archivo PDF <span className="text-peligro">*</span>
            </Label>
            <input
              ref={inputArchivo}
              id="poliza-archivo"
              type="file"
              accept="application/pdf,.pdf"
              onChange={(e) => setArchivo(e.target.files?.[0] ?? null)}
              className="block w-full cursor-pointer rounded-md border border-borde bg-fondo text-sm text-tenue-fg file:mr-3 file:cursor-pointer file:rounded-l-md file:border-0 file:bg-tenue file:px-4 file:py-2.5 file:text-sm file:font-medium file:text-tinta"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="poliza-nombre">Nombre del documento</Label>
            <Input
              id="poliza-nombre"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              placeholder="CONTRATO ASISTENCIA TOTAL 2026 (OPCIONAL)"
              maxLength={160}
            />
          </div>
        </div>
        {esContrato && (
          <ContratoCampos
            prefijo="nuevo"
            valor={nuevo}
            onCambiar={setNuevo}
            conFarmacia={conFarmacia}
          />
        )}
        <div className="flex justify-end">
          <Boton type="button" onClick={alSubir} cargando={subir.isPending}>
            <UploadCloud aria-hidden="true" />
            {esContrato ? 'Subir contrato' : 'Subir'}
          </Boton>
        </div>
      </div>

      {/* ── Lista ── */}
      {polizas.isPending ? (
        <div className="space-y-2" role="status" aria-label="Cargando documentos">
          {Array.from({ length: 2 }, (_, i) => (
            <div key={i} className="h-14 animate-pulse rounded-md bg-tenue" />
          ))}
        </div>
      ) : polizas.isError ? (
        <p className="text-sm text-peligro">No pudimos cargar los documentos.</p>
      ) : (polizas.data ?? []).length === 0 ? (
        <p className="rounded-md border border-dashed border-borde px-4 py-8 text-center text-sm text-tenue-fg">
          {esContrato
            ? 'Todavía no hay contratos ni pólizas subidos.'
            : 'Todavía no hay documentos subidos.'}
        </p>
      ) : (
        <ul className="space-y-2">
          {polizas.data!.map((poliza) => (
            <li
              key={poliza.id}
              className="space-y-3 rounded-md border border-borde bg-superficie px-4 py-3"
            >
              <div className="flex items-center gap-3">
                <FileText className="size-4 shrink-0 text-oro" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <p className="min-w-0 break-words text-sm font-medium sm:truncate">{poliza.nombre}</p>
                    {esContrato && poliza.contrato && <EstadoContrato contrato={poliza.contrato} />}
                  </div>
                  <p className="text-xs text-tenue-fg">
                    Subido el {FECHA.format(new Date(poliza.creada_at))}
                  </p>
                </div>
                <a
                  href={urlPoliza(aseguradoraId, poliza.id)}
                  target="_blank"
                  rel="noreferrer"
                  className="shrink-0 text-sm font-medium text-marca transition-opacity duration-150 hover:opacity-80"
                >
                  Ver PDF
                </a>
                {esContrato && poliza.contrato && editando !== poliza.id && (
                  <button
                    type="button"
                    onClick={() => abrirEdicion(poliza)}
                    aria-label={`Editar los datos de ${poliza.nombre}`}
                    title="Editar los datos del contrato"
                    className="rounded p-1.5 text-tenue-fg transition-colors duration-150 hover:text-marca"
                  >
                    <Pencil className="size-4" aria-hidden="true" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => confirmarQuitar(poliza)}
                  aria-label={`Retirar ${poliza.nombre}`}
                  title="Retirar el documento"
                  className="rounded p-1.5 text-tenue-fg transition-colors duration-150 hover:text-peligro"
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                </button>
              </div>

              {esContrato &&
                (editando === poliza.id ? (
                  <div className="space-y-4 border-t border-borde pt-4">
                    <ContratoCampos
                      prefijo={`editar-${poliza.id}`}
                      valor={borrador}
                      onCambiar={setBorrador}
                      conFarmacia={conFarmacia}
                    />
                    <div className="flex justify-end gap-2">
                      <Boton
                        type="button"
                        variante="contorno"
                        onClick={() => setEditando(null)}
                        disabled={guardarDatos.isPending}
                      >
                        Cancelar
                      </Boton>
                      <Boton
                        type="button"
                        onClick={() => alGuardarDatos(poliza.id)}
                        cargando={guardarDatos.isPending}
                      >
                        Guardar datos
                      </Boton>
                    </div>
                  </div>
                ) : poliza.contrato ? (
                  <div className="space-y-3 pl-7">
                    <DatosContrato contrato={poliza.contrato} />
                    {faltaTarifa(poliza.contrato, conFarmacia) && (
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                        <p className="text-sm text-aviso">
                          Este cliente tiene Farmacovigilancia: falta la tarifa y la forma de pago
                          de los medicamentos.
                        </p>
                        <Boton
                          type="button"
                          variante="contorno"
                          tamano="sm"
                          onClick={() => abrirEdicion(poliza)}
                        >
                          Completar datos
                        </Boton>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2 pl-7">
                    <p className="text-sm text-aviso">
                      {conFarmacia
                        ? 'Faltan los datos del contrato: vigencia, tarifa y forma de pago.'
                        : 'Faltan los datos del contrato: la vigencia.'}
                    </p>
                    <Boton
                      type="button"
                      variante="contorno"
                      tamano="sm"
                      onClick={() => abrirEdicion(poliza)}
                    >
                      Completar datos
                    </Boton>
                  </div>
                ))}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
