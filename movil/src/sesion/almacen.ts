import * as SecureStore from 'expo-secure-store'

// El token de sesión vive en el llavero del sistema (Keychain en iOS, Keystore
// en Android): cifrado por el propio teléfono y fuera del alcance de otras
// apps. Es el equivalente nativo de la cookie httpOnly del navegador; jamás en
// AsyncStorage ni en nada parecido a localStorage.

const CLAVE = 'accumedical.sesion'

export async function guardarToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(CLAVE, token)
}

export async function leerToken(): Promise<string | null> {
  return SecureStore.getItemAsync(CLAVE)
}

export async function borrarToken(): Promise<void> {
  await SecureStore.deleteItemAsync(CLAVE)
}
