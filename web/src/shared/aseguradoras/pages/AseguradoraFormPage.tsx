import { useMutation, useQueryClient } from '@tanstack/react-query'
import { motion, useReducedMotion } from 'framer-motion'
import { ArrowLeft, Hammer, Hash, ImagePlus, Info, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { identidadDe } from '@/core/modulos/identidad'
import { cn } from '@/lib/utils'
import { useSesion } from '@/core/auth/useSesion'
import { problemaConDocumento } from '@/shared/identificacion'
import {
  actualizarAseguradora,
  crearAseguradora,
  subirLogo,
  urlLogo,
  type AseguradoraFormulario,
  type ContactoFormulario,
  type Estado,
} from '@/shared/aseguradoras/api'
import { useAseguradora } from '@/shared/aseguradoras/hooks'
import {
  useCiudades,
  useModulos,
  useProvincias,
  useTiposDocumento,
} from '@/shared/catalogos/hooks'
import { ConveniosPanel } from '@/shared/aseguradoras/components/ConveniosPanel'
import { PolizasPanel } from '@/shared/aseguradoras/components/PolizasPanel'
import { SlaPanel } from '@/shared/aseguradoras/components/SlaPanel'
import { UsuariosPanel } from '@/shared/aseguradoras/components/UsuariosPanel'
import { Boton } from '@/shared/components/ui/button'
import {
  ContactosPanel,
  contactoVacio,
  desdeApi,
  haciaApi,
  validar as validarContactos,
} from '@/shared/contactos/ContactosPanel'
import { MapaUbicacion } from '@/shared/mapa/MapaUbicacion'
import { Checkbox } from '@/shared/components/ui/checkbox'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { Select } from '@/shared/components/ui/select'
import { Tabs } from '@/shared/components/ui/tabs'
import { useToast } from '@/shared/components/ui/toast'

const EASE: [number, number, number, number] = [0.22, 0.61, 0.36, 1]
const MAX_LOGO_MB = 5
const TIPOS_LOGO = ['image/png', 'image/jpeg', 'image/webp']
const LISTADO = '/admin/aseguradoras'

const VACIO: AseguradoraFormulario = {
  razon_social: '',
  nombre_comercial: null,
  ruc: '',
  estado: 'activo',
  provincia_codigo: null,
  ciudad_codigo: null,
  direccion_fiscal: null,
  latitud: null,
  longitud: null,
  // Una aseguradora nueva nace sin acceso a ningún módulo: deny by default,
  // igual que en el resto de la plataforma.
  modulos: [],
  coberturas: {},
  contactos: [],
}

/**
 * Color de acento de cada módulo. Se mapea por código y no por el token que
 * devuelve la API porque Tailwind necesita ver las clases escritas para
 * generarlas; un módulo que no esté aquí sale con el verde institucional.
 */
/**
 * Subramas por módulo. Espejo de la constante COBERTURAS del servidor, que es
 * quien manda: aquí solo se usan para pintar las casillas, y el servidor rechaza
 * cualquier código que no reconozca.
 */
const COBERTURAS_POR_MODULO: Record<string, { codigo: string; nombre: string }[]> = {
  calificacion: [
    { codigo: 'vida', nombre: 'Vida' },
    { codigo: 'asistencia_medica', nombre: 'Asistencia médica' },
    { codigo: 'vida_desgravamen', nombre: 'Vida desgravamen' },
  ],
}

/** Nombre visible de cada rama (`modules.subgrupo`) dentro de su familia. */
const SUBGRUPOS: Record<string, string> = {
  siniestros_hospitalarios: 'Siniestros hospitalarios',
  ambulatorio: 'Ambulatorio',
  auditoria_vida: 'Auditoría de vida',
  reembolso: 'Reembolso',
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

/** La ficha completa de una compañía, en el orden en que se recorre. */
const PESTANAS = [
  { id: 'generales', etiqueta: 'Datos generales' },
  { id: 'requerimientos', etiqueta: 'Módulos' },
  { id: 'polizas', etiqueta: 'Pólizas y planes' },
  { id: 'cobertura', etiqueta: 'Cobertura y condiciones' },
  { id: 'sla', etiqueta: 'SLA' },
  { id: 'convenios', etiqueta: 'Convenios' },
  { id: 'contactos', etiqueta: 'Contactos' },
  { id: 'usuarios', etiqueta: 'Usuarios' },
]

/** Marcador de las pestañas aún por construir: visibles, pero sin función. */
function EnConstruccion() {
  return (
    <div className="rounded-md border border-dashed border-borde px-6 py-12 text-center">
      <Hammer className="mx-auto size-6 text-tenue-fg" aria-hidden="true" />
      <p className="mt-3 font-display text-sm font-medium">En construcción</p>
      <p className="mx-auto mt-1 max-w-sm text-sm text-tenue-fg">
        Esta sección todavía no está lista. Estará disponible en una próxima entrega.
      </p>
    </div>
  )
}

export function AseguradoraFormPage() {
  const { id } = useParams<{ id: string }>()
  const editando = Boolean(id)
  const navegar = useNavigate()
  const queryClient = useQueryClient()
  const toast = useToast()

  // Las dos funciones transversales ven esta ficha recortada, y el servidor
  // impone lo mismo: Convenio ve ÚNICAMENTE la red de la compañía y ningún dato
  // suyo; Contabilidad, todo lo contrario —la gestiona entera— salvo justo esa
  // red, que no es suya.
  const { data: sesion } = useSesion()
  const soloConvenios = sesion?.user.funcion === 'convenio'
  const sinConvenios = sesion?.user.funcion === 'contabilidad'

  const detalle = useAseguradora(id ?? null, soloConvenios ? 'basico' : 'completo')
  const provincias = useProvincias()
  // Quien solo lleva los convenios no ve la pestaña de módulos: pedir su
  // catálogo solo le daría un 403 inútil.
  const modulos = useModulos(!soloConvenios)
  const tiposDocumento = useTiposDocumento()

  const [pestana, setPestana] = useState(soloConvenios ? 'convenios' : 'generales')
  const [form, setForm] = useState<AseguradoraFormulario>(VACIO)
  const [logoNuevo, setLogoNuevo] = useState<File | null>(null)
  const [errorLogo, setErrorLogo] = useState<string | null>(null)
  const entradaArchivo = useRef<HTMLInputElement>(null)

  const ciudades = useCiudades(form.provincia_codigo)

  // Al editar, el formulario se rellena cuando llega el detalle del servidor.
  useEffect(() => {
    const ficha = detalle.data
    if (!ficha) return
    // Quien solo lleva los convenios no recibe la ficha: el servidor le devuelve
    // el nombre y nada más. Lo único que hay que rellenar es el rótulo de la
    // cabecera; el resto del formulario no se muestra ni se guarda.
    if (soloConvenios) {
      setForm((previo) => ({ ...previo, razon_social: ficha.razon_social }))
      return
    }
    setForm({
      razon_social: ficha.razon_social,
      nombre_comercial: ficha.nombre_comercial,
      ruc: ficha.ruc,
      estado: ficha.estado as Estado,
      provincia_codigo: ficha.provincia_codigo,
      ciudad_codigo: ficha.ciudad_codigo,
      direccion_fiscal: ficha.direccion_fiscal,
      latitud: ficha.latitud,
      longitud: ficha.longitud,
      // Solo los módulos que se marcan directamente. Los que agrupan coberturas
      // no tienen casilla: su acceso lo deriva el servidor de las subramas.
      modulos: ficha.modulos
        .filter((m) => m.activo && m.coberturas.length === 0)
        .map((m) => m.codigo),
      // Se cargan siempre, aunque el módulo esté destildado: así reaparecen tal
      // cual si se vuelve a marcar.
      contactos: desdeApi(ficha.contactos),
      coberturas: Object.fromEntries(
        ficha.modulos
          .filter((m) => m.coberturas.length > 0)
          .map((m) => [m.codigo, m.coberturas.filter((c) => c.activo).map((c) => c.codigo)]),
      ),
    })
  }, [detalle.data, soloConvenios])

  const previsualizacion = useMemo(
    () => (logoNuevo ? URL.createObjectURL(logoNuevo) : null),
    [logoNuevo],
  )
  useEffect(() => {
    return () => {
      if (previsualizacion) URL.revokeObjectURL(previsualizacion)
    }
  }, [previsualizacion])

  function actualizar<K extends keyof AseguradoraFormulario>(
    campo: K,
    valor: AseguradoraFormulario[K],
  ) {
    setForm((previo) => ({ ...previo, [campo]: valor }))
  }

  // Los `?? []` y `?? {}` de aquí abajo no son paranoia: durante el desarrollo,
  // el recargado en caliente de Vite conserva el estado de un render anterior. Si
  // se añade un campo al formulario, el estado viejo no lo tiene y el acceso
  // directo revienta la pantalla entera. Tolerarlo cuesta nada.
  function alternarModulo(codigo: string, marcado: boolean) {
    setForm((previo) => {
      const actuales = previo.modulos ?? []
      return {
        ...previo,
        modulos: marcado ? [...actuales, codigo] : actuales.filter((c) => c !== codigo),
      }
    })
  }

  function alternarCobertura(moduloCodigo: string, codigo: string, marcado: boolean) {
    setForm((previo) => {
      const actuales = previo.coberturas?.[moduloCodigo] ?? []
      return {
        ...previo,
        coberturas: {
          ...(previo.coberturas ?? {}),
          [moduloCodigo]: marcado
            ? [...actuales, codigo]
            : actuales.filter((c) => c !== codigo),
        },
      }
    })
  }

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

  function alElegirProvincia(codigo: string) {
    // Cambiar de provincia invalida la ciudad: si no se limpiara, podría guardarse
    // una ciudad que no pertenece a la provincia nueva.
    setForm((previo) => ({ ...previo, provincia_codigo: codigo || null, ciudad_codigo: null }))
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
      const cuerpo: AseguradoraFormulario = {
        ...form,
        modulos: form.modulos ?? [],
        coberturas: form.coberturas ?? {},
        contactos: haciaApi(form.contactos ?? []) as never,
        razon_social: form.razon_social.trim(),
        ruc: form.ruc.trim(),
        nombre_comercial: form.nombre_comercial?.trim() || null,
        direccion_fiscal: form.direccion_fiscal?.trim() || null,
      }
      const guardada = id
        ? await actualizarAseguradora(id, cuerpo)
        : await crearAseguradora(cuerpo)
      // El logo se sube después del alta: hasta ese momento no existe el
      // identificador con el que se nombra el archivo.
      if (logoNuevo) await subirLogo(guardada.id, logoNuevo)
      return guardada
    },
    onSuccess: (guardada) => {
      queryClient.invalidateQueries({ queryKey: ['aseguradoras'] })
      queryClient.invalidateQueries({ queryKey: ['aseguradora', guardada.id] })
      toast.exito(
        editando
          ? 'Aseguradora actualizada'
          : `Aseguradora creada con el código ${guardada.codigo_interno}`,
      )
      navegar(LISTADO)
    },
    onError: (error) => toast.error(mensajeDeError(error, 'No se pudo guardar la aseguradora')),
  })

  function enviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault()
    if (!form.razon_social.trim()) {
      setPestana('generales')
      return toast.error('La razón social es obligatoria')
    }
    if (!/^\d{13}$/.test(form.ruc.trim())) {
      setPestana('generales')
      return toast.error('El RUC debe tener exactamente 13 dígitos')
    }
    if (form.latitud === null || form.longitud === null) {
      setPestana('generales')
      return toast.error('Fija el punto de la aseguradora en el mapa')
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
      <div className="w-full space-y-4" role="status" aria-label="Cargando aseguradora">
        <div className="h-4 w-40 animate-pulse rounded bg-tenue" />
        <div className="h-9 w-72 animate-pulse rounded bg-tenue" />
        <div className="h-64 animate-pulse rounded-md bg-tenue" />
      </div>
    )
  }

  if (editando && detalle.isError) {
    return (
      <div className="w-full rounded-md border border-borde bg-superficie px-6 py-14 text-center">
        <p className="font-display text-sm font-medium">No encontramos esa aseguradora</p>
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
        Aseguradoras
      </Link>

      <header className="mt-3 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-display text-[0.6875rem] font-semibold uppercase tracking-[0.16em] text-tenue-fg">
            Administración
          </p>
          <h1 className="mt-1.5 font-display text-2xl font-semibold tracking-tight">
            {/* Quien solo lleva los convenios no está editando la compañía, así
                que el título nombra lo que sí hace: su red de prestadores. */}
            {soloConvenios
              ? 'Convenios de la aseguradora'
              : editando
                ? 'Editar aseguradora'
                : 'Nueva aseguradora'}
          </h1>
          <p className="mt-1 text-sm text-tenue-fg">
            {editando
              ? detalle.data?.razon_social
              : 'El código interno se genera automáticamente al guardar.'}
          </p>
        </div>
        <div className="flex gap-2">
          <Boton variante="contorno" onClick={() => navegar(LISTADO)} disabled={guardar.isPending}>
            {soloConvenios ? 'Volver' : 'Cancelar'}
          </Boton>
          {/* Quien solo lleva los convenios no edita la ficha de la compañía:
              su pestaña guarda por su cuenta. */}
          {!soloConvenios && (
            <Boton type="submit" form="form-aseguradora" cargando={guardar.isPending}>
              {editando ? 'Guardar cambios' : 'Crear aseguradora'}
            </Boton>
          )}
        </div>
      </header>

      {/* El formulario envuelve las pestañas: los botones de arriba lo referencian
          por identificador, y si se desmontara al cambiar de pestaña, pulsar
          guardar desde Requerimientos no haría nada. */}
      <form id="form-aseguradora" onSubmit={enviar} noValidate className="mt-7">
        <Tabs
          pestanas={
            // Cada función transversal ve la ficha por su lado, y lo que no ve
            // no está oculto: no existe para ella (`docs/07`, §6b).
            soloConvenios
              ? [{ id: 'convenios', etiqueta: 'Convenios' }]
              : PESTANAS.filter((p) => !(sinConvenios && p.id === 'convenios'))
          }
          activa={pestana}
          onCambiar={setPestana}
        >
          {pestana === 'generales' ? (
            <div className="space-y-4 pt-6">
              <Bloque titulo="Identificación" descripcion="Cómo se llama y con qué se la identifica.">
                <div className="space-y-5">
                  <div className="space-y-2">
                    <Label htmlFor="razon_social">
                      Razón social <span className="text-peligro">*</span>
                    </Label>
                    <Input
                      id="razon_social"
                      value={form.razon_social}
                      onChange={(e) => actualizar('razon_social', e.target.value)}
                      placeholder="Seguros del Pacífico S.A."
                      maxLength={200}
                      required
                    />
                  </div>

                  <div className="grid gap-5 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="nombre_comercial">Nombre comercial</Label>
                      <Input
                        id="nombre_comercial"
                        value={form.nombre_comercial ?? ''}
                        onChange={(e) => actualizar('nombre_comercial', e.target.value)}
                        placeholder="Pacífico Salud"
                        maxLength={200}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="ruc">
                        RUC <span className="text-peligro">*</span>
                      </Label>
                      <Input
                        id="ruc"
                        value={form.ruc}
                        onChange={(e) => actualizar('ruc', e.target.value.replace(/\D/g, ''))}
                        inputMode="numeric"
                        placeholder="0991234567001"
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
                        {problemaConDocumento('ruc', form.ruc) ?? '13 dígitos'}
                      </p>
                    </div>
                  </div>

                  <div className="grid gap-5 sm:grid-cols-2">
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
                    <div className="space-y-2">
                      <Label htmlFor="estado">Estado</Label>
                      <Select
                        id="estado"
                        value={form.estado}
                        onChange={(e) => actualizar('estado', e.target.value as Estado)}
                      >
                        <option value="activo">Activo</option>
                        <option value="inactivo">Inactivo</option>
                      </Select>
                    </div>
                  </div>
                </div>
              </Bloque>

              <Bloque titulo="Logo" descripcion="Se muestra en el listado y en los expedientes." retraso={0.05}>
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

              <Bloque titulo="Ubicación" descripcion="La ciudad depende de la provincia elegida." retraso={0.1}>
                <div className="space-y-5">
                  <div className="grid gap-5 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="provincia">Provincia</Label>
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
                      <Label htmlFor="ciudad">Ciudad</Label>
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
                    <Label htmlFor="direccion_fiscal">Dirección fiscal</Label>
                    <Input
                      id="direccion_fiscal"
                      value={form.direccion_fiscal ?? ''}
                      onChange={(e) => actualizar('direccion_fiscal', e.target.value)}
                      placeholder="Av. Amazonas N34-100 y Juan Pablo Sanz"
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
          ) : pestana === 'polizas' ? (
            <div className="space-y-4 pt-6">
              <Bloque
                titulo="Pólizas y planes"
                descripcion="Los PDF de pólizas y planes de esta aseguradora."
              >
                <PolizasPanel aseguradoraId={id ?? null} categoria="polizas" />
              </Bloque>
            </div>
          ) : pestana === 'cobertura' ? (
            <div className="space-y-4 pt-6">
              <Bloque
                titulo="Cobertura y condiciones"
                descripcion="Los PDF de coberturas, condiciones generales y particulares."
              >
                <EnConstruccion />
              </Bloque>
            </div>
          ) : pestana === 'sla' ? (
            <div className="space-y-4 pt-6">
              <Bloque
                titulo="SLA"
                descripcion="Las horas y el precio pactados por módulo. Solo aparecen los módulos que esta aseguradora tiene contratados."
              >
                <SlaPanel aseguradoraId={id ?? null} />
              </Bloque>
            </div>
          ) : pestana === 'convenios' ? (
            <div className="space-y-4 pt-6">
              <Bloque
                titulo="Convenios"
                descripcion="La red de esta aseguradora: marca los prestadores con convenio. El detalle (FC, vigencias) se captura después."
              >
                <ConveniosPanel aseguradoraId={id ?? null} />
              </Bloque>
            </div>
          ) : pestana === 'contactos' ? (
            <div className="space-y-4 pt-6">
              <Bloque
                titulo="Contactos"
                descripcion="Personas con las que se trata en esta aseguradora."
              >
                <ContactosPanel
                  contactos={form.contactos ?? []}
                  tiposDocumento={tiposDocumento.data ?? []}
                  cargandoTipos={tiposDocumento.isPending}
                  onAnadir={anadirContacto}
                  onCambiar={cambiarContacto}
                  onQuitar={quitarContacto}
                  descripcionVacio="Añade a quién dirigirse en esta aseguradora."
                />
              </Bloque>
            </div>
          ) : pestana === 'usuarios' ? (
            <div className="space-y-4 pt-6">
              <Bloque
                titulo="Usuarios"
                descripcion="Quién de esta aseguradora entra a la plataforma, y a qué requerimientos."
              >
                <UsuariosPanel
                  aseguradoraId={id ?? null}
                  contactos={detalle.data?.contactos ?? []}
                />
              </Bloque>
            </div>
          ) : (
            <div className="space-y-4 pt-6">
              <Bloque
                titulo="Acceso a módulos"
                descripcion="Marca a cuáles puede entrar esta aseguradora."
              >
                {modulos.isPending ? (
                  <div className="grid gap-3 sm:grid-cols-2" role="status" aria-label="Cargando módulos">
                    {Array.from({ length: 4 }, (_, i) => (
                      <div key={i} className="h-[4.5rem] animate-pulse rounded-md bg-tenue" />
                    ))}
                  </div>
                ) : modulos.isError ? (
                  <p className="text-sm text-peligro">No pudimos cargar los módulos.</p>
                ) : (
                  <>
                    {/* Dos familias comerciales: Suscripción y Siniestro. El
                        grupo viene de `modules.grupo`; uno sin grupo (no
                        debería haber) cae al final, sin encabezado. Dentro de
                        una familia, `subgrupo` es la rama y pinta un subtítulo
                        (Siniestro → «Siniestros hospitalarios»…). */}
                    <fieldset className="space-y-5">
                      <legend className="sr-only">Módulos habilitados</legend>
                      {(
                        [
                          ['suscripcion', 'Suscripción'],
                          ['siniestro', 'Siniestro'],
                          [null, ''],
                        ] as const
                      ).map(([grupo, tituloGrupo]) => {
                        const delGrupo = (modulos.data ?? []).filter(
                          (m) => (m.grupo ?? null) === grupo,
                        )
                        if (delGrupo.length === 0) return null
                        // Las ramas de la familia, en el orden del catálogo.
                        const ramas = [
                          ...new Set(delGrupo.map((m) => m.subgrupo ?? null)),
                        ]
                        return (
                          <div key={grupo ?? 'sin-grupo'}>
                            {tituloGrupo && (
                              <p className="mb-2.5 font-display text-xs font-semibold uppercase tracking-[0.09em] text-tenue-fg">
                                {tituloGrupo}
                              </p>
                            )}
                            <div className="space-y-4">
                              {ramas.map((rama) => (
                            <div key={rama ?? 'sin-rama'}>
                            {rama && (
                              <p className="mb-2 font-display text-xs font-medium text-tenue-fg">
                                {SUBGRUPOS[rama] ?? rama}
                              </p>
                            )}
                            <div className="grid gap-3 sm:grid-cols-2">
                              {delGrupo
                                .filter((m) => (m.subgrupo ?? null) === rama)
                                .map((modulo) => {
                        const suyas = COBERTURAS_POR_MODULO[modulo.codigo]

                        // Un módulo con coberturas NO se marca por sí mismo: es el
                        // encabezado de sus subramas, y su acceso lo deriva el
                        // servidor de ellas.
                        if (suyas) {
                          const elegidas = form.coberturas?.[modulo.codigo] ?? []
                          return (
                            <fieldset
                              key={modulo.codigo}
                              className="rounded-md border border-borde bg-superficie p-4 sm:col-span-2"
                            >
                              <legend className="flex items-center gap-2 px-1">
                                <span
                                  className={cn(
                                    'size-2 rounded-full',
                                    identidadDe(modulo.codigo).punto,
                                  )}
                                  aria-hidden="true"
                                />
                                <span className="font-display text-sm font-medium">
                                  {modulo.nombre}
                                </span>
                                <span className="font-mono text-xs text-tenue-fg">
                                  /{modulo.slug}
                                </span>
                              </legend>
                              <p className="mb-3 mt-1 text-xs text-tenue-fg">
                                {elegidas.length === 0
                                  ? 'Sin coberturas marcadas: la aseguradora no entra a este módulo.'
                                  : `${elegidas.length} de ${suyas.length} coberturas`}
                              </p>
                              <div className="grid gap-2 sm:grid-cols-3">
                                {suyas.map((cobertura) => (
                                  <Checkbox
                                    key={cobertura.codigo}
                                    id={`cobertura-${modulo.codigo}-${cobertura.codigo}`}
                                    checked={elegidas.includes(cobertura.codigo)}
                                    onChange={(v) =>
                                      alternarCobertura(modulo.codigo, cobertura.codigo, v)
                                    }
                                    acento={identidadDe(modulo.codigo).punto}
                                    titulo={cobertura.nombre}
                                  />
                                ))}
                              </div>
                            </fieldset>
                          )
                        }

                        return (
                          <Checkbox
                            key={modulo.codigo}
                            id={`modulo-${modulo.codigo}`}
                            checked={(form.modulos ?? []).includes(modulo.codigo)}
                            onChange={(v) => alternarModulo(modulo.codigo, v)}
                            acento={identidadDe(modulo.codigo).punto}
                            titulo={modulo.nombre}
                            descripcion={`/${modulo.slug}`}
                          />
                        )
                                })}
                            </div>
                            </div>
                              ))}
                            </div>
                          </div>
                        )
                      })}
                    </fieldset>
                    <p className="mt-4 flex items-start gap-2 text-xs text-tenue-fg">
                      <Info className="mt-px size-3.5 shrink-0" aria-hidden="true" />
                      <span>
                        Un módulo con coberturas se habilita marcando alguna de ellas. Destildar no
                        borra el registro: queda marcado como revocado, con quién lo hizo y cuándo.
                      </span>
                    </p>
                  </>
                )}
              </Bloque>
            </div>
          )}
        </Tabs>
      </form>
    </div>
  )
}
