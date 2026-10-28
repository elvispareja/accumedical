import { Ionicons } from '@expo/vector-icons'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert,
  AppState,
  FlatList,
  Image,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native'

import { cerrarSesion, type Sesion } from '../api/auth'
import { misCasos, type CasoAsignado } from '../api/visitas'
import {
  abrirParaUsuario,
  borrarTodo,
  enviarPendientes,
  guardarCasos,
  leerCasos,
  porEnviar,
  usePendientes,
} from '../pendientes'
import { CasoScreen } from './CasoScreen'
import { espaciado, type Paleta } from '../tema'
import { useTema } from '../tema-contexto'

// Sin push mientras la app viva en Expo Go, el «tiempo real» es constancia:
// se consulta cada pocos segundos y el caso aparece solo al ser derivado.
const CADA_MS = 10_000

/**
 * Cuánto apremia una visita programada, contra el reloj: con 2 horas o más por
 * delante, verde; a menos de 2 horas del inicio, anaranjado; y ya dentro de la
 * ventana (o pasada sin culminar), rojo. Va siempre con texto, nunca el color
 * solo, y se recalcula en cada refresco.
 */
function semaforo(
  desdeIso: string,
  hastaIso: string,
  c: Paleta,
): { color: string; texto: string } {
  const ahora = Date.now()
  const desde = new Date(desdeIso).getTime()
  const hasta = new Date(hastaIso).getTime()
  if (ahora >= hasta) return { color: c.rojo, texto: 'Vencida' }
  if (ahora >= desde) return { color: c.rojo, texto: 'EN CURSO' }

  const minutos = Math.max(1, Math.round((desde - ahora) / 60_000))
  let texto: string
  if (minutos >= 48 * 60) {
    texto = `Faltan ${Math.round(minutos / (24 * 60))} días`
  } else if (minutos >= 60) {
    const horas = Math.floor(minutos / 60)
    const resto = minutos % 60
    texto = `Falta${horas > 1 ? 'n' : ''} ${horas} h${resto ? ` ${resto} min` : ''}`
  } else {
    texto = minutos === 1 ? 'Falta 1 min' : `Faltan ${minutos} min`
  }
  return { color: minutos >= 120 ? c.verde : c.naranja, texto }
}

/** La ventana en hora de Ecuador (UTC-5 fijo), sin depender del reloj del teléfono. */
function cuando(iso: string): string {
  const d = new Date(new Date(iso).getTime() - 5 * 3600_000)
  const dd = String(d.getUTCDate()).padStart(2, '0')
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  const hh = String(d.getUTCHours()).padStart(2, '0')
  const mi = String(d.getUTCMinutes()).padStart(2, '0')
  return `${dd}/${mm}/${d.getUTCFullYear()} ${hh}:${mi}`
}

/**
 * La bandeja del médico auditor: sus casos derivados, refrescándose sola. Un
 * caso recién derivado aparece marcado como nuevo hasta que se toque, y tocar
 * una tarjeta abre el panel del caso (llegada → dictado → informe).
 */
