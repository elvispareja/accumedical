// Los colores de la marca, muestreados del logo real (no aproximados a ojo),
// en dos paletas: la clara y la oscura. El auditor elige su modo desde la
// bandeja y la app lo recuerda en el llavero del sistema.

export type ModoTema = 'claro' | 'oscuro'

export interface Paleta {
  azul: string
  oro: string
  fondo: string
  superficie: string
  borde: string
  tinta: string
  tenue: string
  peligro: string
  // El semáforo de urgencia, calibrado por fondo: sobre claro van tonos
  // profundos y sobre oscuro tonos encendidos, para que el contraste aguante.
  verde: string
  naranja: string
  rojo: string
}

export const paletas: Record<ModoTema, Paleta> = {
  claro: {
    azul: '#1a2448', // el trazo de la A del monograma
    oro: '#8a6f33', // el arco de la C, oscurecido para leerse sobre blanco
    fondo: '#f7f7f5',
    superficie: '#ffffff',
    borde: '#e3e3df',
    tinta: '#1d1d1b',
    tenue: '#6b6b66',
    peligro: '#b3261e',
    verde: '#2e7d32',
    naranja: '#e65100',
    rojo: '#c62828',
  },
  // El modo oscuro ES el azul del logo: todos los fondos salen de su familia.
  oscuro: {
    azul: '#3d4f8c',
    oro: '#c9a55e',
    fondo: '#0c1122',
    superficie: '#141b33',
    borde: '#26304f',
    tinta: '#e8ecf7',
    tenue: '#93a0c4',
    peligro: '#ef5350',
    verde: '#66bb6a',
    naranja: '#ffa726',
    rojo: '#ef5350',
  },
}

// La paleta clara sigue siendo el `tema` de siempre: el arranque y el login
// —que tiene su propio diseño nocturno de marca— no cambian con el modo.
export const tema = paletas.claro

export const espaciado = { xs: 6, sm: 10, md: 16, lg: 24, xl: 36 } as const
