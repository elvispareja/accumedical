import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { MailPlus, Pencil, Plus, Power, RotateCw, Search, Users } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { rotuloDeArea, useAreaDeLaRuta } from '@/core/auth/area'
import { useSesion } from '@/core/auth/useSesion'
import { cn } from '@/lib/utils'
import { EstadoBadge } from '@/shared/components/ui/badge'
import { Boton } from '@/shared/components/ui/button'
import { Input } from '@/shared/components/ui/input'
import { useToast } from '@/shared/components/ui/toast'
import {
  ETIQUETA_GRUPO,
  actualizarUsuarioPlataforma,
  listarCoordinaciones,
  listarUsuariosPlataforma,
  reenviarInvitacionPlataforma,
  type UsuarioPlataforma,
} from '@/shared/usuarios/api'

const EASE: [number, number, number, number] = [0.22, 0.61, 0.36, 1]

const ROL_ETIQUETA: Record<string, string> = {
  coordinador: 'Coordinador',
  auditor: 'Auditor',
  convenio: 'Convenio',
  contabilidad: 'Contabilidad',
}

/**
 * El personal de la plataforma: coordinadores y médicos auditores. Usuarios del
 * propio administrador, sin aseguradora. Cada uno tiene UN rol: el coordinador
 * abarca una familia entera; el auditor, los módulos que se le marquen.
 */
