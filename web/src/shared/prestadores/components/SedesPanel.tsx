import { ChevronLeft, ChevronRight, Eye, MapPin, Pencil, Plus, Power, Trash2 } from 'lucide-react'
import { useState } from 'react'

import { useCiudades, useProvincias } from '@/shared/catalogos/hooks'
import { Boton } from '@/shared/components/ui/button'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { Modal } from '@/shared/components/ui/modal'
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

/** El formulario de UNA sede, dentro de la ventana de agregar, ver o editar. */
function FormularioSede({
  sede,
  onCambiar,
  soloLectura,
}: {
  sede: SedeFormulario
  onCambiar: (clave: string, cambios: Partial<SedeFormulario>) => void
  soloLectura: boolean
}) {
  const provincias = useProvincias()
  const ciudades = useCiudades(sede.provincia_codigo || null)

  return (
    <fieldset disabled={soloLectura}>
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
              mayusculas
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
          deshabilitado={soloLectura}
          ayuda="Haz clic en el mapa o arrastra el pin para fijar el punto exacto de la sede."
        />
      </div>
    </fieldset>
  )
}

/** El nombre de la ciudad y la provincia de una sede (las ciudades se piden por provincia). */
function Ubicacion({ provincia, ciudad }: { provincia: string; ciudad: string }) {
  const provincias = useProvincias()
  const ciudades = useCiudades(provincia || null)
  const nombreProvincia = provincias.data?.find((p) => p.codigo === provincia)?.nombre
  const nombreCiudad = ciudades.data?.find((c) => c.codigo === ciudad)?.nombre
  return (
    <>
      <span className="block">{nombreCiudad ?? '—'}</span>
      <span className="block text-xs text-tenue-fg">{nombreProvincia ?? ''}</span>
    </>
  )
}

type Ventana = { modo: 'nueva' | 'editar' | 'ver'; borrador: SedeFormulario } | null

/** Cinco sedes por página (pedido del usuario, 26/10/2026). */
const POR_PAGINA = 5

/**
 * Las sedes en una TABLA (pedido del usuario, 26/10/2026), de cinco en cinco,
 * con Ver, Editar y Activar/Desactivar: una sede GUARDADA no se elimina (se
 * perdería la trazabilidad de las visitas que fueron a ella); solo se quita una
 * recién añadida que aún no se guardó. Agregar y editar van en una ventana. Tener sedes es
 * opcional; la sede que se crea lleva todos sus campos, coordenadas incluidas.
 * Lo que se cambia aquí se guarda con «Guardar cambios» del prestador.
 */
