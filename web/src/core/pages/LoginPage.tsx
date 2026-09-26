import { AnimatePresence, motion, useReducedMotion, type Variants } from 'framer-motion'
import { AlertCircle, Eye, EyeOff, ShieldCheck } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'

import { useQueryClient } from '@tanstack/react-query'

import { iniciarSesion } from '@/core/auth/api'
import { CLAVE_SESION } from '@/core/auth/useSesion'
import { BotonTema } from '@/core/components/BotonTema'
import { Marca } from '@/core/components/Marca'
import { TrazaAuditoria } from '@/core/components/TrazaAuditoria'
import { Boton } from '@/shared/components/ui/button'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'

const EASE: [number, number, number, number] = [0.22, 0.61, 0.36, 1]

/** El catálogo vigente, con su color de acento. Es solo la vitrina del login;
 *  qué módulos ve realmente cada usuario lo resuelve el backend tras autenticar. */
const MODULOS = [
  { nombre: 'Requisitos de Asegurabilidad', clase: 'bg-modulo-examen-asegurabilidad' },
  { nombre: 'Calificación de Riesgo', clase: 'bg-modulo-calificacion-riesgo' },
  { nombre: 'Central de Crédito', clase: 'bg-modulo-carta-credito' },
  { nombre: 'Auditoría de Concurrencia', clase: 'bg-modulo-concurrencia' },
  { nombre: 'Auditoría de Alta', clase: 'bg-modulo-auditoria-alta' },
  { nombre: 'Auditoría del Crédito Hospitalario', clase: 'bg-modulo-auditoria-credito-hospitalario' },
  { nombre: 'Ambulatorio', clase: 'bg-modulo-ambulatorio' },
  { nombre: 'Auditoría de Vida', clase: 'bg-modulo-auditoria-vida' },
  { nombre: 'Reembolso', clase: 'bg-modulo-reembolso' },
] as const

function mensajeDeError(error: unknown): string {
  const estado =
    typeof error === 'object' && error !== null && 'response' in error
      ? (error as { response?: { status?: number } }).response?.status
      : undefined

  // Nunca se distingue "el correo no existe" de "la contraseña es incorrecta":
  // eso permitiría enumerar cuentas. El motivo real queda en el AuditLog del servidor.
  if (estado === 401) return 'No pudimos iniciar sesión. Revisa tu correo y tu contraseña.'
  if (estado === 429) return 'Demasiados intentos. Espera un momento antes de volver a intentarlo.'
  if (estado === undefined) return 'No pudimos conectar con el servidor. Inténtalo de nuevo en unos segundos.'
  return 'Algo salió mal al iniciar sesión. Inténtalo de nuevo.'
}

