import logotipo from '@/assets/logo-accumedical.png'
import logotipoBlanco from '@/assets/logo-accumedical-blanco.png'
import monograma from '@/assets/monograma-accumedical.png'
import monogramaBlanco from '@/assets/monograma-accumedical-blanco.png'
import { cn } from '@/lib/utils'

/**
 * La marca real de la compañía: el logo de Accumedical (Accurate Billing &
 * Medical Audit S.A.), con el monograma AC para los huecos compactos y el
 * logotipo completo para el resto. Los PNG salen del original con el blanco
 * convertido a transparencia.
 *
 * Sobre fondos oscuros ya no viaja en una tarjeta blanca: existe la variante
 * en blanco del propio logo —el interior azul pasa a blanco y el oro se
 * queda—, así que se apoya directa sobre el fondo. `sobreOscuro` la fuerza en
 * fondos oscuros fijos (el panel del login); en los contextos que siguen el
 * tema, cada variante se enseña en su modo.
 */
export function Marca({
  className,
  conTexto = true,
  sobreOscuro = false,
  alto,
}: {
  className?: string
  conTexto?: boolean
  sobreOscuro?: boolean
  /** Clase de altura para la imagen (p. ej. `h-10`) cuando el hueco lo pida. */
  alto?: string
}) {
  const tamano = cn('w-auto select-none', conTexto ? 'h-14' : 'h-9', alto)
  const oscura = conTexto ? logotipoBlanco : monogramaBlanco
  const clara = conTexto ? logotipo : monograma

  if (sobreOscuro) {
    return (
      <span className={cn('inline-flex w-fit items-center', className)}>
        <img src={oscura} alt="Accumedical" draggable={false} className={tamano} />
      </span>
    )
  }

  return (
    <span className={cn('inline-flex w-fit items-center', className)}>
      <img
        src={clara}
        alt="Accumedical"
        draggable={false}
        className={cn(tamano, 'dark:hidden')}
      />
      <img
        src={oscura}
        alt=""
        aria-hidden="true"
        draggable={false}
        className={cn(tamano, 'hidden dark:block')}
      />
    </span>
  )
}