export function InicioScreen({ sesion, onSalir }: { sesion: Sesion; onSalir: () => void }) {
  const { colores, modo, alternar } = useTema()
  const estilos = useMemo(() => crearEstilos(colores), [colores])
  const etiquetaEstado: Record<string, { texto: string; color: string }> = {
    programada: { texto: 'Programada', color: colores.oro },
    // Derivada a este auditor; todavía no ha marcado su llegada.
    asignada: { texto: 'Asignada', color: colores.oro },
    // Marcó «Ya llegué»: está dentro del prestador.
    auditando: { texto: 'Auditando', color: colores.verde },
    cancelada: { texto: 'Cancelada', color: colores.tenue },
    culminada: { texto: 'Culminada', color: colores.verde },
  }

  const [saliendo, setSaliendo] = useState(false)
  const [casos, setCasos] = useState<CasoAsignado[] | null>(null)
  const [refrescando, setRefrescando] = useState(false)
  const [error, setError] = useState(false)
  const [nuevos, setNuevos] = useState<Set<string>>(new Set())
  const [tab, setTab] = useState<'programadas' | 'historial'>('programadas')
  const [abierto, setAbierto] = useState<CasoAsignado | null>(null)
  const conocidos = useRef<Set<string> | null>(null)
  // Sin señal se trabaja con lo último guardado (28/10/2026) y lo hecho queda
  // en la cola del teléfono hasta que vuelva.
  const [sinConexion, setSinConexion] = useState(false)
  const cola = usePendientes().filter((p) => p.clase !== 'transcrito')
  const listo = useRef(false)

  const cargar = useCallback(async () => {
    if (!listo.current) {
      await abrirParaUsuario(sesion.user.id)
      listo.current = true
    }
    try {
      const lista = await misCasos()
      setError(false)
      setSinConexion(false)
      void guardarCasos(lista)
      // Hay señal: lo que se hizo sin ella sale ahora.
      void enviarPendientes()
      // Lo que no estaba en la carga anterior es nuevo: se marca hasta tocarlo.
      if (conocidos.current !== null) {
        const recientes = lista.filter((c) => !conocidos.current!.has(c.id)).map((c) => c.id)
        if (recientes.length > 0) setNuevos((previo) => new Set([...previo, ...recientes]))
      }
      conocidos.current = new Set(lista.map((c) => c.id))
      setCasos(lista)
    } catch {
      setError(true)
      setSinConexion(true)
      const guardados = await leerCasos()
      if (guardados) setCasos((actuales) => actuales ?? guardados)
    }
  }, [sesion.user.id])

  useEffect(() => {
    cargar()
    const id = setInterval(cargar, CADA_MS)
    // Al volver a la app (desbloquear, cambiar de app) se consulta de inmediato.
    const alVolver = AppState.addEventListener('change', (estado) => {
      if (estado === 'active') cargar()
    })
    return () => {
      clearInterval(id)
      alVolver.remove()
    }
  }, [cargar])

  // Por delante: lo que todavía le toca al auditor. Un caso le llega DERIVADO
  // —`asignada`— y pasa a `auditando` en cuanto pulsa «Ya llegué»; los dos
  // siguen siendo trabajo suyo, así que los dos van arriba. Historial: lo que
  // ya se resolvió —culminada, cancelada o no auditada—, lo más reciente
  // primero.
  const PENDIENTES = ['asignada', 'auditando', 'programada']
  const programadas = (casos ?? [])
    .filter((c) => PENDIENTES.includes(c.estado))
    .sort((a, b) => new Date(a.desde).getTime() - new Date(b.desde).getTime())
  const historial = (casos ?? [])
    .filter((c) => !PENDIENTES.includes(c.estado))
    .sort((a, b) => new Date(b.desde).getTime() - new Date(a.desde).getTime())
  const visibles = tab === 'programadas' ? programadas : historial

  async function salirDeVerdad() {
    setSaliendo(true)
    try {
      await cerrarSesion()
    } finally {
      // Nada del auditor se queda en el teléfono al salir.
      borrarTodo()
      onSalir()
    }
  }

  function salir() {
    const sinEnviar = porEnviar().length
    if (sinEnviar === 0) {
      void salirDeVerdad()
      return
    }
    Alert.alert(
      'Tienes cosas sin enviar',
      `${sinEnviar === 1 ? 'Hay 1 nota, foto o dictado guardado' : `Hay ${sinEnviar} notas, fotos o dictados guardados`} en el teléfono ` +
        'que aún no llegan al servidor. Si sales ahora, se pierden.',
      [
        { text: 'Quedarme', style: 'cancel' },
        { text: 'Salir igual', style: 'destructive', onPress: () => void salirDeVerdad() },
      ],
    )
  }

  // El panel del caso ocupa la pantalla; volver regresa a la bandeja tal cual.
  if (abierto) {
    return <CasoScreen caso={abierto} onVolver={() => setAbierto(null)} />
  }

  return (
    <View style={estilos.pantalla}>
      <View style={estilos.topbar}>
        <Image
          // En oscuro va la variante en blanco del monograma: la marca se
          // apoya sobre el fondo, sin tarjeta que la recuadre.
          source={
            modo === 'oscuro'
              ? require('../../assets/monograma-accumedical-blanco.png')
              : require('../../assets/monograma-accumedical.png')
          }
          style={estilos.monograma}
          resizeMode="contain"
          accessibilityLabel="Accumedical"
        />
        <View style={estilos.topbarCentro}>
          <Text style={estilos.titulo}>Mis casos</Text>
          <Text style={estilos.subtitulo} numberOfLines={1}>
            {sesion.user.nombre_completo}
          </Text>
        </View>
        <Pressable
          onPress={alternar}
          accessibilityRole="button"
          accessibilityLabel={modo === 'oscuro' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
          hitSlop={8}
        >
          <Ionicons
            name={modo === 'oscuro' ? 'sunny-outline' : 'moon-outline'}
            size={20}
            color={colores.tenue}
          />
        </Pressable>
        <Pressable onPress={salir} disabled={saliendo} accessibilityRole="button" hitSlop={8}>
          <Text style={estilos.salir}>{saliendo ? '…' : 'Salir'}</Text>
        </Pressable>
      </View>

      {(sinConexion || cola.length > 0) && (
        <View style={estilos.franja}>
          <Ionicons
            name={sinConexion ? 'cloud-offline-outline' : 'cloud-upload-outline'}
            size={16}
            color={colores.naranja}
          />
          <Text style={estilos.franjaTexto}>
            {sinConexion ? 'Sin conexión: trabajas con lo guardado en el teléfono.' : ''}
            {sinConexion && cola.length > 0 ? ' ' : ''}
            {cola.length > 0
              ? `${cola.length} ${cola.length === 1 ? 'pendiente' : 'pendientes'} de enviar.`
              : ''}
          </Text>
          {cola.length > 0 && (
            <Pressable
              onPress={() => void enviarPendientes()}
              accessibilityRole="button"
              hitSlop={8}
            >
              <Text style={estilos.franjaAccion}>Enviar ahora</Text>
            </Pressable>
          )}
        </View>
      )}

      <View style={estilos.pestanas}>
        {(
          [
            ['programadas', `Programadas (${programadas.length})`],
            ['historial', `Historial (${historial.length})`],
          ] as const
        ).map(([valor, etiqueta]) => (
          <Pressable
            key={valor}
            onPress={() => setTab(valor)}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === valor }}
            style={[estilos.pestana, tab === valor && estilos.pestanaActiva]}
          >
            <Text style={[estilos.pestanaTexto, tab === valor && estilos.pestanaTextoActivo]}>
              {etiqueta}
            </Text>
          </Pressable>
        ))}
      </View>

      {error && casos === null ? (
        <View style={estilos.centro}>
          <Ionicons name="cloud-offline-outline" size={28} color={colores.tenue} />
          <Text style={estilos.vacioTitulo}>No pudimos cargar tus casos</Text>
          <Text style={estilos.vacioTexto}>Revisa tu conexión; reintentamos solos.</Text>
        </View>
      ) : casos !== null && visibles.length === 0 ? (
        <View style={estilos.centro}>
          <Ionicons name="file-tray-outline" size={28} color={colores.tenue} />
          <Text style={estilos.vacioTitulo}>
            {tab === 'programadas' ? 'Sin visitas programadas' : 'Sin historial todavía'}
          </Text>
          <Text style={estilos.vacioTexto}>
            {tab === 'programadas'
              ? 'Cuando el supervisor te derive una visita, aparecerá aquí sola: esta pantalla se actualiza cada pocos segundos.'
              : 'Las visitas ya culminadas, canceladas o no auditadas quedarán aquí.'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={visibles}
          keyExtractor={(c) => c.id}
          contentContainerStyle={estilos.lista}
          refreshControl={
            <RefreshControl
              refreshing={refrescando}
              onRefresh={async () => {
                setRefrescando(true)
                await cargar()
                setRefrescando(false)
              }}
              tintColor={colores.oro}
            />
          }
          renderItem={({ item }) => {
            // El semáforo solo aplica a lo pendiente: el historial ya se cerró.
            const urgencia =
              PENDIENTES.includes(item.estado) ? semaforo(item.desde, item.hasta, colores) : null
            return (
            <Pressable
              onPress={() => {
                setNuevos((previo) => {
                  const siguiente = new Set(previo)
                  siguiente.delete(item.id)
                  return siguiente
                })
                setAbierto(item)
              }}
              accessibilityRole="button"
              accessibilityLabel={`Abrir el caso ${item.codigo_interno}`}
              style={[
                estilos.tarjeta,
                urgencia && { borderLeftColor: urgencia.color, borderLeftWidth: 4 },
                nuevos.has(item.id) && estilos.tarjetaNueva,
              ]}
            >
              <View style={estilos.tarjetaCabecera}>
                <Text style={estilos.codigo}>{item.codigo_interno}</Text>
                {nuevos.has(item.id) && <Text style={estilos.nuevo}>NUEVO</Text>}
                {urgencia ? (
                  <View style={[estilos.semaforo, { borderColor: urgencia.color }]}>
                    <View style={[estilos.semaforoPunto, { backgroundColor: urgencia.color }]} />
                    <Text style={[estilos.semaforoTexto, { color: urgencia.color }]}>
                      {urgencia.texto}
                    </Text>
                  </View>
                ) : (
                  <Text
                    style={[
                      estilos.estado,
                      { color: etiquetaEstado[item.estado]?.color ?? colores.tenue },
                    ]}
                  >
                    {etiquetaEstado[item.estado]?.texto ?? item.estado}
                  </Text>
                )}
              </View>

              <Text style={estilos.prestador}>{item.paciente_nombre_completo}</Text>
              <Text style={estilos.aseguradora}>
                CI {item.paciente_numero_documento} · {item.aseguradora_nombre}
              </Text>
              <View style={estilos.filaDato}>
                <Ionicons name="business-outline" size={15} color={colores.tenue} />
                <Text style={estilos.dato}>{item.prestador_nombre}</Text>
              </View>

              <View style={estilos.filaDato}>
                <Ionicons name="location-outline" size={15} color={colores.tenue} />
                <Text style={estilos.dato} numberOfLines={2}>
                  {item.sede_nombre ?? 'SEDE PRINCIPAL'}
                  {[item.ciudad_nombre, item.provincia_nombre].filter(Boolean).length
                    ? ` · ${[item.ciudad_nombre, item.provincia_nombre].filter(Boolean).join(', ')}`
                    : ''}
                  {item.lugar ? `\n${item.lugar}` : ''}
                </Text>
              </View>
              <View style={estilos.filaDato}>
                <Ionicons name="time-outline" size={15} color={colores.tenue} />
                <Text style={estilos.dato}>
                  {cuando(item.desde)} — {cuando(item.hasta)}
                </Text>
              </View>
              {item.observaciones && (
                <View style={estilos.filaDato}>
                  <Ionicons name="document-text-outline" size={15} color={colores.tenue} />
                  <Text style={estilos.dato}>{item.observaciones}</Text>
                </View>
              )}
              {item.correos.length > 0 && (
                <View style={estilos.filaDato}>
                  <Ionicons name="mail-outline" size={15} color={colores.tenue} />
                  <Text style={estilos.dato} numberOfLines={2}>
                    Avisado a: {item.correos.join(', ')}
                  </Text>
                </View>
              )}
            </Pressable>
            )
          }}
        />
      )}
    </View>
  )
}

