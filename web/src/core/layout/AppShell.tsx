import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Bell,
  Briefcase,
  Building2,
  SlidersHorizontal,
  ClipboardCheck,
  Handshake,
  LogOut,
  Settings,
  Stethoscope,
  Users,
} from 'lucide-react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'

import { cerrarSesion } from '@/core/auth/api'
import { esCoordinador, useArea } from '@/core/auth/area'
import { useSesion } from '@/core/auth/useSesion'
import { BotonTema } from '@/core/components/BotonTema'
import { identidadDe } from '@/core/modulos/identidad'
import { BotonNotificaciones } from '@/core/notificaciones/BotonNotificaciones'
import {
  ArmazonLateral,
  EntradaMenu,
  GrupoMenu,
  type EntradaLateral,
} from '@/core/layout/MenuLateral'
import { NavegacionCoordinador } from '@/core/layout/NavegacionCoordinador'
import type { ModuloCatalogo } from '@/shared/catalogos/api'
import { useModulos } from '@/shared/catalogos/hooks'
import { Boton } from '@/shared/components/ui/button'

/**
 * Navegación del área de administración. Cuando crezca, esta lista se
 * construirá a partir de los permisos reales que devuelve /auth/me, nunca de una
 * lista fija en el cliente.
 */
const ENTRADAS: EntradaLateral[] = [
  { a: '/admin/aseguradoras', etiqueta: 'Aseguradoras', icono: Building2 },
  { a: '/admin/prestadores', etiqueta: 'Prestadores', icono: Stethoscope },
  // La red de convenios de Accumedical misma con los prestadores.
  { a: '/admin/red-convenio', etiqueta: 'Red convenio', icono: Handshake },
  // Con quién trabaja Accumedical. La sección está por construir; la entrada
  // existe para reservarle su sitio, y su pantalla lo dice en vez de llevar a
  // un error. NO está en `ENTRADAS_POR_FUNCION`: es del administrador.
  // Su propia app (D49): se abre en pestaña nueva en pacientes.pymes.ec.
  { a: '/pacientes/dashboard', etiqueta: 'Pacientes Accumedical', icono: Briefcase },
]

// Las dos familias comerciales, en el orden en que se presentan. Una sin
// familia —no debería haberla— cae al final y sin encabezado, igual que en la
// ficha de la aseguradora: el mismo dato se pinta igual en toda la plataforma.
const FAMILIAS = [
  ['suscripcion', 'Suscripción'],
  ['siniestro', 'Siniestro'],
  [null, ''],
] as const

// El grupo «Parámetros»: los catálogos que la propia gente mantiene, para no
// necesitar una migración por cada valor nuevo. Lo lleva quien crea prestadores.
const PARAMETROS: EntradaLateral[] = [
  { a: '/admin/parametros/tipos-prestador', etiqueta: 'Tipo de prestador', icono: Stethoscope },
]

/**
 * Lo que ve cada función transversal. El servidor impone lo mismo en cada
 * request: esto solo evita enseñar puertas que estarían cerradas.
 *
 *   convenio     → la red de Accumedical, los prestadores con los que se pacta,
 *                  y las aseguradoras solo para entrar a su pestaña Convenios.
 *   contabilidad → únicamente aseguradoras: las da de alta y gestiona su ficha
 *                  entera menos los convenios.
 */
const ENTRADAS_POR_FUNCION: Record<string, Set<string>> = {
  convenio: new Set([
    '/admin/aseguradoras',
    '/admin/prestadores',
    '/admin/red-convenio',
    '/admin/parametros',
  ]),
  contabilidad: new Set(['/admin/aseguradoras']),
}

/**
 * El grupo «Auditorías» del administrador: **todos los requerimientos vivos**,
 * estén construidos o no, repartidos en sus dos familias.
 *
 * La lista sale del catálogo del servidor (`/shared/catalogos/modulos`), no de
 * una constante: un módulo nuevo aparece aquí con su fila en `modules` y sin
 * tocar este archivo, que es la regla de la plataforma. Dentro de cada familia
 * van por orden alfabético, el mismo con el que cuelgan del menú del
 * coordinador.
 *
 * Los que todavía no tienen panel llevan igual a su dirección: allí les espera
 * el cartel de «en construcción», que dice más que esconderlos.
 */
function GrupoAuditorias({ modulos }: { modulos: ModuloCatalogo[] }) {
  const ubicacion = useLocation()
  return (
    <GrupoMenu
      etiqueta="Auditorías"
      icono={ClipboardCheck}
      dentro={ubicacion.pathname.startsWith('/admin/auditorias')}
    >
      {FAMILIAS.map(([familia, titulo]) => {
        const suyos = modulos
          .filter((m) => (m.grupo ?? null) === familia)
          .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
        if (suyos.length === 0) return null
        return (
          <div key={familia ?? 'sin-familia'}>
            {titulo && (
              <p className="mb-0.5 ml-4 mt-2 px-3 font-display text-[0.6875rem] font-semibold uppercase tracking-[0.09em] text-tenue-fg">
                {titulo}
              </p>
            )}
            {suyos.map((m) => (
              <EntradaMenu
                key={m.codigo}
                a={`/${m.slug}/dashboard`}
                etiqueta={m.nombre}
                icono={identidadDe(m.codigo).Icono}
                anidada
              />
            ))}
          </div>
        )
      })}
    </GrupoMenu>
  )
}

