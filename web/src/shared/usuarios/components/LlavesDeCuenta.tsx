import { useMutation } from '@tanstack/react-query'
import { KeyRound, Mail } from 'lucide-react'
import { useState, type FormEvent } from 'react'

import { useSesion } from '@/core/auth/useSesion'
import { Boton } from '@/shared/components/ui/button'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { Modal } from '@/shared/components/ui/modal'
import { useToast } from '@/shared/components/ui/toast'
import { cambiarPasswordComoAdmin, enviarEnlaceRestablecer } from '@/shared/usuarios/api'

const MINIMO = 12

function mensajeDeError(error: unknown, porDefecto: string): string {
  const detalle = (error as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
  if (typeof detalle === 'string') return detalle
  if (Array.isArray(detalle) && detalle.length > 0) {
    return (detalle[0] as { mensaje?: string }).mensaje ?? porDefecto
  }
  return porDefecto
}

/**
 * **Las dos llaves de la cuenta, solo para el superadministrador** (14/10/2026):
 *
 * - «Cambiar contraseña»: para entrar con la cuenta de quien renunció con casos
 *   abiertos, cerrarlos y luego desactivarlo. Pide el motivo, que queda en la
 *   auditoría junto a quién la cambió.
 * - «Enviar enlace para restablecer»: cuando a alguien se le olvida. Le llega
 *   al correo un enlace de un solo uso a la página común; la contraseña es la
 *   misma para todas sus aplicaciones.
 *
 * Para cualquier otro no se pinta nada, y el servidor lo rechaza igual.
 */
export function LlavesDeCuenta({
  userId,
  email,
  activo,
}: {
  userId: string
  email: string
  activo: boolean
}) {
  const { data: sesion } = useSesion()
  const toast = useToast()
  const [abierto, setAbierto] = useState(false)
  const [confirmarEnlace, setConfirmarEnlace] = useState(false)
  const [password, setPassword] = useState('')
  const [repetida, setRepetida] = useState('')
  const [motivo, setMotivo] = useState('')

  const cambiar = useMutation({
    mutationFn: () => cambiarPasswordComoAdmin(userId, password, motivo.trim()),
    onSuccess: () => {
      toast.exito('Contraseña cambiada. Se cerraron sus sesiones abiertas.')
      cerrar()
    },
    onError: (error) => toast.error(mensajeDeError(error, 'No se pudo cambiar la contraseña')),
  })
  const enlace = useMutation({
    mutationFn: () => enviarEnlaceRestablecer(userId),
    onSuccess: (r) => {
      toast.exito(r.detail)
      setConfirmarEnlace(false)
    },
    onError: (error) => toast.error(mensajeDeError(error, 'No se pudo enviar el enlace')),
  })

  if (!sesion?.user.es_admin_global || sesion.user.id === userId) return null

  function cerrar() {
    setAbierto(false)
    setPassword('')
    setRepetida('')
    setMotivo('')
  }

  const largo = password.length >= MINIMO
  const iguales = password.length > 0 && password === repetida
  const conMotivo = motivo.trim().length >= 3
  const listo = largo && iguales && conMotivo

  function enviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault()
    if (listo) cambiar.mutate()
  }

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Boton
          type="button"
          variante="contorno"
          tamano="sm"
          disabled={!activo}
          title={activo ? undefined : 'Actívalo primero'}
          onClick={() => setAbierto(true)}
        >
          <KeyRound aria-hidden="true" />
          Cambiar contraseña
        </Boton>
        <Boton
          type="button"
          variante="contorno"
          tamano="sm"
          disabled={!activo}
          title={activo ? undefined : 'Actívalo primero'}
          onClick={() => setConfirmarEnlace(true)}
        >
          <Mail aria-hidden="true" />
          Enviar enlace para restablecer
        </Boton>
      </div>

      <Modal
        abierto={abierto}
        onCerrar={cerrar}
        titulo="Cambiar contraseña"
        descripcion={`De ${email}. Sirve para todas sus aplicaciones; sus sesiones abiertas se cierran.`}
        pie={
          <>
            <Boton type="button" variante="contorno" onClick={cerrar}>
              Cancelar
            </Boton>
            <Boton type="submit" form="form-llave" disabled={!listo} cargando={cambiar.isPending}>
              Cambiar contraseña
            </Boton>
          </>
        }
      >
        <form id="form-llave" onSubmit={enviar} noValidate className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="llave-password">Contraseña nueva</Label>
            <Input
              id="llave-password"
              type="password"
              autoComplete="new-password"
              mayusculas={false}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <p className={`text-xs ${largo ? 'text-exito' : 'text-tenue-fg'}`}>
              Al menos {MINIMO} caracteres
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="llave-repetida">Repítela</Label>
            <Input
              id="llave-repetida"
              type="password"
              autoComplete="new-password"
              mayusculas={false}
              value={repetida}
              onChange={(e) => setRepetida(e.target.value)}
            />
            {repetida && !iguales && <p className="text-xs text-peligro">No coinciden</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="llave-motivo">Motivo (queda en la auditoría)</Label>
            <Input
              id="llave-motivo"
              mayusculas={false}
              placeholder="Ej.: renunció; cerrar CONC-0001 antes de desactivarlo"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
            />
          </div>
        </form>
      </Modal>

      <Modal
        abierto={confirmarEnlace}
        onCerrar={() => setConfirmarEnlace(false)}
        titulo="Enviar enlace para restablecer"
        descripcion={`Le llegará a ${email} un enlace de un solo uso para poner una contraseña nueva, la misma para todas sus aplicaciones. Su contraseña actual sigue valiendo hasta que lo use.`}
        pie={
          <>
            <Boton type="button" variante="contorno" onClick={() => setConfirmarEnlace(false)}>
              Cancelar
            </Boton>
            <Boton type="button" onClick={() => enlace.mutate()} cargando={enlace.isPending}>
              Enviar enlace
            </Boton>
          </>
        }
      >
        <p className="text-sm text-tenue-fg">
          Al abrirlo pondrá su contraseña y entrará por el inicio de sesión; desde ahí la
          plataforma lo lleva a su aplicación, o le deja elegir si tiene varias.
        </p>
      </Modal>
    </>
  )
}
