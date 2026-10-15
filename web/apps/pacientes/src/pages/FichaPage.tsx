import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, ExternalLink, FileSignature, Pencil } from 'lucide-react'
import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

import {
  corregirPaciente,
  obtenerPaciente,
  pedirInforme,
  type IdentidadPaciente,
  type Paciente,
  type ResumenModulo,
} from '@pacientes/api'
import { fecha, nombreCompleto } from '@pacientes/pages/ListaPage'
import { destinoDeModuloEnOtraPestana } from '@/core/dominios'
import { Boton } from '@/shared/components/ui/button'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { MenuAcciones, type OpcionDeMenu } from '@/shared/components/ui/menu'
import { Modal } from '@/shared/components/ui/modal'
import { Select } from '@/shared/components/ui/select'
import { useCiudades, useProvincias } from '@/shared/catalogos/hooks'
import { useToast } from '@/shared/components/ui/toast'

/** Cómo se lee cada tipo de evento. Uno nuevo de otra app sale con su código. */
const TIPOS: Record<string, string> = {
  visita_concurrencia: 'Visita de concurrencia',
  informe_concurrencia: 'Informe final entregado',
  caso_calificacion_riesgo: 'Caso de Calificación de Riesgo finalizado',
}

function detalleError(error: unknown, porDefecto: string): string {
  const d = (error as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
  return typeof d === 'string' ? d : porDefecto
}

/**
 * La ficha de un paciente (D49): su identidad —que corrige SOLO este registro,
 * porque la central es su dueña— y lo que le ha pasado en TODAS las auditorías.
 * Lo clínico no está aquí: el caso se abre en su app y el informe final, con un
 * enlace de un solo uso que emite la central (D3).
 */
export function FichaPage() {
  const { id } = useParams<{ id: string }>()
  const navegar = useNavigate()
  const consulta = useQuery({
    queryKey: ['paciente', id],
    queryFn: () => obtenerPaciente(id!),
    enabled: Boolean(id),
  })
  const [editando, setEditando] = useState(false)
  const toast = useToast()
  // El cuadro pulsado: filtra el historial a ese módulo. Vacío = todo.
  const [modulo, setModulo] = useState('')
  const p = consulta.data
  const casos = p ? (modulo ? p.casos.filter((c) => c.aplicacion_codigo === modulo) : p.casos) : []

  /**
   * «Ver informe»: se abre directo, sin pedir motivo (15/10/2026), en el visor
   * de PDF del navegador, desde donde se puede descargar. La pestaña se abre YA,
   * en el mismo clic —abrirla después de esperar al servidor la bloquearía el
   * navegador como ventana emergente— y luego se le pone el enlace.
   */
  function verInforme(eventoId: string) {
    const pestana = window.open('about:blank', '_blank')
    if (pestana) pestana.opener = null
    pedirInforme(eventoId)
      .then((r) => {
        if (pestana) pestana.location.href = r.url
        else window.open(r.url, '_blank', 'noopener')
      })
      .catch((error: unknown) => {
        pestana?.close()
        toast.error(detalleError(error, 'No pudimos abrir el informe'))
      })
  }
  const nombreDelModulo = p?.modulos.find((m) => m.codigo === modulo)?.nombre

  return (
    <div className="px-4 py-8 sm:px-8">
      <Boton variante="fantasma" tamano="sm" onClick={() => navegar('/dashboard')}>
        <ArrowLeft aria-hidden="true" />
        Pacientes
      </Boton>

      {consulta.isError ? (
        <p className="mt-6 text-sm text-tenue-fg">
          {detalleError(consulta.error, 'No pudimos cargar la ficha del paciente.')}
        </p>
      ) : !p ? (
        <div className="mt-6 space-y-3" role="status" aria-label="Cargando">
          <div className="h-7 w-1/2 animate-pulse rounded bg-tenue" />
          <div className="h-24 animate-pulse rounded bg-tenue" />
        </div>
      ) : (
        <>
          <header className="mt-4 flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="font-display text-2xl font-semibold tracking-tight">{nombreCompleto(p)}</h1>
              <p className="mt-1 font-mono text-xs text-tenue-fg">
                {p.tipo_documento_codigo} · {p.numero_documento}
              </p>
            </div>
            <Boton variante="contorno" onClick={() => setEditando(true)}>
              <Pencil aria-hidden="true" />
              Corregir datos
            </Boton>
          </header>

          <dl className="mt-6 grid gap-4 rounded-md border border-borde bg-superficie p-5 text-sm sm:grid-cols-3">
            <Dato titulo="Sexo" valor={p.sexo ? SEXOS[p.sexo] : null} />
            <Dato titulo="Fecha de nacimiento" valor={p.fecha_nacimiento ? fecha(p.fecha_nacimiento) : null} />
            <Dato titulo="Correo" valor={p.email} />
            <Dato titulo="Teléfono" valor={p.telefono} />
            <Dato titulo="Otro teléfono" valor={p.telefono_secundario} />
            <Dato
              titulo="Ciudad"
              valor={[p.ciudad_nombre, p.provincia_nombre].filter(Boolean).join(', ') || null}
            />
            <div className="sm:col-span-3">
              <Dato titulo="Dirección del domicilio" valor={p.direccion} />
            </div>
            <Dato titulo="En el registro desde" valor={fecha(p.created_at)} />
            <Dato titulo="Última corrección" valor={fecha(p.updated_at)} />
          </dl>

          {/* Un cuadro por módulo de Accumedical con los casos de esta persona
              que FINALIZARON en él (15/10/2026). Como los de Concurrencia, cada
              uno es también un filtro: pulsarlo deja el historial en ese módulo. */}
          <section className="mt-8" aria-label="Casos finalizados por módulo">
            <h2 className="font-display text-base font-semibold">Casos finalizados por módulo</h2>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
              {p.modulos.map((m) => (
                <CuadroModulo
                  key={m.codigo}
                  modulo={m}
                  activo={modulo === m.codigo}
                  alPulsar={() => setModulo((actual) => (actual === m.codigo ? '' : m.codigo))}
                />
              ))}
            </div>
          </section>

          <div className="mt-8 flex flex-wrap items-baseline justify-between gap-3">
            <h2 className="font-display text-base font-semibold">
              Historial en las auditorías
              {nombreDelModulo ? <span className="font-normal text-tenue-fg"> · {nombreDelModulo}</span> : null}
            </h2>
            {modulo && (
              <button
                type="button"
                onClick={() => setModulo('')}
                className="text-sm font-medium text-marca transition-opacity duration-150 hover:opacity-80"
              >
                Ver todos los módulos
              </button>
            )}
          </div>
          {casos.length === 0 ? (
            <p className="mt-3 text-sm text-tenue-fg">
              {modulo
                ? 'Sin movimientos en este módulo.'
                : 'Todavía sin movimientos: aparecen cuando un caso suyo culmina o se entrega su informe.'}
            </p>
          ) : (
            <ol className="mt-3 space-y-3">
              {casos.map((c) => {
                // Las acciones ya llegan decididas: «Ver informe» si lo hay (lo ve
                // todo el personal) y «Ver caso» solo si quien mira puede entrar a
                // esa app como coordinador o es el superadministrador.
                const opciones: OpcionDeMenu[] = [
                  ...(c.informe_evento_id
                    ? [{ etiqueta: 'Ver informe', icono: FileSignature, onSelect: () => verInforme(c.informe_evento_id!) }]
                    : []),
                  ...(c.ruta_caso
                    ? [
                        {
                          etiqueta: 'Ver caso',
                          icono: ExternalLink,
                          onSelect: () =>
                            window.open(destinoDeModuloEnOtraPestana(c.ruta_caso!) ?? c.ruta_caso!, '_blank', 'noopener'),
                        },
                      ]
                    : []),
                ]
                return (
                  <li key={c.clave} className="rounded-md border border-borde bg-superficie p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-medium">{TIPOS[c.tipo_evento] ?? c.tipo_evento}</p>
                        <p className="mt-0.5 text-xs text-tenue-fg">
                          {c.aplicacion_nombre} · {fecha(c.fecha)}
                          {c.aseguradora_nombre ? ` · ${c.aseguradora_nombre}` : ''}
                          {c.codigo ? ` · ${c.codigo}` : ''}
                        </p>
                        {c.informe && (
                          <p className="mt-1 text-xs text-tenue-fg">
                            Informe final · entrega {c.informe.numero_entrega ?? '—'}
                            {c.informe.firmado
                              ? ` · firmado por ${c.informe.firmante ?? '—'}`
                              : ' · sin firma electrónica'}
                          </p>
                        )}
                      </div>
                      {opciones.length > 0 && (
                        <MenuAcciones etiqueta={`Acciones de ${c.codigo ?? 'este caso'}`} opciones={opciones} />
                      )}
                    </div>
                  </li>
                )
              })}
            </ol>
          )}

          <CorregirIdentidad paciente={p} abierto={editando} onCerrar={() => setEditando(false)} />
        </>
      )}
    </div>
  )
}

const SEXOS = { femenino: 'Femenino', masculino: 'Masculino' } as const

function Dato({ titulo, valor }: { titulo: string; valor: string | null }) {
  return (
    <div>
      <dt className="text-xs text-tenue-fg">{titulo}</dt>
      <dd className="mt-0.5">{valor || '—'}</dd>
    </div>
  )
}

function CorregirIdentidad({ paciente, abierto, onCerrar }: { paciente: Paciente; abierto: boolean; onCerrar: () => void }) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const inicial = (): IdentidadPaciente => ({
    nombre_principal: paciente.nombre_principal,
    nombre_secundario: paciente.nombre_secundario,
    apellido_paterno: paciente.apellido_paterno,
    apellido_materno: paciente.apellido_materno,
    email: paciente.email,
    telefono: paciente.telefono,
    fecha_nacimiento: paciente.fecha_nacimiento,
    sexo: paciente.sexo,
    telefono_secundario: paciente.telefono_secundario,
    provincia_codigo: paciente.provincia_codigo,
    ciudad_codigo: paciente.ciudad_codigo,
    direccion: paciente.direccion,
  })
  const [form, setForm] = useState<IdentidadPaciente>(inicial)
  const provincias = useProvincias()
  const ciudades = useCiudades(form.provincia_codigo || null)
  const guardar = useMutation({
    mutationFn: () =>
      corregirPaciente(paciente.id, {
        ...form,
        nombre_secundario: form.nombre_secundario || null,
        apellido_materno: form.apellido_materno || null,
        email: form.email || null,
        telefono: form.telefono || null,
        fecha_nacimiento: form.fecha_nacimiento || null,
        sexo: form.sexo || null,
        telefono_secundario: form.telefono_secundario || null,
        provincia_codigo: form.provincia_codigo || null,
        ciudad_codigo: form.ciudad_codigo || null,
        direccion: form.direccion?.trim() || null,
      }),
    onSuccess: (datos) => {
      queryClient.setQueryData(['paciente', paciente.id], datos)
      void queryClient.invalidateQueries({ queryKey: ['pacientes'] })
      toast.exito('Datos del paciente corregidos')
      onCerrar()
    },
    onError: (error) => toast.error(detalleError(error, 'No pudimos guardar la corrección')),
  })
  const campo = (clave: keyof IdentidadPaciente, titulo: string, props: Record<string, unknown> = {}) => (
    <div>
      <Label htmlFor={`p-${clave}`}>{titulo}</Label>
      <Input
        id={`p-${clave}`}
        value={form[clave] ?? ''}
        onChange={(e) => setForm({ ...form, [clave]: e.target.value })}
        {...props}
      />
    </div>
  )
  return (
    <Modal
      abierto={abierto}
      onCerrar={onCerrar}
      titulo="Corregir datos del paciente"
      descripcion="El documento no se cambia: es su identidad. Obligatorios solo el primer nombre y el apellido paterno; lo demás es opcional. Lo que corrijas aquí lo verán todas las auditorías."
      pie={
        <>
          <Boton variante="fantasma" onClick={onCerrar}>
            Cancelar
          </Boton>
          <Boton onClick={() => guardar.mutate()} cargando={guardar.isPending}>
            Guardar
          </Boton>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {campo('nombre_principal', 'Primer nombre')}
        {campo('nombre_secundario', 'Segundo nombre')}
        {campo('apellido_paterno', 'Apellido paterno')}
        {campo('apellido_materno', 'Apellido materno')}
        {campo('email', 'Correo', { type: 'email', mayusculas: false })}
        {campo('telefono', 'Teléfono', { mayusculas: false })}
        {campo('fecha_nacimiento', 'Fecha de nacimiento', { type: 'date' })}
        <div>
          <Label htmlFor="p-sexo">Sexo</Label>
          <Select
            id="p-sexo"
            value={form.sexo ?? ''}
            onChange={(e) => setForm({ ...form, sexo: (e.target.value || null) as IdentidadPaciente['sexo'] })}
          >
            <option value="">Sin dato</option>
            <option value="femenino">Femenino</option>
            <option value="masculino">Masculino</option>
          </Select>
        </div>
        {campo('telefono_secundario', 'Otro teléfono', { mayusculas: false })}
        <div>
          <Label htmlFor="p-provincia">Provincia</Label>
          <Select
            id="p-provincia"
            value={form.provincia_codigo ?? ''}
            // Cambiar de provincia invalida la ciudad: es de la otra.
            onChange={(e) => setForm({ ...form, provincia_codigo: e.target.value || null, ciudad_codigo: null })}
          >
            <option value="">Sin dato</option>
            {provincias.data?.map((p) => (
              <option key={p.codigo} value={p.codigo}>
                {p.nombre}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="p-ciudad">Ciudad o cantón</Label>
          <Select
            id="p-ciudad"
            value={form.ciudad_codigo ?? ''}
            onChange={(e) => setForm({ ...form, ciudad_codigo: e.target.value || null })}
            disabled={!form.provincia_codigo}
          >
            <option value="">{form.provincia_codigo ? 'Sin dato' : 'Elige primero la provincia'}</option>
            {ciudades.data?.map((c) => (
              <option key={c.codigo} value={c.codigo}>
                {c.nombre}
              </option>
            ))}
          </Select>
        </div>
        <div className="sm:col-span-2">{campo('direccion', 'Dirección del domicilio')}</div>
      </div>
    </Modal>
  )
}

/**
 * Un cuadro de la ficha: el módulo con su color y cuántos casos de la persona
 * finalizaron en él. Pulsarlo filtra el historial; pulsarlo otra vez lo quita.
 * El color sale del token del módulo (`--modulo-<código>`), el mismo de toda
 * la plataforma: un punto junto al nombre, nunca el número entero coloreado.
 */
function CuadroModulo({
  modulo,
  activo,
  alPulsar,
}: {
  modulo: ResumenModulo
  activo: boolean
  alPulsar: () => void
}) {
  const color = `hsl(var(--modulo-${modulo.codigo.replace(/_/g, '-')}))`
  return (
    <button
      type="button"
      onClick={alPulsar}
      aria-pressed={activo}
      aria-label={`${modulo.nombre}: ${modulo.finalizados} finalizados. Filtrar el historial`}
      className={[
        'rounded-md border bg-superficie px-4 py-4 text-left transition-colors duration-150',
        'hover:bg-tenue/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-marca',
        activo ? 'border-marca ring-1 ring-marca' : 'border-borde hover:border-tenue-fg/40',
      ].join(' ')}
    >
      <span className="flex items-center gap-1.5 font-display text-[0.6875rem] font-semibold uppercase tracking-[0.09em] text-tenue-fg">
        <span className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: color }} aria-hidden="true" />
        <span className="truncate">{modulo.nombre}</span>
      </span>
      <span className="tabular mt-2 block font-display text-3xl font-semibold tracking-tight">
        {modulo.finalizados}
      </span>
      <span className="mt-0.5 block text-xs text-tenue-fg">
        {modulo.finalizados === 1 ? 'caso finalizado' : 'casos finalizados'}
      </span>
    </button>
  )
}
