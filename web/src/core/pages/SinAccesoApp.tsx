import { useMutation, useQueryClient } from '@tanstack/react-query'
import { LogOut, ShieldOff } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

import { cerrarSesion } from '@/core/auth/api'
import { useSesion } from '@/core/auth/useSesion'
import { Boton } from '@/shared/components/ui/button'

/**
 * Quien abre una app que NO tiene habilitada (D52). Cada app es independiente:
 * no hay selector de módulos ni otra puerta, simplemente no entra. El servidor
 * rechaza igual cada petición y deja registrado el intento; esto solo se lo dice.
 */
export function SinAccesoApp({ app }: { app?: string }) {
  const { data: sesion } = useSesion()
  const navegar = useNavigate()
  const queryClient = useQueryClient()
  const salir = useMutation({
    mutationFn: cerrarSesion,
    onSuccess: () => {
      queryClient.clear()
      navegar('/login', { replace: true })
    },
  })
  return (
    <div className="grid min-h-dvh place-items-center bg-fondo px-6 text-center">
      <div className="max-w-sm">
        <span className="mx-auto grid size-12 place-items-center rounded-md bg-tenue">
          <ShieldOff className="size-6 text-tenue-fg" aria-hidden="true" />
        </span>
        <h1 className="mt-4 font-display text-lg font-semibold">
          No tienes acceso {app ? `a ${app}` : 'a esta aplicación'}
        </h1>
        <p className="mt-2 text-sm text-tenue-fg">
          Tu usuario{sesion ? ` (${sesion.user.email.toLowerCase()})` : ''} no tiene habilitada esta
          aplicación. Si la necesitas, pídesela al administrador de Accumedical.
        </p>
        <Boton variante="contorno" className="mt-6" onClick={() => salir.mutate()} cargando={salir.isPending}>
          <LogOut aria-hidden="true" />
          Entrar con otra cuenta
        </Boton>
      </div>
    </div>
  )
}
