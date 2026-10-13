import { Apple, Play, Smartphone } from 'lucide-react'

import { useSesion } from '@/core/auth/useSesion'
import { BandejaPage } from '@concurrencia/pages/BandejaPage'
import { DashboardPage } from '@concurrencia/pages/DashboardPage'
import { SupervisionPage } from '@concurrencia/pages/SupervisionPage'

/**
 * La portada del módulo depende de quién entra, y lo decide la sesión que
 * calcula el backend —nunca un flag local—:
 *
 * - Supervisor de aseguradora → su panel: cifras y próximas visitas.
 * - Resto del personal de aseguradora → la bandeja de compañía, como siempre.
 * - Supervisor de plataforma → la bandeja global de supervisión.
 * - Auditor de plataforma → todavía no tiene pantalla; se le dice, no se le
 *   deja frente a errores.
 *
 * Esto solo elige qué pintar: la autorización real la ejerce el backend en cada
 * endpoint, y un rol equivocado recibiría 403 aunque forzara la vista.
 */
export function PortadaPage() {
  const { data: sesion } = useSesion()
  if (!sesion) return null

  const rol = sesion.modulos.find((m) => m.codigo === 'concurrencia')?.rol

  if (sesion.aseguradora) {
    return rol === 'supervisor' ? <DashboardPage /> : <BandejaPage />
  }

  if (rol === 'supervisor') return <SupervisionPage />

  // El auditor no trabaja desde el navegador: su herramienta es la app móvil.
  // Los botones de descarga son deliberadamente inertes por ahora —la app aún
  // no está publicada—; el aviso de abajo lo dice para que nadie los machaque.
  return (
    <div className="mx-auto max-w-md px-6 py-20 text-center">
      <span className="mx-auto grid size-12 place-items-center rounded-md bg-marca-suave">
        <Smartphone className="size-6 text-marca" aria-hidden="true" />
      </span>
      <h1 className="mt-4 font-display text-xl font-semibold tracking-tight">
        Tus casos viven en la app móvil
      </h1>
      <p className="mt-2 text-sm text-tenue-fg">
        Concurrencia para auditores se usa desde el celular: ahí te llegan las visitas que el
        supervisor te derive. Descarga la app y entra con esta misma cuenta.
      </p>

      <div className="mt-7 flex flex-col items-center justify-center gap-3 sm:flex-row">
        <button
          type="button"
          className="flex w-56 items-center gap-3 rounded-lg bg-[#1a2448] px-4 py-2.5 text-left text-white transition-opacity duration-150 hover:opacity-90"
          aria-label="Descargar para Android (disponible muy pronto)"
        >
          <Play className="size-6 shrink-0 fill-current" aria-hidden="true" />
          <span className="min-w-0">
            <span className="block text-[0.6875rem] leading-tight opacity-75">Disponible en</span>
            <span className="block font-display text-base font-semibold leading-tight">
              Google Play
            </span>
          </span>
        </button>
        <button
          type="button"
          className="flex w-56 items-center gap-3 rounded-lg bg-[#1a2448] px-4 py-2.5 text-left text-white transition-opacity duration-150 hover:opacity-90"
          aria-label="Descargar para iPhone (disponible muy pronto)"
        >
          <Apple className="size-6 shrink-0 fill-current" aria-hidden="true" />
          <span className="min-w-0">
            <span className="block text-[0.6875rem] leading-tight opacity-75">Descárgala en</span>
            <span className="block font-display text-base font-semibold leading-tight">
              App Store
            </span>
          </span>
        </button>
      </div>

      <p className="mt-4 text-xs text-tenue-fg">Las descargas estarán disponibles muy pronto.</p>
    </div>
  )
}
