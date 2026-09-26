from __future__ import annotations

import httpx
from fastapi import HTTPException, status

from app.core.config import settings
from app.core.logging import log

# El único destino posible. Fijo en código, jamás de configuración de usuario ni
# de una petición: no hay SSRF que valga sobre una constante (A10).
URL_ANTHROPIC = "https://api.anthropic.com/v1/messages"

# Los tipos EXIGIDOS para redactar el informe (la regla de las tres notas).
ETIQUETA_TIPO = {
    "historial_clinico": "Historial clínico del paciente",
    "charla_medico": "Charla con el médico tratante",
    "observacion": "Observación del auditor",
}

# Para etiquetar lo dictado también valen los tipos de legado: un caso viejo
# con charla de enfermería la manda a la IA con su nombre, no con su código.
_ETIQUETAS = {**ETIQUETA_TIPO, "charla_enfermeria": "Charla con enfermería"}

# El molde sale de los informes reales de auditoría concurrente de la compañía
# (Dra. Pareja): mismas secciones, mismo orden, mismo tono clínico-administrativo.
INSTRUCCION = """Eres el asistente de redacción de auditoría médica de Accumedical (Accurate \
Billing & Medical Audit S.A.). Recibes los datos exactos de un caso y las notas que un médico \
auditor dictó durante su visita de concurrencia hospitalaria. Con ellas redactas, en español y \
en texto plano SIN Markdown (nada de #, *, guiones decorativos), el INFORME DE VISITA MÉDICA \
RECURRENTE, con EXACTAMENTE estas secciones, con sus títulos en MAYÚSCULAS, en este orden:

DATOS GENERALES
PACIENTE: …
POLIZA: …
CI.: …
GENERO: …
EDAD: …
FECHA DE INGRESO: …
CENTRO HOSPITALARIO: …
SOLICITADO POR: …
FECHA DE LA SOLICITUD: …

ANTECEDENTES PERSONALES:
ANTECEDENTES FAMILIARES:
ALERGIAS:
ANTECEDENTES QUIRURGICOS:
ENFERMEDAD ACTUAL
DIAGNOSTICOS INGRESO Y DEFINITIVO
CIRUGIA PROGRAMADA - REALIZADA:
EXAMENES REALIZADOS
LABORATORIO
IMAGEN
COMENTARIOS:
CUENTA
ANALISIS:

Reglas, en orden de importancia:
1. FIDELIDAD ABSOLUTA: usa solo lo dictado y los datos del caso. No inventes cifras, fármacos, \
diagnósticos ni evoluciones. Un dato que no consta se escribe exactamente «No consta en el \
dictado.» (en ALERGIAS: «No refiere» solo si el dictado lo dice).
2. DATOS GENERALES: el paciente, la cédula (CI.) y el centro hospitalario salen de los datos \
del caso; póliza, género, edad, fecha de ingreso hospitalario, solicitante y fecha de solicitud \
solo si el dictado los menciona.
3. ENFERMEDAD ACTUAL: empieza con «MC.: …» (el motivo de consulta) y sigue con la narración \
clínica ordenada cronológicamente, redactada en tercera persona, limpiando muletillas y \
repeticiones propias del dictado.
4. DIAGNOSTICOS: un diagnóstico por línea. Antepón el código CIE-10 solo cuando sea inequívoco \
para ese diagnóstico exacto (p. ej. «L03.3 Celulitis del tronco»); si dudas, escribe el \
diagnóstico sin código.
5. EXAMENES REALIZADOS: bajo LABORATORIO transcribe los valores dictados tal cual, con sus \
fechas; bajo IMAGEN los estudios y sus hallazgos. Si no hay, «No constan exámenes en el dictado.»
6. COMENTARIOS: la evolución observada en la visita y el ANÁLISIS CLÍNICO DE AUDITORÍA: \
pertinencia de la hospitalización y del manejo, correlación clínico-imagenológica, criterios de \
gravedad o su ausencia, y lo que queda pendiente. Es la sección donde razonas como auditor \
médico, siempre anclado a lo dictado.
7. CUENTA: si el dictado trae rubros y valores, lístalos uno por línea «RUBRO VALOR» y cierra \
con «TOTAL de estado de cuenta actual: … USD»; si no, «No se dictó estado de cuenta.»
8. ANALISIS: el veredicto de glosas. Si no hay objeciones: «Hasta el momento no se evidencian \
glosas.» Si las hay, enuncia con precisión qué se objeta y por qué, como haría un auditor.
9. FOTOS: si el mensaje trae imágenes, son fotos que el auditor tomó en el hospital (hojas del \
expediente, resultados de laboratorio o imagen, estados de cuenta). Trátalas como dictado \
adicional con la misma fidelidad: transcribe a su sección lo que se LEA con claridad (valores a \
LABORATORIO, rubros y montos a CUENTA, hallazgos a donde correspondan) y NUNCA inventes lo \
ilegible; si una imagen no se entiende, ignórala sin comentarlo.
10. No firmes ni añadas responsable: el sistema lo agrega con el nombre real del auditor."""


