import { useMutation, useQueryClient } from '@tanstack/react-query'
import { motion, useReducedMotion } from 'framer-motion'
import { Check, ChevronDown, LogOut } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Outlet, useLocation, useNavigate, useParams } from 'react-router-dom'

import { cambiarModulo, cerrarSesion, type ModuloDelUsuario } from '@/core/auth/api'
import { esCoordinador } from '@/core/auth/area'
import { nombreDeRol } from '@/core/auth/roles'
import { BotonTema } from '@/core/components/BotonTema'
import { BotonNotificaciones } from '@/core/notificaciones/BotonNotificaciones'
import { CLAVE_SESION, useSesion } from '@/core/auth/useSesion'
import { ArmazonLateral } from '@/core/layout/MenuLateral'
import { NavegacionModulo } from '@/core/layout/NavegacionModulo'
import { identidadDe } from '@/core/modulos/identidad'
import { cn } from '@/lib/utils'
import { Boton } from '@/shared/components/ui/button'
import { useToast } from '@/shared/components/ui/toast'

const EASE: [number, number, number, number] = [0.22, 0.61, 0.36, 1]

/** Sus módulos de la A a la Z, que es como se leen de arriba abajo. */
function porAbecedario(modulos: ModuloDelUsuario[]): ModuloDelUsuario[] {
  return [...modulos].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
}

/**
 * Armazón de un módulo: topbar con su acento y el selector para cambiar de
 * módulo sin volver a entrar. Lo que va debajo lo pone cada módulo con su propio
 * `modules/<slug>/routes.tsx`; los que todavía no tienen pantallas cuelgan del
 * marcador de posición `ModuloPendiente`.
 */