export function SedesPanel({
  sedes,
  onAgregar,
  onCambiar,
  onQuitar,
}: {
  sedes: SedeFormulario[]
  onAgregar: (sede: SedeFormulario) => void
  onCambiar: (clave: string, cambios: Partial<SedeFormulario>) => void
  onQuitar: (clave: string) => void
}) {
  const [ventana, setVentana] = useState<Ventana>(null)
  const [error, setError] = useState<string | null>(null)
  const [pagina, setPagina] = useState(0)
  const paginas = Math.max(1, Math.ceil(sedes.length / POR_PAGINA))
  const actual = Math.min(pagina, paginas - 1)
  const enPagina = sedes.slice(actual * POR_PAGINA, actual * POR_PAGINA + POR_PAGINA)

  function abrir(modo: 'nueva' | 'editar' | 'ver', sede?: SedeFormulario) {
    setError(null)
    setVentana({ modo, borrador: sede ? { ...sede } : sedeVacia() })
  }

  function guardar() {
    if (!ventana) return
    const { modo, borrador } = ventana
    // La misma validación de siempre, sobre la lista como quedaría.
    const lista =
      modo === 'nueva'
        ? [...sedes, borrador]
        : sedes.map((s) => (s._key === borrador._key ? borrador : s))
    const problema = validar(lista)
    if (problema) return setError(problema)
    if (modo === 'nueva') {
      onAgregar(borrador)
      // A la última página, donde queda la nueva.
      setPagina(Math.floor(sedes.length / POR_PAGINA))
    } else onCambiar(borrador._key, borrador)
    setVentana(null)
  }

  const soloLectura = ventana?.modo === 'ver'

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-tenue-fg">
          {sedes.length === 0
            ? 'Sin sedes registradas'
            : `${sedes.length} ${sedes.length === 1 ? 'sede' : 'sedes'}`}
        </p>
        <Boton type="button" tamano="sm" onClick={() => abrir('nueva')}>
          <Plus aria-hidden="true" />
          Añadir sede
        </Boton>
      </div>

      {sedes.length === 0 ? (
        <div className="rounded-md border border-dashed border-borde px-6 py-10 text-center">
          <MapPin className="mx-auto size-5 text-tenue-fg" aria-hidden="true" />
          <p className="mt-3 font-display text-sm font-medium">Sin sedes</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-tenue-fg">
            Las sedes son opcionales. Añade una si este prestador atiende en varios sitios.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border border-borde">
          <table className="w-full text-left text-sm">
            <thead className="bg-tenue/40 font-display text-[0.6875rem] uppercase tracking-[0.09em] text-tenue-fg">
              <tr>
                <th className="px-4 py-3 font-medium">Sede</th>
                <th className="px-4 py-3 font-medium">Ciudad</th>
                <th className="px-4 py-3 font-medium">Dirección</th>
                <th className="px-4 py-3 font-medium">Teléfono</th>
                <th className="px-4 py-3 font-medium">Estado</th>
                <th className="px-4 py-3" aria-label="Acciones" />
              </tr>
            </thead>
            <tbody className="divide-y divide-borde">
              {enPagina.map((sede) => (
                <tr key={sede._key} className="align-top">
                  <td className="px-4 py-3 font-medium">{sede.nombre || '—'}</td>
                  <td className="px-4 py-3">
                    <Ubicacion provincia={sede.provincia_codigo} ciudad={sede.ciudad_codigo} />
                  </td>
                  <td className="max-w-xs px-4 py-3 text-tenue-fg">{sede.direccion || '—'}</td>
                  <td className="px-4 py-3 tabular text-tenue-fg">{sede.telefono || '—'}</td>
                  <td className="px-4 py-3">
                    <span
                      className={
                        sede.estado === 'activa'
                          ? 'rounded-full border border-exito/40 bg-exito-suave/50 px-2 py-0.5 text-xs'
                          : 'rounded-full border border-borde px-2 py-0.5 text-xs text-tenue-fg'
                      }
                    >
                      {sede.estado === 'activa' ? 'Activa' : 'Inactiva'}
                    </span>
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex justify-end gap-1">
                      <Boton type="button" variante="fantasma" tamano="sm" onClick={() => abrir('ver', sede)}>
                        <Eye aria-hidden="true" />
                        Ver
                      </Boton>
                      <Boton type="button" variante="contorno" tamano="sm" onClick={() => abrir('editar', sede)}>
                        <Pencil aria-hidden="true" />
                        Editar
                      </Boton>
                      {sede.id ? (
                        <Boton
                          type="button"
                          variante="fantasma"
                          tamano="sm"
                          onClick={() =>
                            onCambiar(sede._key, {
                              estado: sede.estado === 'activa' ? 'inactiva' : 'activa',
                            })
                          }
                          title={sede.estado === 'activa' ? 'Desactivar' : 'Activar'}
                          aria-label={`${sede.estado === 'activa' ? 'Desactivar' : 'Activar'} ${sede.nombre}`}
                          className={sede.estado === 'activa' ? 'hover:text-aviso' : 'hover:text-exito'}
                        >
                          <Power aria-hidden="true" />
                        </Boton>
                      ) : (
                        // Recién añadida y sin guardar: aún no tiene historia que perder.
                        <Boton
                          type="button"
                          variante="fantasma"
                          tamano="sm"
                          onClick={() => onQuitar(sede._key)}
                          title="Quitar (todavía no se ha guardado)"
                          aria-label={`Quitar ${sede.nombre || 'la sede'}`}
                          className="hover:text-peligro"
                        >
                          <Trash2 aria-hidden="true" />
                        </Boton>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {paginas > 1 && (
        <div className="flex items-center justify-between gap-3 text-sm text-tenue-fg">
          <span>
            Página {actual + 1} de {paginas}
          </span>
          <div className="flex gap-2">
            <Boton
              type="button"
              variante="contorno"
              tamano="sm"
              onClick={() => setPagina(actual - 1)}
              disabled={actual === 0}
            >
              <ChevronLeft aria-hidden="true" />
              Anterior
            </Boton>
            <Boton
              type="button"
              variante="contorno"
              tamano="sm"
              onClick={() => setPagina(actual + 1)}
              disabled={actual >= paginas - 1}
            >
              Siguiente
              <ChevronRight aria-hidden="true" />
            </Boton>
          </div>
        </div>
      )}

      <Modal
        abierto={ventana !== null}
        onCerrar={() => setVentana(null)}
        titulo={
          ventana?.modo === 'nueva'
            ? 'Nueva sede'
            : ventana?.modo === 'editar'
              ? `Editar ${ventana.borrador.nombre || 'sede'}`
              : (ventana?.borrador.nombre ?? 'Sede')
        }
        descripcion={
          soloLectura ? undefined : 'Se guarda en el prestador al pulsar «Guardar cambios» en su ficha.'
        }
        ancho="max-w-3xl"
        pie={
          <div className="flex justify-end gap-2">
            <Boton type="button" variante="contorno" onClick={() => setVentana(null)}>
              {soloLectura ? 'Cerrar' : 'Cancelar'}
            </Boton>
            {soloLectura ? (
              <Boton
                type="button"
                onClick={() => ventana && setVentana({ modo: 'editar', borrador: ventana.borrador })}
              >
                <Pencil aria-hidden="true" />
                Editar
              </Boton>
            ) : (
              <Boton type="button" onClick={guardar}>
                {ventana?.modo === 'nueva' ? 'Agregar sede' : 'Aplicar cambios'}
              </Boton>
            )}
          </div>
        }
      >
        {ventana && (
          <div className="space-y-4">
            {error && (
              <p className="rounded-md border border-peligro/40 bg-peligro-suave/40 px-3 py-2 text-sm" role="alert">
                {error}
              </p>
            )}
            <FormularioSede
              sede={ventana.borrador}
              soloLectura={soloLectura}
              onCambiar={(_, cambios) =>
                setVentana((v) => (v ? { ...v, borrador: { ...v.borrador, ...cambios } } : v))
              }
            />
          </div>
        )}
      </Modal>
    </div>
  )
}
