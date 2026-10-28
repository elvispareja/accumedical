import { StatusBar } from 'expo-status-bar'
import { useEffect, useState } from 'react'
import { ActivityIndicator, StyleSheet, View } from 'react-native'

import { sesionActual, type Sesion } from './src/api/auth'
import { ErrorDeApi } from './src/api/cliente'
import { borrarToken, guardarPerfil, leerPerfil, leerToken } from './src/sesion/almacen'
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
        if (await leerToken()) {
          const actual = await sesionActual()
          await guardarPerfil({ ...actual, token: null })
          setSesion(actual)
        }
      } catch (error) {
        if (error instanceof ErrorDeApi && [401, 403].includes(error.status)) {
          // Token caducado o revocado: se limpia y se vuelve al login sin ruido.
          await borrarToken()
        } else {
          // SIN SEÑAL (28/10/2026): no se echa al auditor. Entra con el perfil
          // guardado y trabaja con lo del teléfono; el servidor decide al volver.
          const guardada = await leerPerfil<Sesion>()
          if (guardada) setSesion(guardada)
        }
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
        <LoginScreen
          onEntrar={(nueva) => {
            void guardarPerfil({ ...nueva, token: null })
            setSesion(nueva)
          }}
        />
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
