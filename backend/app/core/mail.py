from __future__ import annotations

import html as html_lib
import smtplib
import ssl
from email.headerregistry import Address
from email.message import EmailMessage
from pathlib import Path

from app.core.config import settings
from app.core.logging import log

# Envío por SMTP, sin dependencias externas: `smtplib` de la biblioteca estándar
# basta y evita arrastrar un cliente de correo con su propia superficie.
#
# Este módulo NO hace peticiones a URLs suministradas por el usuario: el servidor
# de correo es configuración del despliegue, así que A10/SSRF no aplica.


class ErrorDeCorreo(RuntimeError):
    """El mensaje no salió. Quien llama decide si es fatal o si se reintenta."""


def _cabecera_from() -> str:
    """`Nombre <buzon@dominio>` bien formado, sin concatenar strings a mano."""
    buzon, _, dominio = settings.mail_from.partition("@")
    return str(Address(settings.mail_from_nombre, buzon, dominio))


# El logo del membrete viaja DENTRO del mensaje (adjunto relacionado con CID):
# los clientes de correo bloquean imágenes remotas, y así el correo no depende
# de ningún hosting. `parents[1]` = app/; el PNG vive en app/assets.
_LOGO_MEMBRETE = Path(__file__).resolve().parents[1] / "assets" / "logo-accumedical.png"
_CID_LOGO = "logo-accumedical-membrete"

# Paleta de la marca, la misma de la web y el PDF.
_NAVY = "#1a2448"
_ORO = "#b0914d"


def _html_con_membrete(texto: str, con_logo: bool, firma: tuple[str, str, str]) -> str:
    """
    El cuerpo del aviso tal cual —espacios y saltos respetados, HTML escapado—
    dentro de una tarjeta blanca, cerrado por el membrete de la firma: el logo
    de Accumedical, línea divisoria y el bloque de quien firma
    `(nombre, cargo, correo)` — en el alta de un caso, quien lo creó.
    """
    nombre_firma, cargo_firma, correo_firma = firma
    logo = (
        f'<img src="cid:{_CID_LOGO}" width="122" alt="Accumedical" '
        'style="display:block;width:122px;height:auto">'
        if con_logo
        else f'<span style="font:700 18px Georgia,serif;color:{_NAVY}">ACCUMEDICAL</span>'
    )
    return f"""<html><body style="margin:0;padding:0;background:#f2f4f8">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
         style="background:#f2f4f8">
    <tr><td align="center" style="padding:18px 16px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
             style="width:100%;background:#ffffff;border-radius:10px;
                    border:1px solid #e3e7ee">
        <tr><td style="height:5px;background:{_NAVY};border-radius:10px 10px 0 0;
                       font-size:0;line-height:0">&nbsp;</td></tr>
        <tr><td style="padding:30px 34px 24px">
          <div style="white-space:pre-wrap;font:14px/1.65 -apple-system,'Segoe UI',Arial,sans-serif;
                      color:#28303d">{html_lib.escape(texto)}</div>
        </td></tr>
        <tr><td style="padding:0 34px">
          <div style="border-top:1px solid #e3e7ee;font-size:0">&nbsp;</div>
        </td></tr>
        <tr><td style="padding:20px 34px 30px">
          <table role="presentation" cellpadding="0" cellspacing="0">
            <tr>
              <td style="vertical-align:middle;padding-right:20px">{logo}</td>
              <td style="vertical-align:middle;border-left:2px solid #d9dee7;padding-left:20px">
                <div style="font:700 16px Georgia,'Times New Roman',serif;color:{_NAVY}">
                  {html_lib.escape(nombre_firma)}</div>
                <div style="font:13px -apple-system,'Segoe UI',Arial,sans-serif;color:#3c4656;
                            padding-top:3px">{html_lib.escape(cargo_firma)}</div>
                <div style="font:12.5px -apple-system,'Segoe UI',Arial,sans-serif;padding-top:8px">
                  <a href="mailto:{html_lib.escape(correo_firma)}"
                     style="color:{_NAVY};text-decoration:none">{html_lib.escape(correo_firma)}</a>
                  <span style="color:{_ORO};padding:0 7px">|</span>
                  <a href="https://{html_lib.escape(settings.mail_firma_web)}"
                     style="color:{_NAVY};text-decoration:none">{html_lib.escape(settings.mail_firma_web)}</a>
                </div>
              </td>
            </tr>
          </table>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>"""


