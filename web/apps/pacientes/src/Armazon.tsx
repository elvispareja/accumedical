import { useMutation, useQueryClient } from '@tanstack/react-query'
import { LogOut, Users } from 'lucide-react'
import type { ReactNode } from 'react'
import { Outlet, useNavigate } from 'react-router-dom'

import { cerrarSesion } from '@/core/auth/api'
import { useSesion } from '@/core/auth/useSesion'
import { BotonTema } from '@/core/components/BotonTema'
import { ArmazonLateral, EntradaMenu } from '@/core/layout/MenuLateral'
import { SinAccesoApp } from '@/core/pages/SinAccesoApp'
import { Boton } from '@/shared/components/ui/button'

/** El armazón de la app Pacientes: su menú (solo lo suyo, D47) y la barra de arriba. */
export function Armazon() {
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
    <ArmazonLateral
      nav={
        <nav aria-label="Navegación de Pacientes" className="flex flex-col gap-0.5">
          <EntradaMenu a="/dashboard" etiqueta="Pacientes" icono={Users} />
        </nav>
      }
      topbarIzquierda={
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-md bg-marca-suave">
            <Users className="size-4.5 text-marca" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="truncate font-display text-sm font-semibold">Pacientes</p>
            <p className="truncate text-xs text-tenue-fg">Registro de Accumedical</p>
          </div>
        </div>
      }
      topbarDerecha={
        <>
          <BotonTema />
          <span className="hidden max-w-[16rem] truncate text-sm text-tenue-fg sm:inline">
            {sesion?.user.email}
          </span>
          <Boton variante="fantasma" tamano="sm" onClick={() => salir.mutate()} cargando={salir.isPending}>
            <LogOut aria-hidden="true" />
            <span className="hidden sm:inline">Salir</span>
          </Boton>
        </>
      }
    >
      <Outlet />
    </ArmazonLateral>
  )
}

/**
 * Solo personal de ACCUMEDICAL (D49). Es solo para no pintar lo que no le toca:
 * la puerta real es `require_personal_accumedical` en cada endpoint.
 */
export function SoloAccumedical({ children }: { children: ReactNode }) {
  const { data: sesion } = useSesion()
  if (!sesion) return null
  // Las aseguradoras no entran: el registro reúne a las personas de todas.
  if (sesion.aseguradora) return <SinAccesoApp app="Pacientes" />
  return <>{children}</>
}
