import { Ionicons } from '@expo/vector-icons'
import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  useAudioRecorder,
} from 'expo-audio'
import { useCallback, useEffect, useMemo, useState, useRef } from 'react'
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'

import { Image } from 'expo-image'
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator'
import * as ImagePicker from 'expo-image-picker'

import { ErrorDeApi } from '../api/cliente'
import {
  corregirInforme,
  crearNota,
  leerInformePdf,
  dictar,
  eliminarFoto,
  eliminarNota,
  enviarInforme,
  generarInforme,
  panelDeCaso,
  registrarLlegada,
  subirFoto,
  urlFoto,
  type CasoAsignado,
  type FotoCaso,
  type Nota,
  type TipoNota,
} from '../api/visitas'
import { leerToken } from '../sesion/almacen'
import { espaciado, type Paleta } from '../tema'
import { useTema } from '../tema-contexto'
import { VisorPdf } from './VisorPdf'

const TIPOS: { valor: TipoNota; etiqueta: string; icono: keyof typeof Ionicons.glyphMap }[] = [
  { valor: 'historial_clinico', etiqueta: 'Historial clínico', icono: 'folder-open-outline' },
  { valor: 'charla_medico', etiqueta: 'Médico', icono: 'people-outline' },
  { valor: 'observacion', etiqueta: 'Observación', icono: 'eye-outline' },
]

const ETIQUETA_TIPO: Record<TipoNota, string> = {
  historial_clinico: 'Historial clínico',
  charla_enfermeria: 'Charla con enfermería',
  charla_medico: 'Charla con médico',
  observacion: 'Observación',
}