def enviar(
    *,
    para: str,
    asunto: str,
    texto: str,
    html: str | None = None,
    adjunto: tuple[str, bytes, str, str] | None = None,
    firma: tuple[str, str, str] | None = None,
) -> None:
    """
    Manda un correo, con adjunto opcional `(nombre, contenido, tipo, subtipo)` —
    p. ej. el PDF de un informe. `firma` `(nombre, cargo, correo)` personaliza
    el membrete —el alta de un caso firma quien lo creó—; sin ella, firma la
    gerencia (MAIL_FIRMA_*). Sin SMTP configurado no revienta: en desarrollo lo
    registra en el log para que se pueda seguir trabajando, y en producción ese
    caso no existe porque la configuración se valida al arrancar.

    Del contenido no se registra NADA salvo el destinatario y el asunto: el cuerpo
    de una invitación lleva el enlace que fija una contraseña.
    """
    if not settings.correo_configurado:
        if settings.environment == "production":  # pragma: no cover - lo impide el arranque
            raise ErrorDeCorreo("SMTP no configurado")
        # El único sitio donde el enlace aparece en un log, y solo en desarrollo.
        log.warning(
            "correo_sin_smtp",
            para=para,
            asunto=asunto,
            cuerpo=texto,
            adjunto=adjunto[0] if adjunto else None,
        )
        return

    mensaje = EmailMessage()
    mensaje["From"] = _cabecera_from()
    mensaje["To"] = para
    mensaje["Subject"] = asunto
    mensaje.set_content(texto)
    if html:
        # Quien trae su propio HTML completo (la invitación) manda tal cual.
        mensaje.add_alternative(html, subtype="html")
    else:
        # Todo lo demás sale con el membrete de la marca; el texto plano queda
        # como alternativa para los clientes que no pintan HTML.
        if firma is None:
            firma = (
                settings.mail_firma_nombre,
                settings.mail_firma_cargo,
                settings.mail_firma_correo,
            )
        con_logo = _LOGO_MEMBRETE.is_file()
        mensaje.add_alternative(_html_con_membrete(texto, con_logo, firma), subtype="html")
        if con_logo:
            mensaje.get_payload()[1].add_related(
                _LOGO_MEMBRETE.read_bytes(),
                maintype="image",
                subtype="png",
                cid=f"<{_CID_LOGO}>",
            )
    if adjunto:
        nombre, contenido, tipo, subtipo = adjunto
        mensaje.add_attachment(contenido, maintype=tipo, subtype=subtipo, filename=nombre)

    contexto = ssl.create_default_context()

    def _transmitir() -> None:
        if settings.smtp_ssl:
            cliente: smtplib.SMTP = smtplib.SMTP_SSL(
                settings.smtp_host,
                settings.smtp_port,
                timeout=settings.smtp_timeout_sec,
                context=contexto,
            )
        else:
            cliente = smtplib.SMTP(
                settings.smtp_host, settings.smtp_port, timeout=settings.smtp_timeout_sec
            )
        with cliente:
            if settings.smtp_starttls and not settings.smtp_ssl:
                cliente.starttls(context=contexto)
            if settings.smtp_user:
                cliente.login(settings.smtp_user, settings.smtp_password.get_secret_value())
            cliente.send_message(mensaje)

    # Ni la contraseña del SMTP ni el cuerpo entran en el log: solo el tipo de error.
    for intento in (1, 2):
        try:
            _transmitir()
            break
        except smtplib.SMTPException as error:
            # Protocolo o credenciales (subclase de OSError: va ANTES en el
            # orden de captura): repetirlo no cambia nada.
            log.error("correo_fallido", para=para, asunto=asunto, error=type(error).__name__)
            raise ErrorDeCorreo("No se pudo enviar el correo") from error
        except OSError as error:
            # La conexión no entró (SYN perdido, timeout). En redes inestables
            # el mismo envío suele entrar a la segunda: se reintenta UNA vez.
            if intento == 1:
                log.warning(
                    "correo_reintento", para=para, asunto=asunto, error=type(error).__name__
                )
                continue
            log.error("correo_fallido", para=para, asunto=asunto, error=type(error).__name__)
            raise ErrorDeCorreo("No se pudo enviar el correo") from error

    log.info("correo_enviado", para=para, asunto=asunto)
