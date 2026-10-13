from __future__ import annotations

import io
import re
import unicodedata
from pathlib import Path
from typing import NamedTuple

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import (
    Flowable,
    HRFlowable,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

# El PDF del informe de auditoría, con la marca: banda azul marino del logo,
# títulos de sección en oro y el cuerpo sobrio. Se renderiza AL VUELO desde el
# texto guardado en `conc_visitas.informe`: no se persiste ningún archivo.

NAVY = colors.HexColor("#1a2448")
NAVY_SUAVE = colors.HexColor("#eef1f8")
ORO = colors.HexColor("#8a6f33")
ORO_SUAVE = colors.HexColor("#f5efe2")
TINTA = colors.HexColor("#22262e")
TENUE = colors.HexColor("#5b6470")
LINEA = colors.HexColor("#d9dee9")

# parents[2] es el paquete `app` (…/app/modules/concurrencia/pdf.py).
LOGO_BLANCO = Path(__file__).resolve().parents[2] / "assets" / "logo-accumedical-blanco.png"

# Los títulos que puede traer el informe, ya normalizados (sin tildes, sin ':').
SECCIONES = {
    "DATOS GENERALES",
    "ANTECEDENTES PERSONALES",
    "ANTECEDENTES FAMILIARES",
    "ALERGIAS",
    "ANTECEDENTES QUIRURGICOS",
    "ENFERMEDAD ACTUAL",
    "DIAGNOSTICOS INGRESO Y DEFINITIVO",
    "CIRUGIA PROGRAMADA - REALIZADA",
    "EXAMENES REALIZADOS",
    "LABORATORIO",
    "IMAGEN",
    "COMENTARIOS",
    "CUENTA",
    "ANALISIS",
}
SUBSECCIONES = {"LABORATORIO", "IMAGEN"}

# El hueco donde va el sello de la firma electrónica (QR + titular), justo
# debajo del último párrafo: así nunca tapa texto, ocupe lo que ocupe el informe.
SELLO_ANCHO = 240
SELLO_ALTO = 62


class InformePdf(NamedTuple):
    contenido: bytes
    # (x1, y1, x2, y2) en puntos, en la ÚLTIMA página: dónde va el sello.
    caja_sello: tuple[int, int, int, int]


class _HuecoSello(Flowable):
    """Reserva el sitio del sello y anota dónde quedó en la página."""

    def __init__(self) -> None:
        super().__init__()
        self.caja: tuple[int, int, int, int] | None = None

    def wrap(self, ancho_disponible, alto_disponible):  # noqa: ANN001, ANN201, ARG002
        return SELLO_ANCHO, SELLO_ALTO

    def draw(self) -> None:
        x, y = self.canv.absolutePosition(0, 0)
        self.caja = (round(x), round(y), round(x) + SELLO_ANCHO, round(y) + SELLO_ALTO)


def _normalizar(linea: str) -> str:
    plana = unicodedata.normalize("NFD", linea).encode("ascii", "ignore").decode()
    return plana.strip().rstrip(":").upper()


def _en_secciones(texto: str) -> list[tuple[str, list[str]]]:
    """Parte el texto del informe por sus títulos conocidos, tolerante a tildes."""
    secciones: list[tuple[str, list[str]]] = []
    actual: tuple[str, list[str]] | None = None
    for cruda in texto.splitlines():
        linea = cruda.rstrip()
        clave = _normalizar(linea)
        if clave in SECCIONES:
            actual = (clave, [])
            secciones.append(actual)
            continue
        if clave.startswith("INFORME DE VISITA"):
            continue
        if clave.startswith("RESPONSABLE DE AUDITORIA"):
            # La firma —que el sistema añade al final— va en el pie de cada
            # página con el nombre real: de aquí en adelante no hay contenido.
            break
        if actual is None:
            if linea.strip():
                actual = ("COMENTARIOS", [linea])
                secciones.append(actual)
            continue
        actual[1].append(linea)
    return secciones


def _estilos() -> dict[str, ParagraphStyle]:
    return {
        "cuerpo": ParagraphStyle(
            "cuerpo", fontName="Helvetica", fontSize=9.2, leading=13.6, textColor=TINTA
        ),
        "titulo_seccion": ParagraphStyle(
            "titulo_seccion",
            fontName="Helvetica-Bold",
            fontSize=9.6,
            leading=12,
            textColor=ORO,
            spaceBefore=6,
        ),
        "subtitulo": ParagraphStyle(
            "subtitulo",
            fontName="Helvetica-Bold",
            fontSize=8.8,
            leading=11,
            textColor=NAVY,
            spaceBefore=3,
        ),
        "etiqueta": ParagraphStyle(
            "etiqueta", fontName="Helvetica-Bold", fontSize=8.8, leading=12, textColor=NAVY
        ),
        "valor": ParagraphStyle(
            "valor", fontName="Helvetica", fontSize=9.2, leading=12, textColor=TINTA
        ),
        "analisis": ParagraphStyle(
            "analisis", fontName="Helvetica", fontSize=9.4, leading=14, textColor=TINTA
        ),
    }


def _escapar(texto: str) -> str:
    return texto.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def _parrafos(lineas: list[str], estilo: ParagraphStyle) -> list:
    """Las líneas en bloques separados por líneas en blanco, como párrafos."""
    salida: list = []
    bloque: list[str] = []
    for linea in [*lineas, ""]:
        if linea.strip():
            bloque.append(_escapar(linea.strip()))
        elif bloque:
            salida.append(Paragraph("<br/>".join(bloque), estilo))
            salida.append(Spacer(1, 3))
            bloque = []
    return salida


def _tabla_datos(lineas: list[str], est: dict) -> Table:
    filas = []
    for linea in lineas:
        if ":" in linea:
            etiqueta, valor = linea.split(":", 1)
            filas.append(
                [
                    Paragraph(_escapar(etiqueta.strip().rstrip(".") + ":"), est["etiqueta"]),
                    Paragraph(_escapar(valor.strip() or "—"), est["valor"]),
                ]
            )
        elif linea.strip():
            filas.append([Paragraph("", est["etiqueta"]), Paragraph(_escapar(linea), est["valor"])])
    tabla = Table(filas or [["", ""]], colWidths=[42 * mm, None])
    tabla.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("ROWBACKGROUNDS", (0, 0), (-1, -1), [colors.white, NAVY_SUAVE]),
                ("LINEBELOW", (0, 0), (-1, -1), 0.4, LINEA),
                ("TOPPADDING", (0, 0), (-1, -1), 3.5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 3.5),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
            ]
        )
    )
    return tabla


