import { Inbox, Search } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Navigate } from 'react-router-dom'

import { coordinaDesdePlataforma } from '@/core/auth/area'
import { identidadDe } from '@/core/modulos/identidad'
import { useSesion } from '@/core/auth/useSesion'
import { CasosDeConcurrencia, CuadroDeConcurrencia } from '@concurrencia/integracion'
import { CuadroAuditoria } from '@/shared/components/CuadroAuditoria'
import type { PropsCasosAuditoria, PropsCuadroAuditoria } from '@/shared/components/bandeja'
import { Input } from '@/shared/components/ui/input'

/**
 * La bandeja de entrada del coordinador: **todos los casos de todas sus
 * auditorías**, en una sola pantalla, sin tener que entrar módulo por módulo.
 *
 * Arriba, un cuadro por auditoría con cuántos casos tiene, que es **el atajo a
 * la bandeja de esa auditoría** (`/concurrencia`, y lo que venga). Debajo, todos
 * los casos juntos: el vistazo de quien coordina varias a la vez.
 *
 * Vive en `app/` —la raíz que compone— y no en `core/`, a propósito: para
 * juntarlos hay que importar de cada módulo, y `core` no puede depender de un
 * módulo (regla dura de arquitectura). `app/` sí: es justo donde ya se componen
 * las rutas de cada uno.
 *
 * **Todas las auditorías se leen igual**: código, aseguradora, prestador, cuándo
 * y estado, y nada más. Cada expediente es distinto —una visita no se parece a
 * un reembolso—, así que lo propio de cada uno vive en su página, a la que lleva
 * la fila; aquí solo está lo que comparten, que es lo que permite mirarlas
 * juntas sin aprenderse ocho tablas.
 *
 * **Arriba salen TODAS sus auditorías**, tengan expediente construido o no: la
 * que todavía no lo tiene sale con su cuadro en construcción y lleva igual a su
 * módulo, donde le espera el cartel. Así el coordinador ve desde el primer día
 * el alcance de lo suyo, y el día que una se construya no cambia de sitio: se
 * le enciende el número.
 *
 * Añadir el EXPEDIENTE de un módulo a esta bandeja es **una entrada más en esta
 * lista** y su adaptador (`modules/<slug>/bandeja.tsx`), que aporta dos piezas:
 * el número de su cuadro y sus casos ya traducidos. Hoy solo Concurrencia lo
 * tiene; los demás entran aquí cuando lo tengan.
 */
const SECCIONES: {
  codigo: string
  Cuadro: (props: PropsCuadroAuditoria) => JSX.Element
  Casos: (props: PropsCasosAuditoria) => JSX.Element
}[] = [{ codigo: 'concurrencia', Cuadro: CuadroDeConcurrencia, Casos: CasosDeConcurrencia }]

