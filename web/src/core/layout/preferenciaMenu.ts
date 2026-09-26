import { create } from 'zustand'

const CLAVE = 'accumedical:menu-compacto'

function leerInicial(): boolean {
  try {
    return localStorage.getItem(CLAVE) === '1'
  } catch {
    // Navegación privada o almacenamiento bloqueado: se abre expandido y ya.
    return false
  }
}

function guardar(compacto: boolean) {
  try {
    localStorage.setItem(CLAVE, compacto ? '1' : '0')
  } catch {
    // Vale para esta sesión y no se recuerda. No es un dato de negocio.
  }
}

/**
 * Si el menú lateral está contraído a solo iconos. Estado de UI puro —lo único
 * para lo que este proyecto usa Zustand— y preferencia de ESTE navegador, no del
 * usuario: no viaja al servidor, a diferencia del último módulo usado, que sí es
 * dato de la cuenta y vive en `users.last_module_code`.
 */
export const useMenuLateral = create<{ compacto: boolean; alternar: () => void }>((set, get) => ({
  compacto: leerInicial(),
  alternar: () => {
    const siguiente = !get().compacto
    guardar(siguiente)
    set({ compacto: siguiente })
  },
}))
