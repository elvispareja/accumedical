import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { motion, useReducedMotion } from 'framer-motion'
import { FileKey2, ShieldCheck, UploadCloud } from 'lucide-react'
import { useRef, useState, type FormEvent } from 'react'

import { estadoFirma, guardarFirma } from '@/shared/configuracion/api'
import { Boton } from '@/shared/components/ui/button'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { useToast } from '@/shared/components/ui/toast'

const EASE: [number, number, number, number] = [0.22, 0.61, 0.36, 1]

function mensajeDeError(error: unknown, porDefecto: string): string {
  const detalle = (error as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
  return typeof detalle === 'string' ? detalle : porDefecto
}

/**
 * Configuración de la plataforma, solo para el administrador global. Hoy: la
 * firma electrónica de los informes. La contraseña se teclea en un campo
 * oculto —nunca se pinta—, viaja una sola vez al guardar y el servidor la
 * cifra; esta pantalla jamás la recibe de vuelta.
 */
export function ConfiguracionPage() {
  const toast = useToast()
  const queryClient = useQueryClient()
  const sinMovimiento = useReducedMotion()

  const estado = useQuery({ queryKey: ['configuracion-firma'], queryFn: estadoFirma })

  const [archivo, setArchivo] = useState<File | null>(null)
  const [contrasena, setContrasena] = useState('')
  const inputArchivo = useRef<HTMLInputElement>(null)

  const guardar = useMutation({
    mutationFn: () => guardarFirma(archivo!, contrasena),
    onSuccess: (nuevo) => {
      queryClient.setQueryData(['configuracion-firma'], nuevo)
      // La contraseña no se queda ni en el estado de React más de lo necesario.
      setContrasena('')
      setArchivo(null)
      if (inputArchivo.current) inputArchivo.current.value = ''
      toast.exito(
        nuevo.titular
          ? `Firma configurada · ${nuevo.titular}`
          : 'Firma configurada: los informes ya salen firmados',
      )
    },
    onError: (error) =>
      toast.error(mensajeDeError(error, 'No se pudo guardar la firma. Inténtalo de nuevo')),
  })

  function enviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault()
    if (!archivo) return toast.error('Elige el archivo .p12 de tu firma electrónica')
    if (!contrasena) return toast.error('Escribe la contraseña del certificado')
    guardar.mutate()
  }

  const datos = estado.data
  const bloqueadaPorEntorno = datos?.fuente === 'entorno'

  return (
    <div className="w-full">
      <header>
        <p className="font-display text-[0.6875rem] font-semibold uppercase tracking-[0.16em] text-tenue-fg">
          Administración
        </p>
        <h1 className="mt-1.5 font-display text-2xl font-semibold tracking-tight">
          Configuración
        </h1>
        <p className="mt-1 text-sm text-tenue-fg">
          Lo que la plataforma necesita una sola vez, en un solo sitio.
        </p>
      </header>

      <motion.section
        initial={sinMovimiento ? { opacity: 0 } : { opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.26, ease: EASE }}
        className="mt-7 rounded-md border border-borde bg-superficie p-5 sm:p-6"
      >
        <h2 className="flex items-center gap-2 font-display text-sm font-semibold">
          <FileKey2 className="size-4 text-oro" aria-hidden="true" />
          Firma electrónica de los informes
        </h2>
        <p className="mt-0.5 text-sm text-tenue-fg">
          El certificado .p12 de la empresa (Registro Civil, Security Data, Uanataca…) firma
          digitalmente cada PDF de informe. La contraseña se guarda cifrada en el servidor y no
          se puede volver a ver: solo reemplazar.
        </p>

        {/* El estado actual, sin secretos: quién firma y desde dónde se fijó. */}
        <div className="mt-4 flex items-center gap-2 rounded-md border border-borde bg-tenue/40 px-4 py-3 text-sm">
          <ShieldCheck
            className={datos?.configurada ? 'size-4 shrink-0 text-exito' : 'size-4 shrink-0 text-tenue-fg'}
            aria-hidden="true"
          />
          {estado.isPending ? (
            <span className="text-tenue-fg">Consultando…</span>
          ) : bloqueadaPorEntorno ? (
            <span>
              Configurada por el <strong>entorno del servidor</strong> (FIRMA_P12_PATH): para
              gestionarla desde aquí, quítala del .env y reinicia la API.
            </span>
          ) : datos?.configurada ? (
            <span>
              Configurada{datos.titular ? <> · firma <strong>{datos.titular}</strong></> : null}.
              Subir otro archivo la reemplaza.
            </span>
          ) : (
            <span>Sin configurar: los PDF salen sin firma electrónica.</span>
          )}
        </div>

        <form onSubmit={enviar} noValidate className="mt-5">
          <fieldset disabled={bloqueadaPorEntorno || guardar.isPending} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="firma-archivo">
                Archivo .p12 <span className="text-peligro">*</span>
              </Label>
              <input
                ref={inputArchivo}
                id="firma-archivo"
                type="file"
                accept=".p12,.pfx,application/x-pkcs12"
                onChange={(e) => setArchivo(e.target.files?.[0] ?? null)}
                className="block w-full cursor-pointer rounded-md border border-borde bg-fondo text-sm text-tenue-fg file:mr-3 file:cursor-pointer file:rounded-l-md file:border-0 file:bg-tenue file:px-4 file:py-2.5 file:text-sm file:font-medium file:text-tinta"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="firma-contrasena">
                Contraseña del certificado <span className="text-peligro">*</span>
              </Label>
              {/* type=password: no se ve al teclear. Y mayusculas={false}: una
                  contraseña jamás se transforma. */}
              <Input
                id="firma-contrasena"
                type="password"
                value={contrasena}
                onChange={(e) => setContrasena(e.target.value)}
                autoComplete="new-password"
                mayusculas={false}
                placeholder="••••••••"
              />
              <p className="text-xs text-tenue-fg">
                Se comprueba abriendo el certificado antes de guardar: si no coincide, no se
                guarda nada.
              </p>
            </div>
            <Boton type="submit" cargando={guardar.isPending}>
              <UploadCloud aria-hidden="true" />
              {datos?.configurada && !bloqueadaPorEntorno ? 'Reemplazar firma' : 'Guardar firma'}
            </Boton>
          </fieldset>
        </form>
      </motion.section>
    </div>
  )
}
