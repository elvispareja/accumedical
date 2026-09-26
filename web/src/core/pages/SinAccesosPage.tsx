import { useMutation, useQueryClient } from '@tanstack/react-query'
import { motion, useReducedMotion } from 'framer-motion'
import { LockKeyhole, LogOut } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

import { cerrarSesion } from '@/core/auth/api'
import { useSesion } from '@/core/auth/useSesion'
import { Boton } from '@/shared/components/ui/button'

const EASE: [number, number, number, number] = [0.22, 0.61, 0.36, 1]

/**
 * Sesión válida, cero módulos. Ocurre cuando a alguien todavía no le han
 * asignado accesos, o cuando se los han revocado todos mientras trabajaba.
 *
 * No se dice qué módulos existen ni por qué no entra: eso filtraría información
 * de la plataforma a quien no tiene por qué conocerla.
 */
export function SinAccesosPage() {
  const { data: sesion } = useSesion()
  const navegar = useNavigate()
  const queryClient = useQueryClient()
  const sinMovimiento = useReducedMotion()

  const salir = useMutation({
    mutationFn: cerrarSesion,
    onSuccess: () => {
      queryClient.clear()
      navegar('/login', { replace: true })
    },
  })

  return (
    <main className="grid min-h-dvh place-items-center bg-fondo px-4 py-10">
      <motion.div
        initial={sinMovimiento ? { opacity: 0 } : { opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.28, ease: EASE }}
        className="w-full max-w-md rounded-md border border-borde bg-superficie p-7 text-center shadow-sutil"
      >
        <span className="mx-auto grid size-12 place-items-center rounded-full bg-tenue">
          <LockKeyhole className="size-5 text-tenue-fg" aria-hidden="true" />
        </span>

        <h1 className="mt-5 font-display text-xl font-semibold tracking-tight">
          Todavía no tienes accesos
        </h1>
        <p className="mt-2 text-sm text-tenue-fg">
          {sesion ? `Entraste como ${sesion.user.email}, pero` : 'Tu cuenta'} aún no tiene ningún
          módulo asignado. Pídeselo a quien administra la plataforma en tu compañía: en cuanto te
          lo den, aparecerá aquí sin que tengas que hacer nada más.
        </p>

        <Boton
          variante="contorno"
          className="mt-6 w-full"
          onClick={() => salir.mutate()}
          cargando={salir.isPending}
        >
          <LogOut aria-hidden="true" />
          Cerrar sesión
        </Boton>
      </motion.div>
    </main>
  )
}
