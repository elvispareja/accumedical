import { Construction } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'

import { identidadDe } from '@/core/modulos/identidad'
import { cn } from '@/lib/utils'
import { useModulos } from '@/shared/catalogos/hooks'

/** Nombre visible de la familia comercial, como en el resto de la plataforma. */
const FAMILIA: Record<string, string> = {
  suscripcion: 'Suscripción',
  siniestro: 'Siniestro',
}

/**
 * La auditoría que el administrador ve en su menú pero que todavía no tiene
 * panel de supervisión.
 *
 * Existe para que el menú pueda enseñar **todos** los requerimientos: una
 * entrada que lleva a un error es peor que no estar, y esconder los que faltan
 * deja al administrador sin saber qué viene. El nombre y la familia salen del
 * catálogo del servidor, así que un módulo nuevo cae aquí solo.
 *
 * Es el hermano de `ModuloPendientePage`, que es lo que ve quien entra al
 * módulo por su slug; aquí se mira desde administración.
 */
export function AuditoriaPendientePage() {
  const { slug } = useParams<{ slug: string }>()
  const { data: modulos, isPending } = useModulos()
  const modulo = modulos?.find((m) => m.slug === slug)

  if (isPending) {
    return (
      <div className="w-full" role="status" aria-label="Cargando la auditoría">
        <div className="h-8 w-64 animate-pulse rounded bg-tenue" />
        <div className="mt-6 h-48 animate-pulse rounded-md bg-tenue" />
      </div>
    )
  }

  // Un slug que no está en el catálogo: ni se confirma ni se niega qué existe,
  // se dice lo mismo que se diría de cualquier otro.
  if (!modulo) {
    return (
      <div className="w-full">
        <div className="rounded-md border border-borde bg-superficie px-6 py-16 text-center">
          <Construction className="mx-auto size-6 text-tenue-fg" aria-hidden="true" />
          <p className="mt-3 font-display text-sm font-medium">Esa auditoría no existe</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-tenue-fg">
            Revisa la dirección o vuelve a elegirla en el menú.
          </p>
          <Link
            to="/admin/aseguradoras"
            className="mt-4 inline-block font-display text-sm font-medium text-marca transition-opacity duration-150 hover:opacity-80"
          >
            Ir a administración
          </Link>
        </div>
      </div>
    )
  }

  const identidad = identidadDe(modulo.codigo)
  return (
    <div className="w-full">
      <header>
        <p className="font-display text-[0.6875rem] font-semibold uppercase tracking-[0.16em] text-tenue-fg">
          Auditorías{modulo.grupo ? ` · ${FAMILIA[modulo.grupo] ?? modulo.grupo}` : ''}
        </p>
        <h1 className="mt-1.5 font-display text-2xl font-semibold tracking-tight">
          {modulo.nombre}
        </h1>
      </header>

      <div className="mt-7 rounded-md border border-dashed border-borde px-6 py-16 text-center">
        <span
          className={cn('mx-auto grid size-11 place-items-center rounded-md', identidad.suave)}
        >
          <identidad.Icono className={cn('size-5', identidad.texto)} aria-hidden="true" />
        </span>
        <p className="mt-3 font-display text-sm font-medium">En construcción</p>
        <p className="mx-auto mt-1 max-w-md text-sm text-tenue-fg">
          Este requerimiento todavía no tiene panel de supervisión: se construye en su propio
          hito y aterrizará justo aquí, con la misma forma que el de Concurrencia.
        </p>
      </div>
    </div>
  )
}
