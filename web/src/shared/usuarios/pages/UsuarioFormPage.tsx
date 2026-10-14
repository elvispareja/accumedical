import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { motion, useReducedMotion } from 'framer-motion'
import { ArrowLeft, MailCheck } from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { rotuloDeArea, useAreaDeLaRuta } from '@/core/auth/area'
import { useSesion } from '@/core/auth/useSesion'
import { cn } from '@/lib/utils'
import {
  useCiudades,
  useModulos,
  useProvincias,
  useTiposDocumento,
} from '@/shared/catalogos/hooks'
import { Boton } from '@/shared/components/ui/button'
import { Checkbox } from '@/shared/components/ui/checkbox'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { Select } from '@/shared/components/ui/select'
import { useToast } from '@/shared/components/ui/toast'
import {
  FORMATOS,
  filtrarDocumento,
  filtrarTelefono,
  problemaConDocumento,
  problemaConTelefono,
} from '@/shared/identificacion'
import {
  CamposNombre,
  NOMBRE_VACIO,
  desdeApi as nombreDesdeApi,
  faltaObligatorio,
  haciaApi as nombreHaciaApi,
  type NombrePersona,
} from '@/shared/personas/CamposNombre'
import {
  ETIQUETA_GRUPO,
  actualizarUsuarioPlataforma,
  crearUsuarioPlataforma,
  obtenerUsuarioPlataforma,
  type GrupoPlataforma,
  type RolPlataforma,
} from '@/shared/usuarios/api'

const EASE: [number, number, number, number] = [0.22, 0.61, 0.36, 1]
/**
 * A dónde vuelve el formulario. NO es una constante: la misma pantalla se monta
 * en las dos áreas —`/admin` y `/coordinacion`— y tiene que quedarse en la que
 * se entró, no saltar a la otra (`core/auth/area.ts`).
 */
function useListado(): string {
  return `${useAreaDeLaRuta()}/usuarios`
}

const ROLES: { valor: RolPlataforma; etiqueta: string; ayuda: string }[] = [
  {
    valor: 'coordinador',
    etiqueta: 'Coordinador',
    ayuda: 'Coordina las aplicaciones que se le marquen. Puede haber varios por aplicación.',
  },
  {
    valor: 'auditor',
    etiqueta: 'Auditor',
    ayuda: 'Audita las aplicaciones que se le marquen.',
  },
  {
    valor: 'call_center',
    etiqueta: 'Call center',
    ayuda: 'Hoy, lo mismo que el coordinador. Solo en las apps que lo admiten (Calificación de Riesgo).',
  },
  {
    valor: 'convenio',
    etiqueta: 'Convenio',
    ayuda: 'Lleva la red de convenios. Uno solo.',
  },
  {
    valor: 'contabilidad',
    etiqueta: 'Contabilidad',
    ayuda: 'Su sección está por definir. Uno solo.',
  },
]

/** Los transversales: no se les marca familia ni módulos. */
const FUNCIONES: RolPlataforma[] = ['convenio', 'contabilidad']

interface Formulario extends NombrePersona {
  email: string
  tipo_documento_codigo: string
  numero_documento: string
  telefono: string
  provincia_codigo: string
  ciudad_codigo: string
}

const VACIO: Formulario = {
  ...NOMBRE_VACIO,
  email: '',
  tipo_documento_codigo: '',
  numero_documento: '',
  telefono: '',
  provincia_codigo: '',
  ciudad_codigo: '',
}

