import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { motion, useReducedMotion } from 'framer-motion'
import { MailCheck, Search, ShieldCheck, UserPlus } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { cn } from '@/lib/utils'
import {
  actualizarUsuario,
  claveRequerimiento,
  crearUsuario,
  listarRequerimientos,
  listarUsuarios,
  reenviarInvitacion,
  type Acceso,
  type ContactoSalida,
  type Requerimiento,
  type Rol,
  type Usuario,
} from '@/shared/aseguradoras/api'
import { Boton } from '@/shared/components/ui/button'
import { Checkbox } from '@/shared/components/ui/checkbox'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { Modal } from '@/shared/components/ui/modal'
import { useToast } from '@/shared/components/ui/toast'

const EASE: [number, number, number, number] = [0.22, 0.61, 0.36, 1]
const ROLES: { valor: Rol; etiqueta: string; ayuda: string }[] = [
  {
    valor: 'coordinador',
    etiqueta: 'Coordinador',
    ayuda: 'Abarca todo lo que la compañía tenga contratado. Uno solo.',
  },
  {
    valor: 'operador',
    etiqueta: 'Operador',
    ayuda: 'Entra a los requerimientos que se le marquen.',
  },
]

function mensajeDeError(error: unknown, porDefecto: string): string {
  const detalle = (error as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
  if (typeof detalle === 'string') return detalle
  if (Array.isArray(detalle) && detalle.length > 0) {
    return (detalle[0] as { mensaje?: string }).mensaje ?? porDefecto
  }
  return porDefecto
}

function etiquetaRequerimiento(r: Requerimiento): string {
  return r.cobertura_nombre ? `${r.module_nombre} · ${r.cobertura_nombre}` : r.module_nombre
}

/** De las claves marcadas al cuerpo que espera la API. */
function accesosDe(seleccion: Set<string>): Acceso[] {
  return [...seleccion].map((clave) => {
    const [module_code, cobertura] = clave.split('|')
    return { module_code: module_code!, cobertura_codigo: cobertura || null, rol: 'operador' }
  })
}

/**
 * El rol de la persona y, si es operador, a qué requerimientos entra.
 *
 * El **coordinador** no marca nada: abarca todo lo que la aseguradora tenga
 * contratado, y solo puede haber uno por compañía. El **operador** sí marca sus
 * requerimientos, de los que la aseguradora tiene contratados.
 */
function Requerimientos({
  requerimientos,
  rol,
  onRol,
  seleccion,
  onCambiar,
}: {
  requerimientos: Requerimiento[]
  rol: Rol
  onRol: (rol: Rol) => void
  seleccion: Set<string>
  onCambiar: (siguiente: Set<string>) => void
}) {
  function alternar(r: Requerimiento, marcado: boolean) {
    const siguiente = new Set(seleccion)
    const clave = claveRequerimiento(r)
    if (marcado) siguiente.add(clave)
    else siguiente.delete(clave)
    onCambiar(siguiente)
  }

  if (requerimientos.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-borde px-4 py-6 text-center text-sm text-tenue-fg">
        Esta aseguradora no tiene ningún módulo contratado. Márcalos en la pestaña
        Módulos y vuelve aquí.
      </p>
    )
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        {ROLES.map((opcion) => (
          <button
            key={opcion.valor}
            type="button"
            onClick={() => onRol(opcion.valor)}
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

      {rol === 'coordinador' ? (
        // No se marca nada: lo que abarca es lo que la compañía tenga
        // contratado, y se enseña para que se vea qué se está concediendo.
        <div className="rounded-md border border-borde bg-tenue/40 p-4">
          <p className="font-display text-xs font-medium uppercase tracking-[0.09em] text-tenue-fg">
            Abarca toda la compañía
          </p>
          <p className="mt-1.5 text-sm">
            {requerimientos.map(etiquetaRequerimiento).join(' · ')}
          </p>
          <p className="mt-2 text-xs text-tenue-fg">
            Si la aseguradora contrata otro módulo, lo cubre solo; si lo destilda, lo pierde.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="font-display text-xs font-medium uppercase tracking-[0.09em] text-tenue-fg">
            A qué entra
          </p>
          {requerimientos.map((r) => {
            const clave = claveRequerimiento(r)
            return (
              <Checkbox
                key={clave}
                id={`req-${clave}`}
                checked={seleccion.has(clave)}
                onChange={(v) => alternar(r, v)}
                titulo={etiquetaRequerimiento(r)}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}

/** Diálogo de alta: se elige un contacto y sus requerimientos. */
function DialogoAlta({
  abierto,
  onCerrar,
  aseguradoraId,
  contactos,
  requerimientos,
  yaConUsuario,
}: {
  abierto: boolean
  onCerrar: () => void
  aseguradoraId: string
  contactos: ContactoSalida[]
  requerimientos: Requerimiento[]
  yaConUsuario: Set<string>
}) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const [busqueda, setBusqueda] = useState('')
  const [contactoId, setContactoId] = useState('')
  const [rol, setRol] = useState<Rol>('operador')
  const [seleccion, setSeleccion] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (abierto) {
      setBusqueda('')
      setContactoId('')
      setRol('operador')
      setSeleccion(new Set())
    }
  }, [abierto])

  // Solo contactos que todavía no tienen usuario: uno por persona.
  const elegibles = useMemo(() => {
    const termino = busqueda.trim().toLocaleLowerCase()
    return contactos
      .filter((c) => !yaConUsuario.has(c.id))
      .filter(
        (c) =>
          !termino ||
          `${c.nombre_completo} ${c.email}`.toLocaleLowerCase().includes(termino),
      )
  }, [contactos, yaConUsuario, busqueda])

  const crear = useMutation({
    mutationFn: () =>
      crearUsuario(aseguradoraId, {
        contacto_id: contactoId,
        acceso: { rol, accesos: rol === 'coordinador' ? [] : accesosDe(seleccion) },
      }),
    onSuccess: (usuario) => {
      queryClient.invalidateQueries({ queryKey: ['usuarios', aseguradoraId] })
      toast.exito(`Usuario creado. Se envió la invitación a ${usuario.email}`)
      onCerrar()
    },
    onError: (error) => toast.error(mensajeDeError(error, 'No se pudo crear el usuario')),
  })

  function enviar() {
    if (!contactoId) return toast.error('Elige el contacto que tendrá usuario')
    if (rol === 'operador' && seleccion.size === 0) {
      return toast.error('Marca al menos un requerimiento: sin acceso no podría entrar a nada')
    }
    crear.mutate()
  }

  return (
    <Modal
      abierto={abierto}
      onCerrar={onCerrar}
      titulo="Nuevo usuario"
      descripcion="El usuario sale de un contacto: su nombre y su correo vienen de ahí."
      ancho="max-w-2xl"
      pie={
        <>
          <Boton type="button" variante="contorno" onClick={onCerrar}>
            Cancelar
          </Boton>
          <Boton type="button" onClick={enviar} cargando={crear.isPending}>
            Crear y enviar invitación
          </Boton>
        </>
      }
    >
      <div className="space-y-5">
        <div className="space-y-2">
          <Label htmlFor="buscar-contacto">Contacto</Label>
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-tenue-fg"
              aria-hidden="true"
            />
            <Input
              id="buscar-contacto"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              // Buscar no es capturar un dato: se teclea como salga.
              mayusculas={false}
              placeholder="Buscar por nombre o correo…"
              className="pl-9"
            />
          </div>

          {elegibles.length === 0 ? (
            <p className="rounded-md border border-dashed border-borde px-4 py-6 text-center text-sm text-tenue-fg">
              {contactos.length === 0
                ? 'Esta aseguradora no tiene contactos guardados. Añádelos en la pestaña Contactos y guarda.'
                : busqueda.trim()
                  ? 'Ningún contacto coincide con la búsqueda.'
                  : 'Todos los contactos ya tienen usuario.'}
            </p>
          ) : (
            <div className="max-h-52 space-y-2 overflow-y-auto pr-1">
              {elegibles.map((c) => (
                <label
                  key={c.id}
                  className={cn(
                    'flex cursor-pointer items-center gap-3 rounded-md border p-3 transition-colors duration-150',
                    contactoId === c.id
                      ? 'border-marca/40 bg-marca-suave/50'
                      : 'border-borde hover:bg-tenue/50',
                  )}
                >
                  <input
                    type="radio"
                    name="contacto"
                    value={c.id}
                    checked={contactoId === c.id}
                    onChange={() => setContactoId(c.id)}
                    className="size-4 accent-[hsl(var(--marca))]"
                  />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">
                      {c.nombre_completo}
                    </span>
                    <span className="block truncate font-mono text-xs text-tenue-fg">
                      {c.email}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          )}
        </div>

        <Requerimientos
          requerimientos={requerimientos}
          rol={rol}
          onRol={setRol}
          seleccion={seleccion}
          onCambiar={setSeleccion}
        />
      </div>
    </Modal>
  )
}

/** Diálogo de edición de accesos de un usuario ya creado. */
function DialogoAccesos({
  usuario,
  aseguradoraId,
  requerimientos,
  onCerrar,
}: {
  usuario: Usuario | null
  aseguradoraId: string
  requerimientos: Requerimiento[]
  onCerrar: () => void
}) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const [rol, setRol] = useState<Rol>('operador')
  const [seleccion, setSeleccion] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!usuario) return
    setRol(usuario.rol as Rol)
    // Al coordinador no se le marcan requerimientos: los suyos son los de la
    // compañía, y se recalculan solos.
    setSeleccion(
      usuario.rol === 'coordinador'
        ? new Set()
        : new Set(usuario.accesos.map((a) => claveRequerimiento(a))),
    )
  }, [usuario])

  const guardar = useMutation({
    mutationFn: () =>
      actualizarUsuario(aseguradoraId, usuario!.id, {
        acceso: { rol, accesos: rol === 'coordinador' ? [] : accesosDe(seleccion) },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['usuarios', aseguradoraId] })
      toast.exito('Accesos actualizados')
      onCerrar()
    },
    onError: (error) => toast.error(mensajeDeError(error, 'No se pudieron guardar los accesos')),
  })

  return (
    <Modal
      abierto={usuario !== null}
      onCerrar={onCerrar}
      titulo={usuario ? `Accesos de ${usuario.nombre_completo}` : 'Accesos'}
      descripcion="Quitar todos los accesos no está permitido: desactiva el usuario en su lugar."
      ancho="max-w-2xl"
      pie={
        <>
          <Boton type="button" variante="contorno" onClick={onCerrar}>
            Cancelar
          </Boton>
          <Boton
            type="button"
            onClick={() =>
              rol === 'operador' && seleccion.size === 0
                ? toast.error('Marca al menos un requerimiento')
                : guardar.mutate()
            }
            cargando={guardar.isPending}
          >
            Guardar accesos
          </Boton>
        </>
      }
    >
      <Requerimientos
        requerimientos={requerimientos}
        rol={rol}
        onRol={setRol}
        seleccion={seleccion}
        onCambiar={setSeleccion}
      />
    </Modal>
  )
}

/**
 * Usuarios de la aseguradora. Se crean desde sus contactos y solo pueden acceder
 * a los requerimientos que ella tiene contratados; el servidor lo revalida en
 * cada guardado contra la base, no contra lo que mande esta pantalla.
 */
export function UsuariosPanel({
  aseguradoraId,
  contactos,
}: {
  aseguradoraId: string | null
  contactos: ContactoSalida[]
}) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const sinMovimiento = useReducedMotion()
  const [altaAbierta, setAltaAbierta] = useState(false)
  const [editando, setEditando] = useState<Usuario | null>(null)

  const habilitado = Boolean(aseguradoraId)
  const usuarios = useQuery({
    queryKey: ['usuarios', aseguradoraId],
    queryFn: () => listarUsuarios(aseguradoraId!),
    enabled: habilitado,
  })
  const requerimientos = useQuery({
    queryKey: ['requerimientos', aseguradoraId],
    queryFn: () => listarRequerimientos(aseguradoraId!),
    enabled: habilitado,
  })

  const alternarActivo = useMutation({
    mutationFn: ({ id, activo }: { id: string; activo: boolean }) =>
      actualizarUsuario(aseguradoraId!, id, { is_active: activo }),
    onSuccess: (usuario) => {
      queryClient.invalidateQueries({ queryKey: ['usuarios', aseguradoraId] })
      toast.exito(usuario.is_active ? 'Usuario activado' : 'Usuario desactivado y sesiones cerradas')
    },
    onError: (error) => toast.error(mensajeDeError(error, 'No se pudo cambiar el estado')),
  })

  const reinvitar = useMutation({
    mutationFn: (id: string) => reenviarInvitacion(aseguradoraId!, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['usuarios', aseguradoraId] })
      toast.exito('Invitación reenviada')
    },
    onError: (error) => toast.error(mensajeDeError(error, 'No se pudo reenviar la invitación')),
  })

  if (!habilitado) {
    return (
      <p className="rounded-md border border-dashed border-borde px-6 py-10 text-center text-sm text-tenue-fg">
        Guarda la aseguradora antes de crear sus usuarios: hacen falta sus contactos y sus
        requerimientos, y el alta manda un correo que no se puede deshacer cancelando.
      </p>
    )
  }

  const conUsuario = new Set(
    (usuarios.data ?? []).map((u) => u.contacto_id).filter((id): id is string => Boolean(id)),
  )

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-tenue-fg">
          {(usuarios.data ?? []).length === 0
            ? 'Todavía no hay usuarios de esta aseguradora.'
            : `${usuarios.data!.length} ${usuarios.data!.length === 1 ? 'usuario' : 'usuarios'}.`}
        </p>
        <Boton type="button" tamano="sm" onClick={() => setAltaAbierta(true)}>
          <UserPlus aria-hidden="true" />
          Agregar usuario
        </Boton>
      </div>

      {usuarios.isPending ? (
        <div className="space-y-2" role="status" aria-label="Cargando usuarios">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="h-20 animate-pulse rounded-md bg-tenue" />
          ))}
        </div>
      ) : usuarios.isError ? (
        <p className="py-6 text-center text-sm text-peligro">No pudimos cargar los usuarios.</p>
      ) : usuarios.data!.length === 0 ? (
        <div className="rounded-md border border-dashed border-borde px-6 py-10 text-center">
          <ShieldCheck className="mx-auto size-5 text-tenue-fg" aria-hidden="true" />
          <p className="mt-3 font-display text-sm font-medium">Sin usuarios</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-tenue-fg">
            Elige uno de sus contactos y marca a qué requerimientos entra. Recibirá un correo
            con un enlace para crear su contraseña.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {usuarios.data!.map((usuario, indice) => (
            <motion.li
              key={usuario.id}
              initial={sinMovimiento ? { opacity: 0 } : { opacity: 0, y: 6 }}
              animate={{
                opacity: 1,
                y: 0,
                transition: {
                  duration: 0.22,
                  delay: sinMovimiento ? 0 : Math.min(indice, 8) * 0.03,
                  ease: EASE,
                },
              }}
              className="rounded-md border border-borde p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-medium">{usuario.nombre_completo}</p>
                  <p className="truncate font-mono text-xs text-tenue-fg">{usuario.email}</p>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {!usuario.is_active ? (
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-borde bg-tenue px-2.5 py-0.5 font-display text-[0.6875rem] font-medium text-tenue-fg">
                      Desactivado
                    </span>
                  ) : usuario.password_definida ? (
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-exito/30 bg-exito/10 px-2.5 py-0.5 font-display text-[0.6875rem] font-medium text-exito">
                      <span className="size-1.5 rounded-full bg-exito" aria-hidden="true" />
                      Activo
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-aviso/30 bg-aviso/10 px-2.5 py-0.5 font-display text-[0.6875rem] font-medium text-aviso">
                      <MailCheck className="size-3" aria-hidden="true" />
                      {usuario.invitacion_pendiente ? 'Invitación enviada' : 'Invitación caducada'}
                    </span>
                  )}
                </div>
              </div>

              {/* El rol va una vez, arriba: es de la persona, no de cada
                  requerimiento. Debajo, a qué entra. */}
              <p className="mt-3 font-display text-xs font-medium">
                {usuario.rol === 'coordinador' ? 'Coordinador' : 'Operador'}
                {usuario.rol === 'coordinador' && (
                  <span className="ml-1.5 font-normal text-tenue-fg">· toda la compañía</span>
                )}
              </p>
              <ul className="mt-1.5 flex flex-wrap gap-1.5">
                {usuario.accesos.map((a) => (
                  <li
                    key={claveRequerimiento(a)}
                    className="rounded-full border border-borde bg-superficie-hundida px-2.5 py-0.5 text-xs text-tenue-fg"
                  >
                    {a.cobertura_nombre ? `${a.module_nombre} · ${a.cobertura_nombre}` : a.module_nombre}
                  </li>
                ))}
              </ul>

              <div className="mt-3 flex flex-wrap gap-1">
                <Boton
                  type="button"
                  variante="contorno"
                  tamano="sm"
                  onClick={() => setEditando(usuario)}
                >
                  Accesos
                </Boton>
                {!usuario.password_definida && usuario.is_active && (
                  <Boton
                    type="button"
                    variante="fantasma"
                    tamano="sm"
                    onClick={() => reinvitar.mutate(usuario.id)}
                    cargando={reinvitar.isPending && reinvitar.variables === usuario.id}
                  >
                    Reenviar invitación
                  </Boton>
                )}
                <Boton
                  type="button"
                  variante="fantasma"
                  tamano="sm"
                  onClick={() =>
                    alternarActivo.mutate({ id: usuario.id, activo: !usuario.is_active })
                  }
                  className={usuario.is_active ? 'hover:text-peligro' : undefined}
                >
                  {usuario.is_active ? 'Desactivar' : 'Activar'}
                </Boton>
              </div>
            </motion.li>
          ))}
        </ul>
      )}

      <DialogoAlta
        abierto={altaAbierta}
        onCerrar={() => setAltaAbierta(false)}
        aseguradoraId={aseguradoraId!}
        contactos={contactos}
        requerimientos={requerimientos.data ?? []}
        yaConUsuario={conUsuario}
      />
      <DialogoAccesos
        usuario={editando}
        aseguradoraId={aseguradoraId!}
        requerimientos={requerimientos.data ?? []}
        onCerrar={() => setEditando(null)}
      />
    </div>
  )
}
