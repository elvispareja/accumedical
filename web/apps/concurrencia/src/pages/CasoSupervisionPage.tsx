import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { motion, useReducedMotion } from 'framer-motion'
import { ArrowLeft, Clock, FileText, ImageUp } from 'lucide-react'
import { useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import {
  obtenerVisitaSupervision,
  prorrogarVisita,
  subirComprobante,
  urlComprobante,
  urlInformePdfSupervision,
  type VisitaSupervisionDetalle,
} from '@concurrencia/api'
import { EstadoVisitaBadge } from '@concurrencia/components/visitas'
import { CamposNombre, desdeApi as nombreDesdeApi } from '@/shared/personas/CamposNombre'
import { Boton } from '@/shared/components/ui/button'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { useToast } from '@/shared/components/ui/toast'

const EASE: [number, number, number, number] = [0.22, 0.61, 0.36, 1]

/**
 * El caso de una compañía visto desde la supervisión, **como página entera** y
 * no como diálogo: se abre igual que el formulario de alta, con su dirección
 * propia —enlazable y compartible— y el botón «atrás» del navegador haciendo lo
 * que se espera. Es lo mismo que pide `docs/07`, §2 para altas y ediciones: son
 * páginas, no paneles.
 *
 * Las restricciones no cambian por mudarse de sitio: el caso sigue **entero
 * deshabilitado**. Lo que sí se puede hacer —reprogramar la ventana y subir el
 * comprobante— sigue siendo lo mismo que se podía dentro del diálogo.
 *
 * La ruta es distinta para cada quien, y por eso la resuelve esta página y no
 * quien enlaza: el coordinador entra por su módulo y el administrador global
 * por su panel de Auditorías.
 */
export function CasoSupervisionPage() {
  const { id } = useParams<{ id: string }>()
  const navegar = useNavigate()
  const sinMovimiento = useReducedMotion()

  // A dónde se vuelve: el panel del módulo, también para el administrador global,
  // que entra como coordinador de plataforma (D45).
  const listado = '/concurrencia'

  const detalle = useQuery({
    queryKey: ['supervision-visita', id],
    queryFn: () => obtenerVisitaSupervision(id!),
    enabled: Boolean(id),
  })

  if (detalle.isError) {
    return (
      <div className="w-full rounded-md border border-borde bg-superficie px-6 py-14 text-center">
        <p className="font-display text-sm font-medium">No encontramos ese caso</p>
        <p className="mt-1 text-sm text-tenue-fg">Puede que se haya retirado.</p>
        <Boton variante="contorno" tamano="sm" className="mt-4" onClick={() => navegar(listado)}>
          Volver a los casos
        </Boton>
      </div>
    )
  }

  const caso = detalle.data

  return (
    <div className="w-full">
      <Link
        to={listado}
        className="inline-flex items-center gap-1.5 rounded text-sm text-tenue-fg transition-colors duration-150 hover:text-tinta"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Casos de las aseguradoras
      </Link>

      <header className="mt-3 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-display text-[0.6875rem] font-semibold uppercase tracking-[0.16em] text-tenue-fg">
            Concurrencia · Supervisión
          </p>
          <h1 className="mt-1.5 font-display text-2xl font-semibold tracking-tight">
            {caso ? caso.codigo_interno : 'Caso'}
          </h1>
          <p className="mt-1 text-sm text-tenue-fg">
            {caso ? `${caso.aseguradora_nombre} · ${caso.prestador_nombre}` : 'Cargando…'}
          </p>
        </div>
        <Boton variante="contorno" onClick={() => navegar(listado)}>
          Volver
        </Boton>
      </header>

      <motion.div
        initial={sinMovimiento ? { opacity: 0 } : { opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.26, ease: EASE }}
        className="mt-7 rounded-md border border-borde bg-superficie p-5 sm:p-6"
      >
        {id && <CasoSoloLectura visitaId={id} />}
      </motion.div>
    </div>
  )
}

/** `datetime-local` para PINTAR la hora local, igual que en el formulario real. */
function aLocal(iso: string): string {
  const d = new Date(iso)
  const desfase = d.getTimezoneOffset() * 60000
  return new Date(d.getTime() - desfase).toISOString().slice(0, 16)
}

/**
 * El caso tal como lo ve la aseguradora al crearlo, con TODO deshabilitado: los
 * mismos bloques, los mismos campos, cero edición. Cuando el negocio defina qué
 * puede tocar el supervisor, se habilita campo a campo, no de golpe.
 */
function CasoSoloLectura({ visitaId }: { visitaId: string }) {
  const detalle = useQuery({
    queryKey: ['supervision-visita', visitaId],
    queryFn: () => obtenerVisitaSupervision(visitaId),
  })

  if (detalle.isPending) {
    return (
      <div className="space-y-3" role="status" aria-label="Cargando el caso">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="h-14 animate-pulse rounded-md bg-tenue" />
        ))}
      </div>
    )
  }
  if (detalle.isError || !detalle.data) {
    return (
      <p className="rounded-md border border-borde px-4 py-6 text-center text-sm text-tenue-fg">
        No pudimos cargar el caso. Cierra y vuelve a intentarlo.
      </p>
    )
  }

  const caso = detalle.data
  const seccion = 'font-display text-xs font-medium uppercase tracking-[0.09em] text-tenue-fg'
  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <p className={seccion}>Paciente</p>
        {/* Las MISMAS cuatro casillas con las que se capturó, no el nombre ya
            compuesto en una sola: esta vista enseña el caso tal como se creó, y
            se creó en cuatro. El componente es el mismo del formulario. */}
        <CamposNombre
          valores={nombreDesdeApi({
            nombre_principal: caso.paciente_nombre_principal,
            nombre_secundario: caso.paciente_nombre_secundario,
            apellido_paterno: caso.paciente_apellido_paterno,
            apellido_materno: caso.paciente_apellido_materno,
          })}
          onCambiar={() => {}}
          idPrefijo="sl-paciente"
          deshabilitado
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="sl-paciente-doc">Identificación</Label>
            <Input id="sl-paciente-doc" value={caso.paciente_numero_documento} disabled />
          </div>
        </div>
      </div>

      <div className="space-y-3">
        <p className={seccion}>A quién se visita</p>
        <div className="space-y-2">
          <Label htmlFor="sl-prestador">Prestador</Label>
          <Input id="sl-prestador" value={caso.prestador_nombre} disabled />
        </div>
        <div className="space-y-2">
          <Label htmlFor="sl-destino">Destino</Label>
          <Input
            id="sl-destino"
            value={`${caso.sede_nombre ?? 'Casa matriz'}${
              [caso.ciudad_nombre, caso.provincia_nombre].filter(Boolean).length
                ? ` — ${[caso.ciudad_nombre, caso.provincia_nombre].filter(Boolean).join(', ')}`
                : ''
            }`}
            disabled
          />
          {caso.lugar && <p className="text-xs text-tenue-fg">{caso.lugar}</p>}
        </div>
      </div>

      <div className="space-y-3">
        <p className={seccion}>Cuándo</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="sl-desde">Llegada del auditor</Label>
            <Input id="sl-desde" type="datetime-local" value={aLocal(caso.desde)} disabled />
          </div>
          <div className="space-y-2">
            <Label htmlFor="sl-hasta">Entrega del informe</Label>
            <Input id="sl-hasta" type="datetime-local" value={aLocal(caso.hasta)} disabled />
          </div>
          <div className="space-y-2">
            <Label htmlFor="sl-limite">Plazo de llegada</Label>
            <Input
              id="sl-limite"
              type="datetime-local"
              value={aLocal(caso.llegada_limite)}
              disabled
            />
          </div>
        </div>
        <div className="space-y-2">
          {/* La insignia, no un desplegable apagado: el estado no se elige en
              ninguna pantalla, así que tampoco se pinta como si se pudiera. */}
          <p className="font-display text-sm font-medium">Estado</p>
          <div className="flex flex-wrap items-center gap-2">
            <EstadoVisitaBadge estado={caso.estado} />
            {caso.estado === 'no_auditado' && (
              <span className="text-sm text-tenue-fg">
                El plazo de llegada venció sin el auditor.{' '}
                <strong className="font-medium">La compañía no ve este estado</strong>: para
                ella el caso sigue pendiente. Con «Extender» le das al auditor más horas para
                llegar; para moverlo de día, el operador lo reprograma desde su ficha.
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="space-y-3">
        <p className={seccion}>A quién se avisa</p>
        {caso.correos.length === 0 ? (
          <p className="text-sm text-tenue-fg">Sin correos anotados.</p>
        ) : (
          caso.correos.map((correo, indice) => (
            <div key={correo.email} className="space-y-2">
              <Label htmlFor={`sl-correo-${indice}`}>
                Correo {indice + 1}
                {correo.etiqueta && (
                  <span className="ml-2 font-normal normal-case text-tenue-fg">
                    · {correo.etiqueta}
                  </span>
                )}
              </Label>
              <Input id={`sl-correo-${indice}`} value={correo.email} disabled />
            </div>
          ))
        )}
        <div className="space-y-2">
          <Label htmlFor="sl-observaciones">Observaciones</Label>
          <Input id="sl-observaciones" value={caso.observaciones ?? '—'} disabled />
        </div>
      </div>

      <div className="space-y-2">
        <p className={seccion}>Derivación</p>
        <div className="space-y-2">
          <Label htmlFor="sl-auditor">Auditor asignado</Label>
          <Input id="sl-auditor" value={caso.auditor_nombre ?? 'Sin asignar'} disabled />
        </div>
      </div>

      {/* El informe del auditor, cuando ya existe: el PDF con la marca. */}
      {caso.tiene_informe && (
        <div className="space-y-2">
          <p className={seccion}>Informe de auditoría</p>
          <a
            href={urlInformePdfSupervision(caso.id)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 rounded border border-borde bg-superficie px-3 py-2 text-sm font-medium transition-colors duration-150 hover:border-marca/50 hover:text-marca"
          >
            <FileText className="size-4" aria-hidden="true" />
            Ver el informe (PDF)
          </a>
        </div>
      )}

      <Extender caso={caso} />
      <Comprobante caso={caso} />
    </div>
  )
}

/**
 * **La prórroga**: más horas para que el auditor llegue, contadas DESDE AHORA.
 * A las 16:00 se conceden dos y el plazo queda en las 18:00, no en la hora
 * original más dos; se puede repetir cuantas veces haga falta.
 *
 * Es de Accumedical, no de la compañía: es quien coordina a los auditores y
 * quien ve el `no_auditado` que a la compañía se le oculta. No mueve la entrega
 * del informe, que sigue donde la puso el SLA.
 */
function Extender({ caso }: { caso: VisitaSupervisionDetalle }) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const [abierto, setAbierto] = useState(false)
  const [horas, setHoras] = useState('2')

  const guardar = useMutation({
    mutationFn: () => prorrogarVisita(caso.id, Number(horas.replace(',', '.'))),
    onSuccess: (resultado) => {
      queryClient.invalidateQueries({ queryKey: ['supervision'] })
      queryClient.invalidateQueries({ queryKey: ['supervision-visita', caso.id] })
      toast.exito(
        `Plazo extendido hasta las ${new Date(resultado.llegada_limite).toLocaleTimeString(
          'es-EC',
          { hour: '2-digit', minute: '2-digit' },
        )}`,
      )
      setAbierto(false)
    },
    onError: (error) =>
      toast.error(
        (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
          'No se pudo extender el plazo',
      ),
  })

  // Con el auditor ya dentro, o con el caso terminado, no hay plazo que mover.
  if (!['programada', 'asignada', 'no_auditado'].includes(caso.estado)) return null

  if (!abierto) {
    return (
      <Boton type="button" variante="contorno" onClick={() => setAbierto(true)}>
        <Clock aria-hidden="true" />
        Extender
      </Boton>
    )
  }
  return (
    <div className="space-y-3 rounded-md border border-marca/40 bg-marca-suave/30 p-4">
      <p className="font-display text-xs font-medium uppercase tracking-[0.09em] text-tenue-fg">
        Extender el plazo de llegada
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="ex-horas">
            Horas más <span className="text-peligro">*</span>
          </Label>
          <Input
            id="ex-horas"
            inputMode="decimal"
            value={horas}
            onChange={(e) => setHoras(e.target.value)}
            className="tabular"
          />
          <p className="text-xs text-tenue-fg">
            Se cuentan desde ahora, no desde la hora original.
          </p>
        </div>
      </div>
      <div className="flex gap-2">
        <Boton
          type="button"
          cargando={guardar.isPending}
          onClick={() => {
            const cuantas = Number(horas.replace(',', '.'))
            if (!Number.isFinite(cuantas) || cuantas <= 0) {
              return toast.error('Indica cuántas horas más, en números')
            }
            guardar.mutate()
          }}
        >
          Extender
        </Boton>
        <Boton type="button" variante="fantasma" onClick={() => setAbierto(false)}>
          Cancelar
        </Boton>
      </div>
      <p className="text-xs text-tenue-fg">
        La entrega del informe no se mueve: sigue donde la puso el SLA.
      </p>
    </div>
  )
}

/** La imagen que comprueba el cambio de horario pedido por correo. */
function Comprobante({ caso }: { caso: VisitaSupervisionDetalle }) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const entrada = useRef<HTMLInputElement>(null)
  // El query se invalida al subir, pero el navegador cachearía la imagen por
  // URL: la versión en la query string la obliga a recargarse.
  const [version, setVersion] = useState(0)

  const subir = useMutation({
    mutationFn: (archivo: File) => subirComprobante(caso.id, archivo),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['supervision-visita', caso.id] })
      setVersion((v) => v + 1)
      toast.exito('Comprobante guardado')
    },
    onError: (error) =>
      toast.error(
        (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
          'No se pudo subir el comprobante',
      ),
  })

  return (
    <div className="space-y-3">
      <p className="font-display text-xs font-medium uppercase tracking-[0.09em] text-tenue-fg">
        Comprobante del cambio
      </p>
      {caso.tiene_comprobante && (
        <img
          src={`${urlComprobante(caso.id)}?v=${version}`}
          alt={`Comprobante del cambio de horario de ${caso.codigo_interno}`}
          className="max-h-72 w-full rounded-md border border-borde object-contain"
        />
      )}
      <input
        ref={entrada}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(e) => {
          const archivo = e.target.files?.[0]
          if (archivo) subir.mutate(archivo)
          e.target.value = ''
        }}
      />
      <Boton
        type="button"
        variante="contorno"
        cargando={subir.isPending}
        onClick={() => entrada.current?.click()}
      >
        <ImageUp aria-hidden="true" />
        {caso.tiene_comprobante ? 'Reemplazar comprobante' : 'Subir comprobante'}
      </Boton>
      <p className="text-xs text-tenue-fg">
        La imagen del correo donde pidieron el cambio de horario. PNG, JPEG o WebP.
      </p>
    </div>
  )
}