# Correcciones sobre un informe ya redactado: lo que el auditor dicte tras
# revisar el resultado ES la autoridad, y todo lo demás queda intacto.
INSTRUCCION_CORRECCION = """Eres el asistente de redacción de auditoría médica de Accumedical \
(Accurate Billing & Medical Audit S.A.). Recibes un INFORME DE VISITA MÉDICA RECURRENTE ya \
redactado y las CORRECCIONES que dicta el médico auditor tras revisarlo. Devuelves el informe \
COMPLETO ya corregido, en texto plano SIN Markdown, conservando las mismas secciones, en el \
mismo orden y con los títulos en MAYÚSCULAS.

Reglas, en orden de importancia:
1. Las correcciones del auditor son LA AUTORIDAD: lo que corrige o añade (una edad, un género, \
una fecha, una cifra, una redacción) se aplica tal cual en su sección, aunque el informe dijera \
«No consta en el dictado.»
2. NO toques nada que las correcciones no pidan: el resto del informe se conserva palabra por \
palabra.
3. «Que diga X en vez de Y» es un reemplazo exacto: X va donde estaba Y, y solo ahí.
4. Una corrección ininteligible, o que no encuentre a qué parte del informe aplica, se ignora \
sin comentarla; jamás inventes para completarla.
5. Devuelve SOLO el informe corregido: sin preámbulos, sin comentarios sobre lo que cambiaste y \
sin firma, que la agrega el sistema."""


def preparar_foto(contenido: bytes) -> tuple[str, str] | None:
    """
    Normaliza una foto del caso para la API de visión: la reduce a lo que
    Claude usa de verdad (1568 px de lado mayor; más píxeles los descarta él
    mismo) y la re-encoda a JPEG liviano. Así ninguna foto rompe los límites
    de la API (5 MB / 8000 px por imagen — los iPhone en 48 MP los superan) y
    el request entero queda ligero aunque haya muchas. Devuelve
    `(media_type, base64)`; una imagen que PIL no pueda abrir se salta con
    None: el informe jamás se cae por una foto rota.
    """
    import base64
    from io import BytesIO

    from PIL import Image, ImageOps

    try:
        imagen = Image.open(BytesIO(contenido))
        # La orientación del teléfono viene en EXIF: sin esto, la IA leería
        # documentos acostados.
        imagen = ImageOps.exif_transpose(imagen)
        imagen.thumbnail((1568, 1568))
        if imagen.mode not in ("RGB", "L"):
            imagen = imagen.convert("RGB")
        salida = BytesIO()
        imagen.save(salida, format="JPEG", quality=80)
        return "image/jpeg", base64.b64encode(salida.getvalue()).decode("ascii")
    except Exception:  # noqa: BLE001 - una foto rota no tumba el informe
        log.warning("informe_foto_descartada")
        return None


def _pedir(instruccion: str, contenido: list[dict]) -> str:
    """Una vuelta a Claude con los guards de siempre; el texto o una excepción clara."""
    clave = settings.claude_api_key.get_secret_value().strip()
    if not clave:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=(
                "La redacción con IA todavía no está configurada: falta la clave "
                "de Claude en el servidor (CLAUDE_API_KEY)"
            ),
        )
    try:
        respuesta = httpx.post(
            URL_ANTHROPIC,
            headers={
                "x-api-key": clave,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            json={
                "model": settings.claude_model,
                # Holgado: un informe completo ronda 2000 tokens, pero con
                # muchas fotos transcritas (laboratorios, cuentas) ya chocó el
                # tope dos veces; cortarlo deja el PDF sin CUENTA ni ANALISIS.
                "max_tokens": 16000,
                "system": instruccion,
                "messages": [{"role": "user", "content": contenido}],
            },
            timeout=settings.claude_timeout_sec,
        )
        respuesta.raise_for_status()
        cuerpo = respuesta.json()
        if cuerpo.get("stop_reason") == "max_tokens":
            raise ValueError("respuesta truncada")
        texto = "".join(
            bloque.get("text", "") for bloque in cuerpo.get("content", [])
        ).strip()
        if not texto:
            raise ValueError("respuesta sin texto")
        return texto
    except HTTPException:
        raise
    except Exception as error:  # noqa: BLE001 - el detalle real va al log, sin datos clínicos
        # A09: nunca las notas ni el informe al log; solo la clase del fallo.
        log.warning("informe_ia_fallido", error=type(error).__name__)
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            detail="La IA no pudo redactar el informe en este momento. Inténtalo de nuevo",
        ) from error


def redactar(
    datos_caso: str,
    notas: list[tuple[str, str]],
    fotos: list[tuple[str, str]] | None = None,
) -> str:
    """
    Manda las notas —y las fotos del caso, si las hay, como bloques de imagen
    `(media_type, base64)`— a Claude y devuelve el informe redactado. Sin clave
    configurada responde 503 con un mensaje claro: el panel sigue sirviendo
    para dictar, y el informe llegará cuando la clave esté en el entorno.
    """
    partes = [f"DATOS DEL CASO:\n{datos_caso}", ""]
    for tipo, texto in notas:
        partes += [f"[{_ETIQUETAS.get(tipo, tipo)}]", texto.strip(), ""]

    # Las fotos van ANTES del texto, como manda la guía de la API: primero lo
    # que hay que mirar, después la instrucción de qué hacer con ello.
    contenido: list[dict] = [
        {
            "type": "image",
            "source": {"type": "base64", "media_type": media_type, "data": datos_b64},
        }
        for media_type, datos_b64 in (fotos or [])
    ]
    contenido.append({"type": "text", "text": "\n".join(partes)})
    return _pedir(INSTRUCCION, contenido)


def corregir(informe_actual: str, instrucciones: str) -> str:
    """
    Aplica al informe las correcciones dictadas por el auditor —«la edad es 54»,
    «que diga X en vez de Y»— y devuelve el informe completo corregido.
    """
    contenido = [
        {
            "type": "text",
            "text": (
                f"INFORME ACTUAL:\n{informe_actual}\n\n"
                f"CORRECCIONES DEL AUDITOR:\n{instrucciones.strip()}"
            ),
        }
    ]
    return _pedir(INSTRUCCION_CORRECCION, contenido)
