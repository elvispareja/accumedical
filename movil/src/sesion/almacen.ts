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
  await SecureStore.deleteItemAsync(CLAVE_PERFIL)
}

// Quién es el auditor (id, correo, nombre), para abrir la app SIN señal y
// trabajar con lo guardado (28/10/2026). No es secreto, pero vive junto al
// token y se borra con él; el servidor sigue decidiendo si la sesión vale.
const CLAVE_PERFIL = 'accumedical.perfil'

export async function guardarPerfil(perfil: unknown): Promise<void> {
  await SecureStore.setItemAsync(CLAVE_PERFIL, JSON.stringify(perfil))
}

export async function leerPerfil<T>(): Promise<T | null> {
  const crudo = await SecureStore.getItemAsync(CLAVE_PERFIL)
  return crudo ? (JSON.parse(crudo) as T) : null
}
