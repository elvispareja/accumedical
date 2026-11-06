import { useMutation, useQuery } from '@tanstack/react-query'
import { ChevronDown, FileUp, Package, Plus, Trash2, X } from 'lucide-react'
import { useRef, useState } from 'react'

import { cn } from '@/lib/utils'
import { listarPolizas } from '@/shared/aseguradoras/api'
import { Boton } from '@/shared/components/ui/button'
import { Checkbox } from '@/shared/components/ui/checkbox'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { Select } from '@/shared/components/ui/select'
import { useToast } from '@/shared/components/ui/toast'
import { leerVademecumCliente } from '@/shared/vademecum/api'
import { RevisionLectura } from '@/shared/vademecum/RevisionLectura'
import { VademecumSelector } from '@/shared/vademecum/VademecumSelector'

// ─── Catálogos (mismos códigos que los CHECK de las dos bases) ────────────────
// Especificación de la Central, M2 «Productos y condiciones de cobertura».

export type ServicioProducto = 'farmacia' | 'teleconsulta' | 'consulta_ambulatoria' | 'hospitalaria'
export type UnidadTope = 'evento' | 'persona_mes' | 'persona_anio' | 'receta'
export type UnidadDeducible = 'evento' | 'persona_anio' | 'familia_anio'
export type VentanaEvento = 'mes_calendario' | 'dias_moviles_30' | 'vigencia_poliza'
export type Parentesco = 'conyuge' | 'hijos' | 'padres'

export const SERVICIOS: { valor: ServicioProducto; etiqueta: string }[] = [
  { valor: 'farmacia', etiqueta: 'Farmacia' },
  { valor: 'teleconsulta', etiqueta: 'Teleconsulta' },
  { valor: 'consulta_ambulatoria', etiqueta: 'Consulta ambulatoria' },
  { valor: 'hospitalaria', etiqueta: 'Hospitalaria' },
]
const ORDEN_SERVICIO = SERVICIOS.map((s) => s.valor)
const nombreServicio = (s: ServicioProducto) => SERVICIOS.find((x) => x.valor === s)?.etiqueta ?? s

const UNIDADES_TOPE: { valor: UnidadTope; etiqueta: string; texto: string }[] = [
  { valor: 'evento', etiqueta: 'Por evento (diagnóstico)', texto: 'por evento' },
  { valor: 'persona_mes', etiqueta: 'Por persona al mes', texto: 'por persona al mes' },
  { valor: 'persona_anio', etiqueta: 'Por persona al año', texto: 'por persona al año' },
  { valor: 'receta', etiqueta: 'Por receta', texto: 'por receta' },
]

const UNIDADES_DEDUCIBLE: { valor: UnidadDeducible; etiqueta: string; texto: string }[] = [
  { valor: 'evento', etiqueta: 'Por evento', texto: 'por evento' },
  { valor: 'persona_anio', etiqueta: 'Por persona al año', texto: 'por persona al año' },
  { valor: 'familia_anio', etiqueta: 'Por familia al año', texto: 'por familia al año' },
]

const VENTANAS: { valor: VentanaEvento; etiqueta: string }[] = [
  { valor: 'mes_calendario', etiqueta: 'Mes calendario' },
  { valor: 'dias_moviles_30', etiqueta: '30 días móviles' },
  { valor: 'vigencia_poliza', etiqueta: 'Vigencia de la póliza' },
]

const PARENTESCOS: { valor: Parentesco; etiqueta: string }[] = [
  { valor: 'conyuge', etiqueta: 'Cónyuge' },
  { valor: 'hijos', etiqueta: 'Hijos' },
  { valor: 'padres', etiqueta: 'Padres' },
]

type SiNo = '' | 'si' | 'no'

/**
 * Un servicio del producto con SUS condiciones (6/11/2026, decisión del
 * usuario: «que funcione para ambos casos»). Un plan real paga distinto cada
 * servicio —hospitalario al 100 % hasta USD 20.000, ambulatorio al 80 %,
 * farmacia al 80 %— y otro, como Asistencia Total, comparte un solo tope entre
 * sus servicios: ese va en el producto (`valor`) y aquí el tope es opcional.
 */
export interface ServicioFormulario {
  servicio: ServicioProducto
  porcentaje: string
  /** Tope propio (sublímite). Vacío = usa el común del producto. */
  tope: string
  topeUnidad: UnidadTope | ''
  /** Lo que paga primero el asegurado. «0» = sin deducible. */
  deducible: string
  deducibleUnidad: UnidadDeducible | ''
  eventos: string
  eventosIlimitados: boolean
}

/**
 * Un producto en el formulario (5/11/2026; condiciones de M2 desde el 6/11;
 * por servicio desde la tarde del 6/11). Los números van como texto mientras se escriben
 * —«12,5» a medias no es un número— y se convierten al guardar. `_key` es solo
 * para React.
 *
 * `valor` es el TOPE COMÚN a todos sus servicios (opcional). Lo de farmacia
 * (receta, vademécum, despacho parcial) solo se pide si incluye Farmacia.
 */
export interface ProductoFormulario {
  _key: string
  id?: string
  nombre: string
  servicios: ServicioFormulario[]
  /** El contrato del que sale (6/11/2026): un PDF de «Contratos y pólizas». */
  contratoId: string
  valor: string
  topeUnidad: UnidadTope | ''
  ventana: VentanaEvento | ''
  vigencia: string
  vademecum: SiNo
  despachoParcial: SiNo
  maxDiagnosticos: string
  beneficiarios: SiNo
  parentescos: Parentesco[]
  carencia: string
  exclusiones: string
  /** Vademécum del producto: códigos «VAD-00001» del maestro (solo si lo requiere). */
  vademecumCodigos: string[]
}

/** Un servicio tal como lo devuelve la ficha. */
export interface ServicioSalida {
  servicio: ServicioProducto
  porcentaje: number | null
  tope: number | null
  tope_unidad: UnidadTope | null
  deducible: number
  deducible_unidad: UnidadDeducible | null
  /** `null` = ilimitados. */
  eventos_maximo: number | null
}

