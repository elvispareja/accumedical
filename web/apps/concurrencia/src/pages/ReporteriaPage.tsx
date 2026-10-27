import { BarChart3 } from 'lucide-react'

import { useSesion } from '@/core/auth/useSesion'

/**
 * **Reportería de Concurrencia** (pedido del usuario, 27/10/2026): la portada
 * del dashboard de reportes del coordinador de Accumedical. Por ahora es solo
 * la página de inicio; los reportes los irá definiendo el usuario («ya te diré
 * cómo hacerlo»).
 *
 * El menú solo la ofrece al coordinador de plataforma; si otro rol llega por
 * la dirección, se le dice que no es para él. La autorización real de cada
 * reporte la pondrá el backend, como en todo el módulo.
 */
export function ReporteriaPage() {
  const { data: sesion } = useSesion()
  if (!sesion) return null

  const rol = sesion.modulos.find((m) => m.codigo === 'concurrencia')?.rol
  const esCoordinador = !sesion.aseguradora && rol === 'supervisor'

  if (!esCoordinador) {
    return (
      <div className="mx-auto max-w-md px-6 py-20 text-center">
        <p className="font-display text-sm font-medium">Esta sección no está disponible</p>
        <p className="mt-1 text-sm text-tenue-fg">
          La reportería es de la coordinación de Accumedical.
        </p>
      </div>
    )
  }

  return (
    <div>
      <header>
        <p className="font-display text-[0.6875rem] font-semibold uppercase tracking-[0.16em] text-tenue-fg">
          Concurrencia · Reportería
        </p>
        <h1 className="mt-1.5 font-display text-2xl font-semibold tracking-tight">Reportería</h1>
        <p className="mt-1 text-sm text-tenue-fg">
          Los reportes de las visitas de todas las aseguradoras.
        </p>
      </header>

      <div className="mt-7 rounded-md border border-dashed border-borde bg-superficie px-6 py-16 text-center">
        <span className="mx-auto grid size-12 place-items-center rounded-md bg-marca-suave">
          <BarChart3 className="size-6 text-marca" aria-hidden="true" />
        </span>
        <p className="mt-4 font-display text-sm font-medium">Todavía no hay reportes</p>
        <p className="mx-auto mt-1 max-w-sm text-sm text-tenue-fg">
          Aquí irán los reportes de Concurrencia a medida que los definamos.
        </p>
      </div>
    </div>
  )
}
