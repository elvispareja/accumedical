import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { motion, useReducedMotion } from 'framer-motion'
import { ArrowLeft, Building, CircleSlash, FileText, MapPin, Plus, Search, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { cn } from '@/lib/utils'
import { useSesion } from '@/core/auth/useSesion'
import { useTiposDocumento } from '@/shared/catalogos/hooks'
import {
  actualizarVisita,
  buscarPaciente,
  buscarPacienteSupervision,
  obtenerSla,
  obtenerSlaSupervision,
  crearVisita,
  crearVisitaSupervision,
  type CorreoVisita,
  listarAseguradorasSupervision,
  listarPrestadoresDeAseguradora,
  listarPrestadoresDeLaRed,
  obtenerVisita,
  urlInformePdf,
  cancelarVisita,
  type PrestadorElegible,
} from '@concurrencia/api'
import { EstadoVisitaBadge, sePuedeEditar } from '@concurrencia/components/visitas'
import { Boton } from '@/shared/components/ui/button'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { Modal } from '@/shared/components/ui/modal'
import { Select } from '@/shared/components/ui/select'
import { useToast } from '@/shared/components/ui/toast'
import { FORMATOS, filtrarDocumento, problemaConDocumento } from '@/shared/identificacion'
import {
  CamposNombre,
  NOMBRE_VACIO,
  desdeApi as nombreDesdeApi,
  faltaObligatorio,
  haciaApi as nombreHaciaApi,
  nombreCompleto,
  type NombrePersona,
} from '@/shared/personas/CamposNombre'

const EASE: [number, number, number, number] = [0.22, 0.61, 0.36, 1]

/** «29 sep 2026, 13:00», para enseñar un plazo que no se teclea. */
function formatoLargo(fecha: Date): string {
  return new Intl.DateTimeFormat('es-EC', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(fecha)
}
const BANDEJA = '/dashboard'

/**
 * La casa matriz no es una sede: en la base es `sede_id` nulo. Aquí necesita un
 * valor propio para poder distinguirla de «todavía no he elegido nada», que es
 * la cadena vacía.
 */
const MATRIZ = 'matriz'

/**
 * Tres tarjetas y a partir de ahí se hace scroll. El alto sale de la tarjeta,
 * que no varía: 3 × 5rem + los dos huecos de 0.5rem que las separan.
 */
const ALTO_LISTA = 'calc(3 * 5rem + 2 * 0.5rem)'

/** La misma regla para los contactos, con fila más baja: 3 × 4rem + 2 huecos. */
const ALTO_CONTACTOS = 'calc(3 * 4rem + 2 * 0.5rem)'

/**
 * Qué va a mover el caso desde donde está. El estado no se elige en ninguna
 * pantalla —lo pone la acción que ocurre—, así que aquí se cuenta qué acción
 * falta, que es lo que la persona necesita saber.
 */
const QUE_SIGUE: Record<string, string> = {
  programada: 'Pasará a asignada cuando Accumedical la derive a un médico auditor.',
  asignada: 'Ya tiene auditor. Pasará a auditando cuando llegue al prestador.',
  auditando: 'El auditor está en el prestador; culminará al enviar su informe.',
  culminada: 'El auditor envió su informe.',
  cancelada: 'El caso se canceló.',
  no_auditado:
    'La ventana venció sin que el auditor llegara. Dale una fecha nueva y vuelve a la agenda.',
}

interface Formulario {
  /** El nombre del paciente, en las mismas cuatro partes que toda persona. */
  paciente: NombrePersona
  paciente_tipo_documento_codigo: string
  paciente_numero_documento: string
  prestador_id: string
  sede_id: string
  desde: string
  /** Ids de los contactos del prestador marcados. Lo que viaja es su correo. */
  contactos_elegidos: string[]
  /** Correos transcritos a mano, aparte de los contactos, con quién es cada uno. */
  correos: { _key: string; valor: string; etiqueta: string }[]
  observaciones: string
}

const VACIO: Formulario = {
  paciente: NOMBRE_VACIO,
  paciente_tipo_documento_codigo: '',
  paciente_numero_documento: '',
  prestador_id: '',
  sede_id: '',
  desde: '',
  contactos_elegidos: [],
  correos: [],
  observaciones: '',
}

function mensajeDeError(error: unknown, porDefecto: string): string {
  const detalle = (error as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
  if (typeof detalle === 'string') return detalle
  if (Array.isArray(detalle) && detalle.length > 0) {
    return (detalle[0] as { mensaje?: string }).mensaje ?? porDefecto
  }
  return porDefecto
}

/**
 * Cómo se identifica un destino: por dónde está, no por su calle. Al elegir
 * entre la matriz y las sedes lo que hay que distinguir es la ciudad —a Quito o
 * a Guayaquil—; la dirección exacta es detalle y va debajo, no en el
 * desplegable. Si no consta la ciudad se cae a la dirección, que sigue siendo
 * mejor que no decir nada.
 */
function zona(
  ciudad: string | null | undefined,
  provincia: string | null | undefined,
  direccion?: string | null,
): string {
  const donde = [ciudad, provincia].filter(Boolean).join(', ')
  return donde || direccion || 'sin ubicación registrada'
}


/** `datetime-local` no lleva zona; el navegador la pone al convertir a ISO. */
function aISO(local: string): string {
  return new Date(local).toISOString()
}

function aLocal(iso: string): string {
  const d = new Date(iso)
  const desfase = d.getTimezoneOffset() * 60000
  return new Date(d.getTime() - desfase).toISOString().slice(0, 16)
}

/**
 * A quién se avisó del caso, cuando el expediente solo se mira.
 *
 * No es el selector apagado: es **el hecho**. El selector enseñaría a todos los
 * contactos del prestador —incluidos aquellos a los que NO se avisó— con su
 * casilla, y quien mira acabaría preguntándose por qué puede marcar al gerente
 * si a él no se le mandó nada. Aquí solo están los correos que salieron, con su
 * etiqueta, en las mismas casillas con las que se capturaron y deshabilitadas.
 */
function ListaDeAvisados({ correos }: { correos: CorreoVisita[] }) {
  if (correos.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-borde px-6 py-8 text-center">
        <p className="text-sm text-tenue-fg">A este caso no se le anotó ningún correo.</p>
      </div>
    )
  }
  return (
    <div className="space-y-3">
      {correos.map((correo, indice) => (
        <div key={`${correo.email}-${indice}`} className="space-y-2">
          <Label htmlFor={`avisado-${indice}`}>
            Correo {indice + 1}
            {correo.etiqueta ? (
              <span className="font-normal text-tenue-fg"> · {correo.etiqueta}</span>
            ) : null}
          </Label>
          <Input id={`avisado-${indice}`} value={correo.email} disabled />
        </div>
      ))}
      <p className="text-xs text-tenue-fg">
        {correos.length === 1 ? 'Se avisó a 1 correo.' : `Se avisó a ${correos.length} correos.`}
      </p>
    </div>
  )
}

function Bloque({
  titulo,
  descripcion,
  children,
  retraso = 0,
}: {
  titulo: string
  descripcion?: string
  children: ReactNode
  retraso?: number
}) {
  const sinMovimiento = useReducedMotion()
  return (
    <motion.section
      initial={sinMovimiento ? { opacity: 0 } : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.26, delay: sinMovimiento ? 0 : retraso, ease: EASE }}
      className="rounded-md border border-borde bg-superficie p-5 sm:p-6"
    >
      <h2 className="font-display text-sm font-semibold">{titulo}</h2>
      {descripcion && <p className="mt-0.5 text-sm text-tenue-fg">{descripcion}</p>}
      <div className="mt-5">{children}</div>
    </motion.section>
  )
}

/**
 * Programar la visita del médico auditor: se elige un prestador de la red y, si
 * tiene sedes, a cuál de ellas se va. Si no las tiene, se visita su dirección.
 *
 * Con `supervision` sirve al coordinador de plataforma —a él los pedidos le
 * llegan por correo—: primero elige LA ASEGURADORA y el resto es idéntico,
 * contra los endpoints de supervisión. Es el mismo componente a propósito:
 * los formularios se comparten, no se duplican por rol.
 */
export function VisitaFormPage({
  supervision = false,
  vista = false,
}: {
  supervision?: boolean
  /** Se entró por «Ver»: el mismo expediente, con todo deshabilitado. */
  vista?: boolean
}) {
  const { id } = useParams<{ id: string }>()
  const editando = Boolean(id)
  const navegar = useNavigate()
  const queryClient = useQueryClient()
  const toast = useToast()
  const { data: sesion } = useSesion()

  // A dónde se vuelve: la bandeja de compañía, o la pantalla de supervisión
  // (/concurrencia/dashboard).
  const volverA = supervision ? '/dashboard' : BANDEJA
  const [aseguradoraId, setAseguradoraId] = useState('')
  const aseguradoras = useQuery({
    queryKey: ['concurrencia', 'supervision-aseguradoras'],
    queryFn: listarAseguradorasSupervision,
    enabled: supervision,
    staleTime: 60_000,
  })

  // Tres motivos para que el expediente se enseñe sin poder tocarlo, y el texto
  // de la cabecera dice cuál es. Esto solo apaga la interfaz; la puerta real
  // está en el backend, que rechaza la mutación con 403 o con 409.
  const soloSupervisa =
    Boolean(sesion?.aseguradora) &&
    sesion?.modulos.find((m) => m.codigo === 'concurrencia')?.rol === 'supervisor'

  const [form, setForm] = useState<Formulario>(VACIO)
  const [busqueda, setBusqueda] = useState('')
  const [confirmandoCancelar, setConfirmandoCancelar] = useState(false)

  const tipos = useTiposDocumento()
  // En supervisión la red depende de la aseguradora elegida; sin elegirla
  // todavía no hay nada que pedir.
  const prestadores = useQuery({
    queryKey: supervision
      ? ['concurrencia', 'supervision-prestadores', aseguradoraId]
      : ['concurrencia', 'prestadores'],
    queryFn: () =>
      supervision ? listarPrestadoresDeAseguradora(aseguradoraId) : listarPrestadoresDeLaRed(),
    enabled: !supervision || Boolean(aseguradoraId),
    staleTime: 60_000,
  })

  function elegirAseguradora(nueva: string) {
    // Cambiar de compañía invalida prestador, sede y contactos: son de otra red.
    setAseguradoraId(nueva)
    setForm((previo) => ({
      ...previo,
      prestador_id: '',
      sede_id: '',
      contactos_elegidos: [],
    }))
  }
  const detalle = useQuery({
    queryKey: ['visita', id],
    queryFn: () => obtenerVisita(id!),
    enabled: editando,
  })

  const estadoActual = detalle.data?.estado
  // Un caso cerrado —culminado o cancelado— se lee, no se toca. El servidor lo
  // corta igual con un 409 aunque se teclee la dirección.
  const cerrado = editando && !sePuedeEditar(estadoActual)
  // Vencido sin que el auditor llegara: se edita, y darle una ventana futura
  // es lo que lo devuelve a la agenda.
  const vencido = estadoActual === 'no_auditado'
  const soloLectura = vista || cerrado || soloSupervisa

  // Crear no es lo suyo: si el supervisor teclea /nueva a mano, a su panel.
  useEffect(() => {
    if (soloSupervisa && !editando) navegar(BANDEJA, { replace: true })
  }, [soloSupervisa, editando, navegar])

  useEffect(() => {
    if (!detalle.data) return
    setForm({
      paciente: nombreDesdeApi({
        nombre_principal: detalle.data.paciente_nombre_principal,
        nombre_secundario: detalle.data.paciente_nombre_secundario,
        apellido_paterno: detalle.data.paciente_apellido_paterno,
        apellido_materno: detalle.data.paciente_apellido_materno,
      }),
      paciente_tipo_documento_codigo: detalle.data.paciente_tipo_documento_codigo,
      paciente_numero_documento: detalle.data.paciente_numero_documento,
      prestador_id: detalle.data.prestador_id,
      // Sin sede guardada, la visita era a la casa matriz.
      sede_id: detalle.data.sede_id ?? MATRIZ,
      desde: aLocal(detalle.data.desde),
      contactos_elegidos: [],
      correos: detalle.data.correos.map((c) => ({
        _key: crypto.randomUUID(),
        valor: c.email,
        etiqueta: c.etiqueta ?? '',
      })),
      observaciones: detalle.data.observaciones ?? '',
    })
  }, [detalle.data])

  // Al reabrir, los correos guardados se reparten: el que coincide con un
  // contacto del prestador vuelve como casilla marcada, y el resto como texto,
  // que es como se transcribió. La tabla no distingue el origen —guarda correos
  // y ya—, así que el reparto se rehace aquí contra los contactos de hoy: si un
  // contacto se borró desde entonces, su correo reaparece como texto y no se
  // pierde. Corre una sola vez, cuando la visita y la red ya llegaron.
  const repartido = useRef(false)
  useEffect(() => {
    if (!editando || repartido.current || !detalle.data || !prestadores.data) return
    repartido.current = true

    const contactos = prestadores.data.find((p) => p.id === detalle.data.prestador_id)?.contactos
    if (!contactos?.length) return
    const porCorreo = new Map(contactos.map((c) => [c.email.toLocaleUpperCase(), c.id]))

    const marcados: string[] = []
    const transcritos: { email: string; etiqueta: string | null }[] = []
    for (const correo of detalle.data.correos) {
      const contactoId = porCorreo.get(correo.email.toLocaleUpperCase())
      if (contactoId && !marcados.includes(contactoId)) marcados.push(contactoId)
      else transcritos.push(correo)
    }
    setForm((previo) => ({
      ...previo,
      contactos_elegidos: marcados,
      correos: transcritos.map((c) => ({
        _key: crypto.randomUUID(),
        valor: c.email,
        etiqueta: c.etiqueta ?? '',
      })),
    }))
  }, [editando, detalle.data, prestadores.data])

  /**
   * La identificación del paciente es el PRIMER paso del alta: se teclea el
   * documento, se pulsa «Buscar» y solo entonces aparece el resto del
   * formulario. Antes esto se hacía solo, a los 400 ms de teclear, y nadie se
   * enteraba de si el paciente ya estaba o no.
   *
   *   pendiente → todavía no se ha buscado con este documento
   *   buscando  → la consulta está en vuelo
   *   conocido  → ya pasó por un caso nuestro; sus nombres se rellenaron
   *   nuevo     → no lo teníamos; se escriben a mano
   */
  const [pasoPaciente, setPasoPaciente] = useState<'pendiente' | 'buscando' | 'conocido' | 'nuevo'>(
    'pendiente',
  )
  const [conocidoComo, setConocidoComo] = useState('')

  // Tocar el documento invalida lo buscado: el nombre que hubiera quedado era
  // el de OTRA persona, y arrastrarlo sería el peor error posible aquí.
  function cambiarDocumento(cambios: Partial<Formulario>) {
    setForm((p) => ({
      ...p,
      ...cambios,
      paciente: pasoPaciente === 'conocido' ? NOMBRE_VACIO : p.paciente,
    }))
    setPasoPaciente('pendiente')
    setConocidoComo('')
  }

  async function buscarAlPaciente() {
    const tipo = form.paciente_tipo_documento_codigo
    const numero = form.paciente_numero_documento.trim()
    if (!tipo || !numero || problemaDocumento) return
    if (supervision && !aseguradoraId) return toast.error('Elige primero la aseguradora del caso')
    setPasoPaciente('buscando')
    try {
      const conocido = supervision
        ? await buscarPacienteSupervision(aseguradoraId, tipo, numero)
        : await buscarPaciente(tipo, numero)
      if (!conocido.encontrado || !conocido.nombre_principal || !conocido.apellido_paterno) {
        setPasoPaciente('nuevo')
        return
      }
      const nombre = nombreDesdeApi({
        nombre_principal: conocido.nombre_principal,
        nombre_secundario: conocido.nombre_secundario,
        apellido_paterno: conocido.apellido_paterno,
        apellido_materno: conocido.apellido_materno,
      })
      setForm((p) => ({ ...p, paciente: nombre }))
      setConocidoComo(nombreCompleto(nombre))
      setPasoPaciente('conocido')
    } catch {
      // Que la búsqueda falle no puede impedir abrir el caso: se sigue a mano.
      setPasoPaciente('nuevo')
      toast.error('No pudimos consultar el paciente; escribe sus datos')
    }
  }

  /**
   * **La entrega del informe no se teclea**: es la hora de llegada más las
   * horas de SLA que la compañía tiene pactadas para Concurrencia. Se calcula
   * aquí solo para enseñarla mientras se elige la hora; quien manda es el
   * servidor, que la vuelve a calcular al guardar con la misma regla.
   */
  const sla = useQuery({
    queryKey: ['concurrencia-sla', supervision ? aseguradoraId : 'propia'],
    queryFn: () => (supervision ? obtenerSlaSupervision(aseguradoraId) : obtenerSla()),
    enabled: !soloLectura && (!supervision || Boolean(aseguradoraId)),
    retry: false,
  })

  const entrega = useMemo(() => {
    if (editando && detalle.data) {
      return {
        texto: formatoLargo(new Date(detalle.data.hasta)),
        ayuda: 'Se fijó al programar el caso, con el SLA de la compañía.',
      }
    }
    if (sla.isError) {
      return {
        texto: '—',
        ayuda: 'Esta compañía no tiene horas de SLA pactadas para Concurrencia.',
      }
    }
    if (!sla.data || !form.desde) {
      return {
        texto: '—',
        ayuda: supervision && !aseguradoraId
          ? 'Elige la aseguradora y la hora de llegada.'
          : 'Se calcula al poner la hora de llegada.',
      }
    }
    const llegada = new Date(form.desde)
    const vence = new Date(llegada.getTime() + sla.data.horas * 3600_000)
    return {
      texto: formatoLargo(vence),
      ayuda: `${sla.data.horas} h de SLA desde la llegada.`,
    }
  }, [editando, detalle.data, sla.data, sla.isError, form.desde, supervision, aseguradoraId])

  // Hasta saber de quién es el caso, no se pide nada más. En edición no aplica:
  // el paciente ya está identificado desde que se creó.
  const identificado =
    editando || soloLectura || pasoPaciente === 'conocido' || pasoPaciente === 'nuevo'

  const elegido: PrestadorElegible | undefined = useMemo(
    () => prestadores.data?.find((p) => p.id === form.prestador_id),
    [prestadores.data, form.prestador_id],
  )

  // Cédula y RUC llevan dígito verificador: se comprueba al teclear para no
  // descubrir el error recién al guardar.
  const problemaDocumento = problemaConDocumento(
    form.paciente_tipo_documento_codigo,
    form.paciente_numero_documento,
  )

  // La búsqueda va SOLA (pedido del usuario, 26/10/2026: sin botón «Buscar
  // paciente»): en cuanto el documento está completo y es válido, y tras una
  // pausa corta para no consultar a cada tecla. El aviso «Ya lo teníamos» o «No
  // lo teníamos» sigue diciendo qué pasó.
  useEffect(() => {
    if (editando || soloLectura || pasoPaciente !== 'pendiente') return
    if (!form.paciente_tipo_documento_codigo || !form.paciente_numero_documento.trim()) return
    if (problemaDocumento || (supervision && !aseguradoraId)) return
    const espera = window.setTimeout(() => void buscarAlPaciente(), 600)
    return () => window.clearTimeout(espera)
    // `buscarAlPaciente` se rehace en cada pintado; lo que decide buscar son estos datos.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    editando,
    soloLectura,
    pasoPaciente,
    form.paciente_tipo_documento_codigo,
    form.paciente_numero_documento,
    problemaDocumento,
    supervision,
    aseguradoraId,
  ])

  const visibles = useMemo(() => {
    const termino = busqueda.trim().toLocaleLowerCase()
    const todos = prestadores.data ?? []
    // Oculta hasta que se escribe (pedido del usuario, 26/10/2026): sin búsqueda
    // solo se ve el que ya está elegido, para no perderlo de vista.
    if (!termino) return todos.filter((p) => p.id === form.prestador_id)
    return todos.filter((p) =>
      [p.nombre, p.codigo_interno].some((campo) => campo.toLocaleLowerCase().includes(termino)),
    )
  }, [prestadores.data, busqueda, form.prestador_id])

  function elegirPrestador(prestadorId: string) {
    // Cambiar de prestador invalida la sede y los contactos marcados: son de
    // otro. Los correos transcritos a mano sí sobreviven, que no son de nadie.
    setForm((previo) => ({
      ...previo,
      prestador_id: prestadorId,
      sede_id: '',
      contactos_elegidos: [],
    }))
  }

  function marcarContacto(contactoId: string, marcado: boolean) {
    setForm((previo) => ({
      ...previo,
      contactos_elegidos: marcado
        ? [...previo.contactos_elegidos, contactoId]
        : previo.contactos_elegidos.filter((c) => c !== contactoId),
    }))
  }

  /** Dónde se visita, ya resuelto, para la línea de debajo del selector. */
  const destino = useMemo(() => {
    if (!elegido) return null
    if (form.sede_id === MATRIZ) {
      return {
        direccion: elegido.direccion,
        ciudad: elegido.ciudad_nombre,
        provincia: elegido.provincia_nombre,
      }
    }
    const sede = elegido.sedes.find((s) => s.id === form.sede_id)
    if (!sede) return null
    return {
      direccion: sede.direccion,
      ciudad: sede.ciudad_nombre,
      provincia: sede.provincia_nombre,
    }
  }, [elegido, form.sede_id])

  function anadirCorreo() {
    setForm((previo) => ({
      ...previo,
      correos: [...previo.correos, { _key: crypto.randomUUID(), valor: '', etiqueta: '' }],
    }))
  }

  /**
   * Los correos que viajan: primero los de los contactos marcados y detrás los
   * transcritos a mano, sin repetir ninguno. Si alguien marca a un contacto y
   * además teclea su mismo correo, eso no es un error que reprochar: es la misma
   * persona una vez.
   */
  function correosAEnviar(): CorreoVisita[] {
    const correos: CorreoVisita[] = []
    const vistos = new Set<string>()
    // El contacto marcado hereda su identidad de la ficha; el tecleado a mano,
    // lo que se haya escrito en «Quién es».
    const delContacto: CorreoVisita[] = (elegido?.contactos ?? [])
      .filter((c) => form.contactos_elegidos.includes(c.id))
      .map((c) => ({
        email: c.email,
        etiqueta: `${c.nombre_completo}${c.cargo ? ` · ${c.cargo}` : ''}`,
      }))
    const manuales: CorreoVisita[] = form.correos.map((c) => ({
      email: c.valor.trim(),
      etiqueta: c.etiqueta.trim() || null,
    }))
    for (const correo of [...delContacto, ...manuales]) {
      if (correo.email && !vistos.has(correo.email.toLocaleUpperCase())) {
        vistos.add(correo.email.toLocaleUpperCase())
        correos.push(correo)
      }
    }
    return correos
  }

  const guardar = useMutation({
    mutationFn: async () => {
      const nombre = nombreHaciaApi(form.paciente)
      const cuerpo = {
        prestador_id: form.prestador_id,
        paciente_nombre_principal: nombre.nombre_principal,
        paciente_nombre_secundario: nombre.nombre_secundario,
        paciente_apellido_paterno: nombre.apellido_paterno,
        paciente_apellido_materno: nombre.apellido_materno,
        paciente_tipo_documento_codigo: form.paciente_tipo_documento_codigo,
        paciente_numero_documento: form.paciente_numero_documento.trim(),
        // La casa matriz se guarda como ausencia de sede.
        sede_id: form.sede_id === MATRIZ ? null : form.sede_id || null,
        // Sin el bloque «Cuándo» (pedido del usuario, 26/10/2026): mientras se
        // definen los parámetros nuevos, la hora base es la del registro.
        desde: form.desde ? aISO(form.desde) : new Date().toISOString(),
        correos: correosAEnviar(),
        observaciones: form.observaciones.trim() || null,
      }
      if (supervision) return crearVisitaSupervision({ ...cuerpo, aseguradora_id: aseguradoraId })
      return id ? actualizarVisita(id, cuerpo) : crearVisita(cuerpo)
    },
    onSuccess: (visita) => {
      queryClient.invalidateQueries({ queryKey: ['visitas'] })
      queryClient.invalidateQueries({ queryKey: ['visita', visita.id] })
      queryClient.invalidateQueries({ queryKey: ['supervision'] })
      toast.exito(editando ? 'Visita actualizada' : `Visita programada · ${visita.codigo_interno}`)
      navegar(volverA)
    },
    onError: (error) => toast.error(mensajeDeError(error, 'No se pudo guardar la visita')),
  })

  // Cancelar el caso: lo ÚNICO que mueve su estado desde la compañía. No es un
  // campo del formulario —no hay desplegable de estado en ninguna pantalla—,
  // es una acción con su nombre, su confirmación y su rastro en la auditoría.
  const cancelar = useMutation({
    mutationFn: () => cancelarVisita(id!),
    onSuccess: (visita) => {
      queryClient.invalidateQueries({ queryKey: ['visitas'] })
      queryClient.invalidateQueries({ queryKey: ['visita', visita.id] })
      queryClient.invalidateQueries({ queryKey: ['supervision'] })
      setConfirmandoCancelar(false)
      toast.exito(`${visita.codigo_interno} cancelada`)
      navegar(volverA)
    },
    onError: (error) => {
      setConfirmandoCancelar(false)
      toast.error(mensajeDeError(error, 'No se pudo cancelar el caso'))
    },
  })

  // Por qué no se puede tocar, dicho con todas las letras. Quien entró por
  // «Ver» no necesita que se lo expliquen: lo eligió él.
  const motivoDeSoloLectura =
    estadoActual === 'culminada'
      ? 'solo lectura: el caso ya culminó'
      : estadoActual === 'cancelada'
        ? 'solo lectura: el caso está cancelado'
        : soloSupervisa
          ? 'solo lectura: las visitas las gestiona tu equipo de ejecutivos'
          : null

  // Se cancela mientras nadie haya llegado. Con el auditor dentro del hospital
  // ya no hay nada que cancelar: ese caso termina con su informe.
  const sePuedeCancelar =
    editando && !soloLectura && (estadoActual === 'programada' || estadoActual === 'asignada')

  function enviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault()
    if (soloLectura) return
    if (supervision && !aseguradoraId) {
      return toast.error('Elige primero la aseguradora del caso')
    }
    // Con el documento válido la búsqueda va sola; guardar a mitad de ella podría
    // registrar como nuevo a alguien que ya teníamos.
    if (!identificado && !problemaDocumento && form.paciente_numero_documento.trim()) {
      return toast.error('Espera un momento: estamos buscando al paciente')
    }
    if (
      faltaObligatorio(form.paciente) ||
      !form.paciente_tipo_documento_codigo ||
      !form.paciente_numero_documento.trim()
    ) {
      return toast.error(
        'El paciente es obligatorio: nombre principal, apellido paterno e identificación completa',
      )
    }
    if (problemaDocumento) return toast.error(problemaDocumento)
    if (!form.prestador_id) return toast.error('Elige el prestador que se va a visitar')
    if (elegido && elegido.sedes.length > 0 && !form.sede_id) {
      return toast.error('Elige la sede: la casa matriz o una de sus sedes')
    }
    if (vencido && !form.desde) return toast.error('Indica cuándo debe llegar el auditor')
    const correos = form.correos.map((c) => c.valor.trim()).filter(Boolean)
    if (new Set(correos.map((c) => c.toLocaleLowerCase())).size !== correos.length) {
      return toast.error('Hay un correo repetido')
    }
    guardar.mutate()
  }

  if (editando && detalle.isPending) {
    return (
      <div className="space-y-4" role="status" aria-label="Cargando la visita">
        <div className="h-4 w-40 animate-pulse rounded bg-tenue" />
        <div className="h-9 w-72 animate-pulse rounded bg-tenue" />
        <div className="h-64 animate-pulse rounded-md bg-tenue" />
      </div>
    )
  }

  return (
    <div className="w-full">
      <Link
        to={volverA}
        className="inline-flex items-center gap-1.5 rounded text-sm text-tenue-fg transition-colors duration-150 hover:text-tinta"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        {soloLectura ? 'Volver al panel' : 'Bandeja de entrada'}
      </Link>

      <header className="mt-3 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-display text-[0.6875rem] font-semibold uppercase tracking-[0.16em] text-tenue-fg">
            Concurrencia
          </p>
          <h1 className="mt-1.5 font-display text-2xl font-semibold tracking-tight">
            {soloLectura ? 'Visita' : editando ? 'Editar visita' : 'Nueva visita'}
          </h1>
          {editando && (
            <p className="mt-1 text-sm text-tenue-fg">
              {[detalle.data?.codigo_interno, motivoDeSoloLectura].filter(Boolean).join(' · ')}
            </p>
          )}
          {/* El estado ya no se teclea, así que se ENSEÑA: dónde está el caso y
              qué lo moverá de ahí. Es lo que antes decía el desplegable, pero
              contado como lo que es: una consecuencia, no una elección. */}
          {editando && estadoActual && (
            <p className="mt-2.5 flex flex-wrap items-center gap-2 text-sm text-tenue-fg">
              <EstadoVisitaBadge estado={estadoActual} />
              <span>{QUE_SIGUE[estadoActual] ?? ''}</span>
            </p>
          )}
        </div>
        <div className="flex gap-2">
        {/* El informe del auditor, cuando ya existe: se abre el PDF de marca. */}
        {editando && detalle.data?.tiene_informe && (
          <a
            href={id ? urlInformePdf(id) : '#'}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-10 items-center gap-2 rounded border border-borde bg-superficie px-3 text-sm font-medium transition-colors duration-150 hover:border-marca/50 hover:text-marca"
          >
            <FileText className="size-4" aria-hidden="true" />
            Informe (PDF)
          </a>
        )}
        {soloLectura ? (
          <Boton variante="contorno" onClick={() => navegar(volverA)}>
            Volver
          </Boton>
        ) : (
          <div className="flex gap-2">
            <Boton
              variante="contorno"
              onClick={() => navegar(volverA)}
              disabled={guardar.isPending}
            >
              Cancelar
            </Boton>
            <Boton type="submit" form="form-visita" cargando={guardar.isPending}>
              {/* Sobre un caso vencido, guardar ES reprogramar: el botón lo
                  dice, porque el efecto no es el de siempre. */}
              {vencido ? 'Reprogramar visita' : editando ? 'Guardar cambios' : 'Programar visita'}
            </Boton>
          </div>
        )}
        </div>
      </header>

      <form id="form-visita" onSubmit={enviar} noValidate className="mt-7">
        {/* Un solo interruptor apaga TODO lo de dentro —campos, casillas y
            botones— cuando quien mira no puede tocar: así no queda ningún
            control suelto que olvidarse de deshabilitar. */}
        <fieldset disabled={soloLectura} className="space-y-4">
        {supervision && (
          <Bloque
            titulo="Aseguradora"
            descripcion="El caso nace de esta compañía; su red define qué prestadores puedes elegir."
          >
            <Select
              value={aseguradoraId}
              onChange={(e) => elegirAseguradora(e.target.value)}
              disabled={aseguradoras.isPending}
              aria-label="Aseguradora del caso"
            >
              <option value="">
                {aseguradoras.isPending ? 'Cargando aseguradoras…' : 'Elige la aseguradora'}
              </option>
              {aseguradoras.data?.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.nombre}
                </option>
              ))}
            </Select>
          </Bloque>
        )}
        <Bloque titulo="Paciente">
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="paciente_tipo">
                Tipo de identificación <span className="text-peligro">*</span>
              </Label>
              <Select
                id="paciente_tipo"
                value={form.paciente_tipo_documento_codigo}
                onChange={(e) =>
                  cambiarDocumento({ paciente_tipo_documento_codigo: e.target.value })
                }
                required
              >
                <option value="">Elige el tipo</option>
                {tipos.data?.map((t) => (
                  <option key={t.codigo} value={t.codigo}>
                    {t.nombre}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="paciente_numero">
                Número de identificación <span className="text-peligro">*</span>
              </Label>
              <Input
                id="paciente_numero"
                inputMode={
                  FORMATOS[form.paciente_tipo_documento_codigo]?.soloDigitos ? 'numeric' : 'text'
                }
                value={form.paciente_numero_documento}
                onChange={(e) =>
                  cambiarDocumento({
                    paciente_numero_documento: filtrarDocumento(
                      e.target.value,
                      form.paciente_tipo_documento_codigo,
                    ),
                  })
                }
                placeholder="0912345678"
                className="tabular"
                required
              />
              {/* El dígito verificador, comprobado mientras se teclea. El
                  servidor lo vuelve a comprobar: él es la puerta real. */}
              <p
                className={cn(
                  'text-xs',
                  problemaDocumento ? 'text-peligro' : 'text-tenue-fg',
                )}
                aria-live="polite"
              >
                {problemaDocumento ??
                  FORMATOS[form.paciente_tipo_documento_codigo]?.ayuda ??
                  ''}
              </p>
            </div>
          </div>

          {pasoPaciente === 'buscando' && (
            <p className="mt-3 text-xs text-tenue-fg" aria-live="polite">
              Buscando al paciente…
            </p>
          )}

          {pasoPaciente === 'conocido' && !editando && !soloLectura && (
            <p
              className="mt-3 rounded-md border border-exito/40 bg-exito-suave/50 px-3 py-2 text-sm"
              aria-live="polite"
            >
              <span className="font-medium">Ya lo teníamos: {conocidoComo}.</span>{' '}
              <span className="text-tenue-fg">
                Sus datos se llenaron solos; corrígelos si cambiaron.
              </span>
            </p>
          )}
          {pasoPaciente === 'nuevo' && !editando && !soloLectura && (
            <p
              className="mt-3 rounded-md border border-borde bg-tenue/40 px-3 py-2 text-sm"
              aria-live="polite"
            >
              <span className="font-medium">No lo teníamos todavía.</span>{' '}
              <span className="text-tenue-fg">
                Escribe sus datos: al crear el caso quedará registrado en Pacientes
                Accumedical.
              </span>
            </p>
          )}
          {/* El nombre del paciente, en las mismas cuatro casillas que en el
              resto de la plataforma. Siempre a la vista (pedido del usuario,
              26/10/2026); si la búsqueda lo encuentra, se rellenan solas. */}
          <div className="mt-4">
            <CamposNombre
              idPrefijo="paciente"
              valores={form.paciente}
              deshabilitado={soloLectura}
              onCambiar={(campo, valor) =>
                setForm((p) => ({ ...p, paciente: { ...p.paciente, [campo]: valor } }))
              }
            />
          </div>
        </Bloque>

        <Bloque
          titulo="A quién se visita"
          descripcion={
            soloLectura
              ? 'El prestador al que se programó la visita.'
              : supervision
                ? 'Solo aparecen los prestadores con convenio vigente con la aseguradora elegida.'
                : 'Solo aparecen los prestadores con convenio vigente con tu aseguradora.'
          }
        >
          {/* Mirar no es elegir: en solo lectura no se pinta la lista de la
              red con su buscador —enseñaría prestadores a los que NO se fue—,
              sino el que se eligió, y nada más. */}
          {soloLectura ? (
            <div className="rounded-md border border-borde bg-superficie p-3">
              <p className="truncate text-sm font-medium">
                {elegido?.nombre ?? detalle.data?.prestador_nombre ?? '—'}
              </p>
              {elegido && (
                <p className="mt-0.5 truncate text-xs text-tenue-fg">
                  {elegido.tipo_nombre} · <span className="font-mono">{elegido.codigo_interno}</span>
                </p>
              )}
            </div>
          ) : (
            <>
            <div className="space-y-3">
              <div className="relative">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-tenue-fg"
                  aria-hidden="true"
                />
                <Input
                  value={busqueda}
                  onChange={(e) => setBusqueda(e.target.value)}
                  placeholder="Buscar por nombre o código"
                  aria-label="Buscar prestador"
                  mayusculas={false}
                  className="pl-9"
                />
              </div>

              {supervision && !aseguradoraId ? (
                <p className="rounded-md border border-dashed border-borde px-4 py-8 text-center text-sm text-tenue-fg">
                  Elige primero la aseguradora: su red es la que define los destinos.
                </p>
              ) : prestadores.isPending ? (
                <div className="space-y-2" role="status" aria-label="Cargando prestadores">
                  {Array.from({ length: 3 }, (_, i) => (
                    <div key={i} className="h-16 animate-pulse rounded-md bg-tenue" />
                  ))}
                </div>
              ) : visibles.length === 0 && !busqueda.trim() ? (
                <p className="rounded-md border border-dashed border-borde px-4 py-6 text-center text-sm text-tenue-fg">
                  Escribe el nombre o el código para buscar.
                </p>
              ) : visibles.length === 0 ? (
                <p className="rounded-md border border-dashed border-borde px-4 py-8 text-center text-sm text-tenue-fg">
                  {(prestadores.data ?? []).length === 0
                    ? supervision
                      ? 'Esa aseguradora todavía no tiene prestadores con convenio vigente.'
                      : 'Tu aseguradora todavía no tiene prestadores con convenio vigente.'
                    : 'Ningún prestador coincide con la búsqueda.'}
                </p>
              ) : (
                <div
                  className="space-y-2 overflow-y-auto pr-1"
                  style={{ maxHeight: ALTO_LISTA }}
                >
                  {visibles.map((p) => (
                    <label
                      key={p.id}
                      className={cn(
                        // `h-20` es lo que hace honesto el alto de la lista: tres
                        // tarjetas exactas y el resto detrás del scroll.
                        'flex h-20 cursor-pointer items-start gap-3 rounded-md border p-3 transition-colors duration-150',
                        form.prestador_id === p.id
                          ? 'border-marca/40 bg-marca-suave/50'
                          : 'border-borde hover:bg-tenue/50',
                      )}
                    >
                      <input
                        type="radio"
                        name="prestador"
                        value={p.id}
                        checked={form.prestador_id === p.id}
                        onChange={() => elegirPrestador(p.id)}
                        className="mt-1 size-4 accent-[hsl(var(--marca))]"
                      />
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">{p.nombre}</span>
                        <span className="block truncate text-xs text-tenue-fg">
                          {p.tipo_nombre} · <span className="font-mono">{p.codigo_interno}</span>
                        </span>
                        <span className="mt-0.5 block text-xs text-tenue-fg">
                          {p.sedes.length > 0
                            ? `${p.sedes.length} ${p.sedes.length === 1 ? 'sede' : 'sedes'} · y su casa matriz`
                            : 'Sin sedes: se visita su casa matriz'}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              )}

              {visibles.length > 3 && (
                <p className="text-xs text-tenue-fg" aria-live="polite">
                  {visibles.length} prestadores: desplázate por la lista o busca por nombre.
                </p>
              )}
            </div>
            </>
          )}
        </Bloque>

        {form.prestador_id && (
          <Bloque titulo="Sedes" retraso={0.05}>
            {elegido && elegido.sedes.length > 0 ? (
              <div className="space-y-2">
                <Label htmlFor="sede">
                  Sede <span className="text-peligro">*</span>
                </Label>
                <Select
                  id="sede"
                  value={form.sede_id}
                  onChange={(e) => setForm((previo) => ({ ...previo, sede_id: e.target.value }))}
                >
                  <option value="">Elige la sede</option>
                  {/* Tener sedes no quita la casa matriz de en medio: sigue
                      siendo un sitio al que se puede ir, y es el que la base
                      guarda como visita sin sede. */}
                  <option value={MATRIZ}>
                    Casa matriz —{' '}
                    {zona(elegido.ciudad_nombre, elegido.provincia_nombre, elegido.direccion)}
                  </option>
                  {elegido.sedes.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.nombre} — {zona(s.ciudad_nombre, s.provincia_nombre, s.direccion)}
                    </option>
                  ))}
                </Select>
                {/* La calle, que es lo que el desplegable ya no dice. Sin ella no
                    se pinta nada: repetir la ciudad de la opción elegida sería
                    ruido, y anunciar que falta un dato opcional, peor. */}
                {destino?.direccion && (
                  <p className="flex items-start gap-1.5 pt-1 text-xs text-tenue-fg">
                    <MapPin className="mt-px size-3.5 shrink-0" aria-hidden="true" />
                    <span>{destino.direccion}</span>
                  </p>
                )}
              </div>
            ) : (
              <p className="flex items-start gap-2 rounded-md border border-borde bg-superficie-hundida px-4 py-3 text-sm text-tenue-fg">
                <Building className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                <span>
                  {elegido?.nombre} no tiene sedes registradas, así que se visita su casa matriz:{' '}
                  <span className="text-tinta">
                    {zona(elegido?.ciudad_nombre, elegido?.provincia_nombre, elegido?.direccion)}
                  </span>
                  {/* Aquí no hay desplegable que compita, así que la calle cabe. */}
                  {elegido?.direccion && elegido.ciudad_nombre ? ` · ${elegido.direccion}` : ''}.
                </span>
              </p>
            )}
          </Bloque>
        )}

        {/* Fuera el bloque «Cuándo» (pedido del usuario, 26/10/2026; los
            parámetros nuevos los dirá él). Solo queda para REPROGRAMAR una
            visita vencida, que sin fecha nueva no vuelve a la agenda. */}
        {vencido && (
          <Bloque
            titulo="Cuándo"
            descripcion="A qué hora debe llegar el médico auditor. La entrega del informe sale del SLA de la compañía."
            retraso={0.1}
          >
            <div className="grid gap-5 sm:grid-cols-2">
              {vencido && (
                <p className="sm:col-span-2 rounded-md border border-dashed border-peligro/40 bg-peligro-suave/40 px-3 py-2.5 text-sm">
                  Esta visita <strong className="font-medium">venció sin que el auditor llegara</strong>.
                  Ponle una fecha y una hora nuevas, y el caso vuelve a la agenda: le reaparece al
                  auditor que ya tenía o, si no tenía, Accumedical lo deriva otra vez.
                </p>
              )}
              <div className="space-y-2">
                <Label htmlFor="desde">
                  Cuándo debe llegar el auditor <span className="text-peligro">*</span>
                </Label>
                <Input
                  id="desde"
                  type="datetime-local"
                  value={form.desde}
                  onChange={(e) => setForm((previo) => ({ ...previo, desde: e.target.value }))}
                  required
                />
              </div>
              {/* La entrega NO se teclea: sale del SLA que la compañía tiene
                  pactado para Concurrencia. Se enseña calculada para que quien
                  programa sepa para cuándo es, sin poder moverla. */}
              <div className="space-y-2">
                <Label htmlFor="entrega">Entrega del informe</Label>
                <Input id="entrega" value={entrega.texto} disabled />
                <p className="text-xs text-tenue-fg" aria-live="polite">
                  {entrega.ayuda}
                </p>
              </div>
            </div>
          </Bloque>
        )}

        <Bloque
          titulo="A quién se avisa"
          descripcion={
            soloLectura
              ? 'Los correos a los que se avisó de este caso.'
              : elegido && elegido.contactos.length > 0
                ? 'Marca los contactos del prestador que deben enterarse y añade aparte los correos que quieras a mano.'
                : 'Correos a los que se notificará la visita. Puedes anotar varios.'
          }
          retraso={0.15}
        >
          {/* Mirar no es elegir. En solo lectura NO se pinta el selector de
              contactos del prestador: enseñaría a gente a la que NO se avisó,
              con su casilla, como si se pudiera marcar ahora. Lo que se enseña
              es el hecho: a quién se avisó de este caso, y nada más. */}
          {/* Los correos por defecto (quien creó el caso y los coordinadores)
              ya no se enseñan (pedido del usuario, 26/10/2026): el servidor
              los avisa siempre, se anoten o no. */}
          {soloLectura ? (
            <ListaDeAvisados correos={detalle.data?.correos ?? []} />
          ) : (
            <>
            {/* Sin contactos no hay casillas que ofrecer, pero callarse confunde:
                se dice por qué no están y de dónde saldrían. */}
            {elegido && elegido.contactos.length === 0 && (
              <p className="mb-4 rounded-md border border-dashed border-borde px-4 py-3 text-xs text-tenue-fg">
                {elegido.nombre} no tiene contactos registrados en su expediente. Cuando los tenga,
                aparecerán aquí para marcarlos; mientras tanto, anota los correos a mano.
              </p>
            )}

            {elegido && elegido.contactos.length > 0 && (
              <div className="mb-6">
                <p className="font-display text-xs font-medium uppercase tracking-[0.09em] text-tenue-fg">
                  Contactos de {elegido.nombre}
                </p>
                <div
                  className="mt-3 space-y-2 overflow-y-auto pr-1"
                  style={{ maxHeight: ALTO_CONTACTOS }}
                >
                  {elegido.contactos.map((c) => {
                    const marcado = form.contactos_elegidos.includes(c.id)
                    return (
                      <label
                        key={c.id}
                        className={cn(
                          // `h-16` mantiene honesto el alto de la lista, como en
                          // la de prestadores: tres filas y el resto tras el scroll.
                          'flex h-16 cursor-pointer items-center gap-3 rounded-md border p-3 transition-colors duration-150',
                          marcado ? 'border-marca/40 bg-marca-suave/50' : 'border-borde hover:bg-tenue/50',
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={marcado}
                          onChange={(e) => marcarContacto(c.id, e.target.checked)}
                          className="size-4 shrink-0 accent-[hsl(var(--marca))]"
                        />
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium">
                            {c.nombre_completo}
                            {c.cargo ? (
                              <span className="font-normal text-tenue-fg"> · {c.cargo}</span>
                            ) : null}
                          </span>
                          <span className="block truncate text-xs text-tenue-fg">{c.email}</span>
                        </span>
                      </label>
                    )
                  })}
                </div>
                <p className="mt-2 text-xs text-tenue-fg" aria-live="polite">
                  {form.contactos_elegidos.length} de {elegido.contactos.length} marcados
                  {elegido.contactos.length > 3 ? ' · desplázate para ver el resto' : ''}
                </p>
              </div>
            )}

            {elegido && elegido.contactos.length > 0 && (
              <p className="mb-3 font-display text-xs font-medium uppercase tracking-[0.09em] text-tenue-fg">
                Otros correos
              </p>
            )}

            {form.correos.length === 0 ? (
              <div className="rounded-md border border-dashed border-borde px-6 py-8 text-center">
                <p className="text-sm text-tenue-fg">Todavía no hay ningún correo anotado.</p>
                {!soloLectura && (
                  <Boton type="button" tamano="sm" className="mt-3" onClick={anadirCorreo}>
                    <Plus aria-hidden="true" />
                    Añadir correo
                  </Boton>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                {form.correos.map((correo, indice) => (
                  <div key={correo._key} className="flex items-end gap-2">
                    <div className="min-w-0 flex-1 space-y-2">
                      <Label htmlFor={`correo-${correo._key}`}>Correo {indice + 1}</Label>
                      <Input
                        id={`correo-${correo._key}`}
                        type="email"
                        inputMode="email"
                        mayusculas
                        spellCheck={false}
                        value={correo.valor}
                        onChange={(e) =>
                          setForm((previo) => ({
                            ...previo,
                            correos: previo.correos.map((c) =>
                              c._key === correo._key ? { ...c, valor: e.target.value } : c,
                            ),
                          }))
                        }
                        placeholder="NOMBRE@DOMINIO.EC"
                      />
                      {/* Quién es esa persona: viaja en el aviso, como el cargo
                          del contacto marcado. Opcional a propósito. */}
                      <Input
                        id={`correo-etiqueta-${correo._key}`}
                        value={correo.etiqueta}
                        onChange={(e) =>
                          setForm((previo) => ({
                            ...previo,
                            correos: previo.correos.map((c) =>
                              c._key === correo._key ? { ...c, etiqueta: e.target.value } : c,
                            ),
                          }))
                        }
                        placeholder="QUIÉN ES (OPCIONAL): AUDITOR INTERNO, FACTURACIÓN…"
                        aria-label={`Quién es el correo ${indice + 1}`}
                        maxLength={120}
                      />
                    </div>
                    {!soloLectura && (
                      <Boton
                        type="button"
                        variante="fantasma"
                        tamano="icono"
                        onClick={() =>
                          setForm((previo) => ({
                            ...previo,
                            correos: previo.correos.filter((c) => c._key !== correo._key),
                          }))
                        }
                        aria-label={`Quitar correo ${indice + 1}`}
                        className="mb-0.5 hover:text-peligro"
                      >
                        <Trash2 aria-hidden="true" />
                      </Boton>
                    )}
                  </div>
                ))}
                {!soloLectura && (
                  <Boton type="button" variante="contorno" tamano="sm" onClick={anadirCorreo}>
                    <Plus aria-hidden="true" />
                    Añadir correo
                  </Boton>
                )}
              </div>
            )}
            </>
          )}

          <div className="mt-5 space-y-2">
            <Label htmlFor="observaciones">Observaciones</Label>
            <Input
              id="observaciones"
              value={form.observaciones}
              onChange={(e) => setForm((previo) => ({ ...previo, observaciones: e.target.value }))}
              placeholder="MOTIVO DE LA VISITA, PACIENTES A REVISAR…"
            />
          </div>
        </Bloque>
        </fieldset>

        {/* Cancelar va aparte y al final, no junto a «Guardar»: no es descartar
            lo tecleado —eso es el botón «Cancelar» de arriba—, es cerrar el
            caso. Y solo aparece cuando de verdad se puede. */}
        {sePuedeCancelar && (
          <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-md border border-dashed border-borde px-4 py-4">
            <div>
              <p className="font-display text-sm font-medium">Cancelar el caso</p>
              <p className="mt-0.5 text-sm text-tenue-fg">
                Si la visita ya no hace falta. Solo mientras el auditor no haya llegado.
              </p>
            </div>
            <Boton
              type="button"
              variante="contorno"
              onClick={() => setConfirmandoCancelar(true)}
              className="hover:border-peligro/50 hover:text-peligro"
            >
              <CircleSlash aria-hidden="true" />
              Cancelar el caso
            </Boton>
          </div>
        )}
      </form>

      {/* Cancelar no se deshace: se pregunta una vez, con el código delante. */}
      <Modal
        abierto={confirmandoCancelar}
        onCerrar={() => setConfirmandoCancelar(false)}
        titulo={`¿Cancelar ${detalle.data?.codigo_interno ?? 'el caso'}?`}
        descripcion="El caso deja de estar pendiente y el auditor ya no irá. No se puede deshacer."
        pie={
          <>
            <Boton
              type="button"
              variante="contorno"
              onClick={() => setConfirmandoCancelar(false)}
              disabled={cancelar.isPending}
            >
              No, volver
            </Boton>
            <Boton
              type="button"
              onClick={() => cancelar.mutate()}
              cargando={cancelar.isPending}
            >
              Sí, cancelar el caso
            </Boton>
          </>
        }
      >
        <p className="text-sm text-tenue-fg">
          Quedará como <strong className="font-medium text-tinta">Cancelada</strong> en tu bandeja
          y en la de Accumedical, con tu nombre y la fecha en la auditoría.
        </p>
      </Modal>
    </div>
  )
}