export function ModuloShell({ slug: fijo, raiz: raizFija }: { slug?: string; raiz?: string } = {}) {
  // Un módulo con APP PROPIA (D46) pasa su slug y su raíz: allí las rutas son
  // relativas a la app (`/dashboard`, sin `/<slug>`), así que la dirección no
  // dice de qué módulo es. Los que viven dentro de admin lo sacan de la ruta.
  const { slug: parametro } = useParams<{ slug: string }>()
  const { pathname } = useLocation()
  const slug = fijo ?? parametro ?? pathname.split('/')[1]
  const raiz = raizFija ?? `/${slug ?? ''}`
  const { data: sesion } = useSesion()
  const navegar = useNavigate()
  const queryClient = useQueryClient()
  const toast = useToast()
  const sinMovimiento = useReducedMotion()
  // Si el archivo del logo no llega (borrado del volumen, red), se vuelve al
  // icono del módulo en vez de dejar un hueco con la imagen rota.
  const [logoRoto, setLogoRoto] = useState(false)

  const modulo = sesion?.modulos.find((m) => m.slug === slug)
  const identidad = identidadDe(modulo?.codigo ?? '')

  const cambiar = useMutation({
    mutationFn: cambiarModulo,
    onSuccess: (sesionNueva, destino) => {
      queryClient.setQueryData(CLAVE_SESION, sesionNueva)
      if (destino !== slug) navegar(`/${destino}/dashboard`)
    },
    onError: () => toast.error('No pudimos cambiar de módulo'),
  })

  const salir = useMutation({
    mutationFn: cerrarSesion,
    onSuccess: () => {
      queryClient.clear()
      navegar('/login', { replace: true })
    },
  })

  // Entrar por la barra de direcciones también cuenta como cambiar de módulo:
  // hay que decírselo al backend, que es quien guarda el último usado.
  //
  // Se anuncia UNA VEZ por slug, y las dependencias son solo el slug de la ruta.
  // Vigilar además si el módulo activo coincide parecía más correcto y era un
  // error: al pulsar «cambiar de módulo», la sesión se actualiza antes de que la
  // navegación cambie el slug, así que este efecto veía «activo=concurrencia,
  // ruta=calificacion» y volvía a poner calificacion, deshaciendo el cambio que
  // el usuario acababa de hacer.
  const anunciado = useRef<string | null>(null)
  useEffect(() => {
    if (!slug || !modulo || anunciado.current === slug) return
    anunciado.current = slug
    if (sesion?.modulo_activo !== modulo.codigo) cambiar.mutate(slug)
    // `cambiar` y `sesion` se recrean en cada render; disparar por ellos sería
    // justo el bucle que este efecto tiene que evitar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, modulo?.codigo])

  if (!modulo) return null

  const otros = porAbecedario(sesion?.modulos ?? []).filter((m) => m.slug !== slug)
  const rolVisible = nombreDeRol(modulo.rol, Boolean(sesion?.aseguradora))

  // Quién es y dónde está: el mismo bloque en los dos armazones.
  const identidadDelModulo = (
    <div className="flex min-w-0 items-center gap-3">
      {/* La marca de la compañía si subió logo; el icono del módulo si no.
          El mismo hueco para los dos: nada baila al cambiar de módulo. */}
      {sesion?.aseguradora?.tiene_logo && !logoRoto ? (
        <span className="grid size-9 shrink-0 place-items-center overflow-hidden rounded-md border border-borde bg-fondo">
          <img
            src="/api/v1/auth/mi-aseguradora/logo"
            alt={`Logo de ${sesion.aseguradora.nombre}`}
            title={sesion.aseguradora.nombre}
            className="size-full object-contain"
            onError={() => setLogoRoto(true)}
          />
        </span>
      ) : (
        <span className={cn('grid size-9 shrink-0 place-items-center rounded-md', identidad.suave)}>
          <identidad.Icono className={cn('size-4.5', identidad.texto)} aria-hidden="true" />
        </span>
      )}
      <div className="min-w-0">
        <p className="truncate font-display text-sm font-semibold">{modulo.nombre}</p>
        <p className="truncate text-xs text-tenue-fg">
          {rolVisible}
          {sesion?.aseguradora ? ` · ${sesion.aseguradora.nombre}` : ''}
        </p>
      </div>
    </div>
  )

  const controles = (
    <>
      <BotonNotificaciones modulo={modulo ? { codigo: modulo.codigo, ruta: raiz } : undefined} />
      <BotonTema />
      <span className="hidden max-w-[16rem] truncate text-sm text-tenue-fg sm:inline">
        {sesion?.user.email}
      </span>
      <Boton variante="fantasma" tamano="sm" onClick={() => salir.mutate()} cargando={salir.isPending}>
        <LogOut aria-hidden="true" />
        <span className="hidden sm:inline">Salir</span>
      </Boton>
    </>
  )

  const contenido = (
    <motion.div
      key={slug}
      initial={sinMovimiento ? { opacity: 0 } : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24, ease: EASE }}
    >
      <Outlet />
    </motion.div>
  )

  // El coordinador —el de una familia de Accumedical y el de una compañía, que
  // para esto son lo mismo— lleva varios módulos a la vez: los suyos viven en el
  // MISMO menú lateral que el resto de la plataforma, uno por línea y de la A a
  // la Z. Quien opera o audita un módulo suelto conserva su topbar con el
  // selector, que para dos entradas es más directo que una columna entera.
  // El administrador global entra al módulo COMO coordinador de plataforma (D45):
  // mismo armazón y mismo menú, en el subdominio y con el diseño del módulo.
  if (esCoordinador(sesion) || sesion?.user.es_admin_global) {
    return (
      // La marca del panel es SIEMPRE la de Accumedical, también para quien
      // entra desde una aseguradora: el menú es la plataforma, y la compañía se
      // reconoce arriba, en su logo y su nombre junto al módulo.
      <ArmazonLateral
        nav={<NavegacionModulo raiz={raiz} />}
        franja={identidad.punto}
        topbarIzquierda={identidadDelModulo}
        topbarDerecha={controles}
      >
        {contenido}
      </ArmazonLateral>
    )
  }

  return (
    <div className="min-h-dvh bg-fondo">
      <header className="sticky top-0 z-30 border-b border-borde bg-superficie/95 backdrop-blur">
        <div className={cn('h-1', identidad.punto)} aria-hidden="true" />
        <div className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
          {identidadDelModulo}

          <div className="ml-auto flex items-center gap-2">
            {/* Cambiar de módulo sin reautenticar. Con uno solo no hay nada que
                elegir, así que el selector no se pinta. */}
            {otros.length > 0 && (
              <div className="group relative">
                <Boton variante="contorno" tamano="sm">
                  Cambiar de módulo
                  <ChevronDown aria-hidden="true" />
                </Boton>
                <ul
                  className={cn(
                    'invisible absolute right-0 z-40 mt-1 w-60 rounded-md border border-borde bg-superficie p-1 opacity-0 shadow-elevada',
                    'transition-[opacity,visibility] duration-150 ease-natural',
                    'group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100',
                  )}
                >
                  {[modulo, ...otros].map((otro) => {
                    const suya = identidadDe(otro.codigo)
                    const actual = otro.slug === slug
                    return (
                      <li key={otro.codigo}>
                        <button
                          type="button"
                          onClick={() => cambiar.mutate(otro.slug)}
                          className="flex w-full items-center gap-2.5 rounded px-2.5 py-2 text-left text-sm transition-colors duration-150 hover:bg-tenue"
                        >
                          <span className={cn('size-2 shrink-0 rounded-full', suya.punto)} aria-hidden="true" />
                          <span className="min-w-0 flex-1 truncate">{otro.nombre}</span>
                          {actual && <Check className="size-4 shrink-0 text-marca" aria-hidden="true" />}
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </div>
            )}

            {controles}
          </div>
        </div>
      </header>

      {/* A TODO el ancho, como el área de administración y como el armazón
          con menú: la bandeja tiene siete columnas y una columna centrada de
          72 rem le recortaba el estado. Nadie mira una tabla de casos en una
          hoja estrecha. */}
      <main className="px-4 py-10 sm:px-6">{contenido}</main>
    </div>
  )
}
