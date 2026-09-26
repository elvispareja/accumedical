import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'

/**
 * Cómo se llama una persona, en un solo sitio y para todos los formularios:
 * paciente, contacto y usuario. Cuatro casillas —obligatorio el primer nombre y
 * el apellido paterno— y un filtro que no deja teclear nada que no sea una
 * letra. El servidor lo vuelve a validar, siempre: esto es comodidad, no
 * autoridad.
 */

/** Las cuatro partes tal como viajan a la API y viven en el formulario. */
export interface NombrePersona {
  nombre_principal: string
  nombre_secundario: string
  apellido_paterno: string
  apellido_materno: string
}

export const NOMBRE_VACIO: NombrePersona = {
  nombre_principal: '',
  nombre_secundario: '',
  apellido_paterno: '',
  apellido_materno: '',
}

/**
 * Deja pasar SOLO letras (con tildes y eñes) y espacios. Se aplica mientras se
 * teclea: un número simplemente no aparece, en vez de aceptarlo y rechazarlo al
 * guardar.
 */
export function soloLetras(valor: string): string {
  return valor.replace(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ ]/g, '')
}

/** Lo que llega de la API (con nulos) al estado del formulario (con vacíos). */
export function desdeApi(datos: {
  nombre_principal: string
  nombre_secundario: string | null
  apellido_paterno: string
  apellido_materno: string | null
}): NombrePersona {
  return {
    nombre_principal: datos.nombre_principal,
    nombre_secundario: datos.nombre_secundario ?? '',
    apellido_paterno: datos.apellido_paterno,
    apellido_materno: datos.apellido_materno ?? '',
  }
}

/** Del formulario a la API: los opcionales vacíos viajan como null. */
export function haciaApi(n: NombrePersona) {
  return {
    nombre_principal: n.nombre_principal.trim(),
    nombre_secundario: n.nombre_secundario.trim() || null,
    apellido_paterno: n.apellido_paterno.trim(),
    apellido_materno: n.apellido_materno.trim() || null,
  }
}

/** Los dos obligatorios, para avisar antes de enviar. */
export function faltaObligatorio(n: NombrePersona): boolean {
  return !n.nombre_principal.trim() || !n.apellido_paterno.trim()
}

/**
 * ¿Alguna parte trae algo que no sea una letra? Tecleando es imposible —el
 * filtro no lo deja—, pero una ficha guardada antes de esta regla sí puede
 * traerlo, y el servidor la rechazará: esto permite decir de quién se trata.
 */
export function nombreConSimbolos(n: NombrePersona): boolean {
  return [n.nombre_principal, n.nombre_secundario, n.apellido_paterno, n.apellido_materno].some(
    (parte) => parte.trim() !== soloLetras(parte).trim(),
  )
}

/** El nombre completo tal como lo compone el servidor: nombres y luego apellidos. */
export function nombreCompleto(n: NombrePersona): string {
  return [n.nombre_principal, n.nombre_secundario, n.apellido_paterno, n.apellido_materno]
    .map((p) => p.trim())
    .filter(Boolean)
    .join(' ')
}

const CAMPOS: { campo: keyof NombrePersona; etiqueta: string; requerido: boolean }[] = [
  { campo: 'nombre_principal', etiqueta: 'Nombre principal', requerido: true },
  { campo: 'nombre_secundario', etiqueta: 'Nombre secundario', requerido: false },
  { campo: 'apellido_paterno', etiqueta: 'Apellido paterno', requerido: true },
  { campo: 'apellido_materno', etiqueta: 'Apellido materno', requerido: false },
]

export function CamposNombre({
  valores,
  onCambiar,
  idPrefijo,
  deshabilitado = false,
}: {
  valores: NombrePersona
  onCambiar: (campo: keyof NombrePersona, valor: string) => void
  /** Prefijo de los `id`, para que dos personas en la misma página no choquen. */
  idPrefijo: string
  deshabilitado?: boolean
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {CAMPOS.map(({ campo, etiqueta, requerido }) => (
        <div key={campo} className="space-y-2">
          <Label htmlFor={`${idPrefijo}-${campo}`}>
            {etiqueta} {requerido && <span className="text-peligro">*</span>}
          </Label>
          <Input
            id={`${idPrefijo}-${campo}`}
            value={valores[campo]}
            // El filtro va aquí y no en un validador al guardar: lo que no es
            // letra no llega ni a pintarse.
            onChange={(e) => onCambiar(campo, soloLetras(e.target.value))}
            disabled={deshabilitado}
            maxLength={100}
            autoComplete="off"
          />
        </div>
      ))}
    </div>
  )
}