function crearEstilos(c: Paleta) {
  return StyleSheet.create({
    pantalla: { flex: 1, backgroundColor: c.fondo },
    topbar: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: espaciado.md,
      paddingHorizontal: espaciado.md,
      paddingTop: 54,
      paddingBottom: espaciado.sm,
      backgroundColor: c.superficie,
      borderBottomWidth: 1,
      borderBottomColor: c.borde,
    },
    monograma: { width: 38, height: 38 },
    topbarCentro: { flex: 1, minWidth: 0 },
    titulo: { fontSize: 17, fontWeight: '700', color: c.tinta },
    subtitulo: { fontSize: 12, color: c.tenue },
    salir: { color: c.azul, fontSize: 15, fontWeight: '600' },
    franja: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginHorizontal: espaciado.md,
      marginTop: espaciado.sm,
      paddingHorizontal: espaciado.sm,
      paddingVertical: 8,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: c.naranja,
      backgroundColor: c.superficie,
    },
    franjaTexto: { flex: 1, fontSize: 12.5, color: c.tinta, lineHeight: 17 },
    franjaAccion: { fontSize: 13, fontWeight: '700', color: c.azul },
    pestanas: {
      flexDirection: 'row',
      gap: espaciado.sm,
      paddingHorizontal: espaciado.md,
      paddingVertical: espaciado.sm,
      backgroundColor: c.superficie,
      borderBottomWidth: 1,
      borderBottomColor: c.borde,
    },
    pestana: {
      flex: 1,
      alignItems: 'center',
      paddingVertical: 9,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: c.borde,
      backgroundColor: c.fondo,
    },
    pestanaActiva: { backgroundColor: c.azul, borderColor: c.azul },
    pestanaTexto: { fontSize: 14, fontWeight: '600', color: c.tenue },
    pestanaTextoActivo: { color: '#ffffff' },
    centro: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      padding: espaciado.xl,
      gap: espaciado.xs,
    },
    vacioTitulo: { fontSize: 16, fontWeight: '600', color: c.tinta, marginTop: espaciado.xs },
    vacioTexto: { fontSize: 13, color: c.tenue, textAlign: 'center', lineHeight: 19 },
    lista: { padding: espaciado.md, gap: espaciado.sm },
    tarjeta: {
      backgroundColor: c.superficie,
      borderWidth: 1,
      borderColor: c.borde,
      borderRadius: 14,
      padding: espaciado.md,
      gap: 6,
    },
    tarjetaNueva: { borderColor: c.oro, borderWidth: 1.5 },
    tarjetaCabecera: { flexDirection: 'row', alignItems: 'center', gap: espaciado.sm },
    codigo: { fontSize: 12, color: c.tenue, fontVariant: ['tabular-nums'] },
    nuevo: {
      fontSize: 10,
      fontWeight: '800',
      color: c.oro,
      borderWidth: 1,
      borderColor: c.oro,
      borderRadius: 6,
      paddingHorizontal: 6,
      paddingVertical: 1,
      letterSpacing: 1,
    },
    estado: { marginLeft: 'auto', fontSize: 12, fontWeight: '700' },
    semaforo: {
      marginLeft: 'auto',
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      borderWidth: 1,
      borderRadius: 8,
      paddingHorizontal: 7,
      paddingVertical: 2,
    },
    semaforoPunto: { width: 7, height: 7, borderRadius: 4 },
    semaforoTexto: { fontSize: 11, fontWeight: '800', letterSpacing: 0.3 },
    prestador: { fontSize: 16, fontWeight: '700', color: c.tinta },
    aseguradora: { fontSize: 13, color: c.oro, fontWeight: '600' },
    filaDato: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', marginTop: 2 },
    dato: { flex: 1, fontSize: 13, color: c.tinta, lineHeight: 18 },
  })
}
