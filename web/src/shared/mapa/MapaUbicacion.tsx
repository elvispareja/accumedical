import 'leaflet/dist/leaflet.css'

import L from 'leaflet'
import { useEffect, useId, useMemo, useState } from 'react'
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from 'react-leaflet'

import { cn } from '@/lib/utils'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'

/** Centro y zoom de arranque cuando todavía no hay punto: el Ecuador entero. */
const ECUADOR: [number, number] = [-1.5, -78.5]
const ZOOM_PAIS = 6
const ZOOM_PUNTO = 15
/** Seis decimales: la misma escala que `numeric(9,6)` de la base, unos 11 cm. */
const DECIMALES = 6

export interface Punto {
  latitud: number | null
  longitud: number | null
}

function redondear(valor: number): number {
  return Number(valor.toFixed(DECIMALES))
}

/** ¿El texto de la caja representa ya ese número? «-0.18» y −0.18 sí. */
function mismoNumero(texto: string, valor: number | null): boolean {
  if (valor === null) return texto.trim() === ''
  return texto.trim() !== '' && Number(texto) === valor
}

/**
 * Pin propio en SVG. El icono por defecto de Leaflet se carga desde archivos
 * sueltos del paquete cuya ruta se rompe al empaquetar; dibujarlo aquí evita ese
 * problema y además lo pinta con el color de marca del sistema de diseño.
 */
const PIN = L.divIcon({
  className: '',
  html: `<svg viewBox="0 0 24 24" width="30" height="30" aria-hidden="true"
     style="filter: drop-shadow(0 1px 2px rgb(0 0 0 / .45))">
    <path d="M12 22s7-6.2 7-12A7 7 0 0 0 5 10c0 5.8 7 12 7 12Z"
      fill="hsl(var(--marca))" stroke="white" stroke-width="1.6"/>
    <circle cx="12" cy="10" r="2.6" fill="white"/>
  </svg>`,
  iconSize: [30, 30],
  iconAnchor: [15, 29],
})

/** Traduce un clic en el mapa a un punto. */
function Clics({ onFijar }: { onFijar: (lat: number, lng: number) => void }) {
  useMapEvents({
    click: (evento) => onFijar(evento.latlng.lat, evento.latlng.lng),
  })
  return null
}

/**
 * Recentra cuando el punto cambia desde fuera del mapa —al escribir en las
 * cajas de latitud y longitud, o al cargarse el registro que se edita—. No se
 * mueve cuando el cambio nace de arrastrar el pin: ahí el mapa ya está donde
 * toca y recentrar daría un salto molesto.
 */
function Seguir({ punto, animar }: { punto: Punto; animar: boolean }) {
  const mapa = useMap()
  useEffect(() => {
    if (punto.latitud === null || punto.longitud === null) return
    mapa.setView([punto.latitud, punto.longitud], Math.max(mapa.getZoom(), ZOOM_PUNTO), {
      animate: animar,
    })
  }, [mapa, punto.latitud, punto.longitud, animar])
  return null
}

/**
 * Mapa con un pin que se fija haciendo clic o arrastrando, y dos cajas de
 * latitud y longitud sincronizadas con él.
 *
 * Las cajas no son decoración: son la vía accesible por teclado y la que permite
 * pegar una coordenada exacta. Arrastrar el pin es el atajo cómodo, no el único
 * camino.
 */
