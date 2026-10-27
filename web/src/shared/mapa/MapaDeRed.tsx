import 'leaflet/dist/leaflet.css'

import type { LatLngBoundsExpression, LatLngTuple } from 'leaflet'
import { motion, useReducedMotion } from 'framer-motion'
import { ChevronRight, MapPin, RotateCw, Search } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { CircleMarker, MapContainer, Popup, TileLayer, Tooltip, useMap } from 'react-leaflet'

import { cn } from '@/lib/utils'
import { Boton } from '@/shared/components/ui/button'
import { Input } from '@/shared/components/ui/input'
import type { PuntoDeMapa } from '@/shared/mapa/tipos'

const EASE: [number, number, number, number] = [0.22, 0.61, 0.36, 1]

/** El Ecuador entero, para cuando todavía no hay ningún punto que encuadrar. */
const ECUADOR: LatLngBoundsExpression = [
  [-5.1, -81.2],
  [1.6, -75.1],
]
/** Al pulsar un sitio concreto sí se baja a la calle. */
const ZOOM_PUNTO = 15

/**
 * Hasta dónde se acerca el encuadre en cada nivel. **Es lo que evita que una
 * provincia con un solo punto abra en la acera**: encuadrar un rectángulo de un
 * solo punto lleva al zoom máximo, y lo que se ha pedido es ver el país, o la
 * provincia, no un tejado.
 */
const ZOOM_MAXIMO = { pais: 7, provincia: 12, ciudad: 16 } as const

/** La clave con la que se agrupa: el código oficial, con el nombre al lado. */
type Grupo = { codigo: string; nombre: string; total: number }

/** Una provincia en el mapa: cuántos hay y dónde se pinta la burbuja. */
type Burbuja = Grupo & { latitud: number; longitud: number }

/**
 * El radio de la burbuja, según lo que tenga que caber dentro. Crece con los
 * dígitos, no con la cantidad: un «120» necesita más sitio que un «7», pero una
 * provincia con el triple de prestadores no merece una burbuja tres veces más
 * grande —sería un mapa de círculos, no de datos—.
 */
function radioDe(total: number): number {
  return 13 + (String(total).length - 1) * 4
}

/**
 * Encuadra el mapa sobre los puntos que se están viendo. Se mueve cada vez que
 * cambia la selección —país, provincia o ciudad—, que es justo lo que se espera
 * al elegir en el panel; con un solo punto no hay rectángulo, así que se acerca.
 */
function Encuadrar({
  puntos,
  animar,
  zoomMaximo,
}: {
  puntos: PuntoDeMapa[]
  animar: boolean
  zoomMaximo: number
}) {
  const mapa = useMap()
  useEffect(() => {
    if (puntos.length === 0) {
      mapa.fitBounds(ECUADOR, { animate: animar })
      return
    }
    const [solo] = puntos
    if (puntos.length === 1 && solo) {
      mapa.setView([solo.latitud, solo.longitud], zoomMaximo, { animate: animar })
      return
    }
    mapa.fitBounds(
      puntos.map((p) => [p.latitud, p.longitud] as LatLngTuple),
      { padding: [48, 48], maxZoom: zoomMaximo, animate: animar },
    )
  }, [mapa, puntos, animar, zoomMaximo])
  return null
}

/** Centra en un punto concreto: lo que se pulsa en la lista, se mira en el mapa. */
function Centrar({ punto, animar }: { punto: PuntoDeMapa | null; animar: boolean }) {
  const mapa = useMap()
  useEffect(() => {
    if (!punto) return
    mapa.setView([punto.latitud, punto.longitud], Math.max(mapa.getZoom(), ZOOM_PUNTO), {
      animate: animar,
    })
  }, [mapa, punto, animar])
  return null
}

