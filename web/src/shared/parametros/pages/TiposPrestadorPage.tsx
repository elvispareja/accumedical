import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { Lock, Plus, Power, RotateCw, Stethoscope } from 'lucide-react'
import { useState } from 'react'

import { EstadoBadge } from '@/shared/components/ui/badge'
import { Boton } from '@/shared/components/ui/button'
import { Checkbox } from '@/shared/components/ui/checkbox'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { Modal } from '@/shared/components/ui/modal'
import { useToast } from '@/shared/components/ui/toast'
import {
  actualizarTipoPrestador,
  crearTipoPrestador,
  listarTiposPrestador,
  type TipoPrestador,
} from '@/shared/parametros/api'

const EASE: [number, number, number, number] = [0.22, 0.61, 0.36, 1]
const CLAVE = ['parametros', 'tipos-prestador'] as const

function mensajeDeError(error: unknown, porDefecto: string): string {
  const detalle = (error as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
  return typeof detalle === 'string' ? detalle : porDefecto
}

/**
 * Los tipos de prestador: lo que alimenta el desplegable «Tipo de prestador»
 * del formulario. Se administran aquí para no necesitar una migración cada vez
 * que aparece un «Centro de imágenes».
 *
 * **Un tipo en uso no se retira.** El prestador guarda el código del tipo, así
 * que sacarlo del desplegable dejaría su ficha sin poder reabrirse igual. La
 * pantalla lo dice antes de intentarlo y el servidor lo corta igualmente.
 */
export function TiposPrestadorPage() {
  const toast = useToast()
  const queryClient = useQueryClient()
  const sinMovimiento = useReducedMotion()
  const [editando, setEditando] = useState<TipoPrestador | null>(null)
  const [creando, setCreando] = useState(false)

  const consulta = useQuery({ queryKey: CLAVE, queryFn: listarTiposPrestador })

  function alGuardar(mensaje: string) {
    queryClient.invalidateQueries({ queryKey: CLAVE })
    // El desplegable del formulario de prestadores bebe de otro catálogo: hay
    // que refrescarlo también, o seguiría ofreciendo la lista de antes.
    queryClient.invalidateQueries({ queryKey: ['catalogo', 'tipos-prestador'] })
    toast.exito(mensaje)
  }

  const alternar = useMutation({
    mutationFn: (t: TipoPrestador) => actualizarTipoPrestador(t.codigo, { activo: !t.activo }),
    onSuccess: (t) => alGuardar(t.activo ? `«${t.nombre}» vuelve a ofrecerse` : `«${t.nombre}» retirado`),
    onError: (error) => toast.error(mensajeDeError(error, 'No se pudo cambiar el estado')),
  })

  const tipos = consulta.data ?? []

  return (
    <div className="w-full">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-display text-[0.6875rem] font-semibold uppercase tracking-[0.16em] text-tenue-fg">
            Parámetros
          </p>
          <h1 className="mt-1.5 font-display text-2xl font-semibold tracking-tight">
            Tipo de prestador
          </h1>
          <p className="mt-1 text-sm text-tenue-fg">
            Lo que se ofrece en el desplegable al dar de alta un prestador.
          </p>
        </div>
        <Boton onClick={() => setCreando(true)}>
          <Plus aria-hidden="true" />
          Nuevo tipo
        </Boton>
      </header>

      {consulta.isPending ? (
        <div className="mt-7 space-y-2" role="status" aria-label="Cargando tipos">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="h-14 animate-pulse rounded-md bg-tenue" />
          ))}
        </div>
      ) : consulta.isError ? (
        <div className="mt-7 rounded-md border border-borde bg-superficie px-6 py-14 text-center">
          <p className="font-display text-sm font-medium">No pudimos cargar los tipos.</p>
          <Boton
            variante="contorno"
            tamano="sm"
            className="mt-4"
            onClick={() => consulta.refetch()}
          >
            <RotateCw aria-hidden="true" />
            Reintentar
          </Boton>
        </div>
      ) : tipos.length === 0 ? (
        <div className="mt-7 rounded-md border border-borde bg-superficie px-6 py-16 text-center">
          <Stethoscope className="mx-auto size-6 text-tenue-fg" aria-hidden="true" />
          <p className="mt-3 font-display text-sm font-medium">No hay ningún tipo todavía</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-tenue-fg">
            Sin tipos, el alta de prestadores no puede completarse: crea el primero.
          </p>
        </div>
      ) : (
        <div className="mt-7 overflow-x-auto rounded-md border border-borde bg-superficie">
          <table className="w-full min-w-[42rem] text-sm">
            <thead>
              <tr className="border-b border-borde bg-tenue/40 text-left">
                <Th>Tipo</Th>
                <Th>Código</Th>
                <Th>En uso</Th>
                <Th>Estado</Th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              <AnimatePresence initial={false}>
                {tipos.map((t, indice) => (
                  <motion.tr
                    key={t.codigo}
                    initial={sinMovimiento ? { opacity: 0 } : { opacity: 0, y: 6 }}
                    animate={{
                      opacity: 1,
                      y: 0,
                      transition: {
                        duration: 0.22,
                        delay: sinMovimiento ? 0 : Math.min(indice, 8) * 0.03,
                        ease: EASE,
                      },
                    }}
                    exit={{ opacity: 0, transition: { duration: 0.15 } }}
                    className="border-b border-borde last:border-b-0 hover:bg-tenue/50"
                  >
                    <td className="px-4 py-3">
                      <p className="font-medium">{t.nombre}</p>
                      {t.es_persona && (
                        <p className="text-xs text-tenue-fg">Profesional, no establecimiento</p>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-tenue-fg">{t.codigo}</td>
                    <td className="px-4 py-3 text-tenue-fg">
                      {t.en_uso === 0
                        ? '—'
                        : `${t.en_uso} ${t.en_uso === 1 ? 'prestador' : 'prestadores'}`}
                    </td>
                    <td className="px-4 py-3">
                      <EstadoBadge estado={t.activo ? 'activo' : 'inactivo'} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        <Boton
                          variante="contorno"
                          tamano="sm"
                          onClick={() => setEditando(t)}
                          aria-label={`Editar ${t.nombre}`}
                        >
                          Editar
                        </Boton>
                        {/* Retirar uno en uso rompería la ficha de esos
                            prestadores, así que ni se ofrece; el candado explica
                            por qué en vez de dejar un botón muerto. */}
                        {t.activo && t.en_uso > 0 ? (
                          <span
                            className="inline-flex size-9 items-center justify-center text-tenue-fg"
                            title={`Lo usan ${t.en_uso} ${
                              t.en_uso === 1 ? 'prestador' : 'prestadores'
                            }: no se puede retirar`}
                          >
                            <Lock className="size-4" aria-hidden="true" />
                            <span className="sr-only">
                              En uso por {t.en_uso}: no se puede retirar
                            </span>
                          </span>
                        ) : (
                          <Boton
                            variante="fantasma"
                            tamano="icono"
                            onClick={() => alternar.mutate(t)}
                            cargando={alternar.isPending}
                            aria-label={`${t.activo ? 'Retirar' : 'Volver a ofrecer'} ${t.nombre}`}
                            className={t.activo ? 'hover:text-aviso' : undefined}
                          >
                            <Power aria-hidden="true" />
                          </Boton>
                        )}
                      </div>
                    </td>
                  </motion.tr>
                ))}
              </AnimatePresence>
            </tbody>
          </table>
        </div>
      )}

      <FormularioTipo
        abierto={creando}
        onCerrar={() => setCreando(false)}
        onHecho={(nombre) => alGuardar(`«${nombre}» ya se ofrece en el desplegable`)}
      />
      <FormularioTipo
        key={editando?.codigo}
        tipo={editando ?? undefined}
        abierto={editando !== null}
        onCerrar={() => setEditando(null)}
        onHecho={() => alGuardar('Tipo actualizado')}
      />
    </div>
  )
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-4 py-2.5 font-display text-[0.6875rem] font-semibold uppercase tracking-[0.09em] text-tenue-fg">
      {children}
    </th>
  )
}

