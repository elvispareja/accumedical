import { Navigate, createBrowserRouter, useLocation } from 'react-router-dom'

import { Armazon, SoloAccumedical } from '@pacientes/Armazon'
import { FichaPage } from '@pacientes/pages/FichaPage'
import { ListaPage } from '@pacientes/pages/ListaPage'
import { RequireSession } from '@/core/auth/RequireSession'
import { IrAOtraApp } from '@/core/IrAOtraApp'
import { ErrorPage } from '@/core/pages/ErrorPage'
import { LoginPage } from '@/core/pages/LoginPage'

/**
 * La app Pacientes en la RAÍZ de su subdominio (pacientes.pymes.ec/dashboard,
 * D48/D49). Las mismas puertas que Concurrencia: `/pacientes/*` (dirección
 * lógica de la plataforma) quita el prefijo; admin y lo demás → su app.
 */
const BASE = import.meta.env.BASE_URL.replace(/\/$/, '')

function QuitarPrefijo() {
  const { pathname, search, hash } = useLocation()
  const ruta = pathname.replace(/^\/pacientes(?=\/|$)/, '') || '/'
  return <Navigate to={`${ruta}${search}${hash}`} replace />
}

const DE_OTRA_APP = ['/definir-password', '/admin/*', '/coordinacion/*',
  '/seleccionar-modulo', '/sin-accesos', '/concurrencia/*', '/convenios/*', '/contabilidad/*']

export const router = createBrowserRouter(
  [
    {
      path: '/',
      element: (
        <RequireSession>
          <SoloAccumedical>
            <Armazon />
          </SoloAccumedical>
        </RequireSession>
      ),
      errorElement: <ErrorPage />,
      children: [
        { index: true, element: <Navigate to="dashboard" replace /> },
        { path: 'dashboard', element: <ListaPage /> },
        { path: ':id', element: <FichaPage /> },
      ],
    },
    { path: '/pacientes/*', element: <QuitarPrefijo /> },
    // Su propio login (D51): pacientes.pymes.ec/login.
    { path: '/login', element: <LoginPage app="Pacientes" />, errorElement: <ErrorPage /> },
    ...DE_OTRA_APP.map((path) => ({ path, element: <IrAOtraApp /> })),
    { path: '*', element: <IrAOtraApp /> },
  ],
  { basename: BASE || undefined },
)
