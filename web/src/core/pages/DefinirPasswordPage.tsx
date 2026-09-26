import { useMutation, useQuery } from '@tanstack/react-query'
import { motion, useReducedMotion } from 'framer-motion'
import { Check, Eye, EyeOff, ShieldCheck, X } from 'lucide-react'
import { useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'

import { definirPassword, leerInvitacion } from '@/core/auth/invitacion'
import { Marca } from '@/core/components/Marca'
import { cn } from '@/lib/utils'
import { Boton } from '@/shared/components/ui/button'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { useToast } from '@/shared/components/ui/toast'

const EASE: [number, number, number, number] = [0.22, 0.61, 0.36, 1]
const MINIMO = 12

function mensajeDeError(error: unknown, porDefecto: string): string {
  const detalle = (error as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
  if (typeof detalle === 'string') return detalle
  if (Array.isArray(detalle) && detalle.length > 0) {
    return (detalle[0] as { mensaje?: string }).mensaje ?? porDefecto
  }
  return porDefecto
}

function Requisito({ cumple, texto }: { cumple: boolean; texto: string }) {
  const Icono = cumple ? Check : X
  return (
    <li className={cn('flex items-center gap-2 text-sm', cumple ? 'text-exito' : 'text-tenue-fg')}>
      <Icono className="size-3.5 shrink-0" aria-hidden="true" />
      {texto}
    </li>
  )
}

/**
 * Pantalla pública a la que lleva el enlace de la invitación. No abre sesión al
 * terminar: quien acaba de crear su contraseña entra por el login como todo el
 * mundo, y así el camino de entrada sigue siendo uno solo.
 */
export function DefinirPasswordPage() {
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''
  const navegar = useNavigate()
  const toast = useToast()
  const sinMovimiento = useReducedMotion()

  const [password, setPassword] = useState('')
  const [repetida, setRepetida] = useState('')
  const [visible, setVisible] = useState(false)

  const invitacion = useQuery({
    queryKey: ['invitacion', token],
    queryFn: () => leerInvitacion(token),
    enabled: token.length >= 16,
    retry: false,
  })

  const requisitos = useMemo(
    () => [
      { cumple: password.length >= MINIMO, texto: `Al menos ${MINIMO} caracteres` },
      { cumple: /[a-záéíóúñ]/.test(password) && /[A-ZÁÉÍÓÚÑ]/.test(password), texto: 'Mayúsculas y minúsculas' },
      { cumple: /\d/.test(password), texto: 'Algún número' },
      { cumple: repetida.length > 0 && password === repetida, texto: 'Las dos coinciden' },
    ],
    [password, repetida],
  )
  const listo = requisitos.every((r) => r.cumple)

  const guardar = useMutation({
    mutationFn: () => definirPassword(token, password),
    onSuccess: () => {
      toast.exito('Contraseña creada. Ya puedes entrar.')
      navegar('/login', { replace: true })
    },
    onError: (error) => toast.error(mensajeDeError(error, 'No se pudo crear la contraseña')),
  })

  function enviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault()
    if (!listo) return toast.error('La contraseña todavía no cumple los requisitos')
    guardar.mutate()
  }

  const invalido = token.length < 16 || invitacion.isError

  return (
    <main className="grid min-h-dvh place-items-center bg-fondo px-4 py-10">
      <motion.div
        initial={sinMovimiento ? { opacity: 0 } : { opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.28, ease: EASE }}
        className="w-full max-w-md rounded-md border border-borde bg-superficie p-7 shadow-sutil"
      >
        <ShieldCheck className="size-6 text-marca" aria-hidden="true" />

        {invalido ? (
          <>
            <h1 className="mt-4 font-display text-xl font-semibold tracking-tight">
              Este enlace ya no sirve
            </h1>
            <p className="mt-2 text-sm text-tenue-fg">
              Los enlaces de invitación caducan y solo se pueden usar una vez. Pide uno nuevo a
              quien administra la plataforma.
            </p>
            <Link
              to="/login"
              className="mt-5 inline-block rounded text-sm font-medium text-marca hover:underline"
            >
              Ir al inicio de sesión
            </Link>
          </>
        ) : invitacion.isPending ? (
          <div className="mt-4 space-y-3" role="status" aria-label="Comprobando el enlace">
            <div className="h-6 w-2/3 animate-pulse rounded bg-tenue" />
            <div className="h-4 w-full animate-pulse rounded bg-tenue" />
            <div className="h-10 w-full animate-pulse rounded bg-tenue" />
          </div>
        ) : (
          <>
            <Marca alto="h-10" className="mt-4" />
            <h1 className="mt-3 font-display text-xl font-semibold tracking-tight">
              Hola, {invitacion.data!.nombre_completo}
            </h1>
            <p className="mt-1 text-sm text-tenue-fg">
              Crea tu contraseña para entrar con{' '}
              <span className="font-mono text-xs">{invitacion.data!.email}</span>.
            </p>

            <form onSubmit={enviar} noValidate className="mt-6 space-y-4">
              <div className="space-y-2">
                <Label htmlFor="password">Contraseña</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={visible ? 'text' : 'password'}
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="pr-10"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setVisible((v) => !v)}
                    aria-label={visible ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                    className="absolute right-2 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded text-tenue-fg transition-colors duration-150 hover:text-tinta"
                  >
                    {visible ? (
                      <EyeOff className="size-4" aria-hidden="true" />
                    ) : (
                      <Eye className="size-4" aria-hidden="true" />
                    )}
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="repetida">Repítela</Label>
                <Input
                  id="repetida"
                  type={visible ? 'text' : 'password'}
                  autoComplete="new-password"
                  value={repetida}
                  onChange={(e) => setRepetida(e.target.value)}
                  required
                />
              </div>

              <ul className="space-y-1.5" aria-live="polite">
                {requisitos.map((r) => (
                  <Requisito key={r.texto} cumple={r.cumple} texto={r.texto} />
                ))}
              </ul>

              <Boton type="submit" className="w-full" cargando={guardar.isPending} disabled={!listo}>
                Crear contraseña
              </Boton>
            </form>
          </>
        )}
      </motion.div>
    </main>
  )
}
