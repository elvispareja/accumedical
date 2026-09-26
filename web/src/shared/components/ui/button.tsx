import { cva, type VariantProps } from 'class-variance-authority'
import { Loader2 } from 'lucide-react'
import { forwardRef, type ButtonHTMLAttributes } from 'react'

import { cn } from '@/lib/utils'

const botonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded font-medium ' +
    'transition-[background-color,border-color,color,box-shadow,transform] duration-150 ease-natural ' +
    'disabled:pointer-events-none disabled:opacity-55 active:translate-y-px ' +
    '[&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variante: {
        solido: 'bg-marca text-marca-fg shadow-sutil hover:bg-marca/90',
        contorno: 'border border-borde bg-superficie text-tinta hover:bg-tenue',
        fantasma: 'text-tenue-fg hover:bg-tenue hover:text-tinta',
        enlace: 'text-marca underline-offset-4 hover:underline',
      },
      tamano: {
        sm: 'h-9 px-3 text-sm',
        md: 'h-10 px-4 text-sm',
        lg: 'h-11 px-5 text-[0.9375rem]',
        icono: 'size-9',
      },
    },
    defaultVariants: { variante: 'solido', tamano: 'md' },
  },
)

export interface BotonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof botonVariants> {
  cargando?: boolean
}

export const Boton = forwardRef<HTMLButtonElement, BotonProps>(function Boton(
  { className, variante, tamano, cargando = false, disabled, children, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      className={cn(botonVariants({ variante, tamano }), className)}
      disabled={disabled || cargando}
      aria-busy={cargando || undefined}
      {...props}
    >
      {cargando && <Loader2 className="animate-spin" aria-hidden="true" />}
      {children}
    </button>
  )
})
