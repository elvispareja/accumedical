/**
 * Un punto del mapa de la red, ya traducido: **el mapa no sabe de prestadores
 * ni de aseguradoras**, solo de sitios con nombre y coordenadas.
 *
 * Cada entidad adapta lo suyo a esta forma —igual que hace la bandeja de
 * entrada con los casos de cada módulo—, y así el mapa, el panel de provincias
 * y el filtrado por ciudad se escriben UNA vez.
 */
export interface PuntoDeMapa {
  /** Única por punto. Un prestador con sedes aporta varias, y deben diferir. */
  clave: string
  /** Ruta de su ficha: lo que abre el enlace del globo. */
  ficha: string
  titulo: string
  /** La línea pequeña: código, tipo, ciudad… lo que identifique el sitio. */
  subtitulo: string | null
  direccion: string | null
  provincia_codigo: string | null
  provincia_nombre: string | null
  ciudad_codigo: string | null
  ciudad_nombre: string | null
  latitud: number
  longitud: number
  /**
   * Opcional: a qué entidad pertenece el punto (el prestador) y su nombre. Con
   * él, el buscador del costado lista UNA fila por entidad y, al elegirla,
   * despliega sus sitios (casa matriz y sedes).
   */
  grupo?: string
  nombreGrupo?: string
  /** El nombre de la sede; null = la casa matriz del prestador. */
  sede?: string | null
}
