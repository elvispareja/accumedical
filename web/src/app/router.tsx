import { createBrowserRouter, Navigate } from 'react-router-dom'

import { BandejaEntradaPage } from '@/app/bandeja/BandejaEntradaPage'
import { PacienteDetallePage } from '@/app/pacientes/PacienteDetallePage'
import { PacientesPage } from '@/app/pacientes/PacientesPage'
import { RequireModule } from '@/core/auth/RequireModule'
import { RequireSession } from '@/core/auth/RequireSession'
import { AppShell } from '@/core/layout/AppShell'
import { ModuloShell } from '@/core/layout/ModuloShell'
import { NotificacionesPage } from '@/core/notificaciones/pages/NotificacionesPage'
import { AuditoriaPendientePage } from '@/core/pages/AuditoriaPendientePage'
import { ErrorPage } from '@/core/pages/ErrorPage'
import { DefinirPasswordPage } from '@/core/pages/DefinirPasswordPage'
import { LoginPage } from '@/core/pages/LoginPage'
import { SeleccionarModuloPage } from '@/core/pages/SeleccionarModuloPage'
import { ModuloPendientePage } from '@/core/pages/ModuloPendientePage'
import { SinAccesosPage } from '@/core/pages/SinAccesosPage'
import { rutasConcurrencia } from '@/modules/concurrencia/routes'
import { CasoSupervisionPage } from '@/modules/concurrencia/pages/CasoSupervisionPage'
import { SupervisionPage } from '@/modules/concurrencia/pages/SupervisionPage'
import { VisitaFormPage } from '@/modules/concurrencia/pages/VisitaFormPage'
import { AseguradoraFormPage } from '@/shared/aseguradoras/pages/AseguradoraFormPage'
import { ConfiguracionPage } from '@/shared/configuracion/pages/ConfiguracionPage'
import { AseguradorasPage } from '@/shared/aseguradoras/pages/AseguradorasPage'
import { AseguradorasMapaPage } from '@/shared/aseguradoras/pages/AseguradorasMapaPage'
import { RedConvenioMapaPage } from '@/shared/aseguradoras/pages/RedConvenioMapaPage'
import { RedConvenioPage } from '@/shared/aseguradoras/pages/RedConvenioPage'
import { PrestadorFormPage } from '@/shared/prestadores/pages/PrestadorFormPage'
import { PrestadoresMapaPage } from '@/shared/prestadores/pages/PrestadoresMapaPage'
import { PrestadoresPage } from '@/shared/prestadores/pages/PrestadoresPage'
import { TiposPrestadorPage } from '@/shared/parametros/pages/TiposPrestadorPage'
import { UsuarioFormPage } from '@/shared/usuarios/pages/UsuarioFormPage'
import { UsuariosPage } from '@/shared/usuarios/pages/UsuariosPage'

/**
 * Router raíz. El área de administración cuelga de un layout con menú lateral;
 * la selección de módulo, la pantalla de sin accesos y las rutas de cada módulo
 * entran cuando toque.
 */
