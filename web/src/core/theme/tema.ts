import { create } from 'zustand'

export type Tema = 'claro' | 'oscuro'

const CLAVE = 'accumedical:tema'

function leerInicial(): Tema {
  if (typeof document === 'undefined') return 'claro'
  return document.documentElement.classList.contains('dark') ? 'oscuro' : 'claro'
}

function aplicar(tema: Tema) {
  document.documentElement.classList.toggle('dark', tema === 'oscuro')
  try {
    localStorage.setItem(CLAVE, tema)
  } catch {
    // Navegación privada o almacenamiento bloqueado: el tema vale para esta sesión y ya.
  }
}

/**
 * Estado de UI puro, que es lo único para lo que se usa Zustand en este proyecto.
 * El valor inicial lo fija el script de index.html antes del primer pintado, así
 * que aquí solo se lee la clase ya aplicada y no hay destello.
 */
export const useTema = create<{ tema: Tema; alternar: () => void }>((set, get) => ({
  tema: leerInicial(),
  alternar: () => {
    const siguiente: Tema = get().tema === 'oscuro' ? 'claro' : 'oscuro'
    aplicar(siguiente)
    set({ tema: siguiente })
  },
}))