export function MapaUbicacion({
  punto,
  onCambiar,
  requerido = false,
  deshabilitado = false,
  etiqueta = 'Ubicación en el mapa',
  ayuda = 'Haz clic en el mapa o arrastra el pin para fijar el punto exacto.',
}: {
  punto: Punto
  onCambiar: (punto: Punto) => void
  requerido?: boolean
  deshabilitado?: boolean
  etiqueta?: string
  ayuda?: string
}) {
  const id = useId()
  // El texto de las cajas se guarda tal cual se teclea y NO se deriva del número
  // en cada render: si se derivara, escribir «-0.» se convertiría en «-0» y sería
  // imposible teclear un decimal. Tampoco se limpia al perder el foco: la
  // latitud a medias sigue en pantalla mientras se escribe la longitud, que es
  // justo cuando el par todavía no es válido y no se ha propagado nada.
  const [texto, setTexto] = useState(() => ({
    lat: punto.latitud?.toString() ?? '',
    lng: punto.longitud?.toString() ?? '',
  }))
  const [animar, setAnimar] = useState(false)

  // Punto cambiado desde fuera —clic, arrastre, o el registro que se acaba de
  // cargar—: las cajas se ponen al día. Lo que el usuario tenga escrito se
  // respeta si representa el mismo número, para no pisarle el cursor.
  useEffect(() => {
    setTexto((previo) => ({
      lat: mismoNumero(previo.lat, punto.latitud) ? previo.lat : (punto.latitud?.toString() ?? ''),
      lng: mismoNumero(previo.lng, punto.longitud) ? previo.lng : (punto.longitud?.toString() ?? ''),
    }))
  }, [punto.latitud, punto.longitud])

  const hayPunto = punto.latitud !== null && punto.longitud !== null
  const centro = useMemo<[number, number]>(
    () => (hayPunto ? [punto.latitud!, punto.longitud!] : ECUADOR),
    // Solo para el montaje: a partir de ahí manda <Seguir/>.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  function fijar(lat: number, lng: number) {
    setAnimar(false)
    onCambiar({ latitud: redondear(lat), longitud: redondear(lng) })
  }

  function escribir(campo: 'lat' | 'lng', valor: string) {
    const siguiente = { ...texto, [campo]: valor }
    setTexto(siguiente)
    const lat = Number(siguiente.lat)
    const lng = Number(siguiente.lng)
    // Se propaga solo cuando las dos son números completos y del planeta: a
    // medio teclear, el mapa se quedaría quieto en lugar de dar tumbos.
    if (
      siguiente.lat.trim() === '' ||
      siguiente.lng.trim() === '' ||
      Number.isNaN(lat) ||
      Number.isNaN(lng) ||
      Math.abs(lat) > 90 ||
      Math.abs(lng) > 180
    ) {
      return
    }
    setAnimar(true)
    onCambiar({ latitud: redondear(lat), longitud: redondear(lng) })
  }

  return (
    <div className="space-y-3">
      <div>
        <p className="font-display text-sm font-medium">
          {etiqueta} {requerido && <span className="text-peligro">*</span>}
        </p>
        <p className="mt-0.5 text-sm text-tenue-fg">{ayuda}</p>
      </div>

      <div
        className={cn(
          'overflow-hidden rounded-md border border-borde',
          deshabilitado && 'pointer-events-none opacity-60',
        )}
      >
        <MapContainer
          center={centro}
          zoom={hayPunto ? ZOOM_PUNTO : ZOOM_PAIS}
          scrollWheelZoom={false}
          style={{ height: '18rem', width: '100%' }}
          // Leaflet ya trae navegación por teclado: con foco, las flechas
          // desplazan y +/− acercan.
          keyboard
        >
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            maxZoom={19}
          />
          <Clics onFijar={fijar} />
          <Seguir punto={punto} animar={animar} />
          {hayPunto && (
            <Marker
              position={[punto.latitud!, punto.longitud!]}
              icon={PIN}
              draggable
              eventHandlers={{
                dragend: (evento) => {
                  const { lat, lng } = evento.target.getLatLng()
                  fijar(lat, lng)
                },
              }}
            />
          )}
        </MapContainer>
      </div>

      {!hayPunto && (
        <p className="font-mono text-xs text-tenue-fg">
          Sin punto fijado{requerido ? ' — es obligatorio' : ' — se ubicará por ciudad'}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor={`${id}-lat`}>
            Latitud {requerido && <span className="text-peligro">*</span>}
          </Label>
          <Input
            id={`${id}-lat`}
            inputMode="decimal"
            value={texto.lat}
            onChange={(e) => escribir('lat', e.target.value)}
            placeholder="-0.180653"
            disabled={deshabilitado}
            className="font-mono"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${id}-lng`}>
            Longitud {requerido && <span className="text-peligro">*</span>}
          </Label>
          <Input
            id={`${id}-lng`}
            inputMode="decimal"
            value={texto.lng}
            onChange={(e) => escribir('lng', e.target.value)}
            placeholder="-78.467834"
            disabled={deshabilitado}
            className="font-mono"
          />
        </div>
      </div>
    </div>
  )
}
