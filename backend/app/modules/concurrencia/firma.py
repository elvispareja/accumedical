from __future__ import annotations

import datetime as dt
import threading
from io import BytesIO
from pathlib import Path
from zoneinfo import ZoneInfo

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


def titular_actual() -> str | None:
    """El nombre (CN) del certificado con el que se firma hoy; None sin firma."""
    config = _config_actual()
    if config is None:
        return None
    certificado = _cargar_firmante(*config).signing_cert
    nombre = certificado.subject.native.get("common_name")
    return str(nombre)[:200] if nombre else "(certificado sin nombre)"


# El sello visible, como el de FirmaEC: un QR con los datos de la firma y, al
# lado, el titular. El QR es solo la «cara»; lo que vale es la firma PAdES, que
# cualquiera verifica en Adobe o en el validador oficial.
_RAZON = "Informe de auditoría médica concurrente"
_ZONA = ZoneInfo("America/Guayaquil")
_CAJA_POR_DEFECTO = (45, 57, 285, 119)


def _contenido_qr(titular: str, momento: dt.datetime) -> str:
    return (
        f"FIRMADO POR: {titular}\n"
        f"RAZON: {_RAZON}\n"
        "LOCALIZACION: Quito - Ecuador\n"
        f"FECHA: {momento.isoformat(timespec='seconds')}\n"
        "VALIDAR CON: https://www.firmadigital.gob.ec"
    )


def _sello(titular: str, momento: dt.datetime, ancho: float, alto: float) -> bytes:
    """Una página del tamaño del sello: el QR a la izquierda y el titular."""
    from reportlab.graphics import renderPDF
    from reportlab.graphics.barcode.qr import QrCodeWidget
    from reportlab.graphics.shapes import Drawing
    from reportlab.lib.colors import HexColor
    from reportlab.lib.utils import simpleSplit
    from reportlab.pdfgen import canvas

    salida = BytesIO()
    c = canvas.Canvas(salida, pagesize=(ancho, alto))
    qr = QrCodeWidget(_contenido_qr(titular, momento), barLevel="M", barBorder=1)
    x1, y1, x2, y2 = qr.getBounds()
    dibujo = Drawing(alto, alto, transform=[alto / (x2 - x1), 0, 0, alto / (y2 - y1), 0, 0])
    dibujo.add(qr)
    renderPDF.draw(dibujo, c, 0, 0)

    x = alto + 6
    disponible = ancho - x
    lineas = simpleSplit(titular, "Helvetica-Bold", 9.5, disponible)[:3]
    alto_texto = 9 + len(lineas) * 11.5
    y = (alto + alto_texto) / 2 - 7
    c.setFillColor(HexColor("#5b6470"))
    c.setFont("Helvetica", 7)
    c.drawString(x, y, "Firmado electrónicamente por:")
    c.setFillColor(HexColor("#1a2448"))
    c.setFont("Helvetica-Bold", 9.5)
    for linea in lineas:
        y -= 11.5
        c.drawString(x, y, linea)
    c.showPage()
    c.save()
    return salida.getvalue()


def _estilo_sello(pdf_sello: bytes):  # noqa: ANN202
    from pyhanko.pdf_utils import content, layout
    from pyhanko.pdf_utils.reader import PdfFileReader
    from pyhanko.stamp import StaticStampStyle

    class _PaginaEnMemoria(content.ImportedPdfPage):
        def render(self) -> bytes:
            import uuid

            escritor = self._ensure_writer
            xobj = escritor.import_page_as_xobject(PdfFileReader(BytesIO(pdf_sello)), page_ix=0)
            nombre = "/Sello" + uuid.uuid4().hex
            self.resources.xobject[nombre] = xobj
            x1, y1, x2, y2 = xobj.get_object()["/BBox"]
            self.box = layout.BoxConstraints(width=abs(x1 - x2), height=abs(y1 - y2))
            return nombre.encode() + b" Do"

    return StaticStampStyle(background=_PaginaEnMemoria(None), border_width=0)


def firmar(pdf: bytes, caja: tuple[int, int, int, int] | None = None) -> bytes:
    """
    Devuelve el PDF firmado (PAdES) con el sello visible —QR + titular— en la
    `caja` de la última página (la que reservó el informe bajo su último
    párrafo); sin certificado configurado, el mismo PDF sin tocar.
    """
    config = _config_actual()
    if config is None:
        return pdf
    ruta, contrasena = config
    caja = caja or _CAJA_POR_DEFECTO

    from pyhanko.pdf_utils.incremental_writer import IncrementalPdfFileWriter
    from pyhanko.sign import signers
    from pyhanko.sign.fields import SigFieldSpec

    firmante = _cargar_firmante(ruta, contrasena)
    titular = str(firmante.signing_cert.subject.native.get("common_name") or "—")
    try:
        sello = _sello(
            titular, dt.datetime.now(_ZONA), caja[2] - caja[0], caja[3] - caja[1]
        )
        escritor = IncrementalPdfFileWriter(BytesIO(pdf))
        firmador = signers.PdfSigner(
            signature_meta=signers.PdfSignatureMetadata(
                field_name="FirmaAccumedical",
                reason=_RAZON,
                location="Quito - Ecuador",
            ),
            signer=firmante,
            new_field_spec=SigFieldSpec(sig_field_name="FirmaAccumedical", on_page=-1, box=caja),
            stamp_style=_estilo_sello(sello),
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