export function BandejaEntradaPage() {
  const { data: sesion } = useSesion()

  // Juntar los casos de varias auditorías es de quien coordina DESDE
  // PLATAFORMA. El coordinador de una compañía tiene el mismo menú, pero no
  // esta pantalla: su sitio es su módulo. El servidor diría lo mismo con un
  // 403 por cada lista; mejor no traerlo aquí. Mientras la sesión no llega no
  // se decide nada, o se echaría al que sí puede.
  if (sesion && !coordinaDesdePlataforma(sesion)) {
    const unico = sesion.modulos.length === 1 ? sesion.modulos[0] : undefined
    return <Navigate to={unico ? `/${unico.slug}` : '/seleccionar-modulo'} replace />
  }

  // Las auditorías de esta persona, de la A a la Z, como cuelgan de su menú. Es
  // presentación, no autorización: cada lista la sirve el backend acotada por
  // su cuenta.
  const misAuditorias = [...(sesion?.modulos ?? [])].sort((a, b) =>
    a.nombre.localeCompare(b.nombre, 'es'),
  )
  const expedienteDe = (codigo: string) => SECCIONES.find((s) => s.codigo === codigo)
  const conExpediente = misAuditorias.filter((m) => expedienteDe(m.codigo))

  // Los filtros son de la BANDEJA, no de ninguna auditoría: se escriben una vez
  // arriba y cada una los traduce a lo suyo. Sin estado, que no lo comparten
  // (`shared/components/bandeja.ts`).
  const [busqueda, setBusqueda] = useState('')
  const [busquedaAplicada, setBusquedaAplicada] = useState('')
  const [desde, setDesde] = useState('')
  const [hasta, setHasta] = useState('')

  useEffect(() => {
    const id = window.setTimeout(() => setBusquedaAplicada(busqueda), 300)
    return () => window.clearTimeout(id)
  }, [busqueda])

  const filtros = useMemo(
    () => ({
      search: busquedaAplicada || undefined,
      desde: desde || undefined,
      hasta: hasta || undefined,
    }),
    [busquedaAplicada, desde, hasta],
  )
  const hayFiltros = Boolean(filtros.search || filtros.desde || filtros.hasta)

  function limpiar() {
    setBusqueda('')
    setBusquedaAplicada('')
    setDesde('')
    setHasta('')
  }

  return (
    <div className="w-full">
      <header>
        <p className="font-display text-[0.6875rem] font-semibold uppercase tracking-[0.16em] text-tenue-fg">
          Coordinación
        </p>
        <h1 className="mt-1.5 font-display text-2xl font-semibold tracking-tight">
          Bandeja de entrada
        </h1>
        <p className="mt-1 text-sm text-tenue-fg">
          Todos los casos de tus auditorías, juntos. Cada cuadro abre la bandeja de la suya.
        </p>
      </header>

      {misAuditorias.length === 0 ? (
        <div className="mt-7 rounded-md border border-borde bg-superficie px-6 py-16 text-center">
          <Inbox className="mx-auto size-6 text-tenue-fg" aria-hidden="true" />
          <p className="mt-3 font-display text-sm font-medium">Todavía no coordinas ninguna auditoría</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-tenue-fg">
            En cuanto te asignen una, aparecerá aquí con sus casos.
          </p>
        </div>
      ) : (
        <>
          {/* ── Un cuadro por auditoría, TODAS las suyas: el atajo a la bandeja
              de cada una, y el sitio que ya espera a las que faltan ── */}
          <div className="mt-7 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {misAuditorias.map((m, indice) => {
              const identidad = identidadDe(m.codigo)
              const comun = {
                indice,
                nombre: m.nombre,
                icono: identidad.Icono,
                acento: {
                  suave: identidad.suave,
                  texto: identidad.texto,
                  borde: identidad.borde,
                },
                a: `/${m.slug}`,
              }
              const expediente = expedienteDe(m.codigo)
              if (!expediente) return <CuadroAuditoria key={m.codigo} {...comun} enConstruccion />
              return <expediente.Cuadro key={m.codigo} {...comun} filtros={filtros} />
            })}
          </div>

          {/* ── Los filtros, bajo los cuadros, como en el panel de cada
              auditoría. Los cuadros también los obedecen: cada uno encabeza su
              propia lista y cuenta lo que hay en ella ── */}
          <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_10.5rem_10.5rem]">
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-tenue-fg"
                aria-hidden="true"
              />
              <Input
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                placeholder="Buscar por aseguradora, prestador o código"
                aria-label="Buscar casos"
                mayusculas={false}
                className="pl-9"
              />
            </div>
            <Input
              type="date"
              value={desde}
              onChange={(e) => setDesde(e.target.value)}
              aria-label="Desde esta fecha"
            />
            <Input
              type="date"
              value={hasta}
              min={desde || undefined}
              onChange={(e) => setHasta(e.target.value)}
              aria-label="Hasta esta fecha"
            />
          </div>

          {hayFiltros && (
            <div className="mt-3 flex justify-end">
              <button
                type="button"
                onClick={limpiar}
                className="text-sm font-medium text-marca transition-opacity duration-150 hover:opacity-80"
              >
                Quitar filtros
              </button>
            </div>
          )}

          {/* Sin rótulo encima de cada lista: el cuadro de arriba ya dice de
              qué auditoría es y lleva a la suya. Repetirlo debajo era decir dos
              veces lo mismo. El nombre sigue accesible en el `aria-label` de la
              sección, para quien no ve la pantalla. */}
          {conExpediente.map((m, indice) => {
            const { Casos } = expedienteDe(m.codigo)!
            return (
              <section
                key={m.codigo}
                className={indice === 0 ? 'mt-5' : 'mt-7'}
                aria-label={m.nombre}
              >
                <Casos filtros={filtros} />
              </section>
            )
          })}

          {conExpediente.length === 0 && (
            <p className="mt-7 rounded-md border border-dashed border-borde px-6 py-10 text-center text-sm text-tenue-fg">
              Ninguna de tus auditorías tiene expediente construido todavía. Los casos aparecerán
              aquí en cuanto lo tengan.
            </p>
          )}
        </>
      )}
    </div>
  )
}
