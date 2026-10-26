import { useMutation, useQueryClient } from '@tanstack/react-query'
import { motion, useReducedMotion } from 'framer-motion'
import { ArrowLeft, Hash, ImagePlus, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { cn } from '@/lib/utils'
import { problemaConDocumento } from '@/shared/identificacion'
import {
  useCiudades,
  useProvincias,
  useTiposDocumento,
  useTiposPrestador,
} from '@/shared/catalogos/hooks'
import { Boton } from '@/shared/components/ui/button'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { Select } from '@/shared/components/ui/select'
import { Tabs } from '@/shared/components/ui/tabs'
import { useToast } from '@/shared/components/ui/toast'
import {
  ContactosPanel,
  contactoVacio,
  desdeApi,
  haciaApi,
  validar as validarContactos,
} from '@/shared/contactos/ContactosPanel'
import { MapaUbicacion } from '@/shared/mapa/MapaUbicacion'
import {
  actualizarPrestador,
  crearPrestador,
  subirLogo,
  urlLogo,
  type ContactoFormulario,
  type Estado,
  type PrestadorFormulario,
  type SedeFormulario,
} from '@/shared/prestadores/api'
import {
  SedesPanel,
  desdeApi as sedesDesdeApi,
  haciaApi as sedesHaciaApi,
  validar as validarSedes,
} from '@/shared/prestadores/components/SedesPanel'
import { ConveniosPanel } from '@/shared/prestadores/components/ConveniosPanel'
import { usePrestador } from '@/shared/prestadores/hooks'
import { useApp } from '@/core/app/contexto'

const EASE: [number, number, number, number] = [0.22, 0.61, 0.36, 1]
const MAX_LOGO_MB = 5
const TIPOS_LOGO = ['image/png', 'image/jpeg', 'image/webp']

const VACIO: PrestadorFormulario = {
  tipo_codigo: '',
  nombre: '',
  ruc: '',
  estado: 'activo',
  provincia_codigo: null,
  ciudad_codigo: null,
  direccion: null,
  latitud: null,
  longitud: null,
  contactos: [],
  // Tener sedes es opcional: un prestador nuevo nace sin ninguna.
  sedes: [],
  // Y sin convenio con ninguna aseguradora.
}

function mensajeDeError(error: unknown, porDefecto: string): string {
  const detalle = (error as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
  if (typeof detalle === 'string') return detalle
  if (Array.isArray(detalle) && detalle.length > 0) {
    return (detalle[0] as { mensaje?: string }).mensaje ?? porDefecto
  }
  return porDefecto
}

/** Agrupa campos afines. En una página completa hay sitio para dar estructura. */
function Bloque({
  titulo,
  descripcion,
  children,
  retraso = 0,
}: {
  titulo: string
  descripcion?: string
  children: ReactNode
  retraso?: number
}) {
  const sinMovimiento = useReducedMotion()
  return (
    <motion.section
      initial={sinMovimiento ? { opacity: 0 } : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.26, delay: sinMovimiento ? 0 : retraso, ease: EASE }}
      className="rounded-md border border-borde bg-superficie p-5 sm:p-6"
    >
      <h2 className="font-display text-sm font-semibold">{titulo}</h2>
      {descripcion && <p className="mt-0.5 text-sm text-tenue-fg">{descripcion}</p>}
      <div className="mt-5">{children}</div>
    </motion.section>
  )
}

export function PrestadorFormPage() {
  const { raiz } = useApp()
  const LISTADO = `${raiz}/prestadores`
  const { id } = useParams<{ id: string }>()
  const editando = Boolean(id)
  const navegar = useNavigate()
  const queryClient = useQueryClient()
  const toast = useToast()

  const detalle = usePrestador(id ?? null)
  const provincias = useProvincias()
  const tipos = useTiposPrestador()
  const tiposDocumento = useTiposDocumento()

  const [pestana, setPestana] = useState('generales')
  const [form, setForm] = useState<PrestadorFormulario>(VACIO)
  const [logoNuevo, setLogoNuevo] = useState<File | null>(null)
  const [errorLogo, setErrorLogo] = useState<string | null>(null)
  const entradaArchivo = useRef<HTMLInputElement>(null)

  const ciudades = useCiudades(form.provincia_codigo)

  // Al editar, el formulario se rellena cuando llega el detalle del servidor.
  useEffect(() => {
    if (!detalle.data) return
    setForm({
      tipo_codigo: detalle.data.tipo_codigo,
      nombre: detalle.data.nombre,
      ruc: detalle.data.ruc,
      estado: detalle.data.estado as Estado,
      provincia_codigo: detalle.data.provincia_codigo,
      ciudad_codigo: detalle.data.ciudad_codigo,
      direccion: detalle.data.direccion,
      latitud: detalle.data.latitud,
      longitud: detalle.data.longitud,
      contactos: desdeApi(detalle.data.contactos),
      sedes: sedesDesdeApi(detalle.data.sedes ?? []),
    })
  }, [detalle.data])

  const previsualizacion = useMemo(
    () => (logoNuevo ? URL.createObjectURL(logoNuevo) : null),
    [logoNuevo],
  )
  useEffect(() => {
    return () => {
      if (previsualizacion) URL.revokeObjectURL(previsualizacion)
    }
  }, [previsualizacion])

  function actualizar<K extends keyof PrestadorFormulario>(
    campo: K,
    valor: PrestadorFormulario[K],
  ) {
    setForm((previo) => ({ ...previo, [campo]: valor }))
  }

  function alElegirProvincia(codigo: string) {
    // Cambiar de provincia invalida la ciudad: si no se limpiara, podría guardarse
    // una ciudad que no pertenece a la provincia nueva.
    setForm((previo) => ({ ...previo, provincia_codigo: codigo || null, ciudad_codigo: null }))
  }

  // Los `?? []` de aquí abajo no son paranoia: durante el desarrollo, el recargado
  // en caliente de Vite conserva el estado de un render anterior, y un campo
  // añadido después no existe en él.
  function anadirContacto() {
    setForm((previo) => ({
      ...previo,
      contactos: [...(previo.contactos ?? []), contactoVacio()],
    }))
  }

  function cambiarContacto(clave: string, campo: keyof ContactoFormulario, valor: string) {
    setForm((previo) => ({
      ...previo,
      contactos: (previo.contactos ?? []).map((c) =>
        c._key === clave ? { ...c, [campo]: valor } : c,
      ),
    }))
  }

  function quitarContacto(clave: string) {
    setForm((previo) => ({
      ...previo,
      contactos: (previo.contactos ?? []).filter((c) => c._key !== clave),
    }))
  }

  function agregarSede(sede: SedeFormulario) {
    setForm((previo) => ({ ...previo, sedes: [...(previo.sedes ?? []), sede] }))
  }

  function cambiarSede(clave: string, cambios: Partial<SedeFormulario>) {
    setForm((previo) => ({
      ...previo,
      sedes: (previo.sedes ?? []).map((s) => (s._key === clave ? { ...s, ...cambios } : s)),
    }))
  }

  function quitarSede(clave: string) {
    setForm((previo) => ({
      ...previo,
      sedes: (previo.sedes ?? []).filter((s) => s._key !== clave),
    }))
  }

  function alElegirLogo(archivo: File | null) {
    setErrorLogo(null)
    if (!archivo) return setLogoNuevo(null)
    // Comprobación de cortesía, para responder al instante. La de verdad la hace
    // el servidor leyendo el tipo real del contenido, no la extensión.
    if (!TIPOS_LOGO.includes(archivo.type)) {
      return setErrorLogo('El logo debe ser una imagen PNG, JPEG o WebP')
    }
    if (archivo.size > MAX_LOGO_MB * 1024 * 1024) {
      return setErrorLogo(`El logo no puede superar ${MAX_LOGO_MB} MB`)
    }
    setLogoNuevo(archivo)
  }

  const guardar = useMutation({
    mutationFn: async () => {
      const cuerpo: PrestadorFormulario = {
        ...form,
        nombre: form.nombre.trim(),
        ruc: form.ruc.trim(),
        direccion: form.direccion?.trim() || null,
        contactos: haciaApi(form.contactos ?? []) as never,
        sedes: sedesHaciaApi(form.sedes ?? []) as never,
      }
      const guardado = id ? await actualizarPrestador(id, cuerpo) : await crearPrestador(cuerpo)
      // El logo se sube después del alta: hasta ese momento no existe el
      // identificador con el que se nombra el archivo.
      if (logoNuevo) await subirLogo(guardado.id, logoNuevo)
      return guardado
    },
    onSuccess: (guardado) => {
      queryClient.invalidateQueries({ queryKey: ['prestadores'] })
      queryClient.invalidateQueries({ queryKey: ['prestador', guardado.id] })
      toast.exito(
        editando
          ? 'Prestador actualizado'
          : `Prestador creado con el código ${guardado.codigo_interno}`,
      )
      navegar(LISTADO)
    },
    onError: (error) => toast.error(mensajeDeError(error, 'No se pudo guardar el prestador')),
  })

  function enviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault()
    if (!form.tipo_codigo) {
      setPestana('generales')
      return toast.error('Elige el tipo de prestador')
    }
    if (!form.nombre.trim()) {
      setPestana('generales')
      return toast.error('El nombre es obligatorio')
    }
    if (!/^\d{13}$/.test(form.ruc.trim())) {
      setPestana('generales')
      return toast.error('El RUC debe tener exactamente 13 dígitos')
    }
    // Provincia y ciudad son obligatorias (pedido del usuario, 26/10/2026).
    if (!form.provincia_codigo || !form.ciudad_codigo) {
      setPestana('generales')
      return toast.error('Elige la provincia y la ciudad del prestador')
    }
    if (form.latitud === null || form.longitud === null) {
      setPestana('generales')
      return toast.error('Fija el punto del prestador en el mapa')
    }
    // En el orden de las pestañas: Sedes antes que Contactos.
    const problemaSede = validarSedes(form.sedes ?? [])
    if (problemaSede) {
      setPestana('sedes')
      return toast.error(problemaSede)
    }
    const problema = validarContactos(form.contactos ?? [])
    if (problema) {
      setPestana('contactos')
      return toast.error(problema)
    }
    guardar.mutate()
  }

  if (editando && detalle.isPending) {
    return (
      <div className="w-full space-y-4" role="status" aria-label="Cargando prestador">
        <div className="h-4 w-40 animate-pulse rounded bg-tenue" />
        <div className="h-9 w-72 animate-pulse rounded bg-tenue" />
        <div className="h-64 animate-pulse rounded-md bg-tenue" />
      </div>
    )
  }

  if (editando && detalle.isError) {
    return (
      <div className="w-full rounded-md border border-borde bg-superficie px-6 py-14 text-center">
        <p className="font-display text-sm font-medium">No encontramos ese prestador</p>
        <p className="mt-1 text-sm text-tenue-fg">Puede que se haya eliminado.</p>
        <Boton variante="contorno" tamano="sm" className="mt-4" onClick={() => navegar(LISTADO)}>
          Volver al listado
        </Boton>
      </div>
    )
  }

  const logoActual = detalle.data?.tiene_logo ? urlLogo(detalle.data.id) : null

  return (
    <div className="w-full">
      <Link
        to={LISTADO}
        className="inline-flex items-center gap-1.5 rounded text-sm text-tenue-fg transition-colors duration-150 hover:text-tinta"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Prestadores
      </Link>

      <header className="mt-3 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-display text-[0.6875rem] font-semibold uppercase tracking-[0.16em] text-tenue-fg">
            Administración
          </p>
          <h1 className="mt-1.5 font-display text-2xl font-semibold tracking-tight">
            {editando ? 'Editar prestador' : 'Nuevo prestador'}
          </h1>
          <p className="mt-1 text-sm text-tenue-fg">
            {editando
              ? detalle.data?.nombre
              : 'El código interno se genera automáticamente al guardar.'}
          </p>
        </div>
        <div className="flex gap-2">
          <Boton variante="contorno" onClick={() => navegar(LISTADO)} disabled={guardar.isPending}>
            Cancelar
          </Boton>
          <Boton type="submit" form="form-prestador" cargando={guardar.isPending}>
            {editando ? 'Guardar cambios' : 'Crear prestador'}
          </Boton>
        </div>
      </header>

      {/* El formulario envuelve las pestañas: los botones de arriba lo referencian
          por identificador, y si se desmontara al cambiar de pestaña, pulsar
          guardar desde Contactos no haría nada. */}
      <form id="form-prestador" onSubmit={enviar} noValidate className="mt-7">
        <Tabs
          pestanas={[
            { id: 'generales', etiqueta: 'Datos generales' },
            { id: 'sedes', etiqueta: 'Sedes' },
            { id: 'contactos', etiqueta: 'Contactos' },
            { id: 'convenios', etiqueta: 'Convenios' },
          ]}
          activa={pestana}
          onCambiar={setPestana}
        >
          {pestana === 'generales' ? (
            <div className="space-y-4 pt-6">
              <Bloque titulo="Identificación" descripcion="Quién es y con qué se lo identifica.">
                <div className="space-y-5">
                  <div className="grid gap-5 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="tipo_codigo">
                        Tipo de prestador <span className="text-peligro">*</span>
                      </Label>
                      <Select
                        id="tipo_codigo"
                        value={form.tipo_codigo}
                        onChange={(e) => actualizar('tipo_codigo', e.target.value)}
                        disabled={tipos.isPending}
                        required
                        aria-describedby="ayuda-tipo"
                      >
                        <option value="">Selecciona un tipo</option>
                        {tipos.data?.map((t) => (
                          <option key={t.codigo} value={t.codigo}>
                            {t.nombre}
                          </option>
                        ))}
                      </Select>
                      {/* La lista ya no se escribe aquí: se administra, y una
                          enumeración a mano se quedaría vieja en cuanto alguien
                          añada un tipo. Se dice DÓNDE se cambia, que además es
                          una pantalla a la que llega quien ve este formulario. */}
                      <p id="ayuda-tipo" className="text-xs text-tenue-fg">
                        ¿Falta alguno? Se administran en{' '}
                        <Link
                          to={`${raiz}/parametros/tipos-prestador`}
                          className="text-marca transition-opacity duration-150 hover:opacity-80"
                        >
                          Parámetros › Tipo de prestador
                        </Link>
                        .
                      </p>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="estado">Estado</Label>
                      <Select
                        id="estado"
                        value={form.estado}
                        onChange={(e) => actualizar('estado', e.target.value as Estado)}
                      >
                        <option value="activo">Activo</option>
                        <option value="inactivo">Inactivo</option>
                        <option value="suspendido">Suspendido</option>
                      </Select>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="nombre">
                      Nombre <span className="text-peligro">*</span>
                    </Label>
                    <Input
                      id="nombre"
                      value={form.nombre}
                      onChange={(e) => actualizar('nombre', e.target.value)}
                      placeholder="Hospital Metropolitano"
                      maxLength={200}
                      required
                    />
                  </div>

                  <div className="grid gap-5 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="ruc">
                        RUC <span className="text-peligro">*</span>
                      </Label>
                      <Input
                        id="ruc"
                        value={form.ruc}
                        onChange={(e) => actualizar('ruc', e.target.value.replace(/\D/g, ''))}
                        inputMode="numeric"
                        placeholder="1790012345001"
                        maxLength={13}
                        required
                        aria-describedby="ayuda-ruc"
                      />
                      {/* Su dígito verificador, comprobado al teclear: trece
                          dígitos cualesquiera no son un RUC. El servidor lo
                          vuelve a comprobar. */}
                      <p
                        id="ayuda-ruc"
                        className={cn(
                          'text-xs',
                          problemaConDocumento('ruc', form.ruc) ? 'text-peligro' : 'text-tenue-fg',
                        )}
                        aria-live="polite"
                      >
                        {problemaConDocumento('ruc', form.ruc) ??
                          '13 dígitos · no puede repetirse entre prestadores'}
                      </p>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="codigo_interno">Código interno</Label>
                      <div className="relative">
                        <Hash
                          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-tenue-fg"
                          aria-hidden="true"
                        />
                        <Input
                          id="codigo_interno"
                          value={detalle.data?.codigo_interno ?? ''}
                          placeholder="Se genera al guardar"
                          readOnly
                          disabled
                          className="pl-9 font-mono"
                        />
                      </div>
                      <p className="text-xs text-tenue-fg">Lo asigna el sistema, no se edita</p>
                    </div>
                  </div>
                </div>
              </Bloque>

              <Bloque
                titulo="Logo"
                descripcion="Se muestra en el listado y en los expedientes."
                retraso={0.05}
              >
                <div className="flex flex-wrap items-center gap-5">
                  <div
                    className={cn(
                      'grid size-24 shrink-0 place-items-center overflow-hidden rounded-md border',
                      previsualizacion || logoActual
                        ? 'border-borde bg-fondo'
                        : 'border-dashed border-borde bg-tenue',
                    )}
                  >
                    {previsualizacion || logoActual ? (
                      <img
                        src={previsualizacion ?? logoActual ?? ''}
                        alt=""
                        className="size-full object-contain"
                      />
                    ) : (
                      <ImagePlus className="size-6 text-tenue-fg" aria-hidden="true" />
                    )}
                  </div>

                  <div className="min-w-0 space-y-2">
                    <input
                      ref={entradaArchivo}
                      id="logo"
                      type="file"
                      accept={TIPOS_LOGO.join(',')}
                      className="sr-only"
                      onChange={(e) => alElegirLogo(e.target.files?.[0] ?? null)}
                    />
                    <div className="flex flex-wrap items-center gap-2">
                      <Boton
                        type="button"
                        variante="contorno"
                        tamano="sm"
                        onClick={() => entradaArchivo.current?.click()}
                      >
                        {previsualizacion || logoActual ? 'Cambiar imagen' : 'Elegir imagen'}
                      </Boton>
                      {logoNuevo && (
                        <Boton
                          type="button"
                          variante="fantasma"
                          tamano="sm"
                          onClick={() => {
                            setLogoNuevo(null)
                            if (entradaArchivo.current) entradaArchivo.current.value = ''
                          }}
                        >
                          <Trash2 aria-hidden="true" />
                          Quitar
                        </Boton>
                      )}
                    </div>
                    <p className="text-xs text-tenue-fg">
                      PNG, JPEG o WebP · máximo {MAX_LOGO_MB} MB
                    </p>
                    {errorLogo && (
                      <p role="alert" className="text-xs text-peligro">
                        {errorLogo}
                      </p>
                    )}
                  </div>
                </div>
              </Bloque>

              <Bloque
                titulo="Ubicación"
                descripcion="La ciudad depende de la provincia elegida."
                retraso={0.1}
              >
                <div className="space-y-5">
                  <div className="grid gap-5 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="provincia">
                        Provincia <span className="text-peligro">*</span>
                      </Label>
                      <Select
                        id="provincia"
                        value={form.provincia_codigo ?? ''}
                        onChange={(e) => alElegirProvincia(e.target.value)}
                        disabled={provincias.isPending}
                      >
                        <option value="">Selecciona una provincia</option>
                        {provincias.data?.map((p) => (
                          <option key={p.codigo} value={p.codigo}>
                            {p.nombre}
                          </option>
                        ))}
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="ciudad">
                        Ciudad <span className="text-peligro">*</span>
                      </Label>
                      <Select
                        id="ciudad"
                        value={form.ciudad_codigo ?? ''}
                        onChange={(e) => actualizar('ciudad_codigo', e.target.value || null)}
                        disabled={!form.provincia_codigo || ciudades.isPending}
                        aria-describedby="ayuda-ciudad"
                      >
                        <option value="">
                          {form.provincia_codigo
                            ? ciudades.isPending
                              ? 'Cargando…'
                              : 'Selecciona una ciudad'
                            : 'Elige primero la provincia'}
                        </option>
                        {ciudades.data?.map((c) => (
                          <option key={c.codigo} value={c.codigo}>
                            {c.nombre}
                          </option>
                        ))}
                      </Select>
                      <p id="ayuda-ciudad" className="text-xs text-tenue-fg">
                        {form.provincia_codigo && ciudades.data
                          ? `${ciudades.data.length} cantones`
                          : 'Depende de la provincia'}
                      </p>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="direccion">Dirección</Label>
                    <Input
                      id="direccion"
                      value={form.direccion ?? ''}
                      onChange={(e) => actualizar('direccion', e.target.value)}
                      placeholder="Av. Mariana de Jesús y Nuño de Valderrama"
                      maxLength={300}
                    />
                  </div>

                  <MapaUbicacion
                    requerido
                    punto={{ latitud: form.latitud, longitud: form.longitud }}
                    onCambiar={(p) =>
                      setForm((previo) => ({
                        ...previo,
                        latitud: p.latitud,
                        longitud: p.longitud,
                      }))
                    }
                  />
                </div>
              </Bloque>
            </div>
          ) : pestana === 'contactos' ? (
            <div className="space-y-4 pt-6">
              <Bloque
                titulo="Contactos"
                descripcion="Personas con las que se trata en este prestador."
              >
                <ContactosPanel
                  contactos={form.contactos ?? []}
                  tiposDocumento={tiposDocumento.data ?? []}
                  cargandoTipos={tiposDocumento.isPending}
                  onAnadir={anadirContacto}
                  onCambiar={cambiarContacto}
                  onQuitar={quitarContacto}
                  descripcionVacio="Añade a quién dirigirse en este prestador."
                  // Solo las sedes ya guardadas: una nueva aún no tiene id al que atarse.
                  sedes={(form.sedes ?? [])
                    .filter((s) => s.id)
                    .map((s) => ({
                      id: s.id as string,
                      nombre: s.estado === 'activa' ? s.nombre : `${s.nombre} (inactiva)`,
                    }))}
                />
              </Bloque>
            </div>
          ) : pestana === 'sedes' ? (
            <div className="space-y-4 pt-6">
              <Bloque
                titulo="Sedes"
                descripcion="Dónde atiende: matriz, sucursales o consultorios. Son opcionales."
              >
                <SedesPanel
                  sedes={form.sedes ?? []}
                  onAgregar={agregarSede}
                  onCambiar={cambiarSede}
                  onQuitar={quitarSede}
                />
              </Bloque>
            </div>
          ) : (
            <div className="space-y-4 pt-6">
              <Bloque
                titulo="Convenios con aseguradoras"
                descripcion="Con qué compañías tiene convenio este prestador. Marcar lo crea; desmarcar lo retira. «Editar» abre el detalle del convenio guardado: su listado de precios y sus valores FC."
              >
                {/* La MISMA pieza que usa la aseguradora para marcar sus
                    prestadores: es la misma tabla, leída desde este lado.
                    Vive fuera del <form> en la práctica —guarda con su propio
                    botón contra su propio endpoint—, así que «Guardar cambios»
                    de arriba no la toca y no hay dos caminos a la misma fila. */}
                <ConveniosPanel prestadorId={id ?? null} />
              </Bloque>
            </div>
          )}
        </Tabs>
      </form>
    </div>
  )
}
