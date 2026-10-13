import { Building2, Handshake, Hospital, SlidersHorizontal } from 'lucide-react'
import { Navigate, createBrowserRouter, useLocation } from 'react-router-dom'

import { ProveedorApp } from '@/core/app/contexto'
import { RequireSession } from '@/core/auth/RequireSession'
import { IrAlLogin } from '@/core/IrAlLogin'
import { IrAOtraApp } from '@/core/IrAOtraApp'
import { ArmazonApp, SoloFuncion } from '@/core/layout/ArmazonApp'
import { ErrorPage } from '@/core/pages/ErrorPage'
import { AseguradoraFormPage } from '@/shared/aseguradoras/pages/AseguradoraFormPage'
import { AseguradorasPage } from '@/shared/aseguradoras/pages/AseguradorasPage'
import { RedConvenioMapaPage } from '@/shared/aseguradoras/pages/RedConvenioMapaPage'
import { RedConvenioPage } from '@/shared/aseguradoras/pages/RedConvenioPage'
import { TiposPrestadorPage } from '@/shared/parametros/pages/TiposPrestadorPage'
import { PrestadoresMapaPage } from '@/shared/prestadores/pages/PrestadoresMapaPage'
import { PrestadoresPage } from '@/shared/prestadores/pages/PrestadoresPage'
import { PrestadorFormPage } from '@/shared/prestadores/pages/PrestadorFormPage'

/**
 * La app CONVENIOS (convenios.pymes.ec, D50): atar los convenios. Separada de
 * admin como Concurrencia: sus rutas en la raíz, su menú, y las pantallas de
 * siempre (las de `@/shared`) con `alcance: 'convenios'` —de cada aseguradora
 * solo su red—. Entra quien lleva la función Convenio y el administrador.
 */
const BASE = import.meta.env.BASE_URL.replace(/\/$/, '')

function QuitarPrefijo() {
  const { pathname, search, hash } = useLocation()
  const ruta = pathname.replace(/^\/convenios(?=\/|$)/, '') || '/'
  return <Navigate to={`${ruta}${search}${hash}`} replace />
}

const DE_OTRA_APP = ['/definir-password', '/admin/*', '/coordinacion/*', '/seleccionar-modulo',
  '/sin-accesos', '/concurrencia/*', '/pacientes/*', '/contabilidad/*']

export const router = createBrowserRouter(
  [
    {
      path: '/',
      element: (
        <ProveedorApp value={{ raiz: '', alcance: 'convenios' }}>
          <RequireSession>
            <SoloFuncion funcion="convenio" nombre="Convenios">
              <ArmazonApp
                titulo="Convenios"
                subtitulo="Red de prestadores de cada aseguradora"
                icono={Handshake}
                entradas={[
                  { a: '/dashboard', etiqueta: 'Aseguradoras', icono: Building2, fin: true },
                  { a: '/red-convenio', etiqueta: 'Red convenio Accumedical', icono: Handshake },
                  { a: '/prestadores', etiqueta: 'Prestadores', icono: Hospital },
                  { a: '/parametros/tipos-prestador', etiqueta: 'Tipos de prestador', icono: SlidersHorizontal },
                ]}
              />
            </SoloFuncion>
          </RequireSession>
        </ProveedorApp>
      ),
      errorElement: <ErrorPage />,
      children: [
        { index: true, element: <Navigate to="dashboard" replace /> },
        // La portada: las aseguradoras, para entrar a la red de cada una.
        { path: 'dashboard', element: <AseguradorasPage /> },
        { path: 'aseguradoras', element: <Navigate to="/dashboard" replace /> },
        { path: 'aseguradoras/:id/editar', element: <AseguradoraFormPage /> },
        { path: 'red-convenio', element: <RedConvenioPage /> },
        { path: 'red-convenio/mapa', element: <RedConvenioMapaPage /> },
        { path: 'prestadores', element: <PrestadoresPage /> },
        { path: 'prestadores/mapa', element: <PrestadoresMapaPage /> },
        { path: 'prestadores/nuevo', element: <PrestadorFormPage /> },
        { path: 'prestadores/:id/editar', element: <PrestadorFormPage /> },
        { path: 'parametros', element: <Navigate to="/parametros/tipos-prestador" replace /> },
        { path: 'parametros/tipos-prestador', element: <TiposPrestadorPage /> },
      ],
    },
    { path: '/convenios/*', element: <QuitarPrefijo /> },
    { path: '/login', element: <IrAlLogin /> },
    ...DE_OTRA_APP.map((path) => ({ path, element: <IrAOtraApp /> })),
    { path: '*', element: <IrAOtraApp /> },
  ],
  { basename: BASE || undefined },
)
