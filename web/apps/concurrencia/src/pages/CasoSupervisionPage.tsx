import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { motion, useReducedMotion } from 'framer-motion'
import { ArrowLeft, Clock, FileText } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import {
  asignarAuditor,
  listarAuditores,
  obtenerVisitaSupervision,
  urlInformePdfSupervision,
  type AuditorElegible,
  type Parentesco,
  type VisitaSupervisionDetalle,
  REFRESCO_MS,
} from '@concurrencia/api'
import { EstadoVisitaBadge, FueraDeSla } from '@concurrencia/components/visitas'
import { CamposNombre, desdeApi as nombreDesdeApi } from '@/shared/personas/CamposNombre'
import { Boton } from '@/shared/components/ui/button'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { Select } from '@/shared/components/ui/select'
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
  const listado = '/dashboard'

  const detalle = useQuery({
    queryKey: ['supervision-visita', id],
    queryFn: () => obtenerVisitaSupervision(id!),
    enabled: Boolean(id),
    // El estado lo mueve el auditor (llega, envía el informe): se ve sin
    // recargar. Lo que el coordinador esté escribiendo no se pisa: vive en el
    // estado de los formularios, no en esta consulta.
    refetchInterval: REFRESCO_MS,
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
    refetchInterval: REFRESCO_MS,
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

  return <CasoCargado caso={detalle.data} />
}

const PARENTESCO: Record<Parentesco, string> = {
  conyuge: 'CÓNYUGE',
  hijo: 'HIJO/A',
  padre_madre: 'PADRE/MADRE',
  otro: 'OTRO',
}

function CasoCargado({ caso }: { caso: VisitaSupervisionDetalle }) {
  const seccion = 'font-display text-xs font-medium uppercase tracking-[0.09em] text-tenue-fg'
  return (
    <div className="space-y-6">
      {/* Cómo llegó el requerimiento, cuando lo programó la coordinación
          (26/10/2026). Interno: la aseguradora no lo ve. */}
      {caso.requerimiento_medio && (
        <div className="space-y-3">
          <p className={seccion}>Requerimiento</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="sl-req-medio">Medio</Label>
              <Input
                id="sl-req-medio"
                value={
                  caso.requerimiento_medio === 'correo'
                    ? 'CORREO'
                    : `OTRO MEDIO · ${caso.requerimiento_medio_detalle ?? ''}`
                }
                disabled
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sl-req-llego">Fecha y hora en que llegó</Label>
              <Input
                id="sl-req-llego"
                type="datetime-local"
                value={caso.requerimiento_recibido_at ? aLocal(caso.requerimiento_recibido_at) : ''}
                disabled
              />
            </div>
          </div>
        </div>
      )}

      {/* Póliza y titular (26/10/2026), tal como los capturó la compañía. */}
      <div className="space-y-3">
        <p className={seccion}>Póliza y titular</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="sl-poliza">Número de póliza</Label>
            <Input id="sl-poliza" value={caso.poliza_numero ?? '—'} disabled />
          </div>
          <div className="space-y-2">
            <Label htmlFor="sl-es-titular">¿El paciente es el titular?</Label>
            <Input
              id="sl-es-titular"
              value={caso.paciente_es_titular ? 'SÍ' : 'NO'}
              disabled
            />
          </div>
        </div>
        {!caso.paciente_es_titular && (
          <>
            <CamposNombre
              valores={nombreDesdeApi({
                nombre_principal: caso.titular_nombre_principal ?? '',
                nombre_secundario: caso.titular_nombre_secundario,
                apellido_paterno: caso.titular_apellido_paterno ?? '',
                apellido_materno: caso.titular_apellido_materno,
              })}
              onCambiar={() => {}}
              idPrefijo="sl-titular"
              deshabilitado
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="sl-titular-doc">Identificación del titular</Label>
                <Input
                  id="sl-titular-doc"
                  value={caso.titular_numero_documento ?? '—'}
                  disabled
                />
              </div>
            </div>
          </>
        )}
      </div>

      <div className="space-y-3">
        <p className={seccion}>
          {caso.paciente_es_titular ? 'Paciente (es el titular)' : 'Paciente (quien está internado)'}
        </p>
        {!caso.paciente_es_titular && caso.titular_parentesco && (
          <div className="space-y-2">
            <Label htmlFor="sl-parentesco">Parentesco con el titular</Label>
            <Input
              id="sl-parentesco"
              value={PARENTESCO[caso.titular_parentesco]}
              disabled
            />
          </div>
        )}
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
            value={`${caso.sede_nombre ?? 'SEDE PRINCIPAL'}${
              [caso.ciudad_nombre, caso.provincia_nombre].filter(Boolean).length
                ? ` — ${[caso.ciudad_nombre, caso.provincia_nombre].filter(Boolean).join(', ')}`
                : ''
            }`}
            disabled
          />
          {caso.lugar && <p className="text-xs text-tenue-fg">Dirección: {caso.lugar}</p>}
        </div>
        {/* Debajo del destino (pedido del usuario, 26/10/2026): lo que anotó la
            compañía suele ser sobre esa visita. */}
        <div className="space-y-2">
          <Label htmlFor="sl-observaciones">Observaciones</Label>
          <Input id="sl-observaciones" value={caso.observaciones ?? '—'} disabled />
        </div>
      </div>

      <div className="space-y-3">
        <p className={seccion}>Cuándo</p>
        {/* La hora de ir al hospital y, AL LADO, el auditor (pedido del usuario,
            26/10/2026): la coordinación fija las dos cosas juntas, una sola
            hora, sin rango. Editables solo mientras el caso está en la agenda.
            Sin «Entrega del informe» ni «Plazo de llegada» («esas dos cosas ya
            no van»): el servidor los sigue calculando de esta hora. */}
        {/* Con el auditor ya asignado, arriba solo se lee: la hora se cambia con
            «Nuevo horario» (pedido del usuario, 27/10/2026). */}
        {caso.estado === 'programada' ? (
          <Derivar caso={caso} />
        ) : (
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="sl-desde">Ir al hospital desde</Label>
              <Input id="sl-desde" type="datetime-local" value={aLocal(caso.desde)} disabled />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sl-hasta">Hasta</Label>
              <Input
                id="sl-hasta"
                type="datetime-local"
                value={aLocal(caso.llegada_limite)}
                disabled
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sl-auditor">Auditor</Label>
              <Input id="sl-auditor" value={caso.auditor_nombre ?? 'Sin asignar'} disabled />
            </div>
          </div>
        )}
        <div className="space-y-2">
          {/* La insignia, no un desplegable apagado: el estado no se elige en
              ninguna pantalla, así que tampoco se pinta como si se pudiera. */}
          <p className="font-display text-sm font-medium">Estado</p>
          <div className="flex flex-wrap items-center gap-2">
            <EstadoVisitaBadge estado={caso.estado} />
            {caso.fuera_sla && (
              <>
                <FueraDeSla />
                <span className="text-sm text-tenue-fg">
                  Pasó la entrega pactada y aún no hay informe. La compañía no ve esta marca.
                </span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Sin «A quién se avisa» ni «Comprobante del cambio» (pedido del
          usuario, 26/10/2026): los avisos se mandan igual; aquí no se muestran. */}
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

      <NuevoHorario caso={caso} />
    </div>
  )
}

/**
 * Derivar desde la ficha: el auditor —los de la ciudad del destino primero,
 * luego los de la provincia y luego el resto— y la hora puesta en «Cuándo».
 * Las dos son obligatorias; se guardan juntas. Con el caso ya derivado, sirve
 * para cambiar de auditor o de hora.
 */
function Derivar({ caso }: { caso: VisitaSupervisionDetalle }) {
  const toast = useToast()
  const queryClient = useQueryClient()
  // Un caso ya derivado trae su ventana; uno programado nace sin ella.
  const programado = caso.estado === 'programada'
  const [hora, setHora] = useState(() => (programado ? '' : aLocal(caso.desde)))
  const [horaFin, setHoraFin] = useState(() =>
    programado ? '' : aLocal(caso.llegada_limite),
  )
  const [auditorId, setAuditorId] = useState(caso.auditor_id ?? '')

  const guardar = useMutation({
    mutationFn: () =>
      asignarAuditor(
        caso.id,
        auditorId,
        new Date(hora).toISOString(),
        new Date(horaFin).toISOString(),
      ),
    onSuccess: (actualizada) => {
      queryClient.invalidateQueries({ queryKey: ['supervision'] })
      queryClient.invalidateQueries({ queryKey: ['supervision-visita', caso.id] })
      toast.exito(`${actualizada.codigo_interno} derivada a ${actualizada.auditor_nombre}`)
    },
    onError: (error) =>
      toast.error(
        (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
          'No se pudo derivar el caso',
      ),
  })

  return (
    <div className="space-y-3">
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-2">
          <Label htmlFor="sl-desde">
            Ir al hospital desde <span className="text-peligro">*</span>
          </Label>
          <Input
            id="sl-desde"
            type="datetime-local"
            value={hora}
            onChange={(e) => setHora(e.target.value)}
          />
          <p className="text-xs text-tenue-fg">La aseguradora no ve el horario.</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="sl-hasta">
            Hasta <span className="text-peligro">*</span>
          </Label>
          <Input
            id="sl-hasta"
            type="datetime-local"
            value={horaFin}
            min={hora || aLocal(new Date().toISOString())}
            onChange={(e) => setHoraFin(e.target.value)}
          />
          <p className="text-xs text-tenue-fg">Hasta qué hora puede llegar el auditor.</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="sl-auditor">
            Auditor <span className="text-peligro">*</span>
          </Label>
          <SelectorDeAuditor
            id="sl-auditor"
            caso={caso}
            valor={auditorId}
            alCambiar={setAuditorId}
          />
        </div>
      </div>
      <Boton
        type="button"
        cargando={guardar.isPending}
        onClick={() => {
          if (!hora || !horaFin) return toast.error('Indica desde y hasta qué hora ir al hospital')
          if (new Date(horaFin) <= new Date(hora)) {
            return toast.error('La hora «hasta» debe ser posterior a la hora «desde»')
          }
          if (!auditorId) return toast.error('Elige el auditor')
          guardar.mutate()
        }}
      >
        {caso.auditor_id ? 'Guardar' : 'Derivar'}
      </Boton>
    </div>
  )
}

/**
 * El auditor del caso: los de la ciudad del destino primero, luego los de la
 * provincia y luego el resto. Lo usan «Derivar» y «Nuevo horario».
 */
function SelectorDeAuditor({
  id,
  caso,
  valor,
  alCambiar,
}: {
  id: string
  caso: VisitaSupervisionDetalle
  valor: string
  alCambiar: (id: string) => void
}) {
  const auditores = useQuery({ queryKey: ['auditores'], queryFn: listarAuditores })
  const lista = auditores.data ?? []
  const enCiudad = caso.ciudad_nombre
    ? lista.filter((a) => a.ciudad_nombre === caso.ciudad_nombre)
    : []
  const enProvincia = caso.provincia_nombre
    ? lista.filter((a) => a.provincia_nombre === caso.provincia_nombre && !enCiudad.includes(a))
    : []
  const otros = lista.filter((a) => !enCiudad.includes(a) && !enProvincia.includes(a))
  const grupos: [string, AuditorElegible[]][] = [
    [`En la ciudad${caso.ciudad_nombre ? ` · ${caso.ciudad_nombre}` : ''}`, enCiudad],
    [`En la provincia${caso.provincia_nombre ? ` · ${caso.provincia_nombre}` : ''}`, enProvincia],
    ['En otras provincias', otros],
  ]
  return (
    <>
      <Select
        id={id}
        value={valor}
        onChange={(e) => alCambiar(e.target.value)}
        disabled={auditores.isPending}
      >
        <option value="">{auditores.isPending ? 'Cargando auditores…' : 'Elige el auditor'}</option>
        {grupos
          .filter(([, filas]) => filas.length > 0)
          .map(([titulo, filas]) => (
            <optgroup key={titulo} label={titulo}>
              {filas.map((a) => (
                <option key={a.id} value={a.id}>
                  {`${a.nombre_completo} · ${
                    [a.ciudad_nombre, a.provincia_nombre].filter(Boolean).join(', ') ||
                    'Sin ubicación registrada'
                  }`}
                </option>
              ))}
            </optgroup>
          ))}
      </Select>
      {auditores.data?.length === 0 && (
        <p className="text-xs text-tenue-fg">
          No hay médicos auditores activos: créalos en Usuarios del administrador.
        </p>
      )}
    </>
  )
}

/**
 * **Nuevo horario** (pedido del usuario, 27/10/2026; reemplaza a «Extender»):
 * con el auditor ya asignado se mueve la ventana —desde y hasta qué hora ir al
 * hospital— y, si hace falta, el auditor («por si quiero cambiar de auditor»).
 * Con el mismo auditor le llega el horario nuevo y la compañía no se entera;
 * con otro, es una derivación nueva. La entrega del informe no se mueve.
 */
function NuevoHorario({ caso }: { caso: VisitaSupervisionDetalle }) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const [abierto, setAbierto] = useState(false)
  const [hora, setHora] = useState(() => aLocal(caso.desde))
  const [horaFin, setHoraFin] = useState(() => aLocal(caso.llegada_limite))
  const [auditorId, setAuditorId] = useState(caso.auditor_id ?? '')

  const guardar = useMutation({
    mutationFn: () =>
      asignarAuditor(
        caso.id,
        auditorId,
        new Date(hora).toISOString(),
        new Date(horaFin).toISOString(),
      ),
    onSuccess: (actualizada) => {
      queryClient.invalidateQueries({ queryKey: ['supervision'] })
      queryClient.invalidateQueries({ queryKey: ['supervision-visita', caso.id] })
      toast.exito(`Guardado; se le avisa a ${actualizada.auditor_nombre ?? 'el auditor'}`)
      setAbierto(false)
    },
    onError: (error) =>
      toast.error(
        (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
          'No se pudo guardar el horario',
      ),
  })

  // Solo con el auditor asignado y sin haber llegado: después ya no hay visita
  // que mover.
  if (caso.estado !== 'asignada' || !caso.auditor_id) return null

  if (!abierto) {
    return (
      <Boton
        type="button"
        variante="contorno"
        onClick={() => {
          setHora(aLocal(caso.desde))
          setHoraFin(aLocal(caso.llegada_limite))
          setAuditorId(caso.auditor_id ?? '')
          setAbierto(true)
        }}
      >
        <Clock aria-hidden="true" />
        Nuevo horario
      </Boton>
    )
  }
  return (
    <div className="space-y-3 rounded-md border border-marca/40 bg-marca-suave/30 p-4">
      <p className="font-display text-xs font-medium uppercase tracking-[0.09em] text-tenue-fg">
        Nuevo horario
      </p>
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-2">
          <Label htmlFor="nh-desde">
            Ir al hospital desde <span className="text-peligro">*</span>
          </Label>
          <Input
            id="nh-desde"
            type="datetime-local"
            value={hora}
            onChange={(e) => setHora(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="nh-hasta">
            Hasta <span className="text-peligro">*</span>
          </Label>
          <Input
            id="nh-hasta"
            type="datetime-local"
            value={horaFin}
            min={hora || aLocal(new Date().toISOString())}
            onChange={(e) => setHoraFin(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="nh-auditor">
            Auditor <span className="text-peligro">*</span>
          </Label>
          <SelectorDeAuditor
            id="nh-auditor"
            caso={caso}
            valor={auditorId}
            alCambiar={setAuditorId}
          />
        </div>
      </div>
      <div className="flex gap-2">
        <Boton
          type="button"
          cargando={guardar.isPending}
          onClick={() => {
            if (!hora || !horaFin) return toast.error('Indica desde y hasta qué hora ir al hospital')
            if (new Date(horaFin) <= new Date(hora)) {
              return toast.error('La hora «hasta» debe ser posterior a la hora «desde»')
            }
            if (!auditorId) return toast.error('Elige el auditor')
            guardar.mutate()
          }}
        >
          Guardar
        </Boton>
        <Boton type="button" variante="fantasma" onClick={() => setAbierto(false)}>
          Cancelar
        </Boton>
      </div>
      <p className="text-xs text-tenue-fg">
        Al auditor le llega el horario nuevo; si cambias de auditor, el caso se le deriva al
        nuevo. La aseguradora no ve el horario.
      </p>
    </div>
  )
}
