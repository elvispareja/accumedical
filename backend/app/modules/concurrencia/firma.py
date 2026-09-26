from __future__ import annotations

import threading
from io import BytesIO
from pathlib import Path

from fastapi import HTTPException, status

from app.core.config import settings
from app.core.logging import log

# Firma electrónica PAdES sobre el PDF del informe, con el .p12 de la empresa
# (Registro Civil, Security Data, Uanataca…). No es una imagen: es la firma
# criptográfica que Adobe verifica —quién firmó, cuándo, y si el documento fue
# alterado después—. Sin certificado configurado, el PDF sale tal cual: en
# desarrollo no debe hacer falta un certificado para trabajar.
#
# El certificado sale de UNO de dos sitios, en este orden:
#  1. El entorno (FIRMA_P12_PATH + FIRMA_P12_PASSWORD): manda si está puesto.
#  2. Lo subido por el superadmin en Configuración: el .p12 y la contraseña
#     CIFRADA (core/security/cifrado, llave derivada del SECRET_KEY) viven en
#     el volumen de subidas, fuera del repositorio y de la base.

RUTA_P12_SUBIDO = "firma/accumedical.p12"
RUTA_CLAVE_SUBIDA = "firma/accumedical.clave"

# El certificado se carga UNA vez y se reusa mientras el archivo no cambie: la
# huella (ruta, mtime, tamaño) hace que un .p12 recién subido desde el panel se
# recargue solo, también con varios workers.
_candado = threading.Lock()
_firmante = None
_huella: tuple[str, int, int] | None = None

_ERROR_CONFIG = (
    "La firma electrónica está configurada pero no se pudo cargar el certificado: "
    "revisa el .p12 y su contraseña en Configuración (o FIRMA_P12_* del servidor)"
)


def _config_actual() -> tuple[Path, str] | None:
    """La pareja (ruta del .p12, contraseña) vigente, o None si no hay firma."""
    if settings.firma_p12_path:
        return Path(settings.firma_p12_path), settings.firma_p12_password.get_secret_value()
    p12 = Path(settings.upload_dir) / RUTA_P12_SUBIDO
    clave = Path(settings.upload_dir) / RUTA_CLAVE_SUBIDA
    if p12.is_file() and clave.is_file():
        from app.core.security import cifrado

        try:
            return p12, cifrado.descifrar(clave.read_bytes())
        except Exception as error:  # InvalidToken: archivo manipulado o SECRET_KEY distinto
            log.error("firma_clave_fallo", error=type(error).__name__)
            raise HTTPException(
                status.HTTP_500_INTERNAL_SERVER_ERROR, detail=_ERROR_CONFIG
            ) from error
    return None


def validar_certificado(datos_p12: bytes, contrasena: str) -> str:
    """
    Comprueba EN MEMORIA que el archivo es un .p12 de verdad y que la
    contraseña lo abre, ANTES de guardar nada. Devuelve el nombre del titular
    para enseñarlo en la pantalla. Lanza ValueError si no abre.
    """
    from cryptography.hazmat.primitives.serialization import pkcs12
    from cryptography.x509.oid import NameOID

    llave, certificado, _extra = pkcs12.load_key_and_certificates(
        datos_p12, contrasena.encode() or None
    )
    if llave is None or certificado is None:
        raise ValueError("el .p12 no trae llave y certificado")
    atributos = certificado.subject.get_attributes_for_oid(NameOID.COMMON_NAME)
    return str(atributos[0].value) if atributos else "(certificado sin nombre)"


def _cargar_firmante(ruta: Path, contrasena: str):
    global _firmante, _huella  # noqa: PLW0603 - caché deliberada del certificado
    if not ruta.is_file():
        log.error("firma_p12_fallo", error="ArchivoNoEncontrado")
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, detail=_ERROR_CONFIG)
    datos = ruta.stat()
    huella = (str(ruta), datos.st_mtime_ns, datos.st_size)
    if _firmante is not None and _huella == huella:
        return _firmante
    with _candado:
        if _firmante is not None and _huella == huella:
            return _firmante
        # Import perezoso: pyhanko es pesado y solo hace falta al firmar.
        from pyhanko.sign import signers

        try:
            clave = contrasena.encode() or None
            firmante = signers.SimpleSigner.load_pkcs12(pfx_file=str(ruta), passphrase=clave)
        except Exception as error:
            # Jamás la contraseña ni el certificado al log: solo el tipo de fallo.
            log.error("firma_p12_fallo", error=type(error).__name__)
            raise HTTPException(
                status.HTTP_500_INTERNAL_SERVER_ERROR, detail=_ERROR_CONFIG
            ) from error
        if firmante is None:
            log.error("firma_p12_fallo", error="ContrasenaOArchivoInvalido")
            raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, detail=_ERROR_CONFIG)
        _firmante = firmante
        _huella = huella
        return firmante


def firmar(pdf: bytes) -> bytes:
    """
    Devuelve el PDF firmado (PAdES) con un sello visible al pie de la última
    página —junto a la línea del responsable—; sin certificado configurado,
    el mismo PDF sin tocar.
    """
    config = _config_actual()
    if config is None:
        return pdf
    ruta, contrasena = config

    from pyhanko.pdf_utils.incremental_writer import IncrementalPdfFileWriter
    from pyhanko.sign import signers
    from pyhanko.sign.fields import SigFieldSpec
    from pyhanko.stamp import TextStampStyle

    firmante = _cargar_firmante(ruta, contrasena)
    try:
        escritor = IncrementalPdfFileWriter(BytesIO(pdf))
        firmador = signers.PdfSigner(
            signature_meta=signers.PdfSignatureMetadata(
                field_name="FirmaAccumedical",
                reason="Informe de auditoría médica concurrente",
            ),
            signer=firmante,
            # Última página, esquina inferior izquierda, POR ENCIMA del pie de
            # página: el sello visible con firmante y fecha, en español.
            new_field_spec=SigFieldSpec(
                sig_field_name="FirmaAccumedical", on_page=-1, box=(36, 40, 306, 88)
            ),
            stamp_style=TextStampStyle(
                stamp_text="Firmado electrónicamente por:\n%(signer)s\nFecha: %(ts)s",
                border_width=1,
            ),
        )
        salida = firmador.sign_pdf(escritor)
        return salida.getvalue()
    except HTTPException:
        raise
    except Exception as error:  # noqa: BLE001 - el detalle real va al log
        log.error("firma_pdf_fallo", error=type(error).__name__)
        raise HTTPException(
            status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="No se pudo firmar el PDF del informe. Inténtalo de nuevo",
        ) from error