/** Alta y edición: los mismos dos campos, un solo formulario. */
function FormularioTipo({
  tipo,
  abierto,
  onCerrar,
  onHecho,
}: {
  tipo?: TipoPrestador
  abierto: boolean
  onCerrar: () => void
  onHecho: (nombre: string) => void
}) {
  const toast = useToast()
  const [nombre, setNombre] = useState(tipo?.nombre ?? '')
  const [esPersona, setEsPersona] = useState(tipo?.es_persona ?? false)

  const guardar = useMutation({
    mutationFn: () =>
      tipo
        ? actualizarTipoPrestador(tipo.codigo, { nombre: nombre.trim(), es_persona: esPersona })
        : crearTipoPrestador({ nombre: nombre.trim(), es_persona: esPersona }),
    onSuccess: (guardado) => {
      onHecho(guardado.nombre)
      onCerrar()
      if (!tipo) {
        setNombre('')
        setEsPersona(false)
      }
    },
    onError: (error) => toast.error(mensajeDeError(error, 'No se pudo guardar el tipo')),
  })

  return (
    <Modal
      abierto={abierto}
      onCerrar={onCerrar}
      titulo={tipo ? `Editar ${tipo.nombre}` : 'Nuevo tipo de prestador'}
      descripcion={
        tipo
          ? 'Cambiar el nombre no toca a los prestadores ya registrados: ellos guardan el código.'
          : 'Aparecerá en el desplegable del alta de prestadores.'
      }
      pie={
        <>
          <Boton type="button" variante="contorno" onClick={onCerrar}>
            Cancelar
          </Boton>
          <Boton
            type="button"
            onClick={() => {
              if (nombre.trim().length < 2) return toast.error('Escribe el nombre del tipo')
              guardar.mutate()
            }}
            cargando={guardar.isPending}
          >
            {tipo ? 'Guardar cambios' : 'Crear tipo'}
          </Boton>
        </>
      }
    >
      <div className="space-y-5">
        <div className="space-y-2">
          <Label htmlFor="tipo-nombre">
            Nombre <span className="text-peligro">*</span>
          </Label>
          {/* Sin mayúsculas automáticas: esto NO es dato de expediente sino
              una etiqueta del sistema, y «CENTRO DE IMÁGENES» desentonaría en un
              desplegable donde los de fábrica son «Hospital» y «Clínica»
              (`docs/07`, §1). */}
          <Input
            id="tipo-nombre"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            placeholder="Centro de imágenes"
            maxLength={100}
            mayusculas={false}
          />
          <p className="text-xs text-tenue-fg">
            {tipo
              ? `Código: ${tipo.codigo} — no cambia, es lo que guardan los prestadores.`
              : 'El código se genera solo a partir del nombre.'}
          </p>
        </div>
        <Checkbox
          id="tipo-es-persona"
          checked={esPersona}
          onChange={setEsPersona}
          titulo="Es un profesional, no un establecimiento"
          descripcion="Como «Médico» u «Odontólogo». Distingue a una persona de una clínica."
        />
      </div>
    </Modal>
  )
}
