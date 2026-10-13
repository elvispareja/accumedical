import { AlertTriangle, RotateCw } from 'lucide-react'
import { isRouteErrorResponse, useNavigate, useRouteError } from 'react-router-dom'

import { Boton } from '@/shared/components/ui/button'

/**
 * Última red de seguridad de la interfaz. Sin ella, cualquier excepción durante
 * el renderizado deja al usuario frente a la pantalla cruda de React Router con
 * un volcado de pila, que no le dice nada y parece que la aplicación murió.
 *
 * En desarrollo sí se muestra el detalle técnico, porque ahí sirve.
 */
export function ErrorPage() {
  const error = useRouteError()
  const navegar = useNavigate()

  const detalle = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : error instanceof Error
      ? error.message
      : null

  return (
    <div className="grid min-h-dvh place-items-center bg-fondo px-6">
      <div className="w-full max-w-md text-center">
        <div className="mx-auto grid size-11 place-items-center rounded-full border border-peligro/30 bg-peligro-suave">
          <AlertTriangle className="size-5 text-peligro" aria-hidden="true" />
        </div>

        <h1 className="mt-4 font-display text-xl font-semibold tracking-tight">
          Algo se rompió en esta pantalla
        </h1>
        <p className="mx-auto mt-2 max-w-sm text-sm text-tenue-fg">
          No perdiste nada de lo que ya estaba guardado. Recargar suele bastar; si vuelve a pasar,
          avísanos con lo que estabas haciendo.
        </p>

        {import.meta.env.DEV && detalle && (
          <pre className="mt-5 overflow-x-auto rounded-md border border-borde bg-superficie-hundida p-3 text-left font-mono text-xs text-tenue-fg">
            {detalle}
          </pre>
        )}

        <div className="mt-6 flex justify-center gap-2">
          <Boton onClick={() => window.location.reload()}>
            <RotateCw aria-hidden="true" />
            Recargar
          </Boton>
          <Boton variante="contorno" onClick={() => navegar('/admin')}>
            Ir al inicio
          </Boton>
        </div>
      </div>
    </div>
  )
}
