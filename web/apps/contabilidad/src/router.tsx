import { Building2, Calculator, Map } from 'lucide-react'
import { Navigate, createBrowserRouter, useLocation } from 'react-router-dom'

import { ProveedorApp } from '@/core/app/contexto'
import { RequireSession } from '@/core/auth/RequireSession'
import { IrAOtraApp } from '@/core/IrAOtraApp'
import { ArmazonApp, SoloFuncion } from '@/core/layout/ArmazonApp'
import { ErrorPage } from '@/core/pages/ErrorPage'
import { LoginPage } from '@/core/pages/LoginPage'
import { AseguradoraFormPage } from '@/shared/aseguradoras/pages/AseguradoraFormPage'
import { AseguradorasMapaPage } from '@/shared/aseguradoras/pages/AseguradorasMapaPage'
import { AseguradorasPage } from '@/shared/aseguradoras/pages/AseguradorasPage'

/**
 * La app CONTABILIDAD (contabilidad.pymes.ec, D50): dar de alta aseguradoras y
 * llevar su ficha. Separada de admin como Concurrencia, con las pantallas de
 * siempre (`@/shared`) y `alcance: 'contabilidad'` —la ficha entera menos la
 * red, que es de Convenios—. Entra quien lleva la función Contabilidad y el
 * administrador.
 */
const BASE = import.meta.env.BASE_URL.replace(/\/$/, '')

function QuitarPrefijo() {
  const { pathname, search, hash } = useLocation()
  const ruta = pathname.replace(/^\/contabilidad(?=\/|$)/, '') || '/'
  return <Navigate to={`${ruta}${search}${hash}`} replace />
}

const DE_OTRA_APP = ['/definir-password', '/admin/*', '/coordinacion/*', '/seleccionar-modulo',
  '/sin-accesos', '/concurrencia/*', '/pacientes/*', '/convenios/*']

export const router = createBrowserRouter(
  [
    {
      path: '/',
      element: (
        <ProveedorApp value={{ raiz: '', alcance: 'contabilidad' }}>
          <RequireSession>
            <SoloFuncion funcion="contabilidad" nombre="Contabilidad">
              <ArmazonApp
                titulo="Contabilidad"
                subtitulo="Alta y ficha de las aseguradoras"
                icono={Calculator}
                entradas={[
                  { a: '/dashboard', etiqueta: 'Aseguradoras', icono: Building2, fin: true },
                  { a: '/aseguradoras/mapa', etiqueta: 'Mapa de aseguradoras', icono: Map },
                ]}
              />
            </SoloFuncion>
          </RequireSession>
        </ProveedorApp>
      ),
      errorElement: <ErrorPage />,
      children: [
        { index: true, element: <Navigate to="dashboard" replace /> },
        { path: 'dashboard', element: <AseguradorasPage /> },
        { path: 'aseguradoras', element: <Navigate to="/dashboard" replace /> },
        { path: 'aseguradoras/mapa', element: <AseguradorasMapaPage /> },
        { path: 'aseguradoras/nueva', element: <AseguradoraFormPage /> },
        { path: 'aseguradoras/:id/editar', element: <AseguradoraFormPage /> },
      ],
    },
    { path: '/contabilidad/*', element: <QuitarPrefijo /> },
    // Su propio login (D51): contabilidad.pymes.ec/login.
    { path: '/login', element: <LoginPage app="Contabilidad" />, errorElement: <ErrorPage /> },
    ...DE_OTRA_APP.map((path) => ({ path, element: <IrAOtraApp /> })),
    { path: '*', element: <IrAOtraApp /> },
  ],
  { basename: BASE || undefined },
)
