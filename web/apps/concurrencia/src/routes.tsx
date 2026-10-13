import { Navigate, type RouteObject } from 'react-router-dom'

import { BandejaPage } from '@concurrencia/pages/BandejaPage'
import { CasoSupervisionPage } from '@concurrencia/pages/CasoSupervisionPage'
import { PortadaPage } from '@concurrencia/pages/PortadaPage'
import { VisitaFormPage } from '@concurrencia/pages/VisitaFormPage'
import { NotificacionesDelModulo } from '@/core/notificaciones/pages/NotificacionesDelModulo'

/**
 * El módulo expone sus rutas y el router raíz solo las compone. Cuelgan del
 * armazón de módulo, que ya resuelve el acento, el rol y el cambio de módulo.
 * La portada elige qué pintar según quién entra: el panel del supervisor de
 * compañía, la bandeja de compañía o la supervisión de plataforma. `bandeja`
 * existe con ruta propia para que el supervisor llegue a la lista completa
 * desde su panel.
 */
export const rutasConcurrencia: RouteObject[] = [
  // La portada vive en /concurrencia/dashboard (pedido del usuario); la raíz lleva allí.
  { index: true, element: <Navigate to="dashboard" replace /> },
  { path: 'dashboard', element: <PortadaPage /> },
  { path: 'bandeja', element: <BandejaPage /> },
  // Sus avisos, dentro de la app (D47). Antes que `:id`, que se lo tragaría.
  { path: 'notificaciones', element: <NotificacionesDelModulo /> },
  { path: 'nueva', element: <VisitaFormPage /> },
  // El alta del coordinador de plataforma: primero la aseguradora, luego el
  // mismo formulario. El backend igual exige rol supervisor de plataforma.
  { path: 'programar', element: <VisitaFormPage supervision /> },
  // El caso visto desde la supervisión, como página. VA ANTES de `:id`: ese
  // segmento dinámico se tragaría «supervision», y el coordinador acabaría en la
  // ficha de la compañía, que le responde 403.
  { path: 'supervision/:id', element: <CasoSupervisionPage /> },
  // Ver es la MISMA pantalla, con todo deshabilitado: el expediente se enseña
  // con las casillas con las que se capturó. Va antes que `:id` por claridad;
  // no chocan, porque son un segmento y dos.
  { path: ':id/ver', element: <VisitaFormPage vista /> },
  { path: ':id', element: <VisitaFormPage /> },
]
