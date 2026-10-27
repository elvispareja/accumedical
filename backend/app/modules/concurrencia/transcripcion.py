from __future__ import annotations

import os
import threading
from pathlib import Path

from fastapi import HTTPException, status

from app.core.config import settings
from app.core.logging import log

# Whisper local (faster-whisper, CPU): el dictado del auditor es dato clínico y
# se transcribe EN este servidor, jamás en un servicio externo. El modelo se
# descarga una única vez al volumen de subidas y sobrevive a los reinicios.

_candado = threading.Lock()
_modelo = None


def _cargar():
    global _modelo
    if _modelo is None:
        destino = Path(settings.upload_dir) / ".modelos-stt"
        destino.mkdir(parents=True, exist_ok=True)
        # La caché de huggingface_hub cae por defecto en ~/.cache, que el
        # usuario no root del contenedor no puede escribir. Debe fijarse ANTES
        # del import: la librería lee HF_HOME al importarse.
        os.environ.setdefault("HF_HOME", str(destino / "hf"))

        # Import perezoso: el arranque del proceso no paga los ~2 s de CTranslate2.
        from faster_whisper import WhisperModel
        _modelo = WhisperModel(
            settings.stt_modelo, device="cpu", compute_type="int8", download_root=str(destino)
        )
    return _modelo


def precalentar() -> None:
    """
    Descarga y carga el modelo en un hilo aparte al arrancar: la primera vez son
    cientos de MB y no debe bloquear ni el arranque ni el healthcheck. Si un
    dictado llega antes de tiempo, simplemente espera el candado.
    """

    def _tarea() -> None:
        try:
            with _candado:
                _cargar()
            log.info("stt_listo", modelo=settings.stt_modelo)
        except Exception as error:  # noqa: BLE001 - el detalle al log, no al usuario
            log.warning("stt_no_disponible", error=type(error).__name__)

    threading.Thread(target=_tarea, daemon=True).start()


#: Por debajo de este pico el audio es silencio digital: el teléfono no grabó.
_PICO_MUDO = 0.001


def _registrar_silencio(ruta: str) -> float | None:
    """
    Sin texto: ¿el audio vino mudo (el teléfono no grabó) o había voz y el
    filtro de voz la descartó? Se registra la duración y el PICO de amplitud
    (0 = silencio total, 1 = máximo), nunca el contenido. Devuelve el pico, o
    `None` si no se pudo medir.
    """
    try:
        from faster_whisper import decode_audio

        muestras = decode_audio(ruta)
        pico = float(abs(muestras).max()) if len(muestras) else 0.0
        log.info("stt_sin_voz", segundos=round(len(muestras) / 16000, 1), pico=round(pico, 4))
        return pico
    except Exception as error:  # noqa: BLE001 - es solo diagnóstico
        log.warning("stt_sin_voz_no_medido", error=type(error).__name__)
        return None


def transcribir(ruta: str) -> str:
    """
    El audio a texto, en español. Serializado con un candado: la transcripción
    satura CPU y dos a la vez solo se estorban. Nunca se loguea el contenido.
    """
    pico = None
    try:
        with _candado:
            modelo = _cargar()
            segmentos, _info = modelo.transcribe(ruta, language="es", vad_filter=True)
            texto = " ".join(s.text.strip() for s in segmentos).strip()
            if not texto:
                pico = _registrar_silencio(ruta)
    except Exception as error:  # noqa: BLE001
        log.warning("stt_fallido", error=type(error).__name__)
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            detail="No se pudo transcribir el dictado. Inténtalo de nuevo",
        ) from error
    # Silencio DIGITAL (27/10/2026): no es que se hablara bajo, es que el
    # teléfono no entregó sonido. Casi siempre el interruptor «Acceso al
    # micrófono» de Android o el permiso de la app: se dice tal cual.
    if pico is not None and pico < _PICO_MUDO:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                "El teléfono envió el audio en silencio total: el micrófono no está "
                "captando. Revisa que «Acceso al micrófono» esté activado en los ajustes "
                "rápidos y que la app tenga permiso de micrófono, y que ninguna otra app "
                "lo esté usando."
            ),
        )
    return texto
