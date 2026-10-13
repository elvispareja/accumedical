import { ArrowLeft, Bell, Inbox } from 'lucide-react'

import { coordinaDesdePlataforma } from '@/core/auth/area'
import { useSesion } from '@/core/auth/useSesion'
import { EntradaMenu } from '@/core/layout/MenuLateral'

/**
 * El menú lateral DENTRO de un módulo (D47): solo lo del módulo. La lista de
 * todas las auditorías es del panel —admin o coordinación—, no de cada app:
 * cada módulo es su propia aplicación y no un centro que enlaza a los demás.
 *
 *   Bandeja de entrada   ← la portada del módulo
 *   Notificaciones       ← solo las de este módulo
 *   ─────────
 *   Volver al panel      ← admin → /admin · coordinador de plataforma →
 *                          su bandeja general · coordinador de compañía con
 *                          varios módulos → elegir otro
 */
export function NavegacionModulo({ slug }: { slug: string }) {
  const { data: sesion } = useSesion()

  const panel = sesion?.user.es_admin_global
    ? { a: '/admin', etiqueta: 'Administración' }
    : coordinaDesdePlataforma(sesion)
      ? { a: '/coordinacion/bandeja', etiqueta: 'Coordinación' }
      : (sesion?.modulos.length ?? 0) > 1
        ? { a: '/seleccionar-modulo', etiqueta: 'Otras auditorías' }
        : null

  return (
    <nav aria-label="Navegación del módulo" className="flex flex-col gap-0.5">
      <EntradaMenu a={`/${slug}`} etiqueta="Bandeja de entrada" icono={Inbox} fin />
      <EntradaMenu a={`/${slug}/notificaciones`} etiqueta="Notificaciones" icono={Bell} />
      {panel && (
        <div className="mt-3 border-t border-borde pt-3">
          <EntradaMenu a={panel.a} etiqueta={`Volver a ${panel.etiqueta}`} icono={ArrowLeft} />
        </div>
      )}
    </nav>
  )
}
