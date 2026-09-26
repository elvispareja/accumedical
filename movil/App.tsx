import { StatusBar } from 'expo-status-bar'
import { useEffect, useState } from 'react'
import { ActivityIndicator, StyleSheet, View } from 'react-native'

import { sesionActual, type Sesion } from './src/api/auth'
import { borrarToken, leerToken } from './src/sesion/almacen'
import { InicioScreen } from './src/pantallas/InicioScreen'
import { LoginScreen } from './src/pantallas/LoginScreen'
import { tema } from './src/tema'
import { TemaProvider, useTema } from './src/tema-contexto'

/**
 * La app del médico auditor. Al abrir, si el llavero guarda un token de sesión
 * todavía válido —el servidor decide, no la app—, entra directo; si no, al
 * login. El modo claro/oscuro lo elige el auditor y lo recuerda el llavero.
 */
export default function App() {
  return (
    <TemaProvider>
      <Raiz />
    </TemaProvider>
  )
}

function Raiz() {
  const { modo } = useTema()
  const [arrancando, setArrancando] = useState(true)
  const [sesion, setSesion] = useState<Sesion | null>(null)

  useEffect(() => {
    ;(async () => {
      try {
        if (await leerToken()) setSesion(await sesionActual())
      } catch {
        // Token caducado o revocado: se limpia y se vuelve al login sin ruido.
        await borrarToken()
      } finally {
        setArrancando(false)
      }
    })()
  }, [])

  if (arrancando) {
    return (
      <View style={estilos.arranque}>
        <ActivityIndicator color={tema.oro} size="large" />
        <StatusBar style="light" />
      </View>
    )
  }

  return (
    <>
      {sesion ? (
        <InicioScreen sesion={sesion} onSalir={() => setSesion(null)} />
      ) : (
        <LoginScreen onEntrar={setSesion} />
      )}
      <StatusBar style={sesion ? (modo === 'oscuro' ? 'light' : 'dark') : 'light'} />
    </>
  )
}

const estilos = StyleSheet.create({
  arranque: {
    flex: 1,
    backgroundColor: tema.azul,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
