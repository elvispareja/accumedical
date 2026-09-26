import { Ionicons } from '@expo/vector-icons'
import { LinearGradient } from 'expo-linear-gradient'
import { useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Animated,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'

import { iniciarSesion, type Sesion } from '../api/auth'
import { tema } from '../tema'

// Paleta del login: el azul de la marca llevado a noche, con el oro como único
// acento. Minimalista de verdad: una tarjeta no — campos flotando en el fondo.
const NOCHE = '#0c1226'
const AZUL_PROFUNDO = '#141d3d'
const LINEA = 'rgba(255,255,255,0.14)'
const LINEA_FOCO = tema.oro
const TEXTO_SUAVE = 'rgba(255,255,255,0.55)'
const CAMPO_FONDO = 'rgba(255,255,255,0.05)'

/**
 * El mismo login de la plataforma, en versión de bolsillo: fondo nocturno con
 * un resplandor dorado, el monograma como única insignia y dos campos flotantes.
 * Los errores son los del backend, que responde idéntico ante cualquier fallo
 * para no filtrar cuentas.
 */
export function LoginScreen({ onEntrar }: { onEntrar: (sesion: Sesion) => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [verPassword, setVerPassword] = useState(false)
  const [foco, setFoco] = useState<'email' | 'password' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(false)

  // Entrada: todo sube y aparece una sola vez, sin rebotes.
  const entrada = useRef(new Animated.Value(0)).current
  useEffect(() => {
    Animated.timing(entrada, { toValue: 1, duration: 520, useNativeDriver: true }).start()
  }, [entrada])

  async function entrar() {
    if (!email.trim() || !password) {
      setError('Escribe tu correo y tu contraseña')
      return
    }
    setError(null)
    setCargando(true)
    try {
      onEntrar(await iniciarSesion(email.trim(), password))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No pudimos iniciar sesión')
    } finally {
      setCargando(false)
    }
  }

  return (
    <View style={estilos.pantalla}>
      <LinearGradient
        colors={[AZUL_PROFUNDO, NOCHE]}
        start={{ x: 0.2, y: 0 }}
        end={{ x: 0.8, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      {/* El resplandor dorado: dos halos concéntricos, sin imágenes. */}
      <View pointerEvents="none" style={[estilos.halo, estilos.haloGrande]} />
      <View pointerEvents="none" style={[estilos.halo, estilos.haloChico]} />

      <KeyboardAvoidingView
        style={estilos.contenido}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Animated.View
          style={{
            opacity: entrada,
            transform: [
              { translateY: entrada.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }) },
            ],
          }}
        >
          {/* La insignia: el monograma AC sobre una placa clara, único brillo. */}
          <View style={estilos.placa}>
            <Image
              source={require('../../assets/monograma-accumedical.png')}
              style={estilos.monograma}
              resizeMode="contain"
              accessibilityLabel="Accumedical"
            />
          </View>

          <Text style={estilos.marca}>ACCUMEDICAL</Text>
          <View style={estilos.subrayado} />
          <Text style={estilos.lema}>Auditoría médica en campo</Text>

          {/* Campos flotantes: línea tenue, oro al enfocar. */}
          <View
            style={[
              estilos.campo,
              foco === 'email' && estilos.campoEnFoco,
            ]}
          >
            <Ionicons
              name="mail-outline"
              size={18}
              color={foco === 'email' ? tema.oro : TEXTO_SUAVE}
            />
            <TextInput
              style={estilos.campoTexto}
              value={email}
              onChangeText={setEmail}
              onFocus={() => setFoco('email')}
              onBlur={() => setFoco(null)}
              placeholder="Correo electrónico"
              placeholderTextColor={TEXTO_SUAVE}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              textContentType="username"
              editable={!cargando}
            />
          </View>

          <View
            style={[
              estilos.campo,
              foco === 'password' && estilos.campoEnFoco,
            ]}
          >
            <Ionicons
              name="lock-closed-outline"
              size={18}
              color={foco === 'password' ? tema.oro : TEXTO_SUAVE}
            />
            <TextInput
              style={estilos.campoTexto}
              value={password}
              onChangeText={setPassword}
              onFocus={() => setFoco('password')}
              onBlur={() => setFoco(null)}
              placeholder="Contraseña"
              placeholderTextColor={TEXTO_SUAVE}
              secureTextEntry={!verPassword}
              textContentType="password"
              editable={!cargando}
              onSubmitEditing={entrar}
            />
            <Pressable
              onPress={() => setVerPassword((v) => !v)}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel={verPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
            >
              <Ionicons
                name={verPassword ? 'eye-off-outline' : 'eye-outline'}
                size={18}
                color={TEXTO_SUAVE}
              />
            </Pressable>
          </View>

          {error && (
            <Text style={estilos.error} accessibilityRole="alert">
              {error}
            </Text>
          )}

          <Pressable
            onPress={entrar}
            disabled={cargando}
            accessibilityRole="button"
            style={({ pressed }) => [pressed && estilos.botonPulsado]}
          >
            <LinearGradient
              colors={[tema.oro, '#8f7238']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={estilos.boton}
            >
              {cargando ? (
                <ActivityIndicator color={NOCHE} />
              ) : (
                <View style={estilos.botonFila}>
                  <Text style={estilos.botonTexto}>Entrar</Text>
                  <Ionicons name="arrow-forward" size={18} color={NOCHE} />
                </View>
              )}
            </LinearGradient>
          </Pressable>

          <Text style={estilos.pie}>
            Los accesos quedan registrados en la auditoría de la plataforma.
          </Text>
        </Animated.View>
      </KeyboardAvoidingView>
    </View>
  )
}

const estilos = StyleSheet.create({
  pantalla: { flex: 1, backgroundColor: NOCHE },
  halo: {
    position: 'absolute',
    borderRadius: 999,
    backgroundColor: tema.oro,
  },
  haloGrande: { width: 420, height: 420, top: -180, right: -160, opacity: 0.07 },
  haloChico: { width: 260, height: 260, top: -90, right: -70, opacity: 0.07 },
  contenido: { flex: 1, justifyContent: 'center', paddingHorizontal: 28 },
  placa: {
    alignSelf: 'center',
    width: 76,
    height: 76,
    borderRadius: 22,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: tema.oro,
    shadowOpacity: 0.35,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
  },
  monograma: { width: 52, height: 52 },
  marca: {
    marginTop: 22,
    textAlign: 'center',
    color: '#ffffff',
    fontSize: 21,
    fontWeight: '700',
    letterSpacing: 6,
  },
  subrayado: {
    alignSelf: 'center',
    marginTop: 10,
    width: 34,
    height: 2,
    borderRadius: 1,
    backgroundColor: tema.oro,
  },
  lema: {
    marginTop: 10,
    marginBottom: 40,
    textAlign: 'center',
    color: TEXTO_SUAVE,
    fontSize: 13,
    letterSpacing: 1.2,
  },
  campo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: CAMPO_FONDO,
    borderWidth: 1,
    borderColor: LINEA,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 4,
    marginBottom: 14,
  },
  campoEnFoco: { borderColor: LINEA_FOCO },
  campoTexto: {
    flex: 1,
    color: '#ffffff',
    fontSize: 16,
    paddingVertical: 14,
  },
  error: {
    color: '#ff9d94',
    fontSize: 13,
    marginBottom: 12,
    textAlign: 'center',
  },
  boton: {
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  botonPulsado: { opacity: 0.9, transform: [{ scale: 0.985 }] },
  botonFila: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  botonTexto: { color: NOCHE, fontSize: 16, fontWeight: '700', letterSpacing: 0.4 },
  pie: {
    marginTop: 26,
    textAlign: 'center',
    color: 'rgba(255,255,255,0.35)',
    fontSize: 12,
    lineHeight: 17,
  },
})
