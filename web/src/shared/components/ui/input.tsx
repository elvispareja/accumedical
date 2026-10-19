import { forwardRef, type ChangeEvent, type InputHTMLAttributes } from 'react'

import { cn } from '@/lib/utils'

interface PropsInput extends InputHTMLAttributes<HTMLInputElement> {
  /**
   * Escribir en mayúsculas. Activo por defecto en los campos de texto llano:
   * los expedientes se llevan así, y ponerlo aquí evita que un campo nuevo se
   * quede en minúsculas porque alguien olvidó marcarlo.
   *
   * Sin indicar nada se apaga en los tipos donde sería un error. Pasarlo
   * explícito manda sobre esa regla en los dos sentidos: `false` lo apaga en una
   * caja de búsqueda, y `true` lo enciende en el CORREO —también el del login—,
   * que va en mayúsculas como el resto del expediente (regla del cliente, 19/10/2026).
   * Lo único que no admite excepción son las CONTRASEÑAS: quedan como se escriban.
   */
  mayusculas?: boolean
}

/** Tipos donde poner mayúsculas rompería el dato o el control del navegador. */
const SIN_MAYUSCULAS = new Set(['email', 'password', 'date', 'time', 'number', 'url', 'file'])

/**
 * Una contraseña NUNCA se toca, aunque el input diga `type="text"`.
 *
 * Los campos con botón de «mostrar contraseña» cambian su `type` a `text` al
 * pulsarlo, así que mirar solo el tipo los dejaría desprotegidos justo cuando
 * están a la vista. `autocomplete` no cambia al alternar, así que es el dato
 * fiable. Mirarlo aquí protege también a cualquier campo futuro, sin depender de
 * que alguien se acuerde de marcarlo.
 */
function esCredencial(autoComplete: string | undefined): boolean {
  if (!autoComplete) return false
  const valor = autoComplete.toLowerCase()
  return valor.includes('password') || valor.includes('one-time-code') || valor === 'webauthn'
}

export const Input = forwardRef<HTMLInputElement, PropsInput>(function Input(
  { className, mayusculas, onChange, type, autoComplete, ...props },
  ref,
) {
  // Una credencial no se toca ni pidiéndolo: no hay caso en que convenga.
  const aplicar =
    !esCredencial(autoComplete) &&
    (mayusculas === true || ((mayusculas ?? true) && !SIN_MAYUSCULAS.has(type ?? 'text')))

  function alCambiar(evento: ChangeEvent<HTMLInputElement>) {
    if (aplicar) {
      // Se transforma el VALOR, no solo su aspecto: con `text-transform` en CSS
      // se vería en mayúsculas y se guardaría como se tecleó, que es justo la
      // clase de desajuste que nadie descubre hasta que consulta la base.
      // Sustituir por una cadena de la misma longitud deja el cursor donde está.
      evento.target.value = evento.target.value.toUpperCase()
    }
    onChange?.(evento)
  }

  return (
    <input
      ref={ref}
      type={type}
      autoComplete={autoComplete}
      onChange={onChange ? alCambiar : undefined}
      className={cn(
        'h-11 w-full rounded border border-borde bg-superficie px-3 text-[0.9375rem] text-tinta',
        'placeholder:text-tenue-fg/70',
        'transition-[border-color,box-shadow] duration-150 ease-natural',
        'hover:border-borde/80',
        'focus-visible:border-marca focus-visible:ring-2 focus-visible:ring-anillo/35 focus-visible:ring-offset-0',
        'disabled:cursor-not-allowed disabled:opacity-60',
        'aria-[invalid=true]:border-peligro aria-[invalid=true]:ring-peligro/25',
        className,
      )}
      {...props}
    />
  )
})
