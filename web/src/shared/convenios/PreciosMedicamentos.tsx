import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, FileSpreadsheet, UploadCloud } from 'lucide-react'
import { useRef, useState } from 'react'

import { Boton } from '@/shared/components/ui/button'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { useToast } from '@/shared/components/ui/toast'
import {
  subirListaPrecios,
  verListaPrecios,
  type ErroresLista,
} from '@/shared/prestadores/api'
import { URL_PLANTILLA_PRECIOS } from '@/shared/vademecum/api'

const FECHA = new Intl.DateTimeFormat('es-EC', { day: 'numeric', month: 'short', year: 'numeric' })
const MONTO = new Intl.NumberFormat('es-EC', { minimumFractionDigits: 2, maximumFractionDigits: 4 })

function fechaCorta(iso: string): string {
  const [a = 0, m = 1, d = 1] = iso.split('-').map(Number)
  return FECHA.format(new Date(a, m - 1, d))
}

/** El error de la central: o un texto, o la lista de errores por fila del Excel. */
function errorDe(error: unknown): { mensaje: string; filas: string[]; total: number } {
  const detalle = (error as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
  if (typeof detalle === 'string') return { mensaje: detalle, filas: [], total: 0 }
  if (detalle && typeof detalle === 'object' && 'errores' in detalle) {
    const d = detalle as ErroresLista
    return { mensaje: d.mensaje, filas: d.errores, total: d.total_errores }
  }
  return { mensaje: 'No se pudo subir la lista de precios', filas: [], total: 0 }
}

/**
 * **Precios de medicamentos** de una farmacia en su convenio (6/11/2026, M4):
 * la farmacia descarga la plantilla (todo el vademécum maestro), llena nombre
 * comercial, presentación y precio de lo que vende, y aquí se sube con su
 * vigencia. La central la valida contra el vademécum: con un solo error no se
 * reemplaza la vigente y se dice qué fila corregir. Es el precio que se reconoce
 * al pagar (RN-07), y de ella sale el vademécum de esa farmacia.
 */
export function PreciosMedicamentos({
  prestadorId,
  convenioId,
}: {
  prestadorId: string
  convenioId: string
}) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const [archivo, setArchivo] = useState<File | null>(null)
  const [desde, setDesde] = useState('')
  const [hasta, setHasta] = useState('')
  const [errores, setErrores] = useState<{ mensaje: string; filas: string[]; total: number } | null>(
    null,
  )
  const [filtro, setFiltro] = useState('')
  const inputArchivo = useRef<HTMLInputElement>(null)
  const clave = ['convenio-precios', convenioId]

  const lista = useQuery({ queryKey: clave, queryFn: () => verListaPrecios(prestadorId, convenioId) })

  const subir = useMutation({
    mutationFn: () => subirListaPrecios(prestadorId, convenioId, archivo!, desde, hasta),
    onSuccess: (nueva) => {
      queryClient.setQueryData(clave, nueva)
      setArchivo(null)
      setErrores(null)
      if (inputArchivo.current) inputArchivo.current.value = ''
      toast.exito(`Lista de precios guardada: ${nueva.filas} precios`)
    },
    onError: (error) => {
      const e = errorDe(error)
      setErrores(e)
      toast.error(e.mensaje)
    },
  })

  function enviar() {
    if (!archivo) return toast.error('Elige el Excel de la lista de precios (.xlsx)')
    if (!desde) return toast.error('Indica desde cuándo rige la lista')
    if (hasta && hasta < desde) return toast.error('La vigencia termina antes de empezar')
    setErrores(null)
    subir.mutate()
  }

  const termino = filtro.trim().toLocaleUpperCase()
  const precios = (lista.data?.precios ?? []).filter(
    (p) =>
      !termino ||
      p.medicamento.toLocaleUpperCase().includes(termino) ||
      (p.nombre_comercial ?? '').includes(termino) ||
      p.vademecum_codigo.includes(termino),
  )

  return (
    <div className="space-y-5">
      <div className="rounded-md border border-borde bg-tenue/40 px-4 py-3 text-sm">
        <p className="font-medium">Cómo se carga</p>
        <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-tenue-fg">
          <li>
            Descarga la plantilla: trae todos los medicamentos del vademécum con su código.
          </li>
          <li>
            La farmacia llena, en lo que vende, el nombre comercial, la presentación y el precio (las
            filas sin precio se ignoran).
          </li>
          <li>Súbela aquí como Excel (.xlsx) con su vigencia. Reemplaza a la lista vigente.</li>
        </ol>
        <a
          href={URL_PLANTILLA_PRECIOS}
          className="mt-2 inline-flex items-center gap-1.5 font-medium text-marca hover:opacity-80"
        >
          <Download className="size-4" aria-hidden="true" />
          Descargar plantilla (Excel)
        </a>
      </div>

      {/* ── Subir ── */}
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_10rem_10rem_auto] sm:items-end">
        <div className="space-y-2">
          <Label htmlFor="precios-archivo">
            Lista de precios (.xlsx) <span className="text-peligro">*</span>
          </Label>
          <input
            ref={inputArchivo}
            id="precios-archivo"
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={(e) => setArchivo(e.target.files?.[0] ?? null)}
            className="block w-full cursor-pointer rounded-md border border-borde bg-fondo text-sm text-tenue-fg file:mr-3 file:cursor-pointer file:rounded-l-md file:border-0 file:bg-tenue file:px-4 file:py-2.5 file:text-sm file:font-medium file:text-tinta"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="precios-desde">
            Rige desde <span className="text-peligro">*</span>
          </Label>
          <Input
            id="precios-desde"
            type="date"
            value={desde}
            min="2000-01-01"
            max="2100-12-31"
            onChange={(e) => setDesde(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="precios-hasta">Hasta</Label>
          <Input
            id="precios-hasta"
            type="date"
            value={hasta}
            min={desde || '2000-01-01'}
            max="2100-12-31"
            onChange={(e) => setHasta(e.target.value)}
          />
        </div>
        <Boton type="button" onClick={enviar} cargando={subir.isPending}>
          <UploadCloud aria-hidden="true" />
          Subir lista
        </Boton>
      </div>

      {errores && errores.filas.length > 0 && (
        <div
          className="rounded-md border border-peligro/30 bg-peligro/5 px-4 py-3 text-sm"
          role="alert"
        >
          <p className="font-medium text-peligro">{errores.mensaje}</p>
          <ul className="mt-2 max-h-48 list-disc space-y-0.5 overflow-y-auto pl-5 text-tinta">
            {errores.filas.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
          {errores.total > errores.filas.length && (
            <p className="mt-2 text-xs text-tenue-fg">
              Y {errores.total - errores.filas.length} más. La lista vigente no cambió.
            </p>
          )}
        </div>
      )}

      {/* ── La vigente ── */}
      {lista.isPending ? (
        <div className="h-24 animate-pulse rounded-md bg-tenue" role="status" aria-label="Cargando" />
      ) : lista.isError ? (
        <p className="text-sm text-peligro">No pudimos cargar la lista de precios.</p>
      ) : !lista.data ? (
        <p className="rounded-md border border-dashed border-borde px-4 py-8 text-center text-sm text-tenue-fg">
          Esta farmacia todavía no tiene lista de precios por medicamento.
        </p>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="flex min-w-0 items-center gap-2 text-sm">
              <FileSpreadsheet className="size-4 shrink-0 text-oro" aria-hidden="true" />
              <span className="min-w-0 truncate font-medium">{lista.data.nombre_archivo}</span>
              <span className="text-tenue-fg">
                · rige {fechaCorta(lista.data.vigencia_desde)}
                {lista.data.vigencia_hasta ? ` – ${fechaCorta(lista.data.vigencia_hasta)}` : ' en adelante'}
                {' · '}
                {lista.data.filas} precios de {lista.data.medicamentos} medicamentos
              </span>
            </p>
            <Input
              type="search"
              value={filtro}
              onChange={(e) => setFiltro(e.target.value)}
              placeholder="Buscar en la lista"
              aria-label="Buscar en la lista de precios"
              className="w-56"
            />
          </div>
          <div className="max-h-96 overflow-auto rounded-md border border-borde">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-superficie text-xs text-tenue-fg">
                <tr>
                  <th className="px-3 py-2 font-medium">Medicamento</th>
                  <th className="px-3 py-2 font-medium">Nombre comercial</th>
                  <th className="px-3 py-2 font-medium">Presentación</th>
                  <th className="px-3 py-2 text-right font-medium">Precio</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-borde">
                {precios.map((p) => (
                  <tr key={`${p.vademecum_codigo}-${p.fila_excel}`}>
                    <td className="px-3 py-2">
                      <span className="block">{p.medicamento}</span>
                      <span className="text-xs text-tenue-fg tabular">{p.vademecum_codigo}</span>
                    </td>
                    <td className="px-3 py-2">{p.nombre_comercial ?? '—'}</td>
                    <td className="px-3 py-2">{p.presentacion}</td>
                    <td className="px-3 py-2 text-right tabular">USD {MONTO.format(Number(p.precio))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