/** El grupo «Parámetros», idéntico para el admin y para la función Convenio. */
function GrupoParametros() {
  const ubicacion = useLocation()
  return (
    <GrupoMenu
      etiqueta="Parámetros"
      icono={SlidersHorizontal}
      dentro={ubicacion.pathname.startsWith('/admin/parametros')}
    >
      {PARAMETROS.map((entrada) => (
        <EntradaMenu key={entrada.a} {...entrada} anidada />
      ))}
    </GrupoMenu>
  )
}

/**
 * El menú del armazón, que **no es «el del administrador»**: este armazón lo
 * montan también pantallas que lleva cualquiera —las notificaciones—, así que
 * quién lo abre decide qué ve. Por orden:
 *
 *   1. el administrador global, el menú completo;
 *   2. una función transversal, solo lo suyo;
 *   3. quien coordina —Accumedical o una compañía—, el MISMO menú que lleva
 *      dentro de su módulo;
 *   4. cualquier otro (un operador abriendo sus notificaciones), solo eso.
 *
 * El orden importa y el último caso todavía más: **el menú completo no puede ser
 * el «si no es ninguno de los anteriores»**. Lo fue, y por eso una coordinadora
 * de compañía que pulsaba la campana acababa viendo Aseguradoras, Prestadores,
 * Red convenio, Parámetros y Configuración. El servidor le habría respondido
 * `403` en todas, pero la puerta no debería ni pintarse.
 */
function Navegacion() {
  const { data: sesion } = useSesion()
  const funcion = sesion?.user.funcion ?? null
  const area = useArea()
  // El catálogo de módulos solo lo abre quien puede verlo entero; pedirlo con
  // cualquier otra sesión sería un 403 seguro, así que va bajo bandera.
  const { data: catalogo } = useModulos(sesion?.user.es_admin_global ?? false)

  const suyas = funcion ? ENTRADAS_POR_FUNCION[funcion] : undefined
  if (suyas) {
    return (
      <nav aria-label="Navegación principal" className="flex flex-col gap-0.5">
        {ENTRADAS.filter((e) => suyas.has(e.a)).map((entrada) => (
          <EntradaMenu key={entrada.a} {...entrada} />
        ))}
        {suyas.has('/admin/parametros') && <GrupoParametros />}
      </nav>
    )
  }

  // Quien coordina llega con el suyo, sea de una familia o de una compañía: es
  // el mismo componente que usa dentro de su módulo, no una copia.
  if (esCoordinador(sesion)) return <NavegacionCoordinador />

  if (!sesion?.user.es_admin_global) {
    // Personal de una compañía o auditor de plataforma: aquí solo entra a sus
    // notificaciones, y es lo único que se le enseña.
    return (
      <nav aria-label="Navegación principal" className="flex flex-col gap-0.5">
        <EntradaMenu a={`${area}/notificaciones`} etiqueta="Notificaciones" icono={Bell} />
      </nav>
    )
  }

  return (
    <nav aria-label="Navegación principal" className="flex flex-col gap-0.5">
      {ENTRADAS.map((entrada) => (
        <EntradaMenu key={entrada.a} {...entrada} />
      ))}

      {/* Mientras el catálogo no llegue no hay grupo: un «Auditorías» vacío
          que se despliega en nada se lee como algo roto. */}
      {catalogo && catalogo.length > 0 && <GrupoAuditorias modulos={catalogo} />}

      <GrupoParametros />

      <EntradaMenu a="/admin/usuarios" etiqueta="Usuarios" icono={Users} />
      <EntradaMenu a="/admin/notificaciones" etiqueta="Notificaciones" icono={Bell} />
      <EntradaMenu a="/admin/configuracion" etiqueta="Configuración" icono={Settings} />
    </nav>
  )
}

export function AppShell() {
  const { data: sesion } = useSesion()
  const navegar = useNavigate()
  const queryClient = useQueryClient()

  const salir = useMutation({
    mutationFn: cerrarSesion,
    onSettled: () => {
      queryClient.clear()
      navegar('/login', { replace: true })
    },
  })

  return (
    <ArmazonLateral
      nav={<Navegacion />}
      topbarDerecha={
        <>
          <span className="hidden max-w-[16rem] truncate text-sm text-tenue-fg sm:inline">
            {sesion?.user.email}
          </span>
          <BotonNotificaciones />
          <BotonTema />
          <Boton
            variante="contorno"
            tamano="sm"
            onClick={() => salir.mutate()}
            cargando={salir.isPending}
          >
            <LogOut aria-hidden="true" />
            <span className="hidden sm:inline">Salir</span>
          </Boton>
        </>
      }
    >
      <Outlet />
    </ArmazonLateral>
  )
}
