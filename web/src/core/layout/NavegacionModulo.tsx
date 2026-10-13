import { Bell, Inbox } from 'lucide-react'

import { EntradaMenu } from '@/core/layout/MenuLateral'

/**
 * El menú lateral DENTRO de un módulo (D47): solo lo del módulo. La lista de
 * todas las auditorías es del panel —admin o coordinación—, no de cada app:
 * cada módulo es su propia aplicación y no un centro que enlaza a los demás.
 *
 *   Bandeja de entrada   ← la portada del módulo, en /<slug>/dashboard
 *   Notificaciones       ← solo las de este módulo
 *
 * Sin «volver al panel»: desde el panel el módulo se abre en una pestaña nueva,
 * así que para volver basta con cerrarla (pedido del usuario).
 */
export function NavegacionModulo({ slug }: { slug: string }) {
  return (
    <nav aria-label="Navegación del módulo" className="flex flex-col gap-0.5">
      <EntradaMenu a={`/${slug}/dashboard`} etiqueta="Bandeja de entrada" icono={Inbox} fin />
      <EntradaMenu a={`/${slug}/notificaciones`} etiqueta="Notificaciones" icono={Bell} />
    </nav>
  )
}
