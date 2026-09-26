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


def transcribir(ruta: str) -> str:
    """
    El audio a texto, en español. Serializado con un candado: la transcripción
    satura CPU y dos a la vez solo se estorban. Nunca se loguea el contenido.
    """
    try:
        with _candado:
            modelo = _cargar()
            segmentos, _info = modelo.transcribe(ruta, language="es", vad_filter=True)
            texto = " ".join(s.text.strip() for s in segmentos).strip()
    except Exception as error:  # noqa: BLE001
        log.warning("stt_fallido", error=type(error).__name__)
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            detail="No se pudo transcribir el dictado. Inténtalo de nuevo",
        ) from error
    return texto
