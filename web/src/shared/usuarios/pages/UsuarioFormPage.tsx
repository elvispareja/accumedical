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
  historialDeUsuario,
  obtenerUsuarioPlataforma,
  type FuncionPlataforma,
  type GrupoPlataforma,
  type RolEnApp,
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

/** Los roles que se dan POR APLICACIÓN (14/10/2026: uno en cada app, o ninguno). */
const ROLES_APP: { valor: RolEnApp; etiqueta: string }[] = [
  { valor: 'auditor', etiqueta: 'Auditor' },
  { valor: 'coordinador', etiqueta: 'Coordinador' },
  // Hoy hace lo mismo que el coordinador; solo donde la app lo admite.
  { valor: 'call_center', etiqueta: 'Call center' },
]

/** Las funciones transversales: una persona a la vez en cada una. */
const FUNCIONES: { valor: FuncionPlataforma; etiqueta: string; ayuda: string }[] = [
  { valor: 'convenio', etiqueta: 'Convenio', ayuda: 'Lleva la red de convenios.' },
  { valor: 'contabilidad', etiqueta: 'Contabilidad', ayuda: 'Su sección está por definir.' },
]

const FECHA = new Intl.DateTimeFormat('es-EC', { day: '2-digit', month: 'short', year: 'numeric' })

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
  // Un rol EN CADA aplicación (o ninguno) y, aparte, una función transversal.
  const [asignaciones, setAsignaciones] = useState<Record<string, RolEnApp>>({})
  const [funcion, setFuncion] = useState<FuncionPlataforma | ''>('')

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
    const mapa = new Map<
      GrupoPlataforma,
      { codigo: string; nombre: string; conCallCenter: boolean }[]
    >()
    if (miFamilia) {
      mapa.set(
        miFamilia,
        (sesion?.modulos ?? []).map((m) => ({ codigo: m.codigo, nombre: m.nombre, conCallCenter: false })),
      )
      return mapa
    }
    for (const m of modulos.data ?? []) {
      if (m.grupo !== 'suscripcion' && m.grupo !== 'siniestro') continue
      mapa.set(m.grupo, [
        ...(mapa.get(m.grupo) ?? []),
        { codigo: m.codigo, nombre: m.nombre, conCallCenter: Boolean(m.con_call_center) },
      ])
    }
    return mapa
  }, [modulos.data, miFamilia, sesion?.modulos])

  // La trayectoria de la persona (solo al editar): cada rol que tuvo, dónde y cuándo.
  const historial = useQuery({
    queryKey: ['historial-usuario', id],
    queryFn: () => historialDeUsuario(id!),
    enabled: editando,
  })

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
    setAsignaciones(
      Object.fromEntries(acceso.aplicaciones.map((a) => [a.module_code, a.rol as RolEnApp])),
    )
    setFuncion(acceso.funcion ?? '')
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
        // Cada app con su rol, y la función si la tiene. Lo que se quite se
        // REVOCA en el servidor (su tramo se cierra en el historial).
        acceso: {
          aplicaciones: Object.entries(asignaciones).map(([module_code, rol]) => ({
            module_code,
            rol,
          })),
          funcion: funcion || null,
        },
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
    if (Object.keys(asignaciones).length === 0 && !funcion) {
      return toast.error('Dale al menos un rol en una aplicación, o una función (Convenio o Contabilidad)')
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
          titulo="Aplicaciones y rol"
          descripcion="Un rol en cada aplicación, o ninguno: puede auditar una y coordinar otra. Puede haber varios coordinadores, auditores y call center por aplicación. Quitar un rol no borra nada: su tramo se cierra en el historial."
          retraso={0.05}
        >
          <div className="space-y-5">
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
                      <div
                        key={m.codigo}
                        className={cn(
                          'flex items-center justify-between gap-3 rounded-md border p-3',
                          asignaciones[m.codigo] ? 'border-marca/40 bg-marca-suave/40' : 'border-borde',
                        )}
                      >
                        <Label htmlFor={`rol-${m.codigo}`} className="min-w-0 truncate">
                          {m.nombre}
                        </Label>
                        <div className="w-44 shrink-0">
                          <Select
                            id={`rol-${m.codigo}`}
                            value={asignaciones[m.codigo] ?? ''}
                            onChange={(e) =>
                              setAsignaciones((previo) => {
                                const siguiente = { ...previo }
                                if (e.target.value) siguiente[m.codigo] = e.target.value as RolEnApp
                                else delete siguiente[m.codigo]
                                return siguiente
                              })
                            }
                          >
                            <option value="">Sin acceso</option>
                            {ROLES_APP.filter((r) => r.valor !== 'call_center' || m.conCallCenter).map(
                              (r) => (
                                <option key={r.valor} value={r.valor}>
                                  {r.etiqueta}
                                </option>
                              ),
                            )}
                          </Select>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </Bloque>

        <Bloque
          titulo="Función transversal"
          descripcion="Aparte de sus aplicaciones. Cada función la lleva una sola persona a la vez: para nombrar a otra, desactiva o quita la función a quien la tiene."
          retraso={0.08}
        >
          <div className="grid gap-3 sm:grid-cols-3">
            {[{ valor: '' as const, etiqueta: 'Ninguna', ayuda: 'Solo sus aplicaciones.' }, ...FUNCIONES].map(
              (opcion) => (
                <button
                  key={opcion.valor || 'ninguna'}
                  type="button"
                  onClick={() => setFuncion(opcion.valor)}
                  aria-pressed={funcion === opcion.valor}
                  className={cn(
                    'rounded-md border p-4 text-left transition-colors duration-150',
                    funcion === opcion.valor
                      ? 'border-marca/50 bg-marca-suave/40'
                      : 'border-borde hover:bg-tenue/50',
                  )}
                >
                  <span className="font-display text-sm font-medium">{opcion.etiqueta}</span>
                  <span className="mt-1 block text-xs text-tenue-fg">{opcion.ayuda}</span>
                </button>
              ),
            )}
          </div>
        </Bloque>

        {editando && (
          <Bloque
            titulo="Historial de accesos"
            descripcion="Cada rol que tuvo, dónde, desde y hasta cuándo, y quién se lo dio o se lo quitó. Nada se borra: lo que hizo con cada rol sigue a su nombre."
            retraso={0.1}
          >
            {!historial.data || historial.data.length === 0 ? (
              <p className="text-sm text-tenue-fg">Sin movimientos todavía.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="text-tenue-fg">
                    <tr>
                      <th className="py-1.5 pr-3 font-medium">Dónde</th>
                      <th className="py-1.5 pr-3 font-medium">Rol</th>
                      <th className="py-1.5 pr-3 font-medium">Desde</th>
                      <th className="py-1.5 pr-3 font-medium">Hasta</th>
                      <th className="py-1.5 pr-3 font-medium">Se lo dio</th>
                      <th className="py-1.5 font-medium">Se lo quitó</th>
                    </tr>
                  </thead>
                  <tbody>
                    {historial.data.map((t, i) => (
                      <tr key={`${t.donde}-${t.desde}-${i}`} className="border-t border-borde">
                        <td className="py-1.5 pr-3">{t.donde}</td>
                        <td className="py-1.5 pr-3">{t.rol_etiqueta}</td>
                        <td className="py-1.5 pr-3 tabular">{FECHA.format(new Date(t.desde))}</td>
                        <td className="py-1.5 pr-3 tabular">
                          {t.hasta ? FECHA.format(new Date(t.hasta)) : <span className="text-exito">vigente</span>}
                        </td>
                        <td className="py-1.5 pr-3">{t.otorgado_por ?? '—'}</td>
                        <td className="py-1.5">{t.retirado_por ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Bloque>
        )}
      </form>
    </div>
  )
}
