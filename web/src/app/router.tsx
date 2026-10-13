import { createBrowserRouter, Navigate } from 'react-router-dom'

import { BandejaEntradaPage } from '@/app/bandeja/BandejaEntradaPage'
import { RequireModule } from '@/core/auth/RequireModule'
import { GuardaDeDominio } from '@/core/GuardaDeDominio'
import { IrAOtraApp } from '@/core/IrAOtraApp'
import { RequireSession } from '@/core/auth/RequireSession'
import { AppShell } from '@/core/layout/AppShell'
import { ModuloShell } from '@/core/layout/ModuloShell'
import { NotificacionesDelModulo } from '@/core/notificaciones/pages/NotificacionesDelModulo'
import { NotificacionesPage } from '@/core/notificaciones/pages/NotificacionesPage'
import { RedirigirAlModulo } from '@/core/pages/RedirigirAlModulo'
import { ErrorPage } from '@/core/pages/ErrorPage'
import { DefinirPasswordPage } from '@/core/pages/DefinirPasswordPage'
import { LoginPage } from '@/core/pages/LoginPage'
import { SeleccionarModuloPage } from '@/core/pages/SeleccionarModuloPage'
import { ModuloPendientePage } from '@/core/pages/ModuloPendientePage'
import { SinAccesosPage } from '@/core/pages/SinAccesosPage'
import { ConfiguracionPage } from '@/shared/configuracion/pages/ConfiguracionPage'
import { UsuarioFormPage } from '@/shared/usuarios/pages/UsuarioFormPage'
import { UsuariosPage } from '@/shared/usuarios/pages/UsuariosPage'

/**
 * Router raíz. El área de administración cuelga de un layout con menú lateral;
 * la selección de módulo, la pantalla de sin accesos y las rutas de cada módulo
 * entran cuando toque.
 */
export const router = createBrowserRouter([
  {
    // Reparte las rutas entre admin.pymes.ec y el dominio de cada módulo.
    element: <GuardaDeDominio />,
    children: [
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
          // Contabilidad y Convenios tienen su PROPIA app (D50): estas direcciones
          // solo llevan allá (enlaces guardados, avisos viejos).
          { path: 'aseguradoras', element: <Navigate to="/contabilidad/dashboard" replace /> },
          { path: 'aseguradoras/mapa', element: <Navigate to="/contabilidad/aseguradoras/mapa" replace /> },
          { path: 'aseguradoras/nueva', element: <Navigate to="/contabilidad/aseguradoras/nueva" replace /> },
          { path: 'aseguradoras/:id/editar', element: <RedirigirAlModulo a="/contabilidad/aseguradoras/:id/editar" /> },
          { path: 'prestadores', element: <Navigate to="/convenios/prestadores" replace /> },
          { path: 'prestadores/mapa', element: <Navigate to="/convenios/prestadores/mapa" replace /> },
          { path: 'prestadores/nuevo', element: <Navigate to="/convenios/prestadores/nuevo" replace /> },
          { path: 'prestadores/:id/editar', element: <RedirigirAlModulo a="/convenios/prestadores/:id/editar" /> },
          { path: 'red-convenio', element: <Navigate to="/convenios/red-convenio" replace /> },
          { path: 'red-convenio/mapa', element: <Navigate to="/convenios/red-convenio/mapa" replace /> },
          // Los pacientes viven en su propia app, pacientes.pymes.ec (D49): estas
          // direcciones solo llevan allá, para no romper enlaces guardados.
          { path: 'pacientes', element: <Navigate to="/pacientes/dashboard" replace /> },
          { path: 'clientes', element: <Navigate to="/pacientes/dashboard" replace /> },
          { path: 'pacientes/:tipo/:numero', element: <Navigate to="/pacientes/dashboard" replace /> },
          { path: 'usuarios', element: <UsuariosPage /> },
          { path: 'usuarios/nuevo', element: <UsuarioFormPage /> },
          { path: 'usuarios/:id/editar', element: <UsuarioFormPage /> },
          // Auditorías (D45): el administrador entra a CADA módulo como coordinador
          // de plataforma, en el subdominio y con las pantallas del módulo. Estas
          // direcciones ya no tienen pantalla propia: solo llevan a la del módulo,
          // para que los enlaces y avisos guardados sigan funcionando.
          { path: 'auditorias', element: <Navigate to="/concurrencia" replace /> },
          { path: 'auditorias/concurrencia', element: <Navigate to="/concurrencia" replace /> },
          {
            path: 'auditorias/concurrencia/programar',
            element: <Navigate to="/concurrencia/programar" replace />,
          },
          { path: 'auditorias/concurrencia/:id', element: <RedirigirAlModulo a="/concurrencia/supervision/:id" /> },
          { path: 'auditorias/:slug', element: <RedirigirAlModulo a="/:slug" /> },
          // Los catálogos que mantiene la propia gente. Quien crea prestadores
          // tiene que poder nombrar su tipo.
          { path: 'parametros', element: <Navigate to="/convenios/parametros/tipos-prestador" replace /> },
          { path: 'parametros/tipos-prestador', element: <Navigate to="/convenios/parametros/tipos-prestador" replace /> },
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
      // Los módulos con FRONTEND PROPIO (su app, su diseño) no se montan aquí:
      // `/concurrencia/…` lo sirve `apps/concurrencia` (nginx lo enruta allá).
      // Si una navegación interna llega a esa ruta, se salta con recarga completa.
      { path: '/concurrencia/*', element: <IrAOtraApp /> },
      { path: '/pacientes/*', element: <IrAOtraApp /> },
      { path: '/convenios/*', element: <IrAOtraApp /> },
      { path: '/contabilidad/*', element: <IrAOtraApp /> },
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
        children: [
          // Misma forma que los módulos con app propia: la portada en /<slug>/dashboard.
          { index: true, element: <Navigate to="dashboard" replace /> },
          { path: 'dashboard', element: <ModuloPendientePage /> },
          { path: 'notificaciones', element: <NotificacionesDelModulo /> },
        ],
      },
      { path: '*', element: <Navigate to="/login" replace /> },
    ],
  },
])