/**
 * El mapa de la red: **un punto rojo por cada sitio**, con la latitud y la
 * longitud que se capturaron al darlo de alta. Al lado, el panel manda: se
 * elige una provincia y quedan los suyos, se elige una ciudad y quedan solo los
 * de esa ciudad. El mapa acompaña la selección encuadrándose, y pulsar uno de
 * la lista lo centra.
 *
 * **No sabe qué está pintando**: recibe puntos ya traducidos (`PuntoDeMapa`),
 * así que sirve igual para prestadores —donde cada sede aporta su punto— que
 * para compañías, que tienen uno solo. Quien lo monta hace la consulta y la
 * traducción; ver `MapaPrestadores` y `MapaAseguradoras`.
 */
export function MapaDeRed({
  puntos,
  cargando,
  error,
  onReintentar,
  etiqueta,
  unidad,
  vacio,
}: {
  puntos: PuntoDeMapa[]
  cargando: boolean
  error: boolean
  onReintentar: () => void
  /** Cómo se llama lo que se pinta: «Prestadores», «Aseguradoras»… */
  etiqueta: string
  /** Lo mismo en minúsculas y en las dos formas, para contar: «3 prestadores». */
  unidad: { uno: string; varios: string }
  /** Qué decir cuando la selección se queda sin puntos. */
  vacio: string
}) {
  const sinMovimiento = useReducedMotion()
  const [provincia, setProvincia] = useState<string | null>(null)
  const [ciudad, setCiudad] = useState<string | null>(null)
  const [centrado, setCentrado] = useState<PuntoDeMapa | null>(null)

  // Las provincias con cuántos sitios tiene cada una. El servidor ya devolvió
  // los puntos ordenados, así que el recuento conserva ese orden.
  const provincias = useMemo<Grupo[]>(() => {
    const cuenta = new Map<string, Grupo>()
    for (const punto of puntos) {
      if (!punto.provincia_codigo) continue
      const grupo = cuenta.get(punto.provincia_codigo)
      if (grupo) grupo.total += 1
      else
        cuenta.set(punto.provincia_codigo, {
          codigo: punto.provincia_codigo,
          nombre: punto.provincia_nombre ?? punto.provincia_codigo,
          total: 1,
        })
    }
    return [...cuenta.values()]
  }, [puntos])

  const ciudades = useMemo<Grupo[]>(() => {
    if (!provincia) return []
    const cuenta = new Map<string, Grupo>()
    for (const punto of puntos) {
      if (punto.provincia_codigo !== provincia || !punto.ciudad_codigo) continue
      const grupo = cuenta.get(punto.ciudad_codigo)
      if (grupo) grupo.total += 1
      else
        cuenta.set(punto.ciudad_codigo, {
          codigo: punto.ciudad_codigo,
          nombre: punto.ciudad_nombre ?? punto.ciudad_codigo,
          total: 1,
        })
    }
    return [...cuenta.values()]
  }, [puntos, provincia])

  /**
   * Mientras no haya provincia elegida, el mapa no pinta cada sitio suelto sino
   * **una burbuja por provincia con cuántos hay dentro**: en el país entero, un
   * punto por sitio no dice nada y encima se solapan. La burbuja va en el centro
   * medio de sus puntos, que siempre cae entre ellos, y pulsarla entra a esa
   * provincia igual que pulsarla en el panel.
   */
  const burbujas = useMemo<Burbuja[]>(() => {
    if (provincia) return []
    const suma = new Map<string, Burbuja>()
    for (const punto of puntos) {
      if (!punto.provincia_codigo) continue
      const previa = suma.get(punto.provincia_codigo)
      if (previa) {
        previa.total += 1
        previa.latitud += punto.latitud
        previa.longitud += punto.longitud
      } else {
        suma.set(punto.provincia_codigo, {
          codigo: punto.provincia_codigo,
          nombre: punto.provincia_nombre ?? punto.provincia_codigo,
          total: 1,
          latitud: punto.latitud,
          longitud: punto.longitud,
        })
      }
    }
    return [...suma.values()].map((b) => ({
      ...b,
      latitud: b.latitud / b.total,
      longitud: b.longitud / b.total,
    }))
  }, [puntos, provincia])

  // Lo que se ve en el mapa y lo que se lista al lado es SIEMPRE lo mismo.
  const visibles = useMemo(
    () =>
      puntos.filter(
        (p) =>
          (!provincia || p.provincia_codigo === provincia) &&
          (!ciudad || p.ciudad_codigo === ciudad),
      ),
    [puntos, provincia, ciudad],
  )

  // La lista del costado no se pinta entera (pedido del usuario, 26/10/2026):
  // aparece al escribir, como el buscador de «Nueva visita». El mapa sigue
  // enseñando todos los puntos de la provincia o ciudad elegida.
  const [busqueda, setBusqueda] = useState('')
  // Una fila por ENTIDAD (pedido del usuario, 26/10/2026): el prestador una
  // sola vez; al elegirlo se despliegan sus sitios (sede principal y sedes). Los
  // puntos sin `grupo` (p. ej. aseguradoras) son una fila cada uno.
  const [abierta, setAbierta] = useState<string | null>(null)
  const encontrados = useMemo<FilaBuscada[]>(() => {
    const termino = normalizarTexto(busqueda.trim())
    if (!termino) return []
    const filas = new Map<string, FilaBuscada>()
    for (const p of visibles) {
      const clave = p.grupo ?? p.clave
      let fila = filas.get(clave)
      if (!fila) {
        fila = { clave, titulo: p.nombreGrupo ?? p.titulo, subtitulo: p.subtitulo, punto: p, sitios: [] }
        filas.set(clave, fila)
      }
      fila.sitios.push(p)
      // La sede principal es la que representa al prestador en la lista.
      if (p.grupo && !p.sede) {
        fila.punto = p
        fila.subtitulo = p.subtitulo
      }
    }
    // Sede principal primero; después las sedes por nombre.
    for (const f of filas.values()) {
      f.sitios.sort((a, b) => (a.sede ? 1 : 0) - (b.sede ? 1 : 0) || (a.sede ?? '').localeCompare(b.sede ?? '', 'es'))
    }
    return [...filas.values()].filter((f) =>
      f.sitios.some((p) =>
        normalizarTexto(`${f.titulo} ${p.titulo} ${p.subtitulo ?? ''}`).includes(termino),
      ),
    )
  }, [visibles, busqueda])

  function elegirProvincia(codigo: string | null) {
    setProvincia(codigo)
    setCiudad(null)
    setCentrado(null)
  }

  // El encuadre sigue al nivel elegido, no a cuántos puntos haya.
  const zoomMaximo = ciudad
    ? ZOOM_MAXIMO.ciudad
    : provincia
      ? ZOOM_MAXIMO.provincia
      : ZOOM_MAXIMO.pais

  const nombreProvincia = provincias.find((p) => p.codigo === provincia)?.nombre
  const nombreCiudad = ciudades.find((c) => c.codigo === ciudad)?.nombre

  if (error) {
    return (
      <div className="rounded-md border border-borde bg-superficie px-6 py-16 text-center">
        <p className="font-display text-sm font-medium">No pudimos cargar el mapa</p>
        <p className="mx-auto mt-1 max-w-sm text-sm text-tenue-fg">
          Puede ser un corte momentáneo de conexión con el servidor.
        </p>
        <Boton variante="contorno" tamano="sm" className="mt-4" onClick={onReintentar}>
          <RotateCw aria-hidden="true" />
          Reintentar
        </Boton>
      </div>
    )
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="overflow-hidden rounded-md border border-borde bg-superficie">
        {cargando ? (
          <div
            className="h-[34rem] animate-pulse bg-tenue"
            role="status"
            aria-label="Cargando el mapa"
          />
        ) : (
          <MapContainer
            bounds={ECUADOR}
            scrollWheelZoom
            style={{ height: '34rem', width: '100%' }}
            // Leaflet ya trae navegación por teclado: con foco, las flechas
            // desplazan y +/− acercan.
            keyboard
          >
            <TileLayer
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
              maxZoom={19}
            />
            <Encuadrar puntos={visibles} animar={!sinMovimiento} zoomMaximo={zoomMaximo} />
            <Centrar punto={centrado} animar={!sinMovimiento} />

            {/* Nivel país: una burbuja por provincia con el número dentro. El
                rótulo es un Tooltip permanente y no HTML inyectado en el icono:
                React lo escapa, y aquí no se salta la regla del proyecto. */}
            {burbujas.map((burbuja) => (
              <CircleMarker
                key={burbuja.codigo}
                center={[burbuja.latitud, burbuja.longitud]}
                radius={radioDe(burbuja.total)}
                pathOptions={{
                  color: 'white',
                  weight: 2,
                  fillColor: 'hsl(var(--peligro))',
                  fillOpacity: 1,
                  className: 'cursor-pointer',
                }}
                eventHandlers={{ click: () => elegirProvincia(burbuja.codigo) }}
              >
                <Tooltip permanent direction="center" className="burbuja-mapa">
                  {burbuja.total}
                </Tooltip>
                <Popup>
                  <span className="block font-display text-sm font-semibold">
                    {burbuja.nombre}
                  </span>
                  <span className="mt-0.5 block text-xs">
                    {burbuja.total} {burbuja.total === 1 ? unidad.uno : unidad.varios}
                  </span>
                </Popup>
              </CircleMarker>
            ))}

            {/* Dentro de una provincia sí se pinta cada sitio. */}
            {burbujas.length === 0 &&
              visibles.map((punto) => {
                const esElCentrado = centrado !== null && centrado.clave === punto.clave
                return (
                  <CircleMarker
                    key={punto.clave}
                    center={[punto.latitud, punto.longitud]}
                    radius={esElCentrado ? 11 : 7}
                    // El color sale de los tokens del sistema, así que el punto
                    // se ve igual de rojo en claro y en oscuro sin dos
                    // constantes.
                    pathOptions={{
                      color: 'white',
                      weight: 2,
                      fillColor: 'hsl(var(--peligro))',
                      fillOpacity: 1,
                    }}
                    eventHandlers={{ click: () => setCentrado(punto) }}
                  >
                    <Popup>
                      <span className="block font-display text-sm font-semibold">
                        {punto.titulo}
                      </span>
                      {punto.subtitulo && (
                        <span className="mt-0.5 block text-xs">{punto.subtitulo}</span>
                      )}
                      {punto.direccion && (
                        <span className="mt-0.5 block text-xs">{punto.direccion}</span>
                      )}
                      <Link
                        to={punto.ficha}
                        className="mt-1.5 inline-block font-medium text-marca underline"
                      >
                        Ver ficha
                      </Link>
                    </Popup>
                  </CircleMarker>
                )
              })}
          </MapContainer>
        )}
      </div>

      <aside
        aria-label={`${etiqueta} por provincia y ciudad`}
        className="min-w-0 rounded-md border border-borde bg-superficie p-4"
      >
        {/* Dónde estamos, y cómo se vuelve. Es la misma migaja de pan que la
            selección del mapa: país → provincia → ciudad. */}
        <nav aria-label="Ámbito del mapa" className="flex flex-wrap items-center gap-1 text-sm">
          <button
            type="button"
            onClick={() => elegirProvincia(null)}
            className={cn(
              'rounded px-1.5 py-0.5 transition-colors duration-150 hover:text-tinta',
              provincia ? 'text-tenue-fg' : 'font-medium text-tinta',
            )}
          >
            Ecuador
          </button>
          {provincia && (
            <>
              <ChevronRight className="size-3.5 text-tenue-fg" aria-hidden="true" />
              <button
                type="button"
                onClick={() => {
                  setCiudad(null)
                  setCentrado(null)
                }}
                className={cn(
                  'rounded px-1.5 py-0.5 transition-colors duration-150 hover:text-tinta',
                  ciudad ? 'text-tenue-fg' : 'font-medium text-tinta',
                )}
              >
                {nombreProvincia}
              </button>
            </>
          )}
          {ciudad && (
            <>
              <ChevronRight className="size-3.5 text-tenue-fg" aria-hidden="true" />
              <span className="px-1.5 py-0.5 font-medium">{nombreCiudad}</span>
            </>
          )}
        </nav>

        <p className="mt-1 text-xs text-tenue-fg" aria-live="polite">
          {visibles.length} {visibles.length === 1 ? 'punto' : 'puntos'} en el mapa
        </p>

        <div className="barra-fina mt-4 max-h-[28rem] space-y-4 overflow-y-auto pr-1">
          {/* Nivel 1: las provincias. Nivel 2: las ciudades de la elegida.
              En los dos niveles se lista además lo visible, que es lo que se
              ha venido a ver. */}
          {!provincia && (
            <Lista
              titulo="Provincias"
              vacio="Sin provincia registrada: no hay nada que agrupar."
              filas={provincias}
              onElegir={elegirProvincia}
              sinMovimiento={Boolean(sinMovimiento)}
            />
          )}
          {provincia && !ciudad && (
            <Lista
              titulo="Ciudades"
              vacio="En esta provincia no hay ninguno con ciudad registrada."
              filas={ciudades}
              onElegir={(codigo) => {
                setCiudad(codigo)
                setCentrado(null)
              }}
              sinMovimiento={Boolean(sinMovimiento)}
            />
          )}

          <div>
            <p className="font-display text-[0.6875rem] font-semibold uppercase tracking-[0.09em] text-tenue-fg">
              {etiqueta}
            </p>
            <div className="relative mt-2">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-tenue-fg"
                aria-hidden="true"
              />
              <Input
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                placeholder="Buscar por nombre o código"
                aria-label={`Buscar en ${etiqueta}`}
                mayusculas={false}
                className="pl-9"
              />
            </div>
            {visibles.length === 0 ? (
              <p className="mt-2 rounded-md border border-dashed border-borde px-3 py-6 text-center text-sm text-tenue-fg">
                {cargando ? 'Cargando…' : vacio}
              </p>
            ) : !busqueda.trim() ? (
              <p className="mt-2 rounded-md border border-dashed border-borde px-3 py-6 text-center text-sm text-tenue-fg">
                Escribe el nombre o el código para buscar.
              </p>
            ) : encontrados.length === 0 ? (
              <p className="mt-2 rounded-md border border-dashed border-borde px-3 py-6 text-center text-sm text-tenue-fg">
                Nada coincide con la búsqueda.
              </p>
            ) : (
              <ul className="mt-2 space-y-1">
                {encontrados.map((fila, indice) => {
                  const abiertaEsta = abierta === fila.clave
                  const conSedes = fila.sitios.length > 1
                  return (
                    <motion.li
                      key={fila.clave}
                      initial={sinMovimiento ? { opacity: 0 } : { opacity: 0, y: 4 }}
                      animate={{
                        opacity: 1,
                        y: 0,
                        transition: {
                          duration: 0.2,
                          delay: sinMovimiento ? 0 : Math.min(indice, 10) * 0.025,
                          ease: EASE,
                        },
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setAbierta(abiertaEsta ? null : fila.clave)
                          setCentrado(fila.punto)
                        }}
                        aria-expanded={conSedes ? abiertaEsta : undefined}
                        className={cn(
                          'flex w-full items-start gap-2 rounded-md border px-3 py-2 text-left transition-colors duration-150',
                          abiertaEsta
                            ? 'border-marca/40 bg-marca-suave/50'
                            : 'border-transparent hover:bg-tenue/60',
                        )}
                      >
                        <MapPin className="mt-0.5 size-4 shrink-0 text-peligro" aria-hidden="true" />
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium">{fila.titulo}</span>
                          {fila.subtitulo && (
                            <span className="mt-0.5 block truncate text-xs text-tenue-fg">
                              {fila.subtitulo}
                            </span>
                          )}
                          {conSedes && (
                            <span className="mt-0.5 block text-xs text-tenue-fg">
                              {fila.sitios.length - 1}{' '}
                              {fila.sitios.length - 1 === 1 ? 'sede' : 'sedes'} · y su sede principal
                            </span>
                          )}
                        </span>
                      </button>
                      {abiertaEsta && conSedes && (
                        <ul className="ml-6 mt-1 space-y-0.5 border-l border-borde pl-2">
                          {fila.sitios.map((sitio) => {
                            const esElCentrado = centrado !== null && centrado.clave === sitio.clave
                            return (
                              <li key={sitio.clave}>
                                <button
                                  type="button"
                                  onClick={() => setCentrado(sitio)}
                                  className={cn(
                                    'w-full rounded px-2 py-1.5 text-left text-sm transition-colors duration-150',
                                    esElCentrado ? 'bg-marca-suave/50 text-marca' : 'hover:bg-tenue/60',
                                  )}
                                >
                                  <span className="block">{sitio.sede ?? 'Sede principal'}</span>
                                  <span className="block truncate text-xs text-tenue-fg">
                                    {[sitio.ciudad_nombre, sitio.direccion].filter(Boolean).join(' · ')}
                                  </span>
                                </button>
                              </li>
                            )
                          })}
                        </ul>
                      )}
                    </motion.li>
                  )
                })}
              </ul>
            )}
          </div>
        </div>
      </aside>
    </div>
  )
}

