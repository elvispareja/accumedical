import { createContext, useContext } from 'react'

/**
 * En qué app se está pintando una pantalla compartida (D50). Las pantallas de
 * aseguradoras, prestadores, red y parámetros viven en `@/shared` y las montan
 * VARIAS apps:
 *
 *   · admin (`raiz: '/admin'`, el valor por defecto)
 *   · Convenios (`raiz: ''`, `alcance: 'convenios'`): solo la red de cada compañía
 *   · Contabilidad (`raiz: ''`, `alcance: 'contabilidad'`): la ficha sin la red
 *
 * `raiz` es donde empiezan sus rutas (sus enlaces la anteponen); `alcance`
 * recorta la ficha IGUAL que la función del usuario, para que dentro de cada
 * app se vea solo lo suyo aunque entre el administrador. Es solo interfaz: el
 * servidor autoriza cada petición por función.
 */
export interface ContextoApp {
  raiz: string
  alcance: 'convenios' | 'contabilidad' | null
}

const Contexto = createContext<ContextoApp>({ raiz: '/admin', alcance: null })

export const ProveedorApp = Contexto.Provider

export function useApp(): ContextoApp {
  return useContext(Contexto)
}
