import { useMutation, useQueryClient } from '@tanstack/react-query'
import { motion, useReducedMotion } from 'framer-motion'
import { LogOut } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Outlet, useLocation, useNavigate, useParams } from 'react-router-dom'

import { cambiarModulo, cerrarSesion } from '@/core/auth/api'
import { BotonTema } from '@/core/components/BotonTema'
import { BotonNotificaciones } from '@/core/notificaciones/BotonNotificaciones'
import { CLAVE_SESION, useSesion } from '@/core/auth/useSesion'
import { ArmazonLateral, useContextoMenu } from '@/core/layout/MenuLateral'
import { NavegacionModulo } from '@/core/layout/NavegacionModulo'
import { identidadDe } from '@/core/modulos/identidad'
import { cn } from '@/lib/utils'
import { Boton } from '@/shared/components/ui/button'
import { useToast } from '@/shared/components/ui/toast'

const EASE: [number, number, number, number] = [0.22, 0.61, 0.36, 1]

/**
 * Armazón de un módulo: topbar con su acento (sin el bloque del módulo), la
 * campana, el tema y «Salir». Lo que va debajo lo pone cada módulo con su propio
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

  // TODOS con el mismo menú lateral (pedido del usuario, 26/10/2026: «el menú
  // lateral como Calificación»), también quien opera o audita: dentro del
  // módulo solo «Bandeja de entrada» y «Notificaciones» (`NavegacionModulo`).
  // La marca del panel: el logo de la aseguradora si lo subió; si no, el de
  // Accumedical (como en Calificación). El administrador global entra igual,
  // como coordinador de plataforma (D45).
  return (
    <ArmazonLateral
      nav={
        <NavegacionModulo
          raiz={raiz}
          // Reportería (27/10/2026): por ahora solo el coordinador de
          // Accumedical en Concurrencia —sin aseguradora, rol supervisor—.
          conReporteria={
            slug === 'concurrencia' && !sesion?.aseguradora && modulo.rol === 'supervisor'
          }
        />
      }
      marca={
        sesion?.aseguradora?.tiene_logo && !logoRoto ? (
          <MarcaDeAseguradora nombre={sesion.aseguradora.nombre} alFallar={() => setLogoRoto(true)} />
        ) : undefined
      }
      franja={identidad.punto}
      // Sin el bloque del módulo y el rol en la barra (pedido del usuario,
      // 26/10/2026): el menú lateral ya dice dónde se está.
      topbarDerecha={controles}
    >
      {contenido}
    </ArmazonLateral>
  )
}

/**
 * El logo de la aseguradora en el hueco de la marca del menú lateral, sobre una
 * tarjeta clara (los logos de las compañías suelen venir sobre blanco). Si el
 * archivo no llega, `alFallar` devuelve el hueco a la marca de Accumedical.
 */
function MarcaDeAseguradora({ nombre, alFallar }: { nombre: string; alFallar: () => void }) {
  const { compacto } = useContextoMenu()
  return (
    <span
      className={cn(
        'grid place-items-center overflow-hidden rounded-md border border-borde bg-white',
        compacto ? 'size-10 p-1' : 'h-14 w-full px-3 py-1.5',
      )}
    >
      <img
        src="/api/v1/auth/mi-aseguradora/logo"
        alt={`Logo de ${nombre}`}
        title={nombre}
        draggable={false}
        className="max-h-full max-w-full object-contain"
        onError={alFallar}
      />
    </span>
  )
}