function mensajeDeError(error: unknown, porDefecto: string): string {
  const detalle = (error as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
  if (typeof detalle === 'string') return detalle
  if (Array.isArray(detalle) && detalle.length > 0) {
    return (detalle[0] as { mensaje?: string }).mensaje ?? porDefecto
  }
  return porDefecto
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
 * Alta y edición del personal de plataforma. Obligatorios: nombre, apellido y
 * correo; la identificación y el celular son opcionales. La contraseña no se
 * teclea aquí jamás: al crear, la persona recibe una invitación por correo.
 */
export function UsuarioFormPage() {
  const { id } = useParams<{ id: string }>()
  const editando = Boolean(id)
  const navegar = useNavigate()
  const area = useAreaDeLaRuta()
  const LISTADO = useListado()
  const queryClient = useQueryClient()
  const toast = useToast()

  const [form, setForm] = useState<Formulario>(VACIO)
  // Un rol por persona: coordina o audita las aplicaciones marcadas (desde el
  // 14/10/2026 el coordinador ya no es de una familia), o lleva una función.
  const [rol, setRol] = useState<RolPlataforma>('auditor')
  const [modulosMarcados, setModulosMarcados] = useState<Set<string>>(new Set())

  // Un coordinador de familia solo da de alta AUDITORES de su familia: ni otro
  // rol, ni un módulo de la familia de al lado. El servidor impone lo mismo
  // (`validar_alcance`), así que esto es la pantalla, no la cerradura.
  const { data: sesion } = useSesion()
  const miFamilia = sesion?.user.grupo_coordinado ?? null

  const tipos = useTiposDocumento()
  // El catálogo de módulos es del admin; el coordinador no lo necesita, porque
  // los módulos de su familia son exactamente los que ya trae su sesión.
  const modulos = useModulos(miFamilia === null)
  const provincias = useProvincias()
  const ciudades = useCiudades(form.provincia_codigo || null)

  // Los módulos agrupados por familia: el auditor los marca uno a uno y, al
  // coordinador, la familia entera se le enseña como lo que va a abarcar.
  const porFamilia = useMemo(() => {
    const mapa = new Map<GrupoPlataforma, { codigo: string; nombre: string }[]>()
    if (miFamilia) {
      mapa.set(
        miFamilia,
        (sesion?.modulos ?? []).map((m) => ({ codigo: m.codigo, nombre: m.nombre })),
      )
      return mapa
    }
    for (const m of modulos.data ?? []) {
      if (m.grupo !== 'suscripcion' && m.grupo !== 'siniestro') continue
      // El call center solo se puede dar en las apps que tienen ese rol.
      if (rol === 'call_center' && !m.con_call_center) continue
      mapa.set(m.grupo, [...(mapa.get(m.grupo) ?? []), { codigo: m.codigo, nombre: m.nombre }])
    }
    return mapa
  }, [modulos.data, miFamilia, sesion?.modulos, rol])

  // Las familias que se pintan: la suya, o las dos si es el administrador.
  const familias: GrupoPlataforma[] = miFamilia ? [miFamilia] : ['suscripcion', 'siniestro']

  const detalle = useQuery({
    queryKey: ['usuario-plataforma', id],
    queryFn: () => obtenerUsuarioPlataforma(id!),
    enabled: editando,
  })

  useEffect(() => {
    if (!detalle.data) return
    setForm({
      ...nombreDesdeApi(detalle.data),
      email: detalle.data.email,
      tipo_documento_codigo: detalle.data.tipo_documento_codigo ?? '',
      numero_documento: detalle.data.numero_documento ?? '',
      telefono: detalle.data.telefono ?? '',
      provincia_codigo: detalle.data.provincia_codigo ?? '',
      ciudad_codigo: detalle.data.ciudad_codigo ?? '',
    })
    const acceso = detalle.data.acceso
    setRol(acceso.rol)
    // Coordinador y auditor: las aplicaciones marcadas. Un coordinador de
    // familia que aún no se convirtió trae aquí las de su familia.
    setModulosMarcados(
      acceso.rol === 'auditor' || acceso.rol === 'coordinador' || acceso.rol === 'call_center'
        ? new Set(acceso.modulos.map((m) => m.module_code))
        : new Set(),
    )
  }, [detalle.data])

  function cambiar(campo: keyof Formulario, valor: string) {
    setForm((previo) => ({ ...previo, [campo]: valor }))
  }

  // Cédula y RUC llevan dígito verificador: se avisa al teclear, no al guardar.
  const problemaDocumento = problemaConDocumento(
    form.tipo_documento_codigo,
    form.numero_documento,
  )

  const guardar = useMutation({
    mutationFn: async () => {
      const cuerpo = {
        ...nombreHaciaApi(form),
        email: form.email.trim(),
        tipo_documento_codigo: form.tipo_documento_codigo || null,
        numero_documento: form.numero_documento.trim() || null,
        telefono: form.telefono.trim() || null,
        provincia_codigo: form.provincia_codigo || null,
        ciudad_codigo: form.ciudad_codigo || null,
        // Coordinador y auditor mandan sus aplicaciones; las funciones
        // transversales, nada. Nunca dos cosas a la vez.
        acceso: FUNCIONES.includes(rol) ? { rol } : { rol, modulos: [...modulosMarcados] },
      }
      return id ? actualizarUsuarioPlataforma(id, cuerpo) : crearUsuarioPlataforma(cuerpo)
    },
    onSuccess: (usuario) => {
      queryClient.invalidateQueries({ queryKey: ['usuarios-plataforma'] })
      queryClient.invalidateQueries({ queryKey: ['usuario-plataforma', usuario.id] })
      toast.exito(
        editando
          ? 'Usuario actualizado'
          : `Usuario creado · invitación enviada a ${usuario.email}`,
      )
      navegar(LISTADO)
    },
    onError: (error) => toast.error(mensajeDeError(error, 'No se pudo guardar el usuario')),
  })

  function enviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault()
    if (faltaObligatorio(form) || !form.email.trim()) {
      return toast.error('Nombre principal, apellido paterno y correo son obligatorios')
    }
    const tipo = form.tipo_documento_codigo
    const numero = form.numero_documento.trim()
    if (Boolean(tipo) !== Boolean(numero)) {
      return toast.error('El tipo y el número de identificación van juntos: o los dos, o ninguno')
    }
    if (problemaDocumento) return toast.error(problemaDocumento)
    const problemaTelefono = problemaConTelefono(form.telefono)
    if (problemaTelefono) return toast.error(problemaTelefono)
    if (rol === 'coordinador' && modulosMarcados.size === 0) {
      return toast.error('Marca al menos una aplicación: un coordinador sin ellas no coordina nada')
    }
    if (rol === 'call_center' && modulosMarcados.size === 0) {
      return toast.error('Marca la aplicación del call center (hoy, Calificación de Riesgo)')
    }
    if (rol === 'auditor' && modulosMarcados.size === 0) {
      return toast.error('Marca al menos una aplicación: un auditor sin ellas no entra a nada')
    }
    guardar.mutate()
  }

  if (editando && detalle.isPending) {
    return (
      <div className="space-y-4" role="status" aria-label="Cargando el usuario">
        <div className="h-4 w-40 animate-pulse rounded bg-tenue" />
        <div className="h-9 w-72 animate-pulse rounded bg-tenue" />
        <div className="h-64 animate-pulse rounded-md bg-tenue" />
      </div>
    )
  }

  return (
    <div className="w-full">
      <Link
        to={LISTADO}
        className="inline-flex items-center gap-1.5 rounded text-sm text-tenue-fg transition-colors duration-150 hover:text-tinta"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Usuarios
      </Link>

      <header className="mt-3 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-display text-[0.6875rem] font-semibold uppercase tracking-[0.16em] text-tenue-fg">
            {rotuloDeArea(area)}
          </p>
          <h1 className="mt-1.5 font-display text-2xl font-semibold tracking-tight">
            {/* Para el coordinador, lo único que hay aquí son auditores: que lo
                diga el título en vez de obligarle a deducirlo. */}
            {miFamilia
              ? editando
                ? 'Editar auditor'
                : 'Nuevo auditor'
              : editando
                ? 'Editar usuario'
                : 'Nuevo usuario'}
          </h1>
          {editando && detalle.data?.invitacion_pendiente && (
            <p className="mt-1 flex items-center gap-1.5 text-sm text-tenue-fg">
              <MailCheck className="size-4" aria-hidden="true" />
              Invitación pendiente: todavía no ha definido su contraseña.
            </p>
          )}
        </div>
        <div className="flex gap-2">
          <Boton variante="contorno" onClick={() => navegar(LISTADO)} disabled={guardar.isPending}>
            Cancelar
          </Boton>
          <Boton type="submit" form="form-usuario" cargando={guardar.isPending}>
            {editando ? 'Guardar cambios' : 'Crear e invitar'}
          </Boton>
        </div>
      </header>

      <form id="form-usuario" onSubmit={enviar} noValidate className="mt-7 space-y-4">
        <Bloque
          titulo="Identidad"
          descripcion="Solo el nombre principal, el apellido paterno y el correo son obligatorios. La contraseña la define la propia persona desde su invitación."
        >
          <CamposNombre idPrefijo="usuario" valores={form} onCambiar={cambiar} />
          <div className="mt-5 grid gap-5 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="email">
                Correo <span className="text-peligro">*</span>
              </Label>
              {/* Dato de expediente: en mayúsculas. Para entrar da igual cómo lo
                  escriba: el correo del login no distingue mayúsculas. */}
              <Input
                id="email"
                type="email"
                inputMode="email"
                mayusculas
                spellCheck={false}
                value={form.email}
                onChange={(e) => cambiar('email', e.target.value)}
                placeholder="NOMBRE@ACCUMEDICAL.MED.EC"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tipo_documento">Tipo de identificación</Label>
              <Select
                id="tipo_documento"
                value={form.tipo_documento_codigo}
                onChange={(e) => cambiar('tipo_documento_codigo', e.target.value)}
              >
                <option value="">Sin identificación</option>
                {tipos.data?.map((t) => (
                  <option key={t.codigo} value={t.codigo}>
                    {t.nombre}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="numero_documento">Número de identificación</Label>
              <Input
                id="numero_documento"
                inputMode={FORMATOS[form.tipo_documento_codigo]?.soloDigitos ? 'numeric' : 'text'}
                value={form.numero_documento}
                onChange={(e) =>
                  cambiar(
                    'numero_documento',
                    filtrarDocumento(e.target.value, form.tipo_documento_codigo),
                  )
                }
                disabled={!form.tipo_documento_codigo}
                placeholder={form.tipo_documento_codigo ? '0912345678' : 'Elige primero el tipo'}
                className="tabular"
              />
              {/* El dígito verificador, comprobado al teclear; el servidor lo
                  vuelve a comprobar. */}
              <p
                className={cn('text-xs', problemaDocumento ? 'text-peligro' : 'text-tenue-fg')}
                aria-live="polite"
              >
                {problemaDocumento ?? FORMATOS[form.tipo_documento_codigo]?.ayuda ?? ''}
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="telefono">Número celular</Label>
              <Input
                id="telefono"
                inputMode="tel"
                value={form.telefono}
                onChange={(e) => cambiar('telefono', filtrarTelefono(e.target.value))}
                placeholder="0999999999"
                className="tabular"
                maxLength={16}
              />
              <p className="text-xs text-tenue-fg">Solo números; el «+» es opcional.</p>
            </div>
            {/* Dónde está: al derivar un caso, el supervisor ve primero a los
                auditores de la misma ciudad del destino, luego a los de la
                provincia y al final al resto. */}
            <div className="space-y-2">
              <Label htmlFor="provincia">Provincia</Label>
              <Select
                id="provincia"
                value={form.provincia_codigo}
                onChange={(e) => {
                  // Cambiar de provincia invalida la ciudad: es de la otra.
                  setForm((previo) => ({
                    ...previo,
                    provincia_codigo: e.target.value,
                    ciudad_codigo: '',
                  }))
                }}
              >
                <option value="">Sin ubicación</option>
                {provincias.data?.map((p) => (
                  <option key={p.codigo} value={p.codigo}>
                    {p.nombre}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="ciudad">Ciudad</Label>
              <Select
                id="ciudad"
                value={form.ciudad_codigo}
                onChange={(e) => cambiar('ciudad_codigo', e.target.value)}
                disabled={!form.provincia_codigo}
              >
                <option value="">
                  {form.provincia_codigo ? 'Elige la ciudad' : 'Elige primero la provincia'}
                </option>
                {ciudades.data?.map((c) => (
                  <option key={c.codigo} value={c.codigo}>
                    {c.nombre}
                  </option>
                ))}
              </Select>
            </div>
          </div>
        </Bloque>

        <Bloque
          titulo={miFamilia ? 'Módulos que audita' : 'Rol y alcance'}
          descripcion={
            miFamilia
              ? `Marca a qué módulos de ${ETIQUETA_GRUPO[miFamilia]} entra. Solo puedes dar de alta auditores de tu familia.`
              : 'Coordinador y auditor entran a las aplicaciones que se les marquen; una aplicación puede tener varios coordinadores, y queda registro de quién la coordinó y cuándo. Convenio y Contabilidad son transversales, uno de cada.'
          }
          retraso={0.05}
        >
          {/* El coordinador no elige rol: solo crea auditores, así que la
              rejilla de roles no se pinta en vez de pintarse inservible. */}
          <div className={cn('grid gap-3 sm:grid-cols-2', miFamilia && 'hidden')}>
            {ROLES.map((opcion) => (
              <button
                key={opcion.valor}
                type="button"
                onClick={() => {
                  setRol(opcion.valor)
                  // El call center solo cabe en las apps que lo admiten: lo demás
                  // marcado se suelta, en vez de quedar oculto y rechazarse al guardar.
                  if (opcion.valor === 'call_center') {
                    const admiten = new Set(
                      (modulos.data ?? []).filter((m) => m.con_call_center).map((m) => m.codigo),
                    )
                    setModulosMarcados((previo) => new Set([...previo].filter((c) => admiten.has(c))))
                  }
                }}
                aria-pressed={rol === opcion.valor}
                className={cn(
                  'rounded-md border p-4 text-left transition-colors duration-150',
                  rol === opcion.valor
                    ? 'border-marca/50 bg-marca-suave/40'
                    : 'border-borde hover:bg-tenue/50',
                )}
              >
                <span className="flex items-center gap-2 font-display text-sm font-medium">
                  <span
                    className={cn(
                      'size-2 rounded-full',
                      rol === opcion.valor ? 'bg-marca' : 'bg-borde',
                    )}
                    aria-hidden="true"
                  />
                  {opcion.etiqueta}
                </span>
                <span className="mt-1 block text-xs text-tenue-fg">{opcion.ayuda}</span>
              </button>
            ))}
          </div>

          {FUNCIONES.includes(rol) ? (
            // Transversal: no se le marca nada. Qué ve, por definir.
            <div className="mt-5 rounded-md border border-borde bg-tenue/40 p-4">
              <p className="text-sm">
                {rol === 'convenio'
                  ? 'Lleva la red de convenios.'
                  : 'Función de contabilidad.'}{' '}
                No se le marcan módulos ni familias.
              </p>
              <p className="mt-1.5 text-xs text-tenue-fg">
                A qué pantallas entra está por definir: el rol ya se puede asignar y, en
                cuanto se decida, se le abre la puerta sin tocar su ficha.
              </p>
            </div>
          ) : (
            <div className="mt-5 space-y-5">
              {familias.map((clave) => {
                const suyos = porFamilia.get(clave) ?? []
                if (suyos.length === 0) return null
                return (
                  <div key={clave}>
                    <p className="mb-2.5 font-display text-xs font-semibold uppercase tracking-[0.09em] text-tenue-fg">
                      {ETIQUETA_GRUPO[clave]}
                    </p>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {suyos.map((m) => (
                        <Checkbox
                          key={m.codigo}
                          id={`modulo-${m.codigo}`}
                          checked={modulosMarcados.has(m.codigo)}
                          onChange={(marcado) =>
                            setModulosMarcados((previo) => {
                              const siguiente = new Set(previo)
                              if (marcado) siguiente.add(m.codigo)
                              else siguiente.delete(m.codigo)
                              return siguiente
                            })
                          }
                          titulo={m.nombre}
                        />
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </Bloque>
      </form>
    </div>
  )
}