function hora(iso: string): string {
  const d = new Date(new Date(iso).getTime() - 5 * 3600_000)
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`
}

function cuando(iso: string): string {
  const d = new Date(new Date(iso).getTime() - 5 * 3600_000)
  const dd = String(d.getUTCDate()).padStart(2, '0')
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  return `${dd}/${mm}/${d.getUTCFullYear()} ${String(d.getUTCHours()).padStart(2, '0')}:${String(
    d.getUTCMinutes(),
  ).padStart(2, '0')}`
}

/**
 * El panel del caso, en dos etapas. Primero la LLEGADA: el destino con «Ver
 * mapa» (abre la app de mapas con el punto exacto) y «Ya llegué». Al llegar,
 * el TRABAJO: dictar notas —con el micrófono del teclado, que convierte la voz
 * en texto— y pedirle a la IA el informe final ya redactado.
 */
export function CasoScreen({ caso, onVolver }: { caso: CasoAsignado; onVolver: () => void }) {
  const { colores } = useTema()
  const estilos = useMemo(() => crearEstilos(colores), [colores])

  const [etapa, setEtapa] = useState<'llegada' | 'trabajo'>('llegada')
  const [notas, setNotas] = useState<Nota[] | null>(null)
  const [fotos, setFotos] = useState<FotoCaso[] | null>(null)
  const [subiendoFoto, setSubiendoFoto] = useState(false)
  // Las miniaturas se piden con el Bearer en la cabecera, como todo lo demás.
  const [token, setToken] = useState<string | null>(null)
  useEffect(() => {
    leerToken().then(setToken)
  }, [])
  const [informe, setInforme] = useState<string | null>(null)
  const [tipo, setTipo] = useState<TipoNota>('historial_clinico')
  const [texto, setTexto] = useState('')
  const [correccion, setCorreccion] = useState('')
  const [corrigiendo, setCorrigiendo] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [generando, setGenerando] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)

  // El dictado: se graba en la app y se transcribe en el servidor (Whisper
  // local); el texto cae solo en la caja elegida —la nota o las correcciones
  // del informe—, listo para revisar y confirmar.
  const grabadora = useAudioRecorder(RecordingPresets.HIGH_QUALITY)
  const [grabando, setGrabando] = useState(false)
  const [transcribiendo, setTranscribiendo] = useState(false)
  const [destinoDictado, setDestinoDictado] = useState<'nota' | 'correccion'>('nota')

  async function alternarDictado(destino: 'nota' | 'correccion') {
    if (transcribiendo) return
    setAviso(null)
    if (!grabando) {
      const permiso = await AudioModule.requestRecordingPermissionsAsync()
      if (!permiso.granted) {
        setAviso('Sin permiso de micrófono: actívalo en los ajustes del teléfono.')
        return
      }
      setDestinoDictado(destino)
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true })
      await grabadora.prepareToRecordAsync()
      grabadora.record()
      setGrabando(true)
      return
    }
    setGrabando(false)
    await grabadora.stop()
    const uri = grabadora.uri
    if (!uri) {
      setAviso('No se obtuvo el audio. Vuelve a intentarlo.')
      return
    }
    setTranscribiendo(true)
    try {
      const { texto: dictado } = await dictar(caso.id, uri)
      if (!dictado) {
        setAviso('No se entendió nada en el audio. Habla más cerca del micrófono.')
      } else {
        const escribir = destinoDictado === 'correccion' ? setCorreccion : setTexto
        escribir((previo) => (previo.trim() ? `${previo.trim()} ${dictado}` : dictado))
      }
    } catch (error) {
      // El texto crudo del error importa: «Network request failed» y un 415
      // se arreglan en sitios distintos, y el teléfono es el único que lo sabe.
      setAviso(
        error instanceof ErrorDeApi
          ? error.message
          : `No se pudo transcribir. Reintenta. (${String(error)})`,
      )
    } finally {
      setTranscribiendo(false)
    }
  }

  const cargar = useCallback(async () => {
    try {
      const panel = await panelDeCaso(caso.id)
      setNotas(panel.notas)
      setFotos(panel.fotos)
      setInforme(panel.informe)
      // Con la llegada ya registrada —o si ya venía dictando en este caso—,
      // la app no lo devuelve a la puerta.
      if (panel.llegada_at || panel.notas.length > 0 || panel.informe) setEtapa('trabajo')
    } catch {
      setAviso('No pudimos cargar el panel. Revisa tu conexión.')
    }
  }, [caso.id])

  useEffect(() => {
    cargar()
  }, [cargar])

  // «Ya llegué» se guarda en el servidor: esa marca es la que libra al caso de
  // pasar a «no auditado» cuando la ventana vence. Sin ella, no hay trabajo.
  const [llegando, setLlegando] = useState(false)

  async function marcarLlegada() {
    setLlegando(true)
    setAviso(null)
    try {
      await registrarLlegada(caso.id)
      setEtapa('trabajo')
    } catch (error) {
      setAviso(
        error instanceof ErrorDeApi
          ? error.message
          : 'No se pudo registrar la llegada. Revisa tu conexión.',
      )
    } finally {
      setLlegando(false)
    }
  }

  function abrirMapa() {
    // Con el punto exacto del destino; sin coordenadas, por la dirección.
    const destino =
      caso.destino_latitud !== null && caso.destino_longitud !== null
        ? `${caso.destino_latitud},${caso.destino_longitud}`
        : encodeURIComponent(
            [caso.prestador_nombre, caso.lugar, caso.ciudad_nombre, caso.provincia_nombre]
              .filter(Boolean)
              .join(', '),
          )
    Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${destino}`).catch(() =>
      setAviso('No se pudo abrir el mapa en este teléfono.'),
    )
  }

  async function guardar() {
    const limpio = texto.trim()
    if (!limpio) return
    setGuardando(true)
    setAviso(null)
    try {
      const nota = await crearNota(caso.id, tipo, limpio)
      setNotas((previas) => [...(previas ?? []), nota])
      setTexto('')
    } catch (error) {
      setAviso(error instanceof ErrorDeApi ? error.message : 'No se pudo guardar la nota.')
    } finally {
      setGuardando(false)
    }
  }

  function confirmarBorrado(nota: Nota) {
    Alert.alert('Quitar la nota', `¿Quitar este dictado de ${ETIQUETA_TIPO[nota.tipo]}?`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Quitar',
        style: 'destructive',
        onPress: async () => {
          try {
            await eliminarNota(caso.id, nota.id)
            setNotas((previas) => (previas ?? []).filter((n) => n.id !== nota.id))
          } catch {
            setAviso('No se pudo quitar la nota.')
          }
        },
      },
    ])
  }

  // ── Las fotos del caso: expediente, resultados, estado de cuenta ──────────
  const [progresoFotos, setProgresoFotos] = useState<string | null>(null)

  async function tomarFoto() {
    const permiso = await ImagePicker.requestCameraPermissionsAsync()
    if (!permiso.granted) {
      setAviso('Sin permiso de cámara: actívalo en los ajustes del teléfono.')
      return
    }
    // En ráfaga: tras cada toma se sube y la cámara se reabre sola, hasta que
    // canceles. La cámara nativa solo entrega una foto por sesión.
    for (;;) {
      const resultado = await ImagePicker.launchCameraAsync({ quality: 0.7 })
      const activo = resultado.canceled ? null : resultado.assets?.[0]
      if (!activo) break
      await subirLote([activo])
    }
  }

  async function elegirFoto() {
    const resultado = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      // 0 = el máximo que permita el sistema.
      selectionLimit: 0,
      quality: 0.7,
    })
    if (!resultado.canceled && resultado.assets?.length) await subirLote(resultado.assets)
  }

  async function subirLote(activos: ImagePicker.ImagePickerAsset[]) {
    setSubiendoFoto(true)
    setAviso(null)
    let fallidas = 0
    let ultimo = ''
    for (const [indice, activo] of activos.entries()) {
      setProgresoFotos(
        activos.length > 1 ? `Subiendo ${indice + 1} de ${activos.length}…` : 'Subiendo foto…',
      )
      try {
        // El iPhone dispara y guarda en HEIC, que ni el servidor ni la IA
        // aceptan: TODA foto se convierte a JPEG aquí antes de subir. De paso
        // comprime y queda holgada bajo el tope de 5 MB por imagen.
        const dibujada = await ImageManipulator.manipulate(activo.uri).renderAsync()
        const jpeg = await dibujada.saveAsync({ format: SaveFormat.JPEG, compress: 0.7 })
        const foto = await subirFoto(caso.id, jpeg.uri)
        setFotos((previas) => [...(previas ?? []), foto])
      } catch (error) {
        fallidas += 1
        ultimo = error instanceof ErrorDeApi ? error.message : ''
      }
    }
    setProgresoFotos(null)
    setSubiendoFoto(false)
    if (fallidas > 0) {
      setAviso(
        ultimo ||
          (fallidas === 1
            ? 'Una foto no se pudo subir. Reintenta.'
            : `${fallidas} fotos no se pudieron subir. Reintenta.`),
      )
    }
  }

  function confirmarBorradoFoto(foto: FotoCaso) {
    Alert.alert('Quitar la foto', '¿Quitar esta foto del caso?', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Quitar',
        style: 'destructive',
        onPress: async () => {
          try {
            await eliminarFoto(caso.id, foto.id)
            setFotos((previas) => (previas ?? []).filter((f) => f.id !== foto.id))
          } catch {
            setAviso('No se pudo quitar la foto.')
          }
        },
      },
    ])
  }

  async function generar() {
    setGenerando(true)
    setAviso(null)
    try {
      const resultado = await generarInforme(caso.id)
      setInforme(resultado.informe)
    } catch (error) {
      setAviso(error instanceof ErrorDeApi ? error.message : 'La IA no respondió. Reintenta.')
    } finally {
      setGenerando(false)
    }
  }

  // Las correcciones dictadas tras revisar el informe: la IA aplica SOLO eso.
  async function aplicarCorrecciones() {
    const limpio = correccion.trim()
    if (!limpio) return
    setCorrigiendo(true)
    setAviso(null)
    setExito(null)
    try {
      const resultado = await corregirInforme(caso.id, limpio)
      setInforme(resultado.informe)
      setCorreccion('')
      setExito('Informe corregido. Revísalo y envíalo cuando estés conforme.')
    } catch (error) {
      setAviso(error instanceof ErrorDeApi ? error.message : 'No se pudo corregir. Reintenta.')
    } finally {
      setCorrigiendo(false)
    }
  }

  const [abriendoPdf, setAbriendoPdf] = useState(false)
  // El PDF en memoria mientras se ve (nunca en disco ni compartido).
  const [pdf, setPdf] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [exito, setExito] = useState<string | null>(null)
  // **Enviado, se bloquea** (27/10/2026, pedido del usuario): desde que se
  // confirma el envío y mientras sale —o ya salió— no se redacta, corrige ni
  // reenvía: así no viajan dos veces los mismos correos y PDF. Si el envío
  // falla, todo se desbloquea. Un caso ya culminado llega bloqueado.
  const [enviado, setEnviado] = useState(caso.estado === 'culminada')
  const enviandoRef = useRef(false)
  const bloqueado = enviando || enviado

  function confirmarEnvio() {
    if (bloqueado) return
    // Siempre llega a los fijos —quien creó el caso y las dos coordinaciones—;
    // los correos marcados del caso se suman si los hay (27/10/2026).
    const fijos =
      'el operador que creó el caso, la coordinación de la aseguradora y la de Accumedical'
    Alert.alert(
      'Enviar informe',
      caso.correos.length === 0
        ? `El PDF se enviará a ${fijos}.`
        : `El PDF se enviará a:\n\n${caso.correos
            .map((c) => (c.etiqueta ? `${c.email} (${c.etiqueta})` : c.email))
            .join('\n')}\n\n…y también a ${fijos}.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Enviar', onPress: mandar },
      ],
    )
  }

  async function mandar() {
    // Dos toques a «Enviar» antes de repintar no mandan dos veces.
    if (enviandoRef.current || enviado) return
    enviandoRef.current = true
    setEnviando(true)
    setAviso(null)
    setExito(null)
    try {
      const r = await enviarInforme(caso.id)
      setExito(
        r.destinatarios === 1
          ? 'Informe en camino a 1 correo.'
          : `Informe en camino a ${r.destinatarios} correos.`,
      )
      setEnviado(true)
    } catch (error) {
      setAviso(error instanceof ErrorDeApi ? error.message : 'No se pudo enviar. Reintenta.')
    } finally {
      enviandoRef.current = false
      setEnviando(false)
    }
  }

  async function verPdf() {
    setAbriendoPdf(true)
    setAviso(null)
    try {
      // Solo VER, nunca compartir (pedido del usuario): visor dentro de la app.
      setPdf(await leerInformePdf(caso.id))
    } catch {
      setAviso('No se pudo abrir el PDF. Reintenta.')
    } finally {
      setAbriendoPdf(false)
    }
  }

  // La regla del informe: exige LAS TRES notas. El backend la impone; aquí
  // solo se acompaña —botón apagado y una línea que dice qué falta—.
  const tiposPresentes = new Set((notas ?? []).map((n) => n.tipo))
  const faltantes = TIPOS.filter((t) => !tiposPresentes.has(t.valor))
  const puedeGenerar = notas !== null && faltantes.length === 0

  const cabecera = (
    <View style={estilos.topbar}>
      <Pressable onPress={onVolver} accessibilityRole="button" hitSlop={10}>
        <Ionicons name="chevron-back" size={24} color={colores.oro} />
      </Pressable>
      <View style={estilos.topbarCentro}>
        <Text style={estilos.titulo}>{caso.codigo_interno}</Text>
        <Text style={estilos.subtitulo} numberOfLines={1}>
          {caso.paciente_nombre_completo} · {caso.prestador_nombre}
        </Text>
      </View>
    </View>
  )

  // ── Etapa 1: la llegada ────────────────────────────────────────────────────
  if (etapa === 'llegada') {
    return (
      <View style={estilos.pantalla}>
        {cabecera}
        <ScrollView contentContainerStyle={estilos.contenido}>
          <View style={estilos.ficha}>
            <Text style={estilos.fichaTitulo}>{caso.paciente_nombre_completo}</Text>
            <Text style={estilos.fichaSub}>CI {caso.paciente_numero_documento}</Text>
            <View style={estilos.filaDato}>
              <Ionicons name="business-outline" size={15} color={colores.tenue} />
              <Text style={estilos.dato}>{caso.prestador_nombre}</Text>
            </View>
            <View style={estilos.filaDato}>
              <Ionicons name="location-outline" size={15} color={colores.tenue} />
              <Text style={estilos.dato}>
                {caso.sede_nombre ?? 'SEDE PRINCIPAL'}
                {[caso.ciudad_nombre, caso.provincia_nombre].filter(Boolean).length
                  ? ` · ${[caso.ciudad_nombre, caso.provincia_nombre].filter(Boolean).join(', ')}`
                  : ''}
                {caso.lugar ? `\n${caso.lugar}` : ''}
              </Text>
            </View>
            <View style={estilos.filaDato}>
              <Ionicons name="time-outline" size={15} color={colores.tenue} />
              <Text style={estilos.dato}>
                {cuando(caso.desde)} — {cuando(caso.hasta)}
              </Text>
            </View>
            {caso.observaciones && (
              <View style={estilos.filaDato}>
                <Ionicons name="document-text-outline" size={15} color={colores.tenue} />
                <Text style={estilos.dato}>{caso.observaciones}</Text>
              </View>
            )}
          </View>

          <Pressable onPress={abrirMapa} accessibilityRole="button" style={estilos.botonSecundario}>
            <Ionicons name="map-outline" size={18} color={colores.azul} />
            <Text style={estilos.botonSecundarioTexto}>Ver mapa</Text>
          </Pressable>
          <Pressable
            onPress={marcarLlegada}
            disabled={llegando}
            accessibilityRole="button"
            style={[estilos.boton, llegando && estilos.botonApagado]}
          >
            {llegando ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <>
                <Ionicons name="checkmark-circle-outline" size={18} color="#ffffff" />
                <Text style={estilos.botonTexto}>Ya llegué</Text>
              </>
            )}
          </Pressable>
          <Text style={estilos.pista}>
            Al llegar al hospital podrás dictar tus notas y pedir el informe.
          </Text>
          {aviso && <Text style={estilos.aviso}>{aviso}</Text>}
        </ScrollView>
      </View>
    )
  }

  // ── Etapa 2: el trabajo dentro del hospital ────────────────────────────────
  return (
    <KeyboardAvoidingView
      style={estilos.pantalla}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {cabecera}
      <VisorPdf
        base64={pdf}
        titulo={`Informe ${caso.codigo_interno}`}
        onCerrar={() => setPdf(null)}
      />
      <ScrollView contentContainerStyle={estilos.contenido} keyboardShouldPersistTaps="handled">
        <Text style={estilos.seccion}>Dictar una nota</Text>
        <View style={estilos.chips}>
          {TIPOS.map((t) => (
            <Pressable
              key={t.valor}
              onPress={() => setTipo(t.valor)}
              accessibilityRole="radio"
              accessibilityState={{ selected: tipo === t.valor }}
              style={[estilos.chip, tipo === t.valor && estilos.chipActivo]}
            >
              <Ionicons
                name={t.icono}
                size={14}
                color={tipo === t.valor ? '#ffffff' : colores.tenue}
              />
              <Text style={[estilos.chipTexto, tipo === t.valor && estilos.chipTextoActivo]}>
                {t.etiqueta}
              </Text>
              {tiposPresentes.has(t.valor) && (
                <Ionicons
                  name="checkmark-circle"
                  size={14}
                  color={tipo === t.valor ? '#ffffff' : colores.verde}
                />
              )}
            </Pressable>
          ))}
        </View>
        <Pressable
          onPress={() => alternarDictado('nota')}
          disabled={transcribiendo || (grabando && destinoDictado !== 'nota')}
          accessibilityRole="button"
          accessibilityLabel={
            grabando && destinoDictado === 'nota'
              ? 'Terminar el dictado'
              : 'Dictar con el micrófono'
          }
          style={[
            estilos.botonDictar,
            grabando && destinoDictado === 'nota' && estilos.botonDictarActivo,
            (transcribiendo || (grabando && destinoDictado !== 'nota')) &&
              estilos.botonApagado,
          ]}
        >
          {transcribiendo && destinoDictado === 'nota' ? (
            <>
              <ActivityIndicator color="#ffffff" />
              <Text style={estilos.botonTexto}>Transcribiendo…</Text>
            </>
          ) : (
            <>
              <Ionicons
                name={grabando && destinoDictado === 'nota' ? 'stop-circle' : 'mic'}
                size={20}
                color="#ffffff"
              />
              <Text style={estilos.botonTexto}>
                {grabando && destinoDictado === 'nota'
                  ? 'Grabando… toca para terminar'
                  : 'Dictar con el micrófono'}
              </Text>
            </>
          )}
        </Pressable>
        <TextInput
          value={texto}
          onChangeText={setTexto}
          multiline
          placeholder="Dicta con el micrófono y el texto aparecerá aquí solo; también puedes escribir…"
          placeholderTextColor={colores.tenue}
          style={estilos.caja}
        />
        <Pressable
          onPress={guardar}
          disabled={guardando || !texto.trim()}
          accessibilityRole="button"
          style={[estilos.boton, (guardando || !texto.trim()) && estilos.botonApagado]}
        >
          {guardando ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <Text style={estilos.botonTexto}>Guardar nota</Text>
          )}
        </Pressable>

        <Text style={estilos.seccion}>
          Notas del caso{notas ? ` (${notas.length})` : ''}
        </Text>
        {notas === null ? (
          <ActivityIndicator color={colores.oro} style={{ marginTop: espaciado.sm }} />
        ) : notas.length === 0 ? (
          <Text style={estilos.vacio}>
            Todavía no hay notas. Dicta el historial clínico, tu charla con el médico y tu
            observación; con eso la IA redactará el informe.
          </Text>
        ) : (
          notas.map((nota) => (
            <View key={nota.id} style={estilos.nota}>
              <View style={estilos.notaCabecera}>
                <Text style={estilos.notaTipo}>{ETIQUETA_TIPO[nota.tipo]}</Text>
                <Text style={estilos.notaHora}>{hora(nota.creada_at)}</Text>
                <Pressable
                  onPress={() => confirmarBorrado(nota)}
                  accessibilityRole="button"
                  accessibilityLabel="Quitar la nota"
                  hitSlop={8}
                >
                  <Ionicons name="trash-outline" size={16} color={colores.tenue} />
                </Pressable>
              </View>
              <Text style={estilos.notaTexto}>{nota.texto}</Text>
            </View>
          ))
        )}

        <Text style={estilos.seccion}>
          Fotos del caso{fotos ? ` (${fotos.length})` : ''}
        </Text>
        <Text style={estilos.vacio}>
          Expediente, resultados, estado de cuenta: lo que fotografíes entra al
          análisis de la IA junto a tus notas.
        </Text>
        <View style={estilos.filaBotones}>
          <Pressable
            onPress={tomarFoto}
            disabled={subiendoFoto}
            accessibilityRole="button"
            style={[estilos.botonMitad, subiendoFoto && estilos.botonApagado]}
          >
            <Ionicons name="camera-outline" size={17} color={colores.azul} />
            <Text style={estilos.botonSecundarioTexto}>Tomar foto</Text>
          </Pressable>
          <Pressable
            onPress={elegirFoto}
            disabled={subiendoFoto}
            accessibilityRole="button"
            style={[estilos.botonMitad, subiendoFoto && estilos.botonApagado]}
          >
            <Ionicons name="images-outline" size={17} color={colores.azul} />
            <Text style={estilos.botonSecundarioTexto}>De la galería</Text>
          </Pressable>
        </View>
        {subiendoFoto && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <ActivityIndicator color={colores.oro} />
            {progresoFotos && <Text style={estilos.vacio}>{progresoFotos}</Text>}
          </View>
        )}
        {fotos !== null && fotos.length > 0 && token && (
          <View style={estilos.fotosFila}>
            {fotos.map((foto) => (
              <View key={foto.id} style={estilos.fotoMarco}>
                {/* expo-image: el Image clásico de RN es poco fiable con
                    cabeceras de autorización y dejaba la miniatura en negro. */}
                <Image
                  source={{
                    uri: urlFoto(caso.id, foto.id),
                    headers: { Authorization: `Bearer ${token}` },
                  }}
                  contentFit="cover"
                  transition={120}
                  style={estilos.fotoMiniatura}
                />
                <Pressable
                  onPress={() => confirmarBorradoFoto(foto)}
                  accessibilityRole="button"
                  accessibilityLabel="Quitar la foto"
                  hitSlop={8}
                  style={estilos.fotoQuitar}
                >
                  <Ionicons name="close" size={13} color="#ffffff" />
                </Pressable>
              </View>
            ))}
          </View>
        )}

        <Text style={estilos.seccion}>Informe final</Text>
        {notas !== null && faltantes.length > 0 && (
          <Text style={estilos.vacio}>
            El informe exige las tres notas del caso. Falta dictar:{' '}
            {faltantes.map((t) => t.etiqueta).join(', ')}.
          </Text>
        )}
        <Pressable
          onPress={generar}
          disabled={generando || !puedeGenerar || bloqueado}
          accessibilityRole="button"
          style={[
            estilos.boton,
            estilos.botonIa,
            (generando || !puedeGenerar || bloqueado) && estilos.botonApagado,
          ]}
        >
          {generando ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <>
              <Ionicons name="sparkles-outline" size={16} color="#ffffff" />
              <Text style={estilos.botonTexto}>
                {informe ? 'Volver a redactar con IA' : 'Redactar informe con IA'}
              </Text>
            </>
          )}
        </Pressable>
        {informe && (
          <>
            <Pressable
              onPress={verPdf}
              disabled={abriendoPdf}
              accessibilityRole="button"
              style={[estilos.botonSecundario, abriendoPdf && estilos.botonApagado]}
            >
              {abriendoPdf ? (
                <ActivityIndicator color={colores.azul} />
              ) : (
                <>
                  <Ionicons name="document-attach-outline" size={18} color={colores.azul} />
                  <Text style={estilos.botonSecundarioTexto}>Ver el PDF</Text>
                </>
              )}
            </Pressable>
            {/* Revisado el informe, se manda con el PDF adjunto a los correos
                marcados del caso; antes se confirma enseñando a quiénes. */}
            <Pressable
              onPress={confirmarEnvio}
              disabled={bloqueado}
              accessibilityRole="button"
              style={[estilos.boton, bloqueado && estilos.botonApagado]}
            >
              {enviando ? (
                <ActivityIndicator color="#ffffff" />
              ) : (
                <>
                  <Ionicons
                    name={enviado ? 'checkmark-done-outline' : 'send-outline'}
                    size={16}
                    color="#ffffff"
                  />
                  <Text style={estilos.botonTexto}>
                    {enviado ? 'Informe enviado' : 'Enviar informe'}
                  </Text>
                </>
              )}
            </Pressable>
            {exito && <Text style={estilos.exito}>{exito}</Text>}
            {/* El texto completo no se pinta aquí: en pantalla se hace largo;
                el informe se revisa como va a salir, en su PDF de marca. */}
            <Text style={estilos.pista}>
              {enviado
                ? 'Informe enviado. Puedes verlo con «Ver el PDF».'
                : enviando
                  ? 'Enviando el informe…'
                  : 'Informe listo. Revísalo con «Ver el PDF».'}
            </Text>

            {/* Revisado el informe, lo que falte o esté mal se dicta aquí: la
                IA aplica SOLO esas correcciones y no toca el resto. Mientras
                se envía, o ya enviado, no se corrige: se oculta. */}
            {!bloqueado && (
              <>
                <Text style={estilos.seccion}>Corregir el informe</Text>
                <Text style={estilos.vacio}>
                  Dicta lo que falte o deba cambiar: «la edad es 54», «el género es
                  masculino», «en comentarios que diga X en vez de Y». La IA aplica
                  solo eso y conserva el resto tal cual.
                </Text>
                <Pressable
                  onPress={() => alternarDictado('correccion')}
                  disabled={transcribiendo || (grabando && destinoDictado !== 'correccion')}
                  accessibilityRole="button"
                  accessibilityLabel={
                    grabando && destinoDictado === 'correccion'
                      ? 'Terminar el dictado'
                      : 'Dictar la corrección'
                  }
                  style={[
                    estilos.botonDictar,
                    grabando && destinoDictado === 'correccion' && estilos.botonDictarActivo,
                    (transcribiendo || (grabando && destinoDictado !== 'correccion')) &&
                      estilos.botonApagado,
                  ]}
                >
                  {transcribiendo && destinoDictado === 'correccion' ? (
                    <>
                      <ActivityIndicator color="#ffffff" />
                      <Text style={estilos.botonTexto}>Transcribiendo…</Text>
                    </>
                  ) : (
                    <>
                      <Ionicons
                        name={
                          grabando && destinoDictado === 'correccion' ? 'stop-circle' : 'mic'
                        }
                        size={20}
                        color="#ffffff"
                      />
                      <Text style={estilos.botonTexto}>
                        {grabando && destinoDictado === 'correccion'
                          ? 'Grabando… toca para terminar'
                          : 'Dictar la corrección'}
                      </Text>
                    </>
                  )}
                </Pressable>
                <TextInput
                  value={correccion}
                  onChangeText={setCorreccion}
                  multiline
                  placeholder="Dicta o escribe las correcciones aquí…"
                  placeholderTextColor={colores.tenue}
                  style={[estilos.caja, estilos.cajaCorreccion]}
                />
                <Pressable
                  onPress={aplicarCorrecciones}
                  disabled={corrigiendo || !correccion.trim()}
                  accessibilityRole="button"
                  style={[
                    estilos.boton,
                    estilos.botonIa,
                    (corrigiendo || !correccion.trim()) && estilos.botonApagado,
                  ]}
                >
                  {corrigiendo ? (
                    <ActivityIndicator color="#ffffff" />
                  ) : (
                    <>
                      <Ionicons name="color-wand-outline" size={16} color="#ffffff" />
                      <Text style={estilos.botonTexto}>Aplicar correcciones</Text>
                    </>
                  )}
                </Pressable>
              </>
            )}
          </>
        )}

        {aviso && <Text style={estilos.aviso}>{aviso}</Text>}
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

function crearEstilos(c: Paleta) {
  return StyleSheet.create({
    pantalla: { flex: 1, backgroundColor: c.fondo },
    topbar: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: espaciado.sm,
      paddingHorizontal: espaciado.md,
      paddingTop: 54,
      paddingBottom: espaciado.sm,
      backgroundColor: c.superficie,
      borderBottomWidth: 1,
      borderBottomColor: c.borde,
    },
    topbarCentro: { flex: 1, minWidth: 0 },
    titulo: { fontSize: 16, fontWeight: '700', color: c.tinta },
    subtitulo: { fontSize: 12, color: c.tenue },
    contenido: { padding: espaciado.md, paddingBottom: 60, gap: espaciado.sm },
    ficha: {
      backgroundColor: c.superficie,
      borderWidth: 1,
      borderColor: c.borde,
      borderRadius: 14,
      padding: espaciado.md,
      gap: 6,
    },
    fichaTitulo: { fontSize: 17, fontWeight: '700', color: c.tinta },
    fichaSub: { fontSize: 13, color: c.oro, fontWeight: '600' },
    filaDato: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', marginTop: 2 },
    dato: { flex: 1, fontSize: 13, color: c.tinta, lineHeight: 18 },
    seccion: {
      fontSize: 12,
      fontWeight: '800',
      letterSpacing: 1,
      color: c.tenue,
      textTransform: 'uppercase',
      marginTop: espaciado.sm,
    },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      borderWidth: 1,
      borderColor: c.borde,
      borderRadius: 16,
      paddingHorizontal: 11,
      paddingVertical: 6,
      backgroundColor: c.superficie,
    },
    chipActivo: { backgroundColor: c.azul, borderColor: c.azul },
    chipTexto: { fontSize: 12.5, fontWeight: '600', color: c.tenue },
    chipTextoActivo: { color: '#ffffff' },
    caja: {
      minHeight: 110,
      borderWidth: 1,
      borderColor: c.borde,
      borderRadius: 12,
      backgroundColor: c.superficie,
      color: c.tinta,
      padding: espaciado.sm,
      fontSize: 15,
      lineHeight: 21,
      textAlignVertical: 'top',
    },
    boton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 7,
      backgroundColor: c.azul,
      borderRadius: 12,
      paddingVertical: 12,
    },
    botonIa: { backgroundColor: c.oro },
    botonDictar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      backgroundColor: c.azul,
      borderRadius: 12,
      paddingVertical: 13,
    },
    botonDictarActivo: { backgroundColor: c.rojo },
    botonApagado: { opacity: 0.45 },
    botonTexto: { color: '#ffffff', fontSize: 15, fontWeight: '700' },
    botonSecundario: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 7,
      borderWidth: 1.5,
      borderColor: c.azul,
      backgroundColor: c.superficie,
      borderRadius: 12,
      paddingVertical: 12,
      marginTop: espaciado.sm,
    },
    botonSecundarioTexto: { color: c.azul, fontSize: 15, fontWeight: '700' },
    filaBotones: { flexDirection: 'row', gap: espaciado.sm },
    cajaCorreccion: { minHeight: 80 },
    botonMitad: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      borderWidth: 1.5,
      borderColor: c.azul,
      backgroundColor: c.superficie,
      borderRadius: 12,
      paddingVertical: 11,
    },
    fotosFila: { flexDirection: 'row', flexWrap: 'wrap', gap: espaciado.sm },
    fotoMarco: { position: 'relative' },
    fotoMiniatura: {
      width: 84,
      height: 84,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: c.borde,
      backgroundColor: c.superficie,
    },
    fotoQuitar: {
      position: 'absolute',
      top: -6,
      right: -6,
      width: 22,
      height: 22,
      borderRadius: 11,
      backgroundColor: c.rojo,
      alignItems: 'center',
      justifyContent: 'center',
    },
    pista: { fontSize: 12.5, color: c.tenue, textAlign: 'center', marginTop: 2 },
    vacio: { fontSize: 13, color: c.tenue, lineHeight: 19 },
    nota: {
      backgroundColor: c.superficie,
      borderWidth: 1,
      borderColor: c.borde,
      borderRadius: 12,
      padding: espaciado.sm,
      gap: 4,
    },
    notaCabecera: { flexDirection: 'row', alignItems: 'center', gap: espaciado.sm },
    notaTipo: { fontSize: 12, fontWeight: '700', color: c.oro, flex: 1 },
    notaHora: { fontSize: 11, color: c.tenue, fontVariant: ['tabular-nums'] },
    notaTexto: { fontSize: 14, color: c.tinta, lineHeight: 20 },
    aviso: { fontSize: 13, color: c.naranja, lineHeight: 19, marginTop: 4 },
    exito: { fontSize: 13, color: c.verde, fontWeight: '600', lineHeight: 19 },
  })
}
