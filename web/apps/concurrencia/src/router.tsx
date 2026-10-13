import { createBrowserRouter } from 'react-router-dom'

import { rutasConcurrencia } from '@concurrencia/routes'
import { RequireModule } from '@/core/auth/RequireModule'
import { RequireSession } from '@/core/auth/RequireSession'
import { GuardaDeDominio } from '@/core/GuardaDeDominio'
import { IrAOtraApp } from '@/core/IrAOtraApp'
import { ModuloShell } from '@/core/layout/ModuloShell'
import { ErrorPage } from '@/core/pages/ErrorPage'

/**
 * Las rutas de la app de Concurrencia: SOLO las del módulo, con el armazón
 * compartido. Todo lo demás (login, admin, coordinación, otros módulos) es de
 * otra app y se carga con navegación completa: con subdominios lo hace
 * `GuardaDeDominio`; en el mismo origen, `IrAOtraApp`.
 */
export const router = createBrowserRouter([
  {
    element: <GuardaDeDominio />,
    children: [
      {
        path: '/concurrencia',
        element: (
          <RequireSession>
            <RequireModule slug="concurrencia">
              <ModuloShell />
            </RequireModule>
          </RequireSession>
        ),
        errorElement: <ErrorPage />,
        children: rutasConcurrencia,
      },
      { path: '*', element: <IrAOtraApp /> },
    ],
  },
])
