import { Navigate, createBrowserRouter, useLocation } from 'react-router-dom'

import { rutasConcurrencia } from '@concurrencia/routes'
import { RequireModule } from '@/core/auth/RequireModule'
import { RequireSession } from '@/core/auth/RequireSession'
import { IrAOtraApp } from '@/core/IrAOtraApp'
import { ModuloShell } from '@/core/layout/ModuloShell'
import { ErrorPage } from '@/core/pages/ErrorPage'

/**
 * Las rutas de la app de Concurrencia, en la RAÍZ de la app (D48): en su
 * subdominio la dirección es `concurrencia.pymes.ec/dashboard`, sin repetir
 * «concurrencia» (pedido del usuario). En local, sin subdominios, Vite la sirve
 * bajo `/concurrencia/` y el router lo toma como `basename`.
 *
 * Dos puertas más:
 *   · `/concurrencia/…` — la dirección LÓGICA con la que la plataforma nombra
 *     un caso (avisos guardados, enlaces viejos): se le quita el prefijo.
 *   · las rutas de admin (login, administración, coordinación…) y cualquier
 *     otra que no sea de aquí: se cargan en su app (`IrAOtraApp`).
 */
const BASE = import.meta.env.BASE_URL.replace(/\/$/, '')

function QuitarPrefijo() {
  const { pathname, search, hash } = useLocation()
  const ruta = pathname.replace(/^\/concurrencia(?=\/|$)/, '') || '/'
  return <Navigate to={`${ruta}${search}${hash}`} replace />
}

const DE_OTRA_APP = ['/login', '/definir-password', '/admin/*', '/coordinacion/*',
  '/seleccionar-modulo', '/sin-accesos']

export const router = createBrowserRouter(
  [
    {
      path: '/',
      element: (
        <RequireSession>
          <RequireModule slug="concurrencia">
            <ModuloShell slug="concurrencia" raiz="" />
          </RequireModule>
        </RequireSession>
      ),
      errorElement: <ErrorPage />,
      children: rutasConcurrencia,
    },
    { path: '/concurrencia/*', element: <QuitarPrefijo /> },
    // Estáticas: ganan al `:id` de las visitas, que si no se tragaría `/login`.
    ...DE_OTRA_APP.map((path) => ({ path, element: <IrAOtraApp /> })),
    { path: '*', element: <IrAOtraApp /> },
  ],
  { basename: BASE || undefined },
)