/** Lo que devuelve la ficha. */
export interface ProductoSalida {
  id: string
  nombre: string
  servicios: ServicioSalida[]
  contrato_id: string | null
  /** Listo para usarse, o lo que le falta (lo calcula el servidor). */
  completo: boolean
  faltan: string[]
  /** El tope común a sus servicios. */
  valor: number | null
  tope_unidad: UnidadTope | null
  ventana_evento: VentanaEvento | null
  /** Horas corridas de vigencia de la receta; `null` si no incluye Farmacia. */
  vigencia_receta_horas: number | null
  requiere_vademecum: boolean | null
  despacho_parcial: boolean | null
  /** `null` = sin límite. */
  max_diagnosticos: number | null
  beneficiarios_incluidos: boolean | null
  parentescos: Parentesco[]
  carencia_dias: number | null
  exclusiones: string | null
  vademecum: string[]
}

function servicioVacio(servicio: ServicioProducto): ServicioFormulario {
  return {
    servicio,
    porcentaje: '',
    tope: '',
    topeUnidad: '',
    deducible: '0',
    deducibleUnidad: '',
    eventos: '',
    eventosIlimitados: true,
  }
}

/**
 * Un producto nuevo (6/11/2026): se crea con nombre, contrato y servicios. Las
 * condiciones más comunes ya vienen sugeridas —ventana por mes calendario,
 * eventos ilimitados, sin deducible, sin carencia, solo titulares, despacho
 * parcial— y se pueden cambiar; lo demás queda por llenar y el producto,
 * «incompleto».
 */
export function productoVacio(contratoId = ''): ProductoFormulario {
  return {
    _key: crypto.randomUUID(),
    nombre: '',
    servicios: [],
    contratoId,
    valor: '',
    topeUnidad: '',
    ventana: 'mes_calendario',
    vigencia: '',
    vademecum: '',
    despachoParcial: 'si',
    maxDiagnosticos: '',
    beneficiarios: 'no',
    parentescos: [],
    carencia: '0',
    exclusiones: '',
    vademecumCodigos: [],
  }
}

/** 1500.5 → «1500,50»; 12.25 → «12,25»; 10 → «10». Con coma, como se teclea. */
function aTexto(numero: number, decimales: boolean): string {
  const texto = decimales ? numero.toFixed(2) : String(numero)
  return texto.replace('.', ',')
}

const siNo = (v: boolean | null): SiNo => (v === null ? '' : v ? 'si' : 'no')

export function productosDesdeApi(productos: ProductoSalida[]): ProductoFormulario[] {
  return productos.map((p) => ({
    _key: p.id,
    id: p.id,
    nombre: p.nombre,
    servicios: p.servicios.map((s) => ({
      servicio: s.servicio,
      porcentaje: s.porcentaje === null ? '' : aTexto(s.porcentaje, false),
      tope: s.tope === null ? '' : aTexto(s.tope, true),
      topeUnidad: s.tope_unidad ?? '',
      deducible: s.deducible === 0 ? '0' : aTexto(s.deducible, true),
      deducibleUnidad: s.deducible_unidad ?? '',
      eventos: s.eventos_maximo === null ? '' : String(s.eventos_maximo),
      eventosIlimitados: s.eventos_maximo === null,
    })),
    contratoId: p.contrato_id ?? '',
    valor: p.valor === null ? '' : aTexto(p.valor, true),
    topeUnidad: p.tope_unidad ?? '',
    ventana: p.ventana_evento ?? '',
    vigencia: p.vigencia_receta_horas === null ? '' : String(p.vigencia_receta_horas),
    vademecum: siNo(p.requiere_vademecum),
    despachoParcial: siNo(p.despacho_parcial),
    maxDiagnosticos: p.max_diagnosticos === null ? '' : String(p.max_diagnosticos),
    beneficiarios: siNo(p.beneficiarios_incluidos),
    parentescos: p.parentescos,
    carencia: p.carencia_dias === null ? '' : String(p.carencia_dias),
    exclusiones: p.exclusiones ?? '',
    vademecumCodigos: p.vademecum ?? [],
  }))
}

/** Entero en [mínimo, máximo]; si no, null. */
function aEntero(texto: string, minimo: number, maximo: number): number | null {
  const limpio = texto.trim()
  if (!/^\d{1,5}$/.test(limpio)) return null
  const n = Number(limpio)
  return n >= minimo && n <= maximo ? n : null
}

/** El nombre como lo guarda el servidor: compuesto, sin espacios de sobra y en MAYÚSCULAS. */
function nombreNormal(nombre: string): string {
  return nombre.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleUpperCase()
}

/**
 * «1500,5» o «1500.5» → 1500.5. Sin separador de miles: «1.500» sería ambiguo
 * (¿mil quinientos o uno coma cinco?), así que solo vale UN separador decimal.
 * Vacío o no numérico → NaN.
 */
function aNumero(texto: string): number {
  const limpio = texto.trim().replace(/\s/g, '').replace(',', '.')
  return /^\d+(\.\d{1,2})?$/.test(limpio) ? Number(limpio) : Number.NaN
}

const conServicio = (p: ProductoFormulario, s: ServicioProducto) =>
  p.servicios.some((x) => x.servicio === s)
const conFarmacia = (p: ProductoFormulario) => conServicio(p, 'farmacia')
const conConsulta = (p: ProductoFormulario) =>
  conServicio(p, 'teleconsulta') || conServicio(p, 'consulta_ambulatoria')
/** Sin deducible: vacío o cero. */
const sinDeducible = (s: ServicioFormulario) => !s.deducible.trim() || aNumero(s.deducible) === 0
const unidadesDeTope = (conReceta: boolean) =>
  UNIDADES_TOPE.filter((u) => conReceta || u.valor !== 'receta')

/**
 * Lo que le falta a un producto para poder usarse (6/11/2026). La misma regla
 * que el servidor; mientras falte algo queda «incompleto».
 */
