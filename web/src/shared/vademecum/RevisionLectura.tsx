import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Search, X } from 'lucide-react'
import { useState } from 'react'

import { cn } from '@/lib/utils'
import { Boton } from '@/shared/components/ui/button'
import { Input } from '@/shared/components/ui/input'
import { Modal } from '@/shared/components/ui/modal'
import { Select } from '@/shared/components/ui/select'
import { useToast } from '@/shared/components/ui/toast'
import {
  agregarAlMaestro,
  buscarVademecum,
  confirmarLectura,
  decidirFila,
  filtrosVademecum,
  verLecturaVademecum,
  type FilaLectura,
  type LecturaVademecum,
  type MedicamentoCorto,
} from '@/shared/vademecum/api'
import { useTextoDiferido } from '@/shared/vademecum/pages/VademecumPage'

function mensajeDeError(error: unknown, porDefecto: string): string {
  const detalle = (error as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
  return typeof detalle === 'string' ? detalle : porDefecto
}

type Filtro = 'pendientes' | 'dudoso' | 'no_encontrado' | 'encontrado' | 'descartadas' | 'todas'

const FILTROS: { valor: Filtro; etiqueta: string }[] = [
  { valor: 'pendientes', etiqueta: 'Por resolver' },
  { valor: 'dudoso', etiqueta: 'Dudosos' },
  { valor: 'no_encontrado', etiqueta: 'No encontrados' },
  { valor: 'encontrado', etiqueta: 'Encontrados' },
  { valor: 'descartadas', etiqueta: 'Descartados' },
  { valor: 'todas', etiqueta: 'Todas' },
]

const pendiente = (f: FilaLectura) => !f.descartada && f.vademecum_codigo === null

function pasa(f: FilaLectura, filtro: Filtro): boolean {
  if (filtro === 'todas') return true
  if (filtro === 'pendientes') return pendiente(f)
  if (filtro === 'descartadas') return f.descartada
  return f.resultado === filtro
}

function Medicamento({ m }: { m: MedicamentoCorto }) {
  return (
    <span className="min-w-0">
      <span className="font-medium">{m.nombre}</span>
      <span className="text-xs text-tenue-fg">
        {' '}
        · {m.codigo}
        {m.forma_farmaceutica ? ` · ${m.forma_farmaceutica}` : ''}
        {m.fuente.startsWith('AccuMedical') ? ' · agregado por AccuMedical' : ''}
      </span>
    </span>
  )
}

/**
 * **Revisar el vademécum que entregó el cliente** (6/11/2026, M5): cada fila de
 * su archivo con lo que propuso el cruce con el maestro. Lo encontrado viene
 * elegido; lo dudoso y lo no encontrado lo decide una persona (elegir un
 * candidato, buscar otro, agregarlo al maestro o descartarlo). Nada se activa
 * sin confirmar; al confirmar, los códigos pasan al producto.
 */
export function RevisionLectura({
  aseguradoraId,
  lecturaId,
  producto,
  onCerrar,
  onConfirmada,
}: {
  aseguradoraId: string
  lecturaId: string
  producto: string
  onCerrar: () => void
  onConfirmada: (codigos: string[]) => void
}) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const clave = ['vademecum-lectura', lecturaId]
  const [filtro, setFiltro] = useState<Filtro>('pendientes')
  const [abierta, setAbierta] = useState<string | null>(null)

  const lectura = useQuery({ queryKey: clave, queryFn: () => verLecturaVademecum(aseguradoraId, lecturaId) })
  const poner = (l: LecturaVademecum) => queryClient.setQueryData(clave, l)

  const decidir = useMutation({
    mutationFn: (d: { fila: string; vademecum_codigo: string | null; descartada: boolean }) =>
      decidirFila(aseguradoraId, lecturaId, d.fila, {
        vademecum_codigo: d.vademecum_codigo,
        descartada: d.descartada,
      }),
    onSuccess: (l) => {
      poner(l)
      setAbierta(null)
    },
    onError: (e) => toast.error(mensajeDeError(e, 'No se pudo guardar la decisión')),
  })

  const confirmar = useMutation({
    mutationFn: () => confirmarLectura(aseguradoraId, lecturaId),
    onSuccess: ({ lectura: l, codigos }) => {
      poner(l)
      onConfirmada(codigos)
      toast.exito(
        `Vademécum de ${producto} armado con ${codigos.length} medicamentos: guarda los cambios de la ficha`,
      )
      onCerrar()
    },
    onError: (e) => toast.error(mensajeDeError(e, 'No se pudo confirmar')),
  })

  const l = lectura.data
  const filas = (l?.filas ?? []).filter((f) => pasa(f, filtro))
  const cerrada = l ? l.estado !== 'pendiente' : false

  return (
    <Modal abierto onCerrar={onCerrar} titulo={`Vademécum del cliente para ${producto}`} ancho="max-w-5xl">
      {!l ? (
        <div className="h-40 animate-pulse rounded-md bg-tenue" role="status" aria-label="Cargando" />
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <span className="font-medium">{l.nombre_archivo}</span>
            <span className="text-tenue-fg">
              {l.origen === 'pdf_ia' ? 'PDF leído con IA' : 'Excel'} · {l.total} filas
            </span>
            <span className="text-exito">{l.encontrados} encontrados</span>
            <span className="text-aviso">{l.dudosos} dudosos</span>
            <span className="text-peligro">{l.no_encontrados} no encontrados</span>
            <span className={cn('font-medium', l.pendientes ? 'text-aviso' : 'text-exito')}>
              {l.pendientes ? `${l.pendientes} por resolver` : 'Todo resuelto'}
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Filtrar filas">
            {FILTROS.map((f) => (
              <button
                key={f.valor}
                type="button"
                role="tab"
                aria-selected={filtro === f.valor}
                onClick={() => setFiltro(f.valor)}
                className={cn(
                  'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                  filtro === f.valor
                    ? 'border-marca bg-marca text-marca-fg'
                    : 'border-borde text-tenue-fg hover:text-tinta',
                )}
              >
                {f.etiqueta} ({(l.filas ?? []).filter((x) => pasa(x, f.valor)).length})
              </button>
            ))}
          </div>

          <ul className="max-h-[55vh] divide-y divide-borde overflow-y-auto rounded-md border border-borde">
            {filas.length === 0 ? (
              <li className="p-6 text-center text-sm text-tenue-fg">Nada en este filtro.</li>
            ) : (
              filas.map((f) => (
                <li key={f.id} className="space-y-2 px-4 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm">
                        <span className="text-xs text-tenue-fg tabular">Fila {f.fila} · </span>
                        {f.texto}
                      </p>
                      {f.nota && pendiente(f) && <p className="text-xs text-aviso">{f.nota}</p>}
                    </div>
                    {!cerrada && (
                      <div className="flex shrink-0 gap-1.5">
                        {f.descartada ? (
                          <Boton
                            type="button"
                            variante="contorno"
                            tamano="sm"
                            onClick={() => decidir.mutate({ fila: f.id, vademecum_codigo: null, descartada: false })}
                          >
                            Deshacer
                          </Boton>
                        ) : (
                          <>
                            <Boton
                              type="button"
                              variante="contorno"
                              tamano="sm"
                              onClick={() => setAbierta(abierta === f.id ? null : f.id)}
                            >
                              {f.vademecum_codigo ? 'Cambiar' : 'Resolver'}
                            </Boton>
                            <Boton
                              type="button"
                              variante="fantasma"
                              tamano="sm"
                              onClick={() => decidir.mutate({ fila: f.id, vademecum_codigo: null, descartada: true })}
                            >
                              Descartar
                            </Boton>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                  {f.elegido && (
                    <p className="flex items-center gap-2 text-sm">
                      <Check className="size-4 shrink-0 text-exito" aria-hidden="true" />
                      <Medicamento m={f.elegido} />
                    </p>
                  )}
                  {f.descartada && <p className="text-sm text-tenue-fg">Descartada: no entra al vademécum.</p>}
                  {abierta === f.id && !cerrada && (
                    <Resolver
                      aseguradoraId={aseguradoraId}
                      lecturaId={lecturaId}
                      fila={f}
                      onElegir={(codigo) => decidir.mutate({ fila: f.id, vademecum_codigo: codigo, descartada: false })}
                      onAgregado={(nueva) => {
                        poner(nueva)
                        setAbierta(null)
                      }}
                    />
                  )}
                </li>
              ))
            )}
          </ul>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-borde pt-4">
            <p className="text-sm text-tenue-fg">
              {cerrada
                ? 'Esta lectura ya se confirmó.'
                : l.pendientes
                  ? 'Resuelve o descarta las filas pendientes para confirmar.'
                  : 'Al confirmar, estos medicamentos pasan a ser el vademécum del producto.'}
            </p>
            {!cerrada && (
              <Boton
                type="button"
                onClick={() => confirmar.mutate()}
                disabled={l.pendientes > 0}
                cargando={confirmar.isPending}
              >
                Confirmar vademécum
              </Boton>
            )}
          </div>
        </div>
      )}
    </Modal>
  )
}

/** Elegir un candidato, buscar otro en el maestro o agregarlo al maestro. */
function Resolver({
  aseguradoraId,
  lecturaId,
  fila,
  onElegir,
  onAgregado,
}: {
  aseguradoraId: string
  lecturaId: string
  fila: FilaLectura
  onElegir: (codigo: string) => void
  onAgregado: (l: LecturaVademecum) => void
}) {
  const toast = useToast()
  const [texto, setTexto] = useState(fila.principio_activo ?? '')
  const q = useTextoDiferido(texto)
  const [nuevo, setNuevo] = useState(false)
  const [dci, setDci] = useState(fila.principio_activo ?? '')
  const [concentracion, setConcentracion] = useState(fila.concentracion ?? '')
  const [forma, setForma] = useState('')
  const [via, setVia] = useState('')
  const filtros = useQuery({ queryKey: ['vademecum', 'filtros'], queryFn: filtrosVademecum, staleTime: Infinity })
  const busqueda = useQuery({
    queryKey: ['vademecum', 'resolver', q],
    queryFn: () => buscarVademecum({ q, limit: 20 }),
    enabled: q.length >= 2,
  })
  const agregar = useMutation({
    mutationFn: () =>
      agregarAlMaestro(aseguradoraId, lecturaId, fila.id, {
        dci: dci.trim(),
        concentracion: concentracion.trim() || null,
        forma_farmaceutica: forma,
        via: via || null,
      }),
    onSuccess: (l) => {
      toast.exito('Agregado al vademécum maestro')
      onAgregado(l)
    },
    onError: (e) => toast.error(mensajeDeError(e, 'No se pudo agregar al maestro')),
  })

  return (
    <div className="space-y-3 rounded-md border border-borde bg-tenue/30 p-3">
      {fila.candidatos.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-tenue-fg">Lo que propone el cruce</p>
          {fila.candidatos.map((m) => (
            <button
              key={m.codigo}
              type="button"
              onClick={() => onElegir(m.codigo)}
              className="flex w-full items-center gap-2 rounded-md border border-borde bg-superficie px-3 py-2 text-left text-sm hover:border-marca"
            >
              <Medicamento m={m} />
            </button>
          ))}
        </div>
      )}
      <div className="space-y-1.5">
        <p className="text-xs font-medium text-tenue-fg">Buscar otro en el maestro</p>
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-tenue-fg"
            aria-hidden="true"
          />
          <Input
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            mayusculas={false}
            placeholder="Principio activo, ATC o VAD-"
            aria-label="Buscar en el maestro"
            className="pl-9"
          />
        </div>
        {(busqueda.data ?? []).map((m) => (
          <button
            key={m.codigo}
            type="button"
            onClick={() => onElegir(m.codigo)}
            className="flex w-full items-center gap-2 rounded-md border border-borde bg-superficie px-3 py-2 text-left text-sm hover:border-marca"
          >
            <Medicamento m={m} />
          </button>
        ))}
      </div>
      {!nuevo ? (
        <Boton type="button" variante="enlace" tamano="sm" onClick={() => setNuevo(true)}>
          No está en el maestro: agregarlo
        </Boton>
      ) : (
        <div className="space-y-3 rounded-md border border-borde bg-superficie p-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">Agregar al vademécum maestro</p>
            <button type="button" onClick={() => setNuevo(false)} aria-label="Cerrar" className="text-tenue-fg">
              <X className="size-4" aria-hidden="true" />
            </button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Input value={dci} onChange={(e) => setDci(e.target.value)} placeholder="PRINCIPIO ACTIVO" aria-label="Principio activo" />
            <Input
              value={concentracion}
              onChange={(e) => setConcentracion(e.target.value)}
              placeholder="CONCENTRACIÓN (P. EJ. 650 MG)"
              aria-label="Concentración"
            />
            <Select value={forma} onChange={(e) => setForma(e.target.value)} aria-label="Forma farmacéutica">
              <option value="" disabled>
                Forma farmacéutica
              </option>
              {(filtros.data?.formas ?? []).map((x) => (
                <option key={x.valor} value={x.valor}>
                  {x.valor}
                </option>
              ))}
            </Select>
            <Select value={via} onChange={(e) => setVia(e.target.value)} aria-label="Vía">
              <option value="">Vía (opcional)</option>
              {(filtros.data?.vias ?? []).map((x) => (
                <option key={x.valor} value={x.valor}>
                  {x.valor}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex justify-end">
            <Boton
              type="button"
              tamano="sm"
              onClick={() => {
                if (dci.trim().length < 2) return toast.error('Escribe el principio activo')
                if (!forma) return toast.error('Elige la forma farmacéutica')
                agregar.mutate()
              }}
              cargando={agregar.isPending}
            >
              Agregar y usar
            </Boton>
          </div>
          <p className="text-xs text-tenue-fg">
            Queda en el maestro como «agregado por AccuMedical», disponible para todos los productos.
          </p>
        </div>
      )}
    </div>
  )
}
