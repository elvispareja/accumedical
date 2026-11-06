import { ChevronDown, Package, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'

import { cn } from '@/lib/utils'
import { Boton } from '@/shared/components/ui/button'
import { Checkbox } from '@/shared/components/ui/checkbox'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { Select } from '@/shared/components/ui/select'

// ─── Catálogos (mismos códigos que los CHECK de las dos bases) ────────────────
// Especificación de la Central, M2 «Productos y condiciones de cobertura».

export type ServicioProducto = 'farmacia' | 'teleconsulta' | 'consulta_ambulatoria' | 'hospitalaria'
export type UnidadTope = 'evento' | 'persona_mes' | 'persona_anio' | 'receta'
export type VentanaEvento = 'mes_calendario' | 'dias_moviles_30' | 'vigencia_poliza'
export type Parentesco = 'conyuge' | 'hijos' | 'padres'

export const SERVICIOS: { valor: ServicioProducto; etiqueta: string }[] = [
  { valor: 'farmacia', etiqueta: 'Farmacia' },
  { valor: 'teleconsulta', etiqueta: 'Teleconsulta' },
  { valor: 'consulta_ambulatoria', etiqueta: 'Consulta ambulatoria' },
  { valor: 'hospitalaria', etiqueta: 'Hospitalaria' },
]

const UNIDADES_TOPE: { valor: UnidadTope; etiqueta: string; texto: string }[] = [
  { valor: 'evento', etiqueta: 'Por evento (diagnóstico)', texto: 'por evento' },
  { valor: 'persona_mes', etiqueta: 'Por persona al mes', texto: 'por persona al mes' },
  { valor: 'persona_anio', etiqueta: 'Por persona al año', texto: 'por persona al año' },
  { valor: 'receta', etiqueta: 'Por receta', texto: 'por receta' },
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
 * Un producto en el formulario (5/11/2026; condiciones de M2 desde el 6/11).
 * Los números van como texto mientras se escriben —«12,5» a medias no es un
 * número— y se convierten al guardar. `_key` es solo para React.
 *
 * `valor` es el TOPE de cobertura en USD y `porcentaje` el % de cobertura (el
 * copago se calcula). Lo de farmacia (receta, vademécum, despacho parcial) solo
 * se pide si el producto incluye Farmacia.
 */
export interface ProductoFormulario {
  _key: string
  id?: string
  nombre: string
  servicios: ServicioProducto[]
  valor: string
  topeUnidad: UnidadTope | ''
  ventana: VentanaEvento | ''
  eventos: string
  eventosIlimitados: boolean
  porcentaje: string
  vigencia: string
  vademecum: SiNo
  despachoParcial: SiNo
  maxDiagnosticos: string
  beneficiarios: SiNo
  parentescos: Parentesco[]
  carencia: string
  exclusiones: string
}

/** Lo que devuelve la ficha. */
export interface ProductoSalida {
  id: string
  nombre: string
  servicios: ServicioProducto[]
  valor: number
  tope_unidad: UnidadTope | null
  ventana_evento: VentanaEvento | null
  /** `null` = ilimitados. */
  eventos_maximo: number | null
  porcentaje: number
  /** Horas corridas de vigencia de la receta; `null` si no incluye Farmacia. */
  vigencia_receta_horas: number | null
  requiere_vademecum: boolean | null
  despacho_parcial: boolean | null
  /** `null` = sin límite. */
  max_diagnosticos: number | null
  beneficiarios_incluidos: boolean
  parentescos: Parentesco[]
  carencia_dias: number
  exclusiones: string | null
}

export function productoVacio(): ProductoFormulario {
  return {
    _key: crypto.randomUUID(),
    nombre: '',
    servicios: [],
    valor: '',
    topeUnidad: '',
    ventana: '',
    eventos: '',
    eventosIlimitados: false,
    porcentaje: '',
    vigencia: '',
    vademecum: '',
    despachoParcial: '',
    maxDiagnosticos: '',
    beneficiarios: '',
    parentescos: [],
    carencia: '',
    exclusiones: '',
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
    servicios: p.servicios,
    valor: aTexto(p.valor, true),
    topeUnidad: p.tope_unidad ?? '',
    ventana: p.ventana_evento ?? '',
    // Un producto anterior a M2 no tiene unidad: su «ilimitado» no se supone.
    eventos: p.eventos_maximo === null ? '' : String(p.eventos_maximo),
    eventosIlimitados: p.eventos_maximo === null && p.tope_unidad !== null,
    porcentaje: aTexto(p.porcentaje, false),
    vigencia: p.vigencia_receta_horas === null ? '' : String(p.vigencia_receta_horas),
    vademecum: siNo(p.requiere_vademecum),
    despachoParcial: siNo(p.despacho_parcial),
    maxDiagnosticos: p.max_diagnosticos === null ? '' : String(p.max_diagnosticos),
    beneficiarios: p.tope_unidad === null ? '' : siNo(p.beneficiarios_incluidos),
    parentescos: p.parentescos,
    carencia: p.tope_unidad === null ? '' : String(p.carencia_dias),
    exclusiones: p.exclusiones ?? '',
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

const conFarmacia = (p: ProductoFormulario) => p.servicios.includes('farmacia')
const conConsulta = (p: ProductoFormulario) =>
  p.servicios.includes('teleconsulta') || p.servicios.includes('consulta_ambulatoria')

/** El primer problema de la lista, en palabras; null si se puede guardar. Mismas reglas que el servidor. */
export function validarProductos(productos: ProductoFormulario[]): string | null {
  if (productos.length > 200) return 'Una ficha admite hasta 200 productos'
  const nombres = new Set<string>()
  for (const [i, p] of productos.entries()) {
    const nombre = nombreNormal(p.nombre)
    if (!nombre) return `Al producto ${i + 1} le falta el nombre`
    if (nombre.length > 150) return `El nombre del producto ${i + 1} admite hasta 150 caracteres`
    if (nombres.has(nombre)) return `El producto ${nombre} está repetido`
    nombres.add(nombre)
    if (p.servicios.length === 0) return `${nombre}: elige qué servicios cubre`
    const tope = aNumero(p.valor)
    if (Number.isNaN(tope) || tope > 9_999_999_999.99) {
      return `${nombre}: el tope debe ser un número con hasta dos decimales y sin separador de miles (por ejemplo 10,00)`
    }
    if (!p.topeUnidad) return `${nombre}: elige la unidad del tope`
    if (!p.ventana) return `${nombre}: elige la ventana del evento`
    if (!p.eventosIlimitados && aEntero(p.eventos, 1, 1000) === null) {
      return `${nombre}: el número de eventos debe ser un entero entre 1 y 1000, o marca «Ilimitados»`
    }
    const porcentaje = aNumero(p.porcentaje)
    if (Number.isNaN(porcentaje) || porcentaje > 100) {
      return `${nombre}: la cobertura debe ser un porcentaje entre 0 y 100, con hasta dos decimales`
    }
    if (conFarmacia(p)) {
      if (aEntero(p.vigencia, 1, 8760) === null) {
        return `${nombre}: la vigencia de la receta debe ser un número entero de horas entre 1 y 8760 (por ejemplo 72)`
      }
      if (!p.vademecum) return `${nombre}: indica si requiere vademécum`
      if (!p.despachoParcial) return `${nombre}: indica si permite despacho parcial`
    }
    if (conConsulta(p) && p.maxDiagnosticos.trim() && aEntero(p.maxDiagnosticos, 1, 20) === null) {
      return `${nombre}: el máximo de diagnósticos por consulta debe ser un entero entre 1 y 20, o déjalo vacío (sin límite)`
    }
    if (aEntero(p.carencia, 0, 3650) === null) {
      return `${nombre}: la carencia debe ser un número entero de días entre 0 y 3650`
    }
    if (!p.beneficiarios) return `${nombre}: indica si incluye beneficiarios`
    if (p.beneficiarios === 'si' && p.parentescos.length === 0) {
      return `${nombre}: incluye beneficiarios, elige sus parentescos`
    }
    if (p.exclusiones.length > 2000) return `${nombre}: las exclusiones admiten hasta 2000 caracteres`
  }
  return null
}

/**
 * Solo tras `validarProductos`. Manda el producto COMPLETO; lo que no aplica a
 * sus servicios va en `null` (el servidor lo exige así).
 */
export function productosHaciaApi(productos: ProductoFormulario[]) {
  return productos.map((p) => {
    const farmacia = conFarmacia(p)
    const beneficiarios = p.beneficiarios === 'si'
    return {
      ...(p.id ? { id: p.id } : {}),
      nombre: nombreNormal(p.nombre),
      servicios: SERVICIOS.map((s) => s.valor).filter((s) => p.servicios.includes(s)),
      valor: Math.round(aNumero(p.valor) * 100) / 100,
      tope_unidad: p.topeUnidad || null,
      ventana_evento: p.ventana || null,
      eventos_maximo: p.eventosIlimitados ? null : aEntero(p.eventos, 1, 1000),
      porcentaje: Math.round(aNumero(p.porcentaje) * 100) / 100,
      vigencia_receta_horas: farmacia ? aEntero(p.vigencia, 1, 8760) : null,
      requiere_vademecum: farmacia ? p.vademecum === 'si' : null,
      despacho_parcial: farmacia ? p.despachoParcial === 'si' : null,
      max_diagnosticos: conConsulta(p) ? aEntero(p.maxDiagnosticos, 1, 20) : null,
      beneficiarios_incluidos: beneficiarios,
      parentescos: beneficiarios
        ? PARENTESCOS.map((x) => x.valor).filter((x) => p.parentescos.includes(x))
        : [],
      carencia_dias: aEntero(p.carencia, 0, 3650) ?? 0,
      exclusiones: p.exclusiones.trim() || null,
    }
  })
}

/** «FARMACIA, TELECONSULTA · USD 10,00 POR EVENTO · 100 % · RECETA 72 H» para el producto cerrado. */
function resumen(p: ProductoFormulario): string {
  const partes: string[] = []
  const servicios = SERVICIOS.filter((s) => p.servicios.includes(s.valor)).map((s) => s.etiqueta)
  if (servicios.length) partes.push(servicios.join(', '))
  if (p.valor) {
    const unidad = UNIDADES_TOPE.find((u) => u.valor === p.topeUnidad)?.texto ?? ''
    partes.push(`USD ${p.valor} ${unidad}`.trim())
  }
  if (p.porcentaje) partes.push(`${p.porcentaje} % de cobertura`)
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

/**
 * **La pestaña «Producto»** de cualquier cliente (5/11/2026). Desde el 6/11 cada
 * producto lleva sus condiciones de cobertura (especificación de la Central,
 * M2): qué servicios cubre y, según eso, tope, ventana, eventos, cobertura,
 * receta (solo con Farmacia), diagnósticos, beneficiarios, carencia y
 * exclusiones. Cada producto tiene las suyas: es lo variable del sistema.
 * Se guarda con la ficha («Guardar cambios»); quitar uno lo da de baja lógica.
 */
export function ProductosPanel({
  productos,
  onCambiar,
  clienteConFarmacia = false,
}: {
  productos: ProductoFormulario[]
  onCambiar: (productos: ProductoFormulario[]) => void
  /** Lo marcado en la pestaña Módulos: para avisar si un producto con Farmacia no tendrá app. */
  clienteConFarmacia?: boolean
}) {
  // Cerrados se ve el resumen; los nuevos nacen abiertos.
  const [cerrados, setCerrados] = useState<Set<string>>(new Set())

  function poner<K extends keyof ProductoFormulario>(
    clave: string,
    campo: K,
    valor: ProductoFormulario[K],
  ) {
    onCambiar(productos.map((p) => (p._key === clave ? { ...p, [campo]: valor } : p)))
  }

  function alternar<T extends string>(lista: T[], valor: T, marcado: boolean): T[] {
    return marcado ? [...new Set([...lista, valor])] : lista.filter((x) => x !== valor)
  }

  function abrirOCerrar(clave: string) {
    setCerrados((previo) => {
      const siguiente = new Set(previo)
      if (siguiente.has(clave)) siguiente.delete(clave)
      else siguiente.add(clave)
      return siguiente
    })
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
            const tope = aNumero(p.valor)
            const cobertura = aNumero(p.porcentaje)
            const copago =
              Number.isNaN(cobertura) || cobertura > 100
                ? '—'
                : `${(Math.round((100 - cobertura) * 100) / 100).toString().replace('.', ',')} %`
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
                    {!abierto && <p className="text-xs text-tenue-fg">{resumen(p)}</p>}
                  </div>
                  <Boton
                    type="button"
                    variante="fantasma"
                    tamano="icono"
                    onClick={() => abrirOCerrar(p._key)}
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
                    <Seccion titulo="Servicios que cubre *">
                      <div className="flex flex-wrap gap-x-6 gap-y-2">
                        {SERVICIOS.map((s) => (
                          <Checkbox
                            key={s.valor}
                            id={id(`servicio-${s.valor}`)}
                            checked={p.servicios.includes(s.valor)}
                            onChange={(v) =>
                              poner(p._key, 'servicios', alternar(p.servicios, s.valor, v))
                            }
                            titulo={s.etiqueta}
                            compacto
                          />
                        ))}
                      </div>
                    </Seccion>

                    <Seccion titulo="Cobertura">
                      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                        <div className="space-y-2">
                          <Label htmlFor={id('tope')}>
                            Tope (USD) <span className="text-peligro">*</span>
                          </Label>
                          <Input
                            id={id('tope')}
                            value={p.valor}
                            onChange={(e) => poner(p._key, 'valor', e.target.value)}
                            inputMode="decimal"
                            placeholder="10,00"
                            className="tabular"
                            maxLength={16}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor={id('unidad')}>
                            Unidad del tope <span className="text-peligro">*</span>
                          </Label>
                          <Select
                            id={id('unidad')}
                            value={p.topeUnidad}
                            onChange={(e) => poner(p._key, 'topeUnidad', e.target.value as UnidadTope)}
                            required
                          >
                            <option value="" disabled>
                              Elige la unidad
                            </option>
                            {UNIDADES_TOPE.map((u) => (
                              <option key={u.valor} value={u.valor}>
                                {u.etiqueta}
                              </option>
                            ))}
                          </Select>
                        </div>
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
                        <div className="space-y-2">
                          <Label htmlFor={id('eventos')}>
                            Número de eventos <span className="text-peligro">*</span>
                          </Label>
                          <Input
                            id={id('eventos')}
                            value={p.eventosIlimitados ? '' : p.eventos}
                            onChange={(e) => poner(p._key, 'eventos', e.target.value)}
                            inputMode="numeric"
                            placeholder={p.eventosIlimitados ? 'ILIMITADOS' : '3'}
                            className="tabular"
                            maxLength={4}
                            disabled={p.eventosIlimitados}
                          />
                          <Checkbox
                            id={id('ilimitados')}
                            checked={p.eventosIlimitados}
                            onChange={(v) => poner(p._key, 'eventosIlimitados', v)}
                            titulo="Ilimitados"
                            compacto
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor={id('cobertura')}>
                            Cobertura (%) <span className="text-peligro">*</span>
                          </Label>
                          <Input
                            id={id('cobertura')}
                            value={p.porcentaje}
                            onChange={(e) => poner(p._key, 'porcentaje', e.target.value)}
                            inputMode="decimal"
                            placeholder="100"
                            className="tabular"
                            maxLength={6}
                          />
                        </div>
                        <div className="space-y-2">
                          <p className="text-sm font-medium">Copago del paciente</p>
                          <p className="flex h-10 items-center text-sm tabular text-tenue-fg">
                            {copago}
                            <span className="ml-2 text-xs">(se calcula)</span>
                          </p>
                        </div>
                      </div>
                      {!Number.isNaN(tope) && p.topeUnidad === 'evento' && (
                        <p className="text-xs text-tenue-fg">
                          Un evento es la misma enfermedad del mismo asegurado dentro de la ventana:
                          enfermedades distintas suman topes; la misma repetida comparte el saldo.
                        </p>
                      )}
                    </Seccion>

                    {conFarmacia(p) && (
                      <Seccion titulo="Farmacia">
                        {!clienteConFarmacia && (
                          <p className="rounded-md border border-aviso/30 bg-aviso/10 px-3 py-2 text-sm text-aviso">
                            Este producto incluye Farmacia, pero el cliente no tiene marcado
                            Farmacovigilancia en la pestaña Módulos.
                          </p>
                        )}
                        <div className="grid gap-4 sm:grid-cols-3">
                          <div className="space-y-2">
                            <Label htmlFor={id('receta')}>
                              Vigencia de la receta (horas) <span className="text-peligro">*</span>
                            </Label>
                            <Input
                              id={id('receta')}
                              value={p.vigencia}
                              onChange={(e) => poner(p._key, 'vigencia', e.target.value)}
                              inputMode="numeric"
                              placeholder="72"
                              className="tabular"
                              maxLength={4}
                              aria-describedby={id('receta-ayuda')}
                            />
                          </div>
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
                        <p id={id('receta-ayuda')} className="text-xs text-tenue-fg">
                          La vigencia de la receta es el SLA de farmacia: horas corridas desde que
                          se emite, con fines de semana y feriados. Pasadas, la receta vence y la
                          farmacia ya no despacha.
                        </p>
                      </Seccion>
                    )}

                    {conConsulta(p) && (
                      <Seccion titulo="Consulta">
                        <div className="grid gap-4 sm:grid-cols-3">
                          <div className="space-y-2">
                            <Label htmlFor={id('diagnosticos')}>Máximo de diagnósticos por consulta</Label>
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

                    <Seccion titulo="Asegurados">
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
                      <p className="text-xs text-tenue-fg">
                        Por ahora en texto. Cuando esté cargado el vademécum se podrán elegir de la
                        lista.
                      </p>
                    </Seccion>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
      <Boton
        type="button"
        variante="contorno"
        onClick={() => onCambiar([...productos, productoVacio()])}
      >
        <Plus aria-hidden="true" />
        Agregar producto
      </Boton>
    </div>
  )
}
