import { Bell, ClipboardCheck, Inbox, Users } from 'lucide-react'
import { useLocation } from 'react-router-dom'

import { coordinaDesdePlataforma, useArea } from '@/core/auth/area'
import { useSesion } from '@/core/auth/useSesion'
import { EntradaMenu, GrupoMenu } from '@/core/layout/MenuLateral'
import { identidadDe } from '@/core/modulos/identidad'

/**
 * El menú de un coordinador, el mismo esté donde esté: dentro de un módulo o en
 * su pantalla de usuarios. Es UN componente, no dos listas que haya que mantener
 * iguales a mano.
 *
 *   Auditorías        ← grupo desplegable
 *     · sus módulos, de la A a la Z
 *   Usuarios          ← solo el coordinador de PLATAFORMA
 *
 * «Usuarios» es de quien coordina una familia de Accumedical: ahí da de alta a
 * los auditores de su familia. El coordinador de una aseguradora no la tiene —la
 * gente de su compañía la crea el administrador desde la ficha—, y el servidor
 * impone lo mismo: `require_coordinacion` solo admite familia o admin global.
 */
export function NavegacionCoordinador() {
  const { data: sesion } = useSesion()
  const { pathname } = useLocation()

  // El prefijo de sus pantallas propias. Se pregunta, no se fija: este MISMO
  // menú lo lleva también el coordinador de una compañía, cuya área no es la
  // misma (`core/auth/area.ts`).
  const area = useArea()
  const modulos = [...(sesion?.modulos ?? [])].sort((a, b) =>
    a.nombre.localeCompare(b.nombre, 'es'),
  )
  const slugs = new Set(modulos.map((m) => `/${m.slug}`))
  const enUnModulo = slugs.has(`/${pathname.split('/')[1]}`)
  // Sus pantallas propias cuelgan de `/coordinacion`, no de `/admin`: quien
  // coordina no administra la plataforma (`core/auth/area.ts`).
  const deCoordinacion = coordinaDesdePlataforma(sesion)

  return (
    <nav aria-label="Navegación principal" className="flex flex-col gap-0.5">
      {/* Donde aterriza y donde vive: todos los casos de todas sus auditorías.
          Es de quien coordina desde PLATAFORMA —venga por familia o por fila de
          módulo—; el coordinador de una compañía no tiene panel de supervisión
          que juntar, y por eso se mira que no tenga aseguradora. */}
      {deCoordinacion && (
        <EntradaMenu
          a={`${area}/bandeja`}
          etiqueta="Bandeja de entrada"
          icono={Inbox}
          fin
        />
      )}

      <GrupoMenu etiqueta="Auditorías" icono={ClipboardCheck} dentro={enUnModulo}>
        {modulos.map((m) => (
          <EntradaMenu
            key={m.codigo}
            a={`/${m.slug}/dashboard`}
            etiqueta={m.nombre}
            icono={identidadDe(m.codigo).Icono}
            anidada
          />
        ))}
      </GrupoMenu>

      {sesion?.user.grupo_coordinado && (
        <EntradaMenu a={`${area}/usuarios`} etiqueta="Usuarios" icono={Users} />
      )}
      {/* La lista entera de su campana. Esta sí la lleva todo el mundo: cada
          quien ve sus propias notificaciones y nada más. */}
      <EntradaMenu a={`${area}/notificaciones`} etiqueta="Notificaciones" icono={Bell} />
    </nav>
  )
}
