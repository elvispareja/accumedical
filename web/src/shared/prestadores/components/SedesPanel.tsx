import { Building, MapPin, Plus, Trash2 } from 'lucide-react'

import { useCiudades, useProvincias } from '@/shared/catalogos/hooks'
import { Boton } from '@/shared/components/ui/button'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { Select } from '@/shared/components/ui/select'
import { MapaUbicacion } from '@/shared/mapa/MapaUbicacion'
import type { EstadoSede, SedeFormulario, SedeSalida } from '@/shared/prestadores/api'

export function sedeVacia(): SedeFormulario {
  return {
    _key: crypto.randomUUID(),
    nombre: '',
    provincia_codigo: '',
    ciudad_codigo: '',
    direccion: '',
    telefono: '',
    email: '',
    latitud: null,
    longitud: null,
    estado: 'activa',
  }
}

/** Convierte lo que devuelve la API al estado del formulario. */
export function desdeApi(sedes: SedeSalida[]): SedeFormulario[] {
  return sedes.map((s) => ({
    _key: s.id,
    id: s.id,
    nombre: s.nombre,
    provincia_codigo: s.provincia_codigo,
    ciudad_codigo: s.ciudad_codigo,
    direccion: s.direccion,
    telefono: s.telefono ?? '',
    email: s.email ?? '',
    latitud: s.latitud,
    longitud: s.longitud,
    estado: s.estado as EstadoSede,
  }))
}

/** Limpia `_key` y manda los opcionales vacíos como null. */
export function haciaApi(sedes: SedeFormulario[]) {
  return sedes.map(({ _key, ...s }) => ({
    ...s,
    nombre: s.nombre.trim(),
    direccion: s.direccion.trim(),
    telefono: s.telefono.trim() || null,
    email: s.email.trim() || null,
  }))
}

/**
 * Devuelve el primer problema encontrado, o null si la lista es válida.
 *
 * Tener sedes es opcional —una lista vacía pasa—, pero la sede que se crea va
 * entera: sin punto en el mapa no sirve para lo único que se le pide.
 */
export function validar(sedes: SedeFormulario[]): string | null {
  for (const [indice, sede] of sedes.entries()) {
    const cual = sede.nombre.trim() || `la sede ${indice + 1}`
    if (!sede.nombre.trim()) return 'Cada sede necesita un nombre'
    if (!sede.provincia_codigo || !sede.ciudad_codigo) {
      return `Elige provincia y ciudad en ${cual}`
    }
    if (!sede.direccion.trim()) return `Falta la dirección de ${cual}`
    if (sede.latitud === null || sede.longitud === null) {
      return `Fija el punto de ${cual} en el mapa`
    }
  }
  const nombres = sedes.map((s) => s.nombre.trim().toLocaleLowerCase())
  if (new Set(nombres).size !== nombres.length) {
    return 'Hay dos sedes con el mismo nombre'
  }
  return null
}