export function faltanProducto(p: ProductoFormulario): string[] {
  const faltan: string[] = []
  if (!p.contratoId) faltan.push('el contrato')
  if (p.servicios.length === 0) faltan.push('los servicios')
  const conTopeComun = Boolean(p.valor.trim())
  for (const s of ordenados(p.servicios)) {
    const nombre = nombreServicio(s.servicio)
    if (!s.porcentaje.trim()) faltan.push(`la cobertura de ${nombre}`)
    if (!s.tope.trim() && !conTopeComun) faltan.push(`el tope de ${nombre}`)
  }
  if (!p.ventana) faltan.push('la ventana del evento')
  if (!p.carencia.trim()) faltan.push('la carencia')
  if (!p.beneficiarios) faltan.push('si incluye beneficiarios')
  else if (p.beneficiarios === 'si' && p.parentescos.length === 0) faltan.push('los parentescos')
  if (conFarmacia(p)) {
    if (!p.vigencia.trim()) faltan.push('la vigencia de la receta')
    if (!p.vademecum) faltan.push('si requiere vademécum')
    else if (p.vademecum === 'si' && p.vademecumCodigos.length === 0) {
      faltan.push('los medicamentos del vademécum')
    }
    if (!p.despachoParcial) faltan.push('si permite despacho parcial')
  }
  return faltan
}

function ordenados(servicios: ServicioFormulario[]): ServicioFormulario[] {
  return [...servicios].sort(
    (a, b) => ORDEN_SERVICIO.indexOf(a.servicio) - ORDEN_SERVICIO.indexOf(b.servicio),
  )
}

const MONTO_MAXIMO = 9_999_999_999.99
const montoMalo = (texto: string) => {
  const n = aNumero(texto)
  return Number.isNaN(n) || n > MONTO_MAXIMO
}

/**
 * El primer problema de la lista, en palabras; null si se puede guardar.
 * Obligatorio: nombre, contrato y servicios. Lo demás puede faltar (queda
 * «incompleto»), pero lo que se escriba tiene que estar bien escrito.
 */
export function validarProductos(productos: ProductoFormulario[]): string | null {
  if (productos.length > 200) return 'Una ficha admite hasta 200 productos'
  const nombres = new Set<string>()
  const formato = 'un número con hasta dos decimales y sin separador de miles (por ejemplo 10,00)'
  for (const [i, p] of productos.entries()) {
    const nombre = nombreNormal(p.nombre)
    if (!nombre) return `Al producto ${i + 1} le falta el nombre`
    if (nombre.length > 150) return `El nombre del producto ${i + 1} admite hasta 150 caracteres`
    if (nombres.has(nombre)) return `El producto ${nombre} está repetido`
    nombres.add(nombre)
    if (!p.contratoId) return `${nombre}: elige el contrato del que sale`
    if (p.servicios.length === 0) return `${nombre}: agrega al menos un servicio`
    if (p.valor.trim()) {
      if (montoMalo(p.valor)) return `${nombre}: el tope común debe ser ${formato}`
      if (!p.topeUnidad) return `${nombre}: elige la unidad del tope común`
    }
    for (const s of p.servicios) {
      const servicio = `${nombre}, ${nombreServicio(s.servicio)}`
      const porcentaje = aNumero(s.porcentaje)
      if (s.porcentaje.trim() && (Number.isNaN(porcentaje) || porcentaje > 100)) {
        return `${servicio}: la cobertura debe ser un porcentaje entre 0 y 100, con hasta dos decimales`
      }
      if (s.tope.trim()) {
        if (montoMalo(s.tope)) return `${servicio}: el tope debe ser ${formato}`
        if (!s.topeUnidad) return `${servicio}: elige la unidad del tope`
      }
      if (s.deducible.trim() && montoMalo(s.deducible)) {
        return `${servicio}: el deducible debe ser ${formato}, o 0 si no tiene`
      }
      if (!sinDeducible(s) && !s.deducibleUnidad) {
        return `${servicio}: elige cómo se cobra el deducible (por evento, por persona o por familia al año)`
      }
      if (!s.eventosIlimitados && aEntero(s.eventos, 1, 1000) === null) {
        return `${servicio}: el número de eventos debe ser un entero entre 1 y 1000, o marca «Ilimitados»`
      }
    }
    if (conFarmacia(p) && p.vigencia.trim() && aEntero(p.vigencia, 1, 8760) === null) {
      return `${nombre}: la vigencia de la receta debe ser un número entero de horas entre 1 y 8760 (por ejemplo 72)`
    }
    if (conConsulta(p) && p.maxDiagnosticos.trim() && aEntero(p.maxDiagnosticos, 1, 20) === null) {
      return `${nombre}: el máximo de diagnósticos por consulta debe ser un entero entre 1 y 20, o déjalo vacío (sin límite)`
    }
    if (p.carencia.trim() && aEntero(p.carencia, 0, 3650) === null) {
      return `${nombre}: la carencia debe ser un número entero de días entre 0 y 3650`
    }
    if (p.exclusiones.length > 2000) return `${nombre}: las exclusiones admiten hasta 2000 caracteres`
  }
  return null
}

const aMonto = (texto: string) => Math.round(aNumero(texto) * 100) / 100

/**
 * Solo tras `validarProductos`. Manda el producto COMPLETO; lo que no aplica a
 * sus servicios va en `null` (el servidor lo exige así).
 */
