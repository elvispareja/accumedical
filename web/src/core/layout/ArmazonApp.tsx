import { useMutation, useQueryClient } from '@tanstack/react-query'
import { LogOut, type LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { Outlet, useNavigate } from 'react-router-dom'

import { cerrarSesion } from '@/core/auth/api'
import { useSesion } from '@/core/auth/useSesion'
import { BotonTema } from '@/core/components/BotonTema'
import { ArmazonLateral, EntradaMenu } from '@/core/layout/MenuLateral'
import { SinAccesoApp } from '@/core/pages/SinAccesoApp'
import { Boton } from '@/shared/components/ui/button'

export interface EntradaApp {
  a: string
  etiqueta: string
  icono: LucideIcon
  fin?: boolean
}

/**
 * El armazón de una app propia que NO es un módulo de `modules` (Pacientes,
 * Convenios, Contabilidad: D49/D50). Mismo diseño que el de los módulos —menú
 * lateral con la marca de Accumedical, barra de arriba con la identidad de la
 * app, tema, usuario y Salir—, y un menú SOLO con lo de la app (D47).
 */
export function ArmazonApp({
  titulo,
  subtitulo,
  icono: Icono,
  entradas,
}: {
  titulo: string
  subtitulo: string
  icono: LucideIcon
  entradas: EntradaApp[]
}) {
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
        <nav aria-label={`Navegación de ${titulo}`} className="flex flex-col gap-0.5">
          {entradas.map((e) => (
            <EntradaMenu key={e.a} a={e.a} etiqueta={e.etiqueta} icono={e.icono} fin={e.fin} />
          ))}
        </nav>
      }
      topbarIzquierda={
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-md bg-marca-suave">
            <Icono className="size-4.5 text-marca" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="truncate font-display text-sm font-semibold">{titulo}</p>
            <p className="truncate text-xs text-tenue-fg">{subtitulo}</p>
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
 * La puerta de una app de FUNCIÓN (D50): el administrador global o quien lleve
 * esa función (`user_funcion`). Es solo interfaz; cada endpoint lo vuelve a
 * exigir con `require_funcion`.
 */
export function SoloFuncion({
  funcion,
  nombre,
  children,
}: {
  funcion: string
  nombre: string
  children: ReactNode
}) {
  const { data: sesion } = useSesion()
  if (!sesion) return null
  if (!sesion.user.es_admin_global && sesion.user.funcion !== funcion) return <SinAccesoApp app={nombre} />
  return <>{children}</>
}
