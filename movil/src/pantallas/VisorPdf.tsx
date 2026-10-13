import { Modal, Pressable, StyleSheet, Text, View } from 'react-native'
import { WebView } from 'react-native-webview'

import { paletas } from '../tema'

/**
 * Ver el informe en PDF DENTRO de la app, sin compartirlo (pedido del usuario:
 * «es solo ver, no debe compartirse»). Ni menú de compartir, ni descarga, ni
 * copia que quede en el teléfono: quien llama borra el archivo apenas lo lee y
 * aquí solo viaja su contenido en memoria.
 *
 * Se dibuja con pdf.js (Mozilla) dentro de una WebView: versión FIJA de cdnjs
 * verificada con SRI —también el worker, que se baja con `fetch` + `integrity`
 * y se ejecuta desde memoria—, `isEvalSupported: false` (mitiga CVE-2024-4367)
 * y ninguna navegación fuera de la página.
 */
const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174'
const SRI_PDF = 'sha384-/1qUCSGwTur9vjf/z9lmu/eCUYbpOTgSjmpbMQZ1/CtX2v/WcAIKqRv+U1DUCG6e'
const SRI_WORKER = 'sha384-SnzOobpRMLXZ52iJvZm/C0fYw0OQemTXzTjIsdsfMcrCtCEe9qgzxTd3RSklO5x2'

const HTML = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=4">
<style>body{margin:0;background:#525659;-webkit-user-select:none;user-select:none}
canvas{display:block;margin:10px auto;width:calc(100% - 20px);height:auto;background:#fff;box-shadow:0 1px 4px rgba(0,0,0,.4)}
#e{color:#fff;font:15px sans-serif;padding:24px;text-align:center}</style>
<script src="${PDFJS}/pdf.min.js" integrity="${SRI_PDF}" crossorigin="anonymous"></script></head>
<body oncontextmenu="return false"><div id="e">Cargando el informe…</div><script>
(async () => {
  const aviso = document.getElementById('e')
  try {
    const w = await fetch('${PDFJS}/pdf.worker.min.js', { integrity: '${SRI_WORKER}' })
    pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(await w.blob())
    const datos = Uint8Array.from(atob(window.PDF_B64), (c) => c.charCodeAt(0))
    window.PDF_B64 = null
    const pdf = await pdfjsLib.getDocument({ data: datos, isEvalSupported: false }).promise
    aviso.remove()
    for (let i = 1; i <= pdf.numPages; i++) {
      const pagina = await pdf.getPage(i)
      const escala = (window.innerWidth * (window.devicePixelRatio || 1)) / pagina.getViewport({ scale: 1 }).width
      const vista = pagina.getViewport({ scale: escala })
      const lienzo = document.createElement('canvas')
      lienzo.width = vista.width
      lienzo.height = vista.height
      document.body.appendChild(lienzo)
      await pagina.render({ canvasContext: lienzo.getContext('2d'), viewport: vista }).promise
    }
  } catch (x) {
    aviso.textContent = 'No se pudo mostrar el PDF. Revisa la conexión y vuelve a intentarlo.'
  }
})()
</script></body></html>`

export function VisorPdf({
  base64,
  titulo,
  onCerrar,
}: {
  base64: string | null
  titulo: string
  onCerrar: () => void
}) {
  return (
    <Modal visible={base64 !== null} animationType="slide" onRequestClose={onCerrar}>
      <View style={estilos.cabecera}>
        <Text style={estilos.titulo} numberOfLines={1}>
          {titulo}
        </Text>
        <Pressable onPress={onCerrar} accessibilityRole="button" hitSlop={12}>
          <Text style={estilos.cerrar}>Cerrar</Text>
        </Pressable>
      </View>
      {base64 !== null && (
        <WebView
          source={{ html: HTML }}
          injectedJavaScriptBeforeContentLoaded={`window.PDF_B64=${JSON.stringify(base64)};true;`}
          originWhitelist={['about:*']}
          // Solo la propia página: ningún enlace del PDF abre nada.
          onShouldStartLoadWithRequest={(r) => r.url === 'about:blank' || r.url.startsWith('about:')}
          setSupportMultipleWindows={false}
          allowFileAccess={false}
          allowsLinkPreview={false}
          textInteractionEnabled={false}
          style={estilos.web}
        />
      )}
    </Modal>
  )
}

const estilos = StyleSheet.create({
  cabecera: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 48,
    paddingBottom: 14,
    backgroundColor: paletas.claro.azul,
  },
  titulo: { color: '#fff', fontSize: 16, fontWeight: '600', flex: 1, marginRight: 12 },
  cerrar: { color: '#fff', fontSize: 15, fontWeight: '600' },
  web: { flex: 1, backgroundColor: '#525659' },
})