def _tabla_cuenta(lineas: list[str], est: dict) -> list:
    filas = []
    total = None
    for linea in lineas:
        limpia = linea.strip()
        if not limpia:
            continue
        if _normalizar(limpia).startswith("TOTAL"):
            total = limpia
            continue
        # «RUBRO 1.234,56» → rubro a la izquierda, valor a la derecha.
        m = re.match(r"^(.*?)[\s]+([\d.,]+)$", limpia)
        if m:
            filas.append([Paragraph(_escapar(m.group(1)), est["valor"]), m.group(2)])
        else:
            filas.append([Paragraph(_escapar(limpia), est["valor"]), ""])
    salida: list = []
    if filas:
        tabla = Table(filas, colWidths=[None, 30 * mm])
        tabla.setStyle(
            TableStyle(
                [
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("ALIGN", (1, 0), (1, -1), "RIGHT"),
                    ("FONTNAME", (1, 0), (1, -1), "Helvetica"),
                    ("FONTSIZE", (1, 0), (1, -1), 9.2),
                    ("TEXTCOLOR", (1, 0), (1, -1), TINTA),
                    ("LINEBELOW", (0, 0), (-1, -1), 0.4, LINEA),
                    ("TOPPADDING", (0, 0), (-1, -1), 3),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
                ]
            )
        )
        salida.append(tabla)
    if total:
        caja = Table(
            [[Paragraph(f"<b>{_escapar(total)}</b>", est["etiqueta"])]], colWidths=[None]
        )
        caja.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, -1), ORO_SUAVE),
                    ("LINEABOVE", (0, 0), (-1, 0), 0.8, ORO),
                    ("TOPPADDING", (0, 0), (-1, -1), 5),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
                    ("LEFTPADDING", (0, 0), (-1, -1), 8),
                ]
            )
        )
        salida += [Spacer(1, 2), caja]
    return salida