/** Una tarjeta de sede. Vive aparte porque cada una pide sus propias ciudades. */
function TarjetaSede({
  sede,
  indice,
  onCambiar,
  onQuitar,
}: {
  sede: SedeFormulario
  indice: number
  onCambiar: (clave: string, cambios: Partial<SedeFormulario>) => void
  onQuitar: (clave: string) => void
}) {
  const provincias = useProvincias()
  const ciudades = useCiudades(sede.provincia_codigo || null)

  return (
    <fieldset className="rounded-md border border-borde p-4">
      <div className="mb-4 flex items-center justify-between gap-3">
        <legend className="flex items-center gap-2 font-display text-xs font-medium uppercase tracking-[0.09em] text-tenue-fg">
          <Building className="size-3.5" aria-hidden="true" />
          Sede {indice + 1}
        </legend>
        <Boton
          type="button"
          variante="fantasma"
          tamano="sm"
          onClick={() => onQuitar(sede._key)}
          aria-label={`Quitar sede ${indice + 1}`}
          className="hover:text-peligro"
        >
          <Trash2 aria-hidden="true" />
          Quitar
        </Boton>
      </div>

      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor={`sede-nombre-${sede._key}`}>
            Nombre de la sede <span className="text-peligro">*</span>
          </Label>
          <Input
            id={`sede-nombre-${sede._key}`}
            value={sede.nombre}
            onChange={(e) => onCambiar(sede._key, { nombre: e.target.value })}
            placeholder="Sede Matriz"
            maxLength={150}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor={`sede-pais-${sede._key}`}>País</Label>
            <Input id={`sede-pais-${sede._key}`} value="ECUADOR" readOnly disabled />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`sede-provincia-${sede._key}`}>
              Provincia <span className="text-peligro">*</span>
            </Label>
            <Select
              id={`sede-provincia-${sede._key}`}
              value={sede.provincia_codigo}
              // Cambiar de provincia invalida la ciudad: si no se limpiara,
              // podría quedar una ciudad que no pertenece a la nueva.
              onChange={(e) =>
                onCambiar(sede._key, { provincia_codigo: e.target.value, ciudad_codigo: '' })
              }
              disabled={provincias.isPending}
            >
              <option value="">Seleccione…</option>
              {provincias.data?.map((p) => (
                <option key={p.codigo} value={p.codigo}>
                  {p.nombre}
                </option>
              ))}
            </Select>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor={`sede-ciudad-${sede._key}`}>
              Ciudad <span className="text-peligro">*</span>
            </Label>
            <Select
              id={`sede-ciudad-${sede._key}`}
              value={sede.ciudad_codigo}
              onChange={(e) => onCambiar(sede._key, { ciudad_codigo: e.target.value })}
              disabled={!sede.provincia_codigo || ciudades.isPending}
            >
              <option value="">
                {sede.provincia_codigo
                  ? ciudades.isPending
                    ? 'Cargando…'
                    : 'Seleccione…'
                  : 'Elija provincia'}
              </option>
              {ciudades.data?.map((c) => (
                <option key={c.codigo} value={c.codigo}>
                  {c.nombre}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor={`sede-estado-${sede._key}`}>Estado</Label>
            <Select
              id={`sede-estado-${sede._key}`}
              value={sede.estado}
              onChange={(e) =>
                onCambiar(sede._key, { estado: e.target.value as EstadoSede })
              }
            >
              <option value="activa">Activa</option>
              <option value="inactiva">Inactiva</option>
            </Select>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor={`sede-direccion-${sede._key}`}>
            Dirección <span className="text-peligro">*</span>
          </Label>
          <Input
            id={`sede-direccion-${sede._key}`}
            value={sede.direccion}
            onChange={(e) => onCambiar(sede._key, { direccion: e.target.value })}
            placeholder="Av. Principal y Calle Secundaria"
            maxLength={300}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor={`sede-telefono-${sede._key}`}>Teléfono</Label>
            <Input
              id={`sede-telefono-${sede._key}`}
              inputMode="tel"
              value={sede.telefono}
              onChange={(e) => onCambiar(sede._key, { telefono: e.target.value })}
              maxLength={25}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`sede-email-${sede._key}`}>Correo institucional</Label>
            <Input
              id={`sede-email-${sede._key}`}
              type="email"
              inputMode="email"
              spellCheck={false}
              value={sede.email}
              onChange={(e) => onCambiar(sede._key, { email: e.target.value })}
            />
          </div>
        </div>

        <MapaUbicacion
          requerido
          punto={{ latitud: sede.latitud, longitud: sede.longitud }}
          onCambiar={(punto) => onCambiar(sede._key, punto)}
          ayuda="Haz clic en el mapa o arrastra el pin para fijar el punto exacto de la sede."
        />
      </div>
    </fieldset>
  )
}

/**
 * Lista editable de sedes. Tener sedes es opcional; la sede que se crea lleva
 * todos sus campos, coordenadas incluidas.
 */
export function SedesPanel({
  sedes,
  onAnadir,
  onCambiar,
  onQuitar,
}: {
  sedes: SedeFormulario[]
  onAnadir: () => void
  onCambiar: (clave: string, cambios: Partial<SedeFormulario>) => void
  onQuitar: (clave: string) => void
}) {
  if (sedes.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-borde px-6 py-10 text-center">
        <MapPin className="mx-auto size-5 text-tenue-fg" aria-hidden="true" />
        <p className="mt-3 font-display text-sm font-medium">Sin sedes</p>
        <p className="mx-auto mt-1 max-w-sm text-sm text-tenue-fg">
          Las sedes son opcionales. Añade una si este prestador atiende en varios sitios.
        </p>
        <Boton type="button" tamano="sm" className="mt-4" onClick={onAnadir}>
          <Plus aria-hidden="true" />
          Añadir sede
        </Boton>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {sedes.map((sede, indice) => (
        <TarjetaSede
          key={sede._key}
          sede={sede}
          indice={indice}
          onCambiar={onCambiar}
          onQuitar={onQuitar}
        />
      ))}

      <Boton type="button" variante="contorno" tamano="sm" onClick={onAnadir}>
        <Plus aria-hidden="true" />
        Añadir sede
      </Boton>
    </div>
  )
}
