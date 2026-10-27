import { BarChart3, Bell, Inbox } from 'lucide-react'

import { EntradaMenu } from '@/core/layout/MenuLateral'

/**
 * El menú lateral DENTRO de un módulo (D47): solo lo del módulo. La lista de
 * todas las auditorías es del panel —admin o coordinación—, no de cada app:
 * cada módulo es su propia aplicación y no un centro que enlaza a los demás.
 *
 *   Bandeja de entrada   ← la portada del módulo (…/dashboard)
 *   Notificaciones       ← solo las de este módulo
 *   Reportería           ← solo para quien la tiene (`conReporteria`; hoy, el
 *                          coordinador de Accumedical en Concurrencia, 27/10/2026)
 *
 * Sin «volver al panel»: desde el panel el módulo se abre en una pestaña nueva,
 * así que para volver basta con cerrarla (pedido del usuario).
 */
/**
 * `raiz`: donde empieza el módulo en el router que lo monta: `''` en su app
 * propia (D46: `concurrencia.pymes.ec/dashboard`) o `/<slug>` dentro de admin.
 */
export function NavegacionModulo({
  raiz,
  conReporteria = false,
}: {
  raiz: string
  conReporteria?: boolean
}) {
  return (
    <nav aria-label="Navegación del módulo" className="flex flex-col gap-0.5">
      <EntradaMenu a={`${raiz}/dashboard`} etiqueta="Bandeja de entrada" icono={Inbox} fin />
      <EntradaMenu a={`${raiz}/notificaciones`} etiqueta="Notificaciones" icono={Bell} />
      {conReporteria && (
        <EntradaMenu a={`${raiz}/reporteria`} etiqueta="Reportería" icono={BarChart3} />
      )}
    </nav>
  )
}
