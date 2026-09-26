import * as SecureStore from 'expo-secure-store'
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

import { paletas, type ModoTema, type Paleta } from './tema'

// El modo elegido se recuerda entre sesiones. No es un secreto, pero
// SecureStore ya está en la app y evita sumar otra dependencia de storage.
const CLAVE = 'accumedical.tema'

interface ContextoTema {
  modo: ModoTema
  colores: Paleta
  alternar: () => void
}

const Contexto = createContext<ContextoTema>({
  modo: 'claro',
  colores: paletas.claro,
  alternar: () => {},
})

export function TemaProvider({ children }: { children: ReactNode }) {
  const [modo, setModo] = useState<ModoTema>('claro')

  useEffect(() => {
    ;(async () => {
      const guardado = await SecureStore.getItemAsync(CLAVE)
      if (guardado === 'oscuro' || guardado === 'claro') setModo(guardado)
    })()
  }, [])

  const valor = useMemo<ContextoTema>(
    () => ({
      modo,
      colores: paletas[modo],
      alternar: () => {
        setModo((previo) => {
          const siguiente = previo === 'claro' ? 'oscuro' : 'claro'
          SecureStore.setItemAsync(CLAVE, siguiente).catch(() => {})
          return siguiente
        })
      },
    }),
    [modo],
  )

  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>
}

export function useTema(): ContextoTema {
  return useContext(Contexto)
}