export function UsuariosPage() {
  const toast = useToast()
  const navegar = useNavigate()
  // La misma pantalla se monta en las dos áreas: el rótulo y los enlaces se
  // quedan en la que se entró (`core/auth/area.ts`).
  const area = useAreaDeLaRuta()
  const queryClient = useQueryClient()
  const sinMovimiento = useReducedMotion()
  const [busqueda, setBusqueda] = useState('')
  // Un coordinador ve aquí SOLO los auditores de su familia: el servidor ya se
  // los acota, esto solo lo dice con todas las letras.
  const { data: sesion } = useSesion()
  const miFamilia = sesion?.user.grupo_coordinado ?? null

  const consulta = useQuery({
    queryKey: ['usuarios-plataforma'],
    queryFn: listarUsuariosPlataforma,
  })

  // La lista es corta y viaja entera: se filtra aquí, sin ir al servidor.
  const visibles = useMemo(() => {
    const termino = busqueda.trim().toLocaleLowerCase()
    const todos = consulta.data ?? []
    if (!termino) return todos
    return todos.filter((u) =>
      [u.nombre_completo, u.email, u.numero_documento ?? '']
        .join(' ')
        .toLocaleLowerCase()
        .includes(termino),
    )
  }, [consulta.data, busqueda])

  const alternarActivo = useMutation({
    mutationFn: (u: UsuarioPlataforma) =>
      actualizarUsuarioPlataforma(u.id, { is_active: !u.is_active }),
    onSuccess: (usuario) => {
      queryClient.invalidateQueries({ queryKey: ['usuarios-plataforma'] })
      toast.exito(usuario.is_active ? 'Usuario activado' : 'Usuario desactivado')
    },
    // El detalle del servidor importa: al reactivar puede venir «"X" ya tiene
    // supervisor: FULANO…», y taparlo con un genérico dejaría al admin a ciegas.
    onError: (error) =>
      toast.error(
        (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
          'No se pudo cambiar el estado del usuario',
      ),
  })

  const reinvitar = useMutation({
    mutationFn: reenviarInvitacionPlataforma,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['usuarios-plataforma'] })
      toast.exito('Invitación enviada')
    },
    onError: (error) =>
      toast.error(
        (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
          'No se pudo enviar la invitación',
      ),
  })

  return (
    <div className="w-full">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-display text-[0.6875rem] font-semibold uppercase tracking-[0.16em] text-tenue-fg">
            {rotuloDeArea(area)}
          </p>
          <h1 className="mt-1.5 font-display text-2xl font-semibold tracking-tight">
            {miFamilia ? `Auditores de ${ETIQUETA_GRUPO[miFamilia]}` : 'Usuarios'}
          </h1>
          <p className="mt-1 text-sm text-tenue-fg">
            {miFamilia
              ? 'Los médicos auditores de tu familia: los que ya entran a alguno de tus módulos.'
              : 'Tu propio personal: coordinadores y médicos auditores, cada uno con las aplicaciones que se le marquen.'}
          </p>
        </div>
        <Boton onClick={() => navegar(`${area}/usuarios/nuevo`)}>
          <Plus aria-hidden="true" />
          {miFamilia ? 'Nuevo auditor' : 'Nuevo usuario'}
        </Boton>
      </header>

      <div className="relative mt-7 max-w-md">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-tenue-fg"
          aria-hidden="true"
        />
        <Input
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          // Buscar no es capturar un dato: se teclea como salga.
          mayusculas={false}
          placeholder="Buscar por nombre, correo o identificación"
          aria-label="Buscar usuarios"
          className="pl-9"
        />
      </div>

      <div className="mt-5 overflow-hidden rounded-md border border-borde bg-superficie">
        {consulta.isPending ? (
          <Esqueleto />
        ) : consulta.isError ? (
          <EstadoError onReintentar={() => consulta.refetch()} />
        ) : visibles.length === 0 ? (
          <Vacio
            hayFiltros={busqueda.trim().length > 0}
            onCrear={() => navegar(`${area}/usuarios/nuevo`)}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[46rem] table-fixed text-sm">
              <thead>
                <tr className="border-b border-borde bg-superficie-hundida text-left">
                  <Th>Usuario</Th>
                  <Th className="w-[11rem]">Identificación</Th>
                  <Th className="w-[8.5rem]">Celular</Th>
                  <Th className="w-[15rem]">Módulos</Th>
                  <Th className="w-[8.5rem]">Acceso</Th>
                  <th className="w-[7.5rem] px-4 py-2.5">
                    <span className="sr-only">Acciones</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                <AnimatePresence initial={false}>
                  {visibles.map((fila, indice) => (
                    <motion.tr
                      key={fila.id}
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
                      exit={{ opacity: 0, transition: { duration: 0.15 } }}
                      className="border-b border-borde last:border-b-0 hover:bg-tenue/50"
                    >
                      <td className="px-4 py-3">
                        <p className="truncate font-medium">
                          {fila.nombre_completo}
                        </p>
                        <p className="truncate text-xs text-tenue-fg">{fila.email}</p>
                      </td>
                      <td className="px-4 py-3 text-tenue-fg">
                        {fila.numero_documento ? (
                          <>
                            <span className="tabular block truncate">{fila.numero_documento}</span>
                            <span className="block truncate text-xs">
                              {fila.tipo_documento_nombre}
                            </span>
                          </>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="tabular truncate px-4 py-3 text-tenue-fg">
                        {fila.telefono ?? '—'}
                      </td>
                      <td className="px-4 py-3">
                        {/* El coordinador se enseña por su familia —que es lo
                            que de verdad abarca—; el auditor, por sus módulos. */}
                        <p className="truncate text-xs font-medium">
                          {ROL_ETIQUETA[fila.acceso.rol] ?? fila.acceso.rol}
                          {fila.acceso.grupo
                            ? ` · ${ETIQUETA_GRUPO[fila.acceso.grupo]}`
                            : ''}
                        </p>
                        <p
                          className="truncate text-[0.6875rem] text-tenue-fg"
                          title={fila.acceso.modulos.map((m) => m.module_nombre).join(' · ')}
                        >
                          {/* Convenio y Contabilidad no entran por módulos: su
                              alcance está por definir, y decir «sin módulos»
                              sonaría a que les falta algo. */}
                          {fila.acceso.rol === 'convenio' || fila.acceso.rol === 'contabilidad'
                            ? 'Función transversal'
                            : fila.acceso.modulos.length === 0
                              ? 'Sin módulos'
                              : fila.acceso.modulos.map((m) => m.module_nombre).join(' · ')}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <EstadoBadge estado={fila.is_active ? 'activo' : 'inactivo'} />
                        {fila.invitacion_pendiente && (
                          <span className="mt-1 block text-[0.6875rem] text-tenue-fg">
                            Invitación pendiente
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-1">
                          {/* Reinvitar solo tiene sentido mientras no haya contraseña. */}
                          {!fila.password_definida && fila.is_active && (
                            <Boton
                              variante="fantasma"
                              tamano="icono"
                              onClick={() => reinvitar.mutate(fila.id)}
                              aria-label={`Reenviar invitación a ${fila.nombre_completo}`}
                              title="Reenviar invitación"
                            >
                              <MailPlus aria-hidden="true" />
                            </Boton>
                          )}
                          <Boton
                            variante="fantasma"
                            tamano="icono"
                            onClick={() => navegar(`${area}/usuarios/${fila.id}/editar`)}
                            aria-label={`Editar ${fila.nombre_completo}`}
                          >
                            <Pencil aria-hidden="true" />
                          </Boton>
                          <Boton
                            variante="fantasma"
                            tamano="icono"
                            onClick={() => {
                              if (
                                fila.is_active &&
                                !window.confirm(
                                  `¿Desactivar a «${fila.nombre_completo}»? Sus sesiones abiertas se cierran en el acto.`,
                                )
                              ) {
                                return
                              }
                              alternarActivo.mutate(fila)
                            }}
                            aria-label={
                              fila.is_active
                                ? `Desactivar a ${fila.nombre_completo}`
                                : `Activar a ${fila.nombre_completo}`
                            }
                            title={fila.is_active ? 'Desactivar' : 'Activar'}
                            className={cn(fila.is_active && 'hover:text-peligro')}
                          >
                            <Power aria-hidden="true" />
                          </Boton>
                        </div>
                      </td>
                    </motion.tr>
                  ))}
                </AnimatePresence>
              </tbody>
            </table>
          </div>
        )}
      </div>

      {consulta.data && consulta.data.length > 0 && (
        <p className="mt-4 text-sm text-tenue-fg">
          {visibles.length === consulta.data.length
            ? `${consulta.data.length} ${consulta.data.length === 1 ? 'usuario' : 'usuarios'}`
            : `${visibles.length} de ${consulta.data.length} usuarios`}
        </p>
      )}

      {!miFamilia && <CoordinadoresPorAplicacion />}
    </div>
  )
}

const FECHA = new Intl.DateTimeFormat('es-EC', { day: '2-digit', month: 'short', year: 'numeric' })

/**
 * Quién coordina cada aplicación HOY y quién la coordinó antes (14/10/2026).
 * Es la trazabilidad del traspaso: cuando un coordinador se va y la app pasa a
 * otro, su tramo queda aquí con su fecha de salida, y lo que hizo sigue a su
 * nombre en la auditoría.
 */
function CoordinadoresPorAplicacion() {
  const coordinaciones = useQuery({ queryKey: ['coordinaciones'], queryFn: listarCoordinaciones })
  const [abierta, setAbierta] = useState<string | null>(null)
  if (!coordinaciones.data || coordinaciones.data.length === 0) return null
  return (
    <section className="mt-10" aria-labelledby="titulo-coordinaciones">
      <h2 id="titulo-coordinaciones" className="font-display text-lg font-semibold tracking-tight">
        Coordinadores por aplicación
      </h2>
      <p className="mt-1 text-sm text-tenue-fg">
        Quién coordina cada aplicación hoy y quién la coordinó antes. Puede haber varios por
        aplicación; al desactivar o cambiar a un coordinador su tramo se cierra, pero queda aquí.
      </p>
      <ul className="mt-4 divide-y divide-borde overflow-hidden rounded-md border border-borde bg-superficie">
        {coordinaciones.data.map((app) => {
          const vigentes = app.tramos.filter((t) => t.vigente)
          const anteriores = app.tramos.filter((t) => !t.vigente)
          const verHistorial = abierta === app.module_code
          return (
            <li key={app.module_code} className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-display text-sm font-semibold">{app.module_nombre}</p>
                  <p className="mt-1 text-sm">
                    {vigentes.length
                      ? vigentes.map((t) => t.nombre).join(' · ')
                      : <span className="text-tenue-fg">Sin coordinador</span>}
                  </p>
                </div>
                {anteriores.length > 0 || vigentes.length > 0 ? (
                  <button
                    type="button"
                    className="text-xs text-marca underline-offset-4 hover:underline"
                    onClick={() => setAbierta(verHistorial ? null : app.module_code)}
                    aria-expanded={verHistorial}
                  >
                    {verHistorial ? 'Ocultar historial' : `Historial (${app.tramos.length})`}
                  </button>
                ) : null}
              </div>
              {verHistorial && (
                <table className="mt-3 w-full text-left text-xs">
                  <thead className="text-tenue-fg">
                    <tr>
                      <th className="py-1.5 pr-3 font-medium">Coordinador</th>
                      <th className="py-1.5 pr-3 font-medium">Desde</th>
                      <th className="py-1.5 pr-3 font-medium">Hasta</th>
                      <th className="py-1.5 pr-3 font-medium">Se lo dio</th>
                      <th className="py-1.5 font-medium">Se lo quitó</th>
                    </tr>
                  </thead>
                  <tbody>
                    {app.tramos.map((t) => (
                      <tr key={`${t.user_id}-${t.desde}`} className="border-t border-borde">
                        <td className="py-1.5 pr-3">
                          {t.nombre}
                          {t.email ? <span className="block text-tenue-fg">{t.email}</span> : null}
                        </td>
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
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <th
      className={cn(
        'px-4 py-2.5 text-left font-display text-[0.6875rem] font-semibold uppercase tracking-[0.09em] text-tenue-fg',
        className,
      )}
    >
      {children}
    </th>
  )
}

function Esqueleto() {
  return (
    <div className="divide-y divide-borde" role="status" aria-label="Cargando usuarios">
      {Array.from({ length: 4 }, (_, i) => (
        <div key={i} className="flex items-center gap-4 px-4 py-3.5">
          <div className="h-3 w-1/4 animate-pulse rounded bg-tenue" />
          <div className="h-3 w-1/5 animate-pulse rounded bg-tenue" />
          <div className="ml-auto h-5 w-24 animate-pulse rounded-full bg-tenue" />
        </div>
      ))}
    </div>
  )
}

function EstadoError({ onReintentar }: { onReintentar: () => void }) {
  return (
    <div className="px-6 py-14 text-center">
      <p className="font-display text-sm font-medium">No pudimos cargar los usuarios</p>
      <p className="mx-auto mt-1 max-w-sm text-sm text-tenue-fg">
        Puede ser un corte momentáneo de conexión con el servidor.
      </p>
      <Boton variante="contorno" tamano="sm" onClick={onReintentar} className="mt-4">
        <RotateCw aria-hidden="true" />
        Reintentar
      </Boton>
    </div>
  )
}

function Vacio({ hayFiltros, onCrear }: { hayFiltros: boolean; onCrear: () => void }) {
  return (
    <div className="px-6 py-16 text-center">
      <Users className="mx-auto size-6 text-tenue-fg" aria-hidden="true" />
      <p className="mt-3 font-display text-sm font-medium">
        {hayFiltros ? 'Ningún usuario coincide' : 'Todavía no hay usuarios de plataforma'}
      </p>
      <p className="mx-auto mt-1 max-w-sm text-sm text-tenue-fg">
        {hayFiltros
          ? 'Prueba con otro término de búsqueda.'
          : 'Crea el primero: le llegará una invitación por correo para definir su contraseña.'}
      </p>
      {!hayFiltros && (
        <Boton onClick={onCrear} className="mt-4" tamano="sm">
          <Plus aria-hidden="true" />
          Nuevo usuario
        </Boton>
      )}
    </div>
  )
}
