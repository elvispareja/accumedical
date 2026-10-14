import type { ReactNode } from 'react'

/**
 * Una fecha de filtro con su nombre dentro de la caja: «Desde», «Hasta». El
 * campo de fecha nativo no admite placeholder; así se sabe cuál es cuál. El
 * `Input` que va dentro lleva `pl-16` para dejarle sitio.
 */
export function FechaConEtiqueta({ etiqueta, children }: { etiqueta: string; children: ReactNode }) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-medium text-tenue-fg">
        {etiqueta}
      </span>
      {children}
    </div>
  )
}