def _caja_analisis(lineas: list[str], est: dict) -> Table:
    contenido = _parrafos(lineas, est["analisis"]) or [Paragraph("—", est["analisis"])]
    caja = Table([[contenido]], colWidths=[None])
    caja.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), NAVY_SUAVE),
                ("LINEBEFORE", (0, 0), (0, -1), 2.2, ORO),
                ("TOPPADDING", (0, 0), (-1, -1), 8),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
                ("LEFTPADDING", (0, 0), (-1, -1), 10),
                ("RIGHTPADDING", (0, 0), (-1, -1), 10),
            ]
        )
    )
    return caja


def generar_pdf(informe: str, codigo_interno: str, auditor: str) -> InformePdf:
    est = _estilos()
    buffer = io.BytesIO()

    def decorar(canvas, doc) -> None:
        canvas.saveState()
        ancho, alto = A4
        # La banda de marca: azul marino con el logo en blanco.
        canvas.setFillColor(NAVY)
        canvas.rect(0, alto - 24 * mm, ancho, 24 * mm, stroke=0, fill=1)
        try:
            canvas.drawImage(
                str(LOGO_BLANCO), 16 * mm, alto - 20.5 * mm, width=33 * mm, height=16.7 * mm,
                mask="auto", preserveAspectRatio=True, anchor="w",
            )
        except Exception:  # noqa: BLE001, S110 - sin logo, el informe sigue saliendo
            pass
        canvas.setFillColor(colors.white)
        canvas.setFont("Helvetica-Bold", 11.5)
        canvas.drawRightString(
            ancho - 16 * mm, alto - 12.5 * mm, "INFORME DE VISITA MÉDICA RECURRENTE"
        )
        canvas.setFillColor(colors.HexColor("#c9a55e"))
        canvas.setFont("Helvetica", 8.2)
        canvas.drawRightString(
            ancho - 16 * mm, alto - 17 * mm, f"Auditoría médica concurrente · {codigo_interno}"
        )

        # El pie: la firma real y la página.
        canvas.setStrokeColor(LINEA)
        canvas.setLineWidth(0.6)
        canvas.line(16 * mm, 14 * mm, ancho - 16 * mm, 14 * mm)
        canvas.setFillColor(TENUE)
        canvas.setFont("Helvetica", 7.6)
        canvas.drawString(
            16 * mm, 9.5 * mm,
            f"Responsable de Auditoría Concurrente: {auditor} / Médico Auditor",
        )
        canvas.drawRightString(ancho - 16 * mm, 9.5 * mm, f"Accumedical · Página {doc.page}")
        canvas.restoreState()

    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        topMargin=30 * mm,
        bottomMargin=20 * mm,
        leftMargin=16 * mm,
        rightMargin=16 * mm,
        title=f"Informe de visita médica recurrente {codigo_interno}",
        author="Accumedical",
    )

    flujo: list = []
    dentro_examenes = False
    for clave, lineas in _en_secciones(informe):
        es_sub = clave in SUBSECCIONES and dentro_examenes
        if clave == "EXAMENES REALIZADOS":
            dentro_examenes = True
        elif clave not in SUBSECCIONES:
            dentro_examenes = False

        if es_sub:
            flujo.append(Paragraph(clave, est["subtitulo"]))
        else:
            flujo.append(Spacer(1, 5))
            flujo.append(Paragraph(clave, est["titulo_seccion"]))
            flujo.append(
                HRFlowable(width="100%", thickness=0.8, color=NAVY, spaceBefore=1, spaceAfter=5)
            )

        if clave == "DATOS GENERALES":
            flujo.append(_tabla_datos([linea for linea in lineas if linea.strip()], est))
        elif clave == "CUENTA":
            flujo += _tabla_cuenta(lineas, est)
        elif clave == "ANALISIS":
            flujo.append(_caja_analisis(lineas, est))
        else:
            flujo += _parrafos(lineas, est["cuerpo"])

    hueco = _HuecoSello()
    flujo += [Spacer(1, 12), hueco]
    doc.build(flujo, onFirstPage=decorar, onLaterPages=decorar)
    return InformePdf(buffer.getvalue(), hueco.caja or (45, 57, 45 + SELLO_ANCHO, 57 + SELLO_ALTO))
