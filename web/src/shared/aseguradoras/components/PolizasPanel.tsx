import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FileText, Trash2, UploadCloud } from 'lucide-react'
import { useRef, useState } from 'react'

import {
  eliminarPoliza,
  listarPolizas,
  subirPoliza,
  urlPoliza,
  type CategoriaDocumento,
  type Poliza,
} from '@/shared/aseguradoras/api'
import { Boton } from '@/shared/components/ui/button'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { useToast } from '@/shared/components/ui/toast'

function mensajeDeError(error: unknown, porDefecto: string): string {
  const detalle = (error as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
  return typeof detalle === 'string' ? detalle : porDefecto
}

/**
 * Los PDF de pólizas y planes de la aseguradora: subir, ver y retirar. El
 * servidor valida que sea PDF de verdad (contenido, no extensión) y el
 * borrado es lógico, como todo en la casa.
 */
export function PolizasPanel({
  aseguradoraId,
  categoria = 'polizas',
}: {
  aseguradoraId: string | null
  categoria?: CategoriaDocumento
}) {
  const toast = useToast()
  const queryClient = useQueryClient()

  const [archivo, setArchivo] = useState<File | null>(null)
  const [nombre, setNombre] = useState('')
  const inputArchivo = useRef<HTMLInputElement>(null)

  const polizas = useQuery({
    queryKey: ['aseguradora-polizas', aseguradoraId, categoria],
    queryFn: () => listarPolizas(aseguradoraId!, categoria),
    enabled: Boolean(aseguradoraId),
  })

  const subir = useMutation({
    mutationFn: () => subirPoliza(aseguradoraId!, archivo!, nombre.trim(), categoria),
    onSuccess: (lista) => {
      queryClient.setQueryData(['aseguradora-polizas', aseguradoraId, categoria], lista)
      setArchivo(null)
      setNombre('')
      if (inputArchivo.current) inputArchivo.current.value = ''
      toast.exito('Documento subido')
    },
    onError: (error) => toast.error(mensajeDeError(error, 'No se pudo subir el documento')),
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

  function confirmarQuitar(poliza: Poliza) {
    if (window.confirm(`¿Retirar «${poliza.nombre}»? El registro queda como retirado.`)) {
      quitar.mutate(poliza.id)
    }
  }

  const fecha = new Intl.DateTimeFormat('es-EC', { day: 'numeric', month: 'short', year: 'numeric' })

  return (
    <div className="space-y-5">
      {/* ── Subir ── */}
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
        <div className="space-y-2">
          <Label htmlFor="poliza-archivo">Archivo PDF</Label>
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
            placeholder="PÓLIZA VIDA 2026 (OPCIONAL: SI NO, EL DEL ARCHIVO)"
            maxLength={160}
          />
        </div>
        <Boton
          type="button"
          onClick={() => {
            if (!archivo) return toast.error('Elige el archivo PDF a subir')
            subir.mutate()
          }}
          cargando={subir.isPending}
        >
          <UploadCloud aria-hidden="true" />
          Subir
        </Boton>
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
          Todavía no hay pólizas ni planes subidos.
        </p>
      ) : (
        <ul className="space-y-2">
          {polizas.data!.map((poliza) => (
            <li
              key={poliza.id}
              className="flex items-center gap-3 rounded-md border border-borde bg-superficie px-4 py-3"
            >
              <FileText className="size-4 shrink-0 text-oro" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{poliza.nombre}</p>
                <p className="text-xs text-tenue-fg">
                  Subido el {fecha.format(new Date(poliza.creada_at))}
                </p>
              </div>
              <a
                href={urlPoliza(aseguradoraId, poliza.id)}
                target="_blank"
                rel="noreferrer"
                className="text-sm font-medium text-marca transition-opacity duration-150 hover:opacity-80"
              >
                Ver PDF
              </a>
              <button
                type="button"
                onClick={() => confirmarQuitar(poliza)}
                aria-label={`Retirar ${poliza.nombre}`}
                className="rounded p-1.5 text-tenue-fg transition-colors duration-150 hover:text-peligro"
              >
                <Trash2 className="size-4" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