/** Un nivel del panel: provincias o ciudades, cada una con cuántos sitios tiene. */
function Lista({
  titulo,
  vacio,
  filas,
  onElegir,
  sinMovimiento,
}: {
  titulo: string
  vacio: string
  filas: Grupo[]
  onElegir: (codigo: string) => void
  sinMovimiento: boolean
}) {
  return (
    <div>
      <p className="font-display text-[0.6875rem] font-semibold uppercase tracking-[0.09em] text-tenue-fg">
        {titulo}
      </p>
      {filas.length === 0 ? (
        <p className="mt-2 rounded-md border border-dashed border-borde px-3 py-6 text-center text-sm text-tenue-fg">
          {vacio}
        </p>
      ) : (
        <ul className="mt-2 space-y-1">
          {filas.map((fila, indice) => (
            <motion.li
              key={fila.codigo}
              initial={sinMovimiento ? { opacity: 0 } : { opacity: 0, y: 4 }}
              animate={{
                opacity: 1,
                y: 0,
                transition: {
                  duration: 0.2,
                  delay: sinMovimiento ? 0 : Math.min(indice, 10) * 0.025,
                  ease: EASE,
                },
              }}
            >
              <button
                type="button"
                onClick={() => onElegir(fila.codigo)}
                className="flex w-full items-center justify-between gap-2 rounded-md border border-borde px-3 py-2 text-left text-sm transition-colors duration-150 hover:bg-tenue/60"
              >
                <span className="min-w-0 truncate font-medium">{fila.nombre}</span>
                <span className="tabular shrink-0 rounded-full bg-tenue px-2 py-0.5 text-xs text-tenue-fg">
                  {fila.total}
                </span>
              </button>
            </motion.li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Una fila del buscador del costado: una entidad con sus sitios en el mapa. */
interface FilaBuscada {
  clave: string
  titulo: string
  subtitulo: string | null
  /** El punto al que se va al elegir la fila (la sede principal si la hay). */
  punto: PuntoDeMapa
  sitios: PuntoDeMapa[]
}

/** Sin tildes y en minúsculas: «clinica» encuentra «CLÍNICA». */
function normalizarTexto(texto: string): string {
  return texto.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase()
}