export function productosHaciaApi(productos: ProductoFormulario[]) {
  return productos.map((p) => {
    const farmacia = conFarmacia(p)
    const beneficiarios = p.beneficiarios === 'si'
    const topeComun = p.valor.trim() ? aMonto(p.valor) : null
    return {
      ...(p.id ? { id: p.id } : {}),
      nombre: nombreNormal(p.nombre),
      servicios: ordenados(p.servicios).map((s) => {
        const tope = s.tope.trim() ? aMonto(s.tope) : null
        const deducible = sinDeducible(s) ? 0 : aMonto(s.deducible)
        return {
          servicio: s.servicio,
          porcentaje: s.porcentaje.trim() ? aMonto(s.porcentaje) : null,
          tope,
          tope_unidad: tope === null ? null : s.topeUnidad || null,
          deducible,
          deducible_unidad: deducible === 0 ? null : s.deducibleUnidad || null,
          eventos_maximo: s.eventosIlimitados ? null : aEntero(s.eventos, 1, 1000),
        }
      }),
      contrato_id: p.contratoId || null,
      valor: topeComun,
      tope_unidad: topeComun === null ? null : p.topeUnidad || null,
      ventana_evento: p.ventana || null,
      vigencia_receta_horas: farmacia ? aEntero(p.vigencia, 1, 8760) : null,
      requiere_vademecum: farmacia && p.vademecum ? p.vademecum === 'si' : null,
      despacho_parcial: farmacia && p.despachoParcial ? p.despachoParcial === 'si' : null,
      max_diagnosticos: conConsulta(p) ? aEntero(p.maxDiagnosticos, 1, 20) : null,
      beneficiarios_incluidos: p.beneficiarios ? beneficiarios : null,
      parentescos: beneficiarios
        ? PARENTESCOS.map((x) => x.valor).filter((x) => p.parentescos.includes(x))
        : [],
      carencia_dias: p.carencia.trim() ? aEntero(p.carencia, 0, 3650) : null,
      exclusiones: p.exclusiones.trim() || null,
      vademecum: farmacia && p.vademecum === 'si' ? p.vademecumCodigos : [],
    }
  })
}

const textoUnidad = (lista: { valor: string; texto: string }[], valor: string) =>
  lista.find((u) => u.valor === valor)?.texto ?? ''

/**
 * «Farmacia 100 % · Teleconsulta 100 % · tope común USD 10,00 por evento ·
 * receta 72 h» para el producto cerrado.
 */
function resumen(p: ProductoFormulario): string {
  const partes: string[] = []
  for (const s of ordenados(p.servicios)) {
    let texto = nombreServicio(s.servicio)
    if (s.porcentaje.trim()) texto += ` ${s.porcentaje} %`
    if (s.tope.trim()) texto += ` hasta USD ${s.tope} ${textoUnidad(UNIDADES_TOPE, s.topeUnidad)}`
    if (!sinDeducible(s)) {
      texto += `, deducible USD ${s.deducible} ${textoUnidad(UNIDADES_DEDUCIBLE, s.deducibleUnidad)}`
    }
    partes.push(texto.trim())
  }
  if (p.valor.trim()) {
    partes.push(`tope común USD ${p.valor} ${textoUnidad(UNIDADES_TOPE, p.topeUnidad)}`.trim())
  }
  if (conFarmacia(p) && p.vigencia) partes.push(`receta ${p.vigencia} h`)
  return partes.join(' · ') || 'Sin condiciones todavía'
}

function Seccion({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <p className="font-display text-xs font-semibold uppercase tracking-[0.09em] text-tenue-fg">
        {titulo}
      </p>
      {children}
    </div>
  )
}

function SelectSiNo({
  id,
  valor,
  onCambiar,
}: {
  id: string
  valor: SiNo
  onCambiar: (v: SiNo) => void
}) {
  return (
    <Select id={id} value={valor} onChange={(e) => onCambiar(e.target.value as SiNo)} required>
      <option value="" disabled>
        Elige
      </option>
      <option value="si">Sí</option>
      <option value="no">No</option>
    </Select>
  )
}

