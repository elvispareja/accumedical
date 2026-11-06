import { Package, Plus, Trash2 } from 'lucide-react'

import { Boton } from '@/shared/components/ui/button'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'

/**
 * Un producto en el formulario (5/11/2026). Valor y porcentaje van como texto
 * mientras se escriben —«12,5» a medias no es un número—; se convierten al
 * guardar. `_key` es solo para React y no se envía.
 */
export interface ProductoFormulario {
  _key: string
  id?: string
  nombre: string
  valor: string
  porcentaje: string
}

/** Lo que devuelve la ficha. */
export interface ProductoSalida {
  id: string
  nombre: string
  valor: number
  porcentaje: number
}

export function productoVacio(): ProductoFormulario {
  return { _key: crypto.randomUUID(), nombre: '', valor: '', porcentaje: '' }
}

/** 1500.5 → «1500,50»; 12.25 → «12,25»; 10 → «10». Con coma, como se teclea. */
function aTexto(numero: number, decimales: boolean): string {
  const texto = decimales ? numero.toFixed(2) : String(numero)
  return texto.replace('.', ',')
}

export function productosDesdeApi(productos: ProductoSalida[]): ProductoFormulario[] {
  return productos.map((p) => ({
    _key: p.id,
    id: p.id,
    nombre: p.nombre,
    valor: aTexto(p.valor, true),
    porcentaje: aTexto(p.porcentaje, false),
  }))
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

/** El primer problema de la lista, en palabras; null si se puede guardar. */
export function validarProductos(productos: ProductoFormulario[]): string | null {
  if (productos.length > 200) return 'Una ficha admite hasta 200 productos'
  const nombres = new Set<string>()
  for (const [i, p] of productos.entries()) {
    const numero = i + 1
    const nombre = nombreNormal(p.nombre)
    if (!nombre) return `Al producto ${numero} le falta el nombre`
    if (nombres.has(nombre)) return `El producto ${nombre} está repetido`
    nombres.add(nombre)
    const valor = aNumero(p.valor)
    if (nombre.length > 150) return `El nombre del producto ${numero} admite hasta 150 caracteres`
    if (Number.isNaN(valor)) {
      return `El valor de ${nombre} debe ser un número con hasta dos decimales y sin separador de miles (por ejemplo 1500,50)`
    }
    if (valor > 9_999_999_999.99) return `El valor de ${nombre} es demasiado grande`
    const porcentaje = aNumero(p.porcentaje)
    if (Number.isNaN(porcentaje) || porcentaje > 100) {
      return `El porcentaje de ${nombre} debe ser un número entre 0 y 100, con hasta dos decimales`
    }
  }
  return null
}

/** Limpia `_key`, convierte a número y redondea a dos decimales, como la base. */
export function productosHaciaApi(productos: ProductoFormulario[]) {
  return productos.map((p) => ({
    ...(p.id ? { id: p.id } : {}),
    nombre: nombreNormal(p.nombre),
    valor: Math.round(aNumero(p.valor) * 100) / 100,
    porcentaje: Math.round(aNumero(p.porcentaje) * 100) / 100,
  }))
}

/**
 * **La pestaña «Producto»** de cualquier cliente (pedido del usuario, 5/11/2026;
 * para todos los tipos desde el 6/11): «Agregar producto» y, por cada uno,
 * nombre, valor y porcentaje.
 * Se guarda con la ficha («Guardar cambios»); quitar uno lo da de baja lógica.
 */
export function ProductosPanel({
  productos,
  onCambiar,
}: {
  productos: ProductoFormulario[]
  onCambiar: (productos: ProductoFormulario[]) => void
}) {
  function cambiar(clave: string, campo: 'nombre' | 'valor' | 'porcentaje', valor: string) {
    onCambiar(productos.map((p) => (p._key === clave ? { ...p, [campo]: valor } : p)))
  }

  return (
    <div className="space-y-4">
      {productos.length === 0 ? (
        <div className="rounded-md border border-dashed border-borde px-6 py-10 text-center">
          <Package className="mx-auto size-6 text-tenue-fg" aria-hidden="true" />
          <p className="mt-3 font-display text-sm font-medium">Todavía no hay productos</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-tenue-fg">
            Agrega cada producto con su nombre, su valor y su porcentaje.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {productos.map((p, i) => (
            <li
              key={p._key}
              className="grid gap-3 rounded-md border border-borde bg-fondo/40 p-4 sm:grid-cols-[minmax(0,1fr)_11rem_9rem_auto] sm:items-end"
            >
              <div className="space-y-2">
                <Label htmlFor={`producto-nombre-${p._key}`}>
                  Nombre <span className="text-peligro">*</span>
                </Label>
                <Input
                  id={`producto-nombre-${p._key}`}
                  value={p.nombre}
                  onChange={(e) => cambiar(p._key, 'nombre', e.target.value)}
                  placeholder="SEGURO DE VIDA FAMILIAR"
                  maxLength={150}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor={`producto-valor-${p._key}`}>
                  Valor (USD) <span className="text-peligro">*</span>
                </Label>
                <Input
                  id={`producto-valor-${p._key}`}
                  value={p.valor}
                  onChange={(e) => cambiar(p._key, 'valor', e.target.value)}
                  inputMode="decimal"
                  placeholder="1500,00"
                  className="tabular"
                  maxLength={16}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor={`producto-porcentaje-${p._key}`}>
                  Porcentaje (%) <span className="text-peligro">*</span>
                </Label>
                <Input
                  id={`producto-porcentaje-${p._key}`}
                  value={p.porcentaje}
                  onChange={(e) => cambiar(p._key, 'porcentaje', e.target.value)}
                  inputMode="decimal"
                  placeholder="10"
                  className="tabular"
                  maxLength={6}
                />
              </div>
              <Boton
                type="button"
                variante="fantasma"
                tamano="icono"
                onClick={() => onCambiar(productos.filter((x) => x._key !== p._key))}
                aria-label={`Quitar el producto ${p.nombre || i + 1}`}
                title="Quitar el producto"
                className="hover:text-peligro"
              >
                <Trash2 aria-hidden="true" />
              </Boton>
            </li>
          ))}
        </ul>
      )}
      <Boton type="button" variante="contorno" onClick={() => onCambiar([...productos, productoVacio()])}>
        <Plus aria-hidden="true" />
        Agregar producto
      </Boton>
    </div>
  )
}