export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage />, errorElement: <ErrorPage /> },
  // Pública: quien llega desde la invitación todavía no tiene contraseña,
  // así que no puede haber sesión que comprobar.
  { path: '/definir-password', element: <DefinirPasswordPage />, errorElement: <ErrorPage /> },
  {
    path: '/admin',
    element: (
      <RequireSession>
        <AppShell />
      </RequireSession>
    ),
    // Sin esto, cualquier excepción de renderizado deja al usuario frente al
    // volcado de pila crudo de React Router.
    errorElement: <ErrorPage />,
    children: [
      { index: true, element: <Navigate to="/admin/aseguradoras" replace /> },
      // La bandeja del coordinador vive en SU área; esto es solo la puerta de
      // atrás para un enlace viejo.
      { path: 'bandeja', element: <Navigate to="/coordinacion/bandeja" replace /> },
      { path: 'aseguradoras', element: <AseguradorasPage /> },
      // Las mismas compañías, sobre el mapa: una por domicilio.
      { path: 'aseguradoras/mapa', element: <AseguradorasMapaPage /> },
      { path: 'aseguradoras/nueva', element: <AseguradoraFormPage /> },
      { path: 'aseguradoras/:id/editar', element: <AseguradoraFormPage /> },
      { path: 'prestadores', element: <PrestadoresPage /> },
      // Los mismos prestadores, sobre el mapa: un punto por sitio donde se
      // atiende, provincia y ciudad al lado.
      { path: 'prestadores/mapa', element: <PrestadoresMapaPage /> },
      { path: 'prestadores/nuevo', element: <PrestadorFormPage /> },
      { path: 'prestadores/:id/editar', element: <PrestadorFormPage /> },
      // La red de convenios de Accumedical misma con los prestadores.
      { path: 'red-convenio', element: <RedConvenioPage /> },
      { path: 'red-convenio/mapa', element: <RedConvenioMapaPage /> },
      // Con quién trabaja Accumedical: las personas que registran los casos.
      { path: 'pacientes', element: <PacientesPage /> },
      // Se llamó «Clientes» hasta sep 2026: un enlace guardado sigue llevando.
      { path: 'clientes', element: <Navigate to="/admin/pacientes" replace /> },
      // La persona se identifica por su documento, no por un id: es lo que la
      // identifica en todas las auditorías.
      { path: 'pacientes/:tipo/:numero', element: <PacienteDetallePage /> },
      { path: 'usuarios', element: <UsuariosPage /> },
      { path: 'usuarios/nuevo', element: <UsuarioFormPage /> },
      { path: 'usuarios/:id/editar', element: <UsuarioFormPage /> },
      // Auditorías: el administrador supervisa cada requerimiento con LA MISMA
      // pantalla del supervisor de plataforma; el backend le abre esa puerta.
      { path: 'auditorias', element: <Navigate to="/admin/auditorias/concurrencia" replace /> },
      { path: 'auditorias/concurrencia', element: <SupervisionPage /> },
      // El caso, como página entera y no como diálogo.
      { path: 'auditorias/concurrencia/:id', element: <CasoSupervisionPage /> },
      { path: 'auditorias/concurrencia/programar', element: <VisitaFormPage supervision /> },
      // El resto de requerimientos sale igual en el menú, aunque todavía no
      // tenga panel: la dirección existe y enseña su cartel. Va DESPUÉS de las
      // estáticas —que ganan al segmento dinámico— y no antes.
      { path: 'auditorias/:slug', element: <AuditoriaPendientePage /> },
      // Los catálogos que mantiene la propia gente. Quien crea prestadores
      // tiene que poder nombrar su tipo.
      { path: 'parametros', element: <Navigate to="/admin/parametros/tipos-prestador" replace /> },
      { path: 'parametros/tipos-prestador', element: <TiposPrestadorPage /> },
      // La lista entera de la campana. Sin rol: cada quien ve la suya.
      { path: 'notificaciones', element: <NotificacionesPage /> },
      { path: 'configuracion', element: <ConfiguracionPage /> },
    ],
  },
  // ── El área de quien coordina ────────────────────────────────────────────
  //
  // Las MISMAS pantallas del administrador que también son suyas, montadas bajo
  // su propio prefijo: quien coordina no administra la plataforma, y la
  // dirección no tiene por qué decir lo contrario. No son copias —es el mismo
  // componente— y el prefijo **no autoriza nada**: cada endpoint lo revalida el
  // servidor, así que escribir `/admin` a mano no vuelve administrador a nadie.
  {
    path: '/coordinacion',
    element: (
      <RequireSession>
        <AppShell />
      </RequireSession>
    ),
    errorElement: <ErrorPage />,
    children: [
      { index: true, element: <Navigate to="/coordinacion/bandeja" replace /> },
      // Donde aterriza: los casos de TODAS sus auditorías, juntos.
      { path: 'bandeja', element: <BandejaEntradaPage /> },
      // Sus auditores. El servidor solo le deja crear los de su familia.
      { path: 'usuarios', element: <UsuariosPage /> },
      { path: 'usuarios/nuevo', element: <UsuarioFormPage /> },
      { path: 'usuarios/:id/editar', element: <UsuarioFormPage /> },
      { path: 'notificaciones', element: <NotificacionesPage /> },
    ],
  },
  {
    path: '/seleccionar-modulo',
    element: (
      <RequireSession>
        <SeleccionarModuloPage />
      </RequireSession>
    ),
    errorElement: <ErrorPage />,
  },
  {
    path: '/sin-accesos',
    element: (
      <RequireSession>
        <SinAccesosPage />
      </RequireSession>
    ),
    errorElement: <ErrorPage />,
  },
  // Cada módulo con pantallas propias se monta por su slug y compone SUS rutas.
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
  // El resto va al final: las rutas estáticas de arriba ganan al segmento
  // dinámico. Un slug que no existe y uno sin permiso acaban en el mismo sitio,
  // así que la interfaz tampoco delata qué módulos hay.
  {
    path: '/:slug',
    element: (
      <RequireSession>
        <RequireModule>
          <ModuloShell />
        </RequireModule>
      </RequireSession>
    ),
    errorElement: <ErrorPage />,
    children: [{ index: true, element: <ModuloPendientePage /> }],
  },
  { path: '*', element: <Navigate to="/login" replace /> },
])