/** Un monto en USD con su unidad al lado: se lee como un solo dato. */
function MontoConUnidad<U extends string>({
  id,
  etiqueta,
  obligatorio = false,
  monto,
  unidad,
  unidades,
  placeholder,
  conUnidad = true,
  onMonto,
  onUnidad,
}: {
  id: string
  etiqueta: string
  obligatorio?: boolean
  monto: string
  unidad: U | ''
  unidades: { valor: U; etiqueta: string }[]
  placeholder: string
  /** Sin unidad mientras no haga falta: sin monto, o un deducible en 0. */
  conUnidad?: boolean
  onMonto: (v: string) => void
  onUnidad: (v: U) => void
}) {
  return (
    <div className="min-w-0 space-y-2">
      <Label htmlFor={id}>
        {etiqueta} {obligatorio && <span className="text-peligro">*</span>}
      </Label>
      {/* En el celular, la unidad debajo: al lado no cabe sin cortarse. */}
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          id={id}
          value={monto}
          onChange={(e) => onMonto(e.target.value)}
          inputMode="decimal"
          placeholder={placeholder}
          className="tabular sm:w-28 sm:shrink-0"
          maxLength={16}
        />
        {conUnidad && (
          <div className="min-w-0 flex-1">
            <Select
              id={`${id}-unidad`}
              aria-label={`Unidad: ${etiqueta.toLowerCase()}`}
              value={unidad}
              onChange={(e) => onUnidad(e.target.value as U)}
            >
              <option value="" disabled>
                Unidad
              </option>
              {unidades.map((u) => (
                <option key={u.valor} value={u.valor}>
                  {u.etiqueta}
                </option>
              ))}
            </Select>
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * **La pestaña «Producto»** de cualquier cliente (5/11/2026). Cada producto
 * lleva sus condiciones de cobertura (especificación de la Central, M2). Desde
 * el 6/11/2026, por servicio: cada uno con su cobertura, tope, deducible y
 * eventos, más un tope común opcional (sirve el plan con un tope por servicio y
 * el que comparte uno solo). A la vista, lo del resumen de la doctora; el
 * resto, en «Más condiciones». Se guarda con la ficha («Guardar cambios»);
 * quitar uno lo da de baja lógica.
 */
export function ProductosPanel({
  productos,
  onCambiar,
  clienteConFarmacia = false,
  aseguradoraId = null,
}: {
  productos: ProductoFormulario[]
  onCambiar: (productos: ProductoFormulario[]) => void
  /** Lo marcado en la pestaña Módulos: para avisar si un producto con Farmacia no tendrá app. */
  clienteConFarmacia?: boolean
  /** La ficha ya guardada: hace falta para subir el vademécum del cliente. */
  aseguradoraId?: string | null
}) {
  const toast = useToast()
  // El vademécum que entrega el cliente (6/11/2026): su archivo, leído y en revisión.
  const [revisando, setRevisando] = useState<{ clave: string; lecturaId: string } | null>(null)
  const archivoVademecum = useRef<HTMLInputElement>(null)
  const [subiendoPara, setSubiendoPara] = useState<string | null>(null)
  const leer = useMutation({
    mutationFn: (d: { clave: string; productoId: string; archivo: File }) =>
      leerVademecumCliente(aseguradoraId!, d.productoId, d.archivo),
    onSuccess: (lectura, d) => {
      setRevisando({ clave: d.clave, lecturaId: lectura.id })
      toast.exito(
        `Leídas ${lectura.total} filas: ${lectura.encontrados} encontradas, ${lectura.dudosos} dudosas y ${lectura.no_encontrados} no encontradas`,
      )
    },
    onError: (error) => {
      const detalle = (error as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
      toast.error(typeof detalle === 'string' ? detalle : 'No se pudo leer el vademécum')
    },
    onSettled: () => setSubiendoPara(null),
  })
  // Cerrados se ve el resumen; los nuevos nacen abiertos.
  const [cerrados, setCerrados] = useState<Set<string>>(new Set())
  // Lo que no está en el resumen de la doctora, plegado para no abrumar.
  const [conMas, setConMas] = useState<Set<string>>(new Set())
  // Los contratos del cliente: cada producto sale de uno (6/11/2026).
  const contratos = useQuery({
    queryKey: ['aseguradora-polizas', aseguradoraId, 'polizas'],
    queryFn: () => listarPolizas(aseguradoraId!, 'polizas'),
    enabled: Boolean(aseguradoraId),
  })
  const conDatos = (contratos.data ?? []).filter((c) => c.contrato !== null)
  const fecha = new Intl.DateTimeFormat('es-EC', { day: 'numeric', month: 'short', year: 'numeric' })
  const fechaCorta = (iso: string) => {
    const [a = 0, m = 1, d = 1] = iso.split('-').map(Number)
    return fecha.format(new Date(a, m - 1, d))
  }
  const hoy = new Date().toISOString().slice(0, 10)

  function alternarClave(setter: typeof setConMas, clave: string) {
    setter((previo) => {
      const siguiente = new Set(previo)
      if (siguiente.has(clave)) siguiente.delete(clave)
      else siguiente.add(clave)
      return siguiente
    })
  }
  // El producto cuyo vademécum se está eligiendo.
  const [eligiendo, setEligiendo] = useState<string | null>(null)
  const productoEligiendo = productos.find((p) => p._key === eligiendo)

  function poner<K extends keyof ProductoFormulario>(
    clave: string,
    campo: K,
    valor: ProductoFormulario[K],
  ) {
    onCambiar(productos.map((p) => (p._key === clave ? { ...p, [campo]: valor } : p)))
  }

  function ponerServicio<K extends keyof ServicioFormulario>(
    clave: string,
    servicio: ServicioProducto,
    campo: K,
    valor: ServicioFormulario[K],
  ) {
    onCambiar(
      productos.map((p) =>
        p._key === clave
          ? {
              ...p,
              servicios: p.servicios.map((s) =>
                s.servicio === servicio ? { ...s, [campo]: valor } : s,
              ),
            }
          : p,
      ),
    )
  }

  function agregarServicio(clave: string, servicio: ServicioProducto) {
    onCambiar(
      productos.map((p) =>
        p._key === clave && !conServicio(p, servicio)
          ? { ...p, servicios: ordenados([...p.servicios, servicioVacio(servicio)]) }
          : p,
      ),
    )
  }

  function quitarServicio(clave: string, servicio: ServicioProducto) {
    onCambiar(
      productos.map((p) =>
        p._key === clave
          ? { ...p, servicios: p.servicios.filter((s) => s.servicio !== servicio) }
          : p,
      ),
    )
  }

  function alternar<T extends string>(lista: T[], valor: T, marcado: boolean): T[] {
    return marcado ? [...new Set([...lista, valor])] : lista.filter((x) => x !== valor)
  }

  return (
    <div className="space-y-4">
      {productos.length === 0 ? (
        <div className="rounded-md border border-dashed border-borde px-6 py-10 text-center">
          <Package className="mx-auto size-6 text-tenue-fg" aria-hidden="true" />
          <p className="mt-3 font-display text-sm font-medium">Todavía no hay productos</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-tenue-fg">
            Agrega cada producto con los servicios que cubre y sus condiciones.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {productos.map((p, i) => {
            const id = (campo: string) => `producto-${campo}-${p._key}`
            const abierto = !cerrados.has(p._key)
            const faltan = faltanProducto(p)
            const masAbierto = conMas.has(p._key)
            const conTopeComun = Boolean(p.valor.trim())
            const quedan = SERVICIOS.filter((s) => !conServicio(p, s.valor))
            return (
              <li key={p._key} className="rounded-md border border-borde bg-fondo/40">
                {/* ── Cabecera: nombre, resumen y acciones ── */}
                <div className="flex items-start gap-3 p-4">
                  <div className="min-w-0 flex-1 space-y-2">
                    <Label htmlFor={id('nombre')}>
                      Nombre <span className="text-peligro">*</span>
                    </Label>
                    <Input
                      id={id('nombre')}
                      value={p.nombre}
                      onChange={(e) => poner(p._key, 'nombre', e.target.value)}
                      placeholder="ASISTENCIA TOTAL"
                      maxLength={150}
                    />
                    {!abierto && (
                      <p className={cn('text-xs', faltan.length ? 'text-aviso' : 'text-tenue-fg')}>
                        {faltan.length ? `Incompleto · ${resumen(p)}` : resumen(p)}
                      </p>
                    )}
                  </div>
                  <Boton
                    type="button"
                    variante="fantasma"
                    tamano="icono"
                    onClick={() => alternarClave(setCerrados, p._key)}
                    aria-expanded={abierto}
                    aria-label={abierto ? 'Contraer el producto' : 'Ver las condiciones'}
                    title={abierto ? 'Contraer' : 'Ver las condiciones'}
                    className="mt-7"
                  >
                    <ChevronDown
                      aria-hidden="true"
                      className={cn('transition-transform duration-150', abierto && 'rotate-180')}
                    />
                  </Boton>
                  <Boton
                    type="button"
                    variante="fantasma"
                    tamano="icono"
                    onClick={() => onCambiar(productos.filter((x) => x._key !== p._key))}
                    aria-label={`Quitar el producto ${p.nombre || i + 1}`}
                    title="Quitar el producto"
                    className="mt-7 hover:text-peligro"
                  >
                    <Trash2 aria-hidden="true" />
                  </Boton>
                </div>

                {abierto && (
                  <div className="space-y-6 border-t border-borde p-4">
                    <div className="space-y-2">
                      <Label htmlFor={id('contrato')}>
                        Contrato del que sale <span className="text-peligro">*</span>
                      </Label>
                      {conDatos.length === 0 ? (
                        <p className="rounded-md border border-dashed border-borde px-3 py-2 text-sm text-tenue-fg">
                          {aseguradoraId
                            ? 'Primero sube el contrato en la pestaña «Contratos y pólizas»: cada producto sale de un contrato.'
                            : 'Guarda la ficha y sube su contrato en «Contratos y pólizas»: cada producto sale de un contrato.'}
                        </p>
                      ) : (
                        <Select
                          id={id('contrato')}
                          value={p.contratoId}
                          onChange={(e) => poner(p._key, 'contratoId', e.target.value)}
                          required
                        >
                          <option value="" disabled>
                            Elige el contrato
                          </option>
                          {conDatos.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.nombre} · {fechaCorta(c.contrato!.vigencia_desde)} –{' '}
                              {fechaCorta(c.contrato!.vigencia_hasta)}
                              {c.contrato!.vigencia_hasta < hoy ? ' (vencido)' : ''}
                            </option>
                          ))}
                        </Select>
                      )}
                      <p className="text-xs text-tenue-fg">
                        Un contrato puede traer varios productos. El producto está vigente mientras
                        lo esté su contrato.
                      </p>
                    </div>

                    {/* ── Cada servicio con su cobertura, tope, deducible y eventos ── */}
                    <Seccion titulo="Servicios que cubre *">
                      {p.servicios.length === 0 && (
                        <p className="text-sm text-tenue-fg">
                          Agrega cada servicio: farmacia, teleconsulta, consulta ambulatoria u
                          hospitalaria. Cada uno lleva su cobertura.
                        </p>
                      )}
                      <ul className="space-y-3">
                        {p.servicios.map((s) => {
                          const sid = (campo: string) => id(`${s.servicio}-${campo}`)
                          const cobertura = aNumero(s.porcentaje)
                          const copago =
                            Number.isNaN(cobertura) || cobertura > 100
                              ? null
                              : (Math.round((100 - cobertura) * 100) / 100).toString().replace('.', ',')
                          const farmacia = s.servicio === 'farmacia'
                          return (
                            <li
                              key={s.servicio}
                              className="space-y-4 rounded-md border border-borde bg-superficie p-4"
                            >
                              <div className="flex items-center justify-between gap-3">
                                <p className="font-display text-sm font-semibold">
                                  {nombreServicio(s.servicio)}
                                </p>
                                <Boton
                                  type="button"
                                  variante="fantasma"
                                  tamano="icono"
                                  onClick={() => quitarServicio(p._key, s.servicio)}
                                  aria-label={`Quitar ${nombreServicio(s.servicio)} del producto`}
                                  title="Quitar el servicio"
                                  className="hover:text-peligro"
                                >
                                  <X aria-hidden="true" />
                                </Boton>
                              </div>
                              {farmacia && !clienteConFarmacia && (
                                <p className="rounded-md border border-aviso/30 bg-aviso/10 px-3 py-2 text-sm text-aviso">
                                  El cliente no tiene marcado Farmacovigilancia en la pestaña
                                  Módulos.
                                </p>
                              )}
                              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_minmax(0,2fr)_minmax(0,1fr)]">
                                <div className="space-y-2">
                                  <Label htmlFor={sid('cobertura')}>
                                    Cobertura (%) <span className="text-peligro">*</span>
                                  </Label>
                                  <Input
                                    id={sid('cobertura')}
                                    value={s.porcentaje}
                                    onChange={(e) =>
                                      ponerServicio(p._key, s.servicio, 'porcentaje', e.target.value)
                                    }
                                    inputMode="decimal"
                                    placeholder="80"
                                    className="tabular"
                                    maxLength={6}
                                  />
                                  <p className="text-xs text-tenue-fg">
                                    {copago === null ? 'El copago se calcula' : `Copago del paciente: ${copago} %`}
                                  </p>
                                </div>
                                <div className="sm:col-span-2 lg:col-span-1">
                                  <MontoConUnidad
                                    id={sid('tope')}
                                    etiqueta={conTopeComun ? 'Tope propio (USD)' : 'Tope (USD)'}
                                    obligatorio={!conTopeComun}
                                    monto={s.tope}
                                    unidad={s.topeUnidad}
                                    unidades={unidadesDeTope(farmacia)}
                                    placeholder={conTopeComun ? 'EL COMÚN' : '1500,00'}
                                    conUnidad={Boolean(s.tope.trim())}
                                    onMonto={(v) => ponerServicio(p._key, s.servicio, 'tope', v)}
                                    onUnidad={(v) => ponerServicio(p._key, s.servicio, 'topeUnidad', v)}
                                  />
                                </div>
                                <div className="sm:col-span-2 lg:col-span-1">
                                  <MontoConUnidad
                                    id={sid('deducible')}
                                    etiqueta="Deducible (USD)"
                                    monto={s.deducible}
                                    unidad={s.deducibleUnidad}
                                    unidades={UNIDADES_DEDUCIBLE}
                                    placeholder="0"
                                    conUnidad={!sinDeducible(s)}
                                    onMonto={(v) => ponerServicio(p._key, s.servicio, 'deducible', v)}
                                    onUnidad={(v) =>
                                      ponerServicio(p._key, s.servicio, 'deducibleUnidad', v)
                                    }
                                  />
                                </div>
                                <div className="space-y-2">
                                  <Label htmlFor={sid('eventos')}>Número de eventos</Label>
                                  <Input
                                    id={sid('eventos')}
                                    value={s.eventosIlimitados ? '' : s.eventos}
                                    onChange={(e) =>
                                      ponerServicio(p._key, s.servicio, 'eventos', e.target.value)
                                    }
                                    inputMode="numeric"
                                    placeholder={s.eventosIlimitados ? 'ILIMITADOS' : '3'}
                                    className="tabular"
                                    maxLength={4}
                                    disabled={s.eventosIlimitados}
                                  />
                                  <Checkbox
                                    id={sid('ilimitados')}
                                    checked={s.eventosIlimitados}
                                    onChange={(v) =>
                                      ponerServicio(p._key, s.servicio, 'eventosIlimitados', v)
                                    }
                                    titulo="Ilimitados"
                                    compacto
                                  />
                                </div>
                                {farmacia && (
                                  <div className="space-y-2">
                                    <Label htmlFor={id('receta')}>
                                      Vigencia de la receta (horas){' '}
                                      <span className="text-peligro">*</span>
                                    </Label>
                                    <Input
                                      id={id('receta')}
                                      value={p.vigencia}
                                      onChange={(e) => poner(p._key, 'vigencia', e.target.value)}
                                      inputMode="numeric"
                                      placeholder="72"
                                      className="tabular"
                                      maxLength={4}
                                    />
                                    <p className="text-xs text-tenue-fg">
                                      El SLA de farmacia: pasadas, la receta vence.
                                    </p>
                                  </div>
                                )}
                              </div>
                            </li>
                          )
                        })}
                      </ul>
                      {quedan.length > 0 && (
                        <div className="max-w-xs">
                          <Select
                            id={id('agregar-servicio')}
                            aria-label="Agregar un servicio al producto"
                            value=""
                            onChange={(e) =>
                              agregarServicio(p._key, e.target.value as ServicioProducto)
                            }
                          >
                            <option value="" disabled>
                              + Agregar servicio
                            </option>
                            {quedan.map((s) => (
                              <option key={s.valor} value={s.valor}>
                                {s.etiqueta}
                              </option>
                            ))}
                          </Select>
                        </div>
                      )}
                    </Seccion>

                    {/* ── El tope que comparten todos sus servicios ── */}
                    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                      <MontoConUnidad
                        id={id('tope-comun')}
                        etiqueta="Tope común a sus servicios (USD), opcional"
                        monto={p.valor}
                        unidad={p.topeUnidad}
                        unidades={unidadesDeTope(conFarmacia(p))}
                        placeholder="10,00"
                        conUnidad={conTopeComun}
                        onMonto={(v) => poner(p._key, 'valor', v)}
                        onUnidad={(v) => poner(p._key, 'topeUnidad', v)}
                      />
                      <p className="self-end text-xs text-tenue-fg">
                        Lo máximo que paga el producto sumando todos sus servicios (Asistencia
                        Total: USD 10 por evento entre farmacia y teleconsulta). Con él, el tope de
                        cada servicio es opcional; si hay los dos, se paga hasta el menor.
                      </p>
                    </div>

                    {/* ── Estado y lo que no está en el resumen ── */}
                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-borde bg-superficie px-4 py-3">
                      <div className="min-w-0">
                        <p className={cn('text-sm font-medium', faltan.length ? 'text-aviso' : 'text-exito')}>
                          {faltan.length ? 'Incompleto: no se usa hasta completarlo' : 'Completo'}
                        </p>
                        <p className="text-xs text-tenue-fg">
                          {faltan.length ? `Falta ${faltan.join(', ')}.` : resumen(p)}
                        </p>
                      </div>
                      <Boton
                        type="button"
                        variante="contorno"
                        tamano="sm"
                        onClick={() => alternarClave(setConMas, p._key)}
                        aria-expanded={masAbierto}
                      >
                        {masAbierto ? 'Ocultar más condiciones' : 'Más condiciones'}
                      </Boton>
                    </div>

                    {masAbierto && (
                      <div className="space-y-6">
                        <Seccion titulo="Quiénes entran y desde cuándo">
                          <div className="grid gap-4 sm:grid-cols-3">
                            <div className="space-y-2">
                              <Label htmlFor={id('carencia')}>
                                Carencia (días) <span className="text-peligro">*</span>
                              </Label>
                              <Input
                                id={id('carencia')}
                                value={p.carencia}
                                onChange={(e) => poner(p._key, 'carencia', e.target.value)}
                                inputMode="numeric"
                                placeholder="0"
                                className="tabular"
                                maxLength={4}
                              />
                            </div>
                            <div className="space-y-2">
                              <Label htmlFor={id('beneficiarios')}>
                                ¿Incluye beneficiarios? <span className="text-peligro">*</span>
                              </Label>
                              <SelectSiNo
                                id={id('beneficiarios')}
                                valor={p.beneficiarios}
                                onCambiar={(v) => poner(p._key, 'beneficiarios', v)}
                              />
                            </div>
                            {p.beneficiarios === 'si' && (
                              <div className="space-y-2">
                                <p className="text-sm font-medium">
                                  Parentescos <span className="text-peligro">*</span>
                                </p>
                                <div className="flex flex-wrap gap-x-5 gap-y-2 pt-2">
                                  {PARENTESCOS.map((x) => (
                                    <Checkbox
                                      key={x.valor}
                                      id={id(`parentesco-${x.valor}`)}
                                      checked={p.parentescos.includes(x.valor)}
                                      onChange={(v) =>
                                        poner(p._key, 'parentescos', alternar(p.parentescos, x.valor, v))
                                      }
                                      titulo={x.etiqueta}
                                      compacto
                                    />
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        </Seccion>

                        <Seccion titulo="Cómo se cuenta un evento">
                          <div className="grid gap-4 sm:grid-cols-3">
                            <div className="space-y-2">
                              <Label htmlFor={id('ventana')}>
                                Ventana del evento <span className="text-peligro">*</span>
                              </Label>
                              <Select
                                id={id('ventana')}
                                value={p.ventana}
                                onChange={(e) => poner(p._key, 'ventana', e.target.value as VentanaEvento)}
                                required
                              >
                                <option value="" disabled>
                                  Elige la ventana
                                </option>
                                {VENTANAS.map((v) => (
                                  <option key={v.valor} value={v.valor}>
                                    {v.etiqueta}
                                  </option>
                                ))}
                              </Select>
                            </div>
                            <p className="self-end text-xs text-tenue-fg sm:col-span-2">
                              Un evento es la misma enfermedad del mismo asegurado dentro de la
                              ventana: enfermedades distintas suman topes; la misma repetida
                              comparte el saldo.
                            </p>
                          </div>
                        </Seccion>

                        {conFarmacia(p) && (
                          <Seccion titulo="Farmacia">
                            <div className="grid gap-4 sm:grid-cols-3">
                              <div className="space-y-2">
                                <Label htmlFor={id('vademecum')}>
                                  ¿Requiere vademécum? <span className="text-peligro">*</span>
                                </Label>
                                <SelectSiNo
                                  id={id('vademecum')}
                                  valor={p.vademecum}
                                  onCambiar={(v) => poner(p._key, 'vademecum', v)}
                                />
                              </div>
                              <div className="space-y-2">
                                <Label htmlFor={id('parcial')}>
                                  ¿Permite despacho parcial? <span className="text-peligro">*</span>
                                </Label>
                                <SelectSiNo
                                  id={id('parcial')}
                                  valor={p.despachoParcial}
                                  onCambiar={(v) => poner(p._key, 'despachoParcial', v)}
                                />
                              </div>
                            </div>
                            {p.vademecum === 'si' && (
                              <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-borde bg-superficie px-4 py-3">
                                <div>
                                  <p className="text-sm font-medium">Vademécum del producto</p>
                                  <p className="text-xs text-tenue-fg">
                                    {p.vademecumCodigos.length === 0
                                      ? 'Todavía sin medicamentos: elige los que cubre.'
                                      : `${p.vademecumCodigos.length} ${p.vademecumCodigos.length === 1 ? 'medicamento' : 'medicamentos'} del vademécum maestro.`}
                                  </p>
                                </div>
                                <div className="flex flex-wrap gap-2">
                                  <Boton
                                    type="button"
                                    tamano="sm"
                                    disabled={!p.id || !aseguradoraId}
                                    cargando={leer.isPending && subiendoPara === p._key}
                                    title={
                                      p.id
                                        ? 'El PDF o Excel que entregó el cliente: se lee y se cruza con el maestro'
                                        : 'Guarda primero el producto'
                                    }
                                    onClick={() => {
                                      setSubiendoPara(p._key)
                                      archivoVademecum.current?.click()
                                    }}
                                  >
                                    <FileUp aria-hidden="true" />
                                    Subir vademécum del cliente
                                  </Boton>
                                  <Boton
                                    type="button"
                                    variante="contorno"
                                    tamano="sm"
                                    onClick={() => setEligiendo(p._key)}
                                  >
                                    Elegir a mano
                                  </Boton>
                                </div>
                                {!p.id && (
                                  <p className="w-full text-xs text-tenue-fg">
                                    Para subir el PDF o Excel del cliente, guarda primero el producto.
                                  </p>
                                )}
                              </div>
                            )}
                          </Seccion>
                        )}

                        {conConsulta(p) && (
                          <Seccion titulo="Consulta">
                            <div className="grid gap-4 sm:grid-cols-3">
                              <div className="space-y-2">
                                <Label htmlFor={id('diagnosticos')}>
                                  Máximo de diagnósticos por consulta
                                </Label>
                                <Input
                                  id={id('diagnosticos')}
                                  value={p.maxDiagnosticos}
                                  onChange={(e) => poner(p._key, 'maxDiagnosticos', e.target.value)}
                                  inputMode="numeric"
                                  placeholder="SIN LÍMITE"
                                  className="tabular"
                                  maxLength={2}
                                />
                                <p className="text-xs text-tenue-fg">Opcional. Vacío = sin límite.</p>
                              </div>
                            </div>
                          </Seccion>
                        )}

                        <Seccion titulo="Exclusiones">
                          <textarea
                            id={id('exclusiones')}
                            value={p.exclusiones}
                            onChange={(e) =>
                              poner(p._key, 'exclusiones', e.target.value.toLocaleUpperCase())
                            }
                            rows={3}
                            maxLength={2000}
                            aria-label="Exclusiones"
                            placeholder="MEDICAMENTOS O DIAGNÓSTICOS QUE ESTE PRODUCTO NO CUBRE (OPCIONAL)"
                            className="block w-full rounded-md border border-borde bg-fondo px-3 py-2 text-sm placeholder:text-tenue-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marca/40"
                          />
                        </Seccion>
                      </div>
                    )}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
      <input
        ref={archivoVademecum}
        type="file"
        accept=".pdf,.xlsx,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        className="hidden"
        aria-hidden="true"
        tabIndex={-1}
        onChange={(e) => {
          const archivo = e.target.files?.[0]
          const p = productos.find((x) => x._key === subiendoPara)
          e.target.value = ''
          if (!archivo || !p?.id) return setSubiendoPara(null)
          leer.mutate({ clave: p._key, productoId: p.id, archivo })
        }}
      />
      {revisando && aseguradoraId && (
        <RevisionLectura
          aseguradoraId={aseguradoraId}
          lecturaId={revisando.lecturaId}
          producto={nombreNormal(productos.find((x) => x._key === revisando.clave)?.nombre ?? '')}
          onCerrar={() => setRevisando(null)}
          onConfirmada={(codigos) => poner(revisando.clave, 'vademecumCodigos', codigos)}
        />
      )}
      {productoEligiendo && (
        <VademecumSelector
          abierto
          onCerrar={() => setEligiendo(null)}
          producto={nombreNormal(productoEligiendo.nombre)}
          elegidos={productoEligiendo.vademecumCodigos}
          onCambiar={(codigos) => poner(productoEligiendo._key, 'vademecumCodigos', codigos)}
        />
      )}
      <Boton
        type="button"
        variante="contorno"
        onClick={() =>
          onCambiar([...productos, productoVacio(conDatos.length === 1 ? conDatos[0]!.id : '')])
        }
      >
        <Plus aria-hidden="true" />
        Agregar producto
      </Boton>
    </div>
  )
}