export function LoginPage() {
  const navegar = useNavigate()
  const queryClient = useQueryClient()
  const sinMovimiento = useReducedMotion()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [verPassword, setVerPassword] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const contenedor: Variants = {
    inicial: {},
    animado: { transition: { staggerChildren: sinMovimiento ? 0 : 0.055, delayChildren: 0.05 } },
  }

  const elemento: Variants = sinMovimiento
    ? { inicial: { opacity: 0 }, animado: { opacity: 1, transition: { duration: 0.2 } } }
    : {
        inicial: { opacity: 0, y: 12 },
        animado: { opacity: 1, y: 0, transition: { duration: 0.28, ease: EASE } },
      }

  async function manejarEnvio(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault()
    if (enviando) return

    setError(null)
    setEnviando(true)
    try {
      const sesion = await iniciarSesion({ email: email.trim(), password })
      // El login ya devuelve exactamente el mismo shape que /auth/me, así que se
      // siembra la caché y el guard no necesita otra ida y vuelta. Sigue siendo
      // el backend quien manda: cualquier refetch posterior lo confirma.
      queryClient.setQueryData(CLAVE_SESION, sesion)
      // A dónde entra el usuario lo decide el backend, no esta pantalla.
      navegar(sesion.redireccion, { replace: true })
    } catch (e) {
      setError(mensajeDeError(e))
      setEnviando(false)
    }
  }

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[1.15fr_minmax(25rem,0.85fr)]">
      {/* ─────────── Panel visual ─────────── */}
      <motion.aside
        initial={sinMovimiento ? { opacity: 0 } : { opacity: 0, scale: 1.015 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5, ease: EASE }}
        className="panel-login relative isolate flex min-h-[15rem] flex-col justify-between overflow-hidden px-6 py-8 text-white sm:px-10 lg:min-h-dvh lg:px-14 lg:py-12"
      >
        <div className="trama-expediente pointer-events-none absolute inset-0 -z-10" aria-hidden="true" />

        <motion.div
          initial={sinMovimiento ? { opacity: 0 } : { opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.32, delay: 0.06, ease: EASE }}
        >
          <Marca sobreOscuro />
        </motion.div>

        <div className="mt-10 flex flex-1 flex-col justify-center gap-9 lg:mt-0">
          <motion.div
            initial={sinMovimiento ? { opacity: 0 } : { opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.12, ease: EASE }}
            className="max-w-md"
          >
            <h1 className="text-balance font-display text-[1.75rem] font-semibold leading-[1.15] tracking-tight sm:text-[2.125rem] lg:text-[2.5rem]">
              Cada decisión,
              <br />
              con su rastro.
            </h1>
            <p className="mt-4 max-w-sm text-pretty text-[0.9375rem] leading-relaxed text-white/65">
              Suscripción, calificación, concurrencia y cartas de crédito sobre un mismo núcleo de
              aseguradoras, prestadores y auditoría.
            </p>
          </motion.div>

          {/* La traza es el motivo del producto, no un adorno: cada acción queda registrada. */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.4, delay: 0.28, ease: EASE }}
            className="hidden lg:block"
          >
            <TrazaAuditoria />
          </motion.div>
        </div>

        <motion.ul
          initial={sinMovimiento ? { opacity: 0 } : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: 0.34, ease: EASE }}
          className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-2"
        >
          {MODULOS.map((modulo) => (
            <li key={modulo.nombre} className="flex items-center gap-2">
              <span className={`size-1.5 rounded-full ${modulo.clase}`} aria-hidden="true" />
              <span className="font-display text-[0.6875rem] uppercase tracking-[0.13em] text-white/45">
                {modulo.nombre}
              </span>
            </li>
          ))}
        </motion.ul>
      </motion.aside>

      {/* ─────────── Formulario ─────────── */}
      <section className="relative flex items-center justify-center bg-fondo px-6 py-12 sm:px-10 lg:py-16">
        <BotonTema className="absolute right-4 top-4 lg:right-6 lg:top-6" />

        <motion.div
          variants={contenedor}
          initial="inicial"
          animate="animado"
          className="w-full max-w-[23rem]"
        >
          <motion.div variants={elemento} className="mb-8">
            <h2 className="font-display text-2xl font-semibold tracking-tight">Iniciar sesión</h2>
            <p className="mt-1.5 text-sm text-tenue-fg">
              Accede con tu cuenta institucional para continuar.
            </p>
          </motion.div>

          <form onSubmit={manejarEnvio} noValidate className="space-y-5">
            <AnimatePresence initial={false}>
              {error && (
                <motion.div
                  key="error"
                  initial={sinMovimiento ? { opacity: 0 } : { opacity: 0, height: 0, y: -4 }}
                  animate={{ opacity: 1, height: 'auto', y: 0 }}
                  exit={sinMovimiento ? { opacity: 0 } : { opacity: 0, height: 0, y: -4 }}
                  transition={{ duration: 0.22, ease: EASE }}
                  className="overflow-hidden"
                >
                  <p
                    id="error-login"
                    role="alert"
                    aria-live="assertive"
                    className="flex items-start gap-2.5 rounded border border-peligro/30 bg-peligro-suave px-3.5 py-3 text-[0.8125rem] leading-snug text-peligro"
                  >
                    <AlertCircle className="mt-px size-4 shrink-0" aria-hidden="true" />
                    <span>{error}</span>
                  </p>
                </motion.div>
              )}
            </AnimatePresence>

            <motion.div variants={elemento} className="space-y-2">
              <Label htmlFor="email">Correo electrónico</Label>
              <Input
                id="email"
                name="email"
                type="email"
                inputMode="email"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                required
                autoFocus
                placeholder="nombre@aseguradora.ec"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? 'error-login' : undefined}
                disabled={enviando}
              />
            </motion.div>

            <motion.div variants={elemento} className="space-y-2">
              <Label htmlFor="password">Contraseña</Label>
              <div className="relative">
                <Input
                  id="password"
                  name="password"
                  type={verPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  placeholder="••••••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? 'error-login' : undefined}
                  disabled={enviando}
                  className="pr-11"
                />
                <button
                  type="button"
                  onClick={() => setVerPassword((v) => !v)}
                  disabled={enviando}
                  aria-label={verPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                  aria-pressed={verPassword}
                  className="absolute right-1 top-1 grid size-9 place-items-center rounded text-tenue-fg transition-colors duration-150 ease-natural hover:text-tinta disabled:opacity-50"
                >
                  {verPassword ? (
                    <EyeOff className="size-4" aria-hidden="true" />
                  ) : (
                    <Eye className="size-4" aria-hidden="true" />
                  )}
                </button>
              </div>
            </motion.div>

            <motion.div variants={elemento} className="pt-1">
              <Boton type="submit" tamano="lg" cargando={enviando} className="w-full">
                {enviando ? 'Verificando…' : 'Entrar'}
              </Boton>
            </motion.div>
          </form>

          <motion.div variants={elemento} className="mt-7 space-y-4">
            <p className="text-[0.8125rem] leading-relaxed text-tenue-fg">
              ¿Problemas para entrar? Tu acceso y tus módulos los gestiona el administrador de la
              plataforma.
            </p>
            <p className="flex items-start gap-2 border-t border-borde pt-4 text-[0.75rem] leading-relaxed text-tenue-fg/85">
              <ShieldCheck className="mt-px size-3.5 shrink-0" aria-hidden="true" />
              <span>
                Los accesos e intentos de inicio de sesión quedan registrados en la auditoría de la
                plataforma.
              </span>
            </p>
          </motion.div>
        </motion.div>
      </section>
    </div>
  )
}
