import { useMutation, useQueryClient } from '@tanstack/react-query'
import { motion, useReducedMotion } from 'framer-motion'
import { ArrowRight, LogOut } from 'lucide-react'
import { Navigate, useNavigate } from 'react-router-dom'

import { cambiarModulo, cerrarSesion } from '@/core/auth/api'
import { nombreDeRol } from '@/core/auth/roles'
import { CLAVE_SESION, useSesion } from '@/core/auth/useSesion'
import { BotonTema } from '@/core/components/BotonTema'
import { Marca } from '@/core/components/Marca'
import { identidadDe } from '@/core/modulos/identidad'
import { cn } from '@/lib/utils'
import { Boton } from '@/shared/components/ui/button'
import { useToast } from '@/shared/components/ui/toast'

const EASE: [number, number, number, number] = [0.22, 0.61, 0.36, 1]

/**
 * Elegir a qué módulo entrar. La lista la calcula y la devuelve SIEMPRE el
 * backend en `/auth/me`; esta pantalla solo la pinta. Si el usuario tiene uno
 * solo, el backend ni siquiera lo manda aquí: `calcular_redireccion` lo lleva
 * directo a su módulo.
 */
export function SeleccionarModuloPage() {
  const { data: sesion, isPending } = useSesion()
  const navegar = useNavigate()
  const queryClient = useQueryClient()
  const toast = useToast()
  const sinMovimiento = useReducedMotion()

  const entrar = useMutation({
    mutationFn: cambiarModulo,
    onSuccess: (sesionNueva, slug) => {
      // La sesión vuelve con el módulo activo ya fijado y guardado en la base:
      // la próxima vez que entre, el backend lo recordará.
      queryClient.setQueryData(CLAVE_SESION, sesionNueva)
      navegar(`/${slug}`)
    },
    onError: () => toast.error('No pudimos abrir ese módulo. Vuelve a intentarlo.'),
  })

  const salir = useMutation({
    mutationFn: cerrarSesion,
    onSuccess: () => {
      queryClient.clear()
      navegar('/login', { replace: true })
    },
  })

  if (isPending) {
    return (
      <main className="grid min-h-dvh place-items-center bg-fondo px-4">
        <div className="w-full max-w-3xl space-y-4" role="status" aria-label="Cargando tus módulos">
          <div className="h-4 w-40 animate-pulse rounded bg-tenue" />
          <div className="h-9 w-80 animate-pulse rounded bg-tenue" />
          <div className="grid gap-4 sm:grid-cols-2">
            {Array.from({ length: 2 }, (_, i) => (
              <div key={i} className="h-36 animate-pulse rounded-md bg-tenue" />
            ))}
          </div>
        </div>
      </main>
    )
  }

  // Un administrador global no elige módulo: su sitio es la administración. Y
  // quien no tiene ninguno tiene su propia pantalla. En los dos casos el destino
  // lo decidió el backend; esto solo evita dejar a nadie en una pantalla vacía.
  if (sesion?.user.es_admin_global) return <Navigate to="/admin" replace />
  if (!sesion || sesion.modulos.length === 0) return <Navigate to="/sin-accesos" replace />

  const modulos = [...sesion.modulos].sort((a, b) => a.orden - b.orden)

  return (
    <main className="min-h-dvh bg-fondo px-4 py-10 sm:px-6">
      <div className="mx-auto max-w-3xl">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <Marca alto="h-10" />
            <h1 className="mt-3 font-display text-2xl font-semibold tracking-tight">
              Hola, {sesion.user.nombre_completo}
            </h1>
            <p className="mt-1 text-sm text-tenue-fg">
              Tienes acceso a {modulos.length} módulos. Elige por cuál empezar; podrás cambiar
              sin volver a entrar.
            </p>
          </div>
          <div className="flex items-center gap-1">
            <BotonTema />
            <Boton
              variante="fantasma"
              tamano="sm"
              onClick={() => salir.mutate()}
              cargando={salir.isPending}
            >
              <LogOut aria-hidden="true" />
              Salir
            </Boton>
          </div>
        </header>

        <ul className="mt-8 grid gap-4 sm:grid-cols-2">
          {modulos.map((modulo, indice) => {
            const { Icono, punto, suave, texto, borde } = identidadDe(modulo.codigo)
            const abriendo = entrar.isPending && entrar.variables === modulo.slug
            return (
              <motion.li
                key={modulo.codigo}
                initial={sinMovimiento ? { opacity: 0 } : { opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                  duration: 0.26,
                  delay: sinMovimiento ? 0 : Math.min(indice, 8) * 0.05,
                  ease: EASE,
                }}
              >
                <button
                  type="button"
                  onClick={() => entrar.mutate(modulo.slug)}
                  disabled={entrar.isPending}
                  aria-label={`Entrar a ${modulo.nombre} como ${nombreDeRol(modulo.rol, Boolean(sesion?.aseguradora))}`}
                  className={cn(
                    'group relative flex h-full w-full flex-col items-start gap-3 overflow-hidden rounded-md border p-5 text-left',
                    'border-borde bg-superficie transition-[border-color,box-shadow,transform] duration-150 ease-natural',
                    'hover:-translate-y-0.5 hover:shadow-elevada',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-anillo/40',
                    'disabled:pointer-events-none disabled:opacity-60',
                    `hover:${borde}`,
                  )}
                >
                  <span
                    className={cn('absolute inset-x-0 top-0 h-1', punto)}
                    aria-hidden="true"
                  />
                  <span className={cn('grid size-11 place-items-center rounded-md', suave)}>
                    <Icono className={cn('size-5', texto)} aria-hidden="true" />
                  </span>

                  <span className="min-w-0">
                    <span className="block font-display text-base font-semibold">
                      {modulo.nombre}
                    </span>
                    <span className="mt-0.5 block text-sm text-tenue-fg">
                      {nombreDeRol(modulo.rol, Boolean(sesion?.aseguradora))}
                    </span>
                  </span>

                  <span
                    className={cn(
                      'mt-auto inline-flex items-center gap-1.5 pt-2 font-display text-sm font-medium',
                      texto,
                    )}
                  >
                    {abriendo ? 'Abriendo…' : 'Entrar'}
                    <ArrowRight
                      className="size-4 transition-transform duration-150 group-hover:translate-x-0.5"
                      aria-hidden="true"
                    />
                  </span>
                </button>
              </motion.li>
            )
          })}
        </ul>
      </div>
    </main>
  )
}
