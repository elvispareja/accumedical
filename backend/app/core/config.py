from __future__ import annotations

from typing import Literal
from urllib.parse import quote_plus

from pydantic import Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """
    Configuración validada al arranque. Si algo falta o es inválido el proceso
    muere aquí mismo: el contenedor nunca llega a `healthy` con configuración rota.

    No se declara `env_file`: dentro del contenedor el cwd es /app y el .env vive
    en la raíz del repo, así que sería código muerto. Compose lee el .env del host
    e inyecta las claves como variables de entorno. Por eso `extra="ignore"`: ese
    mismo archivo lleva POSTGRES_*, VITE_* y WATCHFILES_*, que no son campos de
    este modelo y con "forbid" impedirían arrancar.
    """

    model_config = SettingsConfigDict(extra="ignore", case_sensitive=False)

    # ── Entorno ──────────────────────────────────────────────────────────────
    environment: Literal["development", "production"] = "development"
    debug: bool = False
    log_level: str = "INFO"

    # ── Base de datos ────────────────────────────────────────────────────────
    postgres_user: str
    postgres_password: SecretStr
    postgres_db: str
    postgres_host: str = "db"
    postgres_port: int = 5432

    # ── Secretos ─────────────────────────────────────────────────────────────
    secret_key: SecretStr = Field(min_length=32)
    mfa_encryption_key: SecretStr

    # ── CORS ─────────────────────────────────────────────────────────────────
    allowed_origins: list[str] = []

    # ── Cookies ──────────────────────────────────────────────────────────────
    cookie_secure: bool | None = None
    cookie_prefix: str = ""

    # ── Sesión (A07) ─────────────────────────────────────────────────────────
    session_idle_ttl_min: int = Field(default=30, gt=0)
    session_absolute_ttl_min: int = Field(default=720, gt=0)
    session_activity_throttle_sec: int = Field(default=60, ge=0)
    session_purge_after_days: int = Field(default=30, gt=0)

    # ── Login (A04, A07) ─────────────────────────────────────────────────────
    login_max_failed_attempts: int = Field(default=5, gt=0)
    login_lockout_min: int = Field(default=15, gt=0)
    login_rate_limit_ip: str = "5/minute"
    password_min_length: int = Field(default=12, ge=12)

    # ── Subidas (A08) ────────────────────────────────────────────────────────
    upload_dir: str = "/srv/uploads"
    upload_max_size_mb: int = Field(default=5, gt=0)

    # ── Correo (invitaciones) ────────────────────────────────────────────────
    # SMTP real. Sin `smtp_host` no se envía nada: en producción el arranque falla
    # y en desarrollo el mensaje se registra en el log con su enlace, para que la
    # falta de credenciales no bloquee el trabajo.
    smtp_host: str = ""
    smtp_port: int = Field(default=587, gt=0, le=65535)
    smtp_user: str = ""
    smtp_password: SecretStr = SecretStr("")
    # STARTTLS en el 587 (lo normal) o TLS directo en el 465. Sin cifrado no se
    # envía: las invitaciones llevan un enlace que fija una contraseña.
    smtp_starttls: bool = True
    smtp_ssl: bool = False
    smtp_timeout_sec: int = Field(default=15, gt=0)
    mail_from: str = ""
    mail_from_nombre: str = "Accumedical"
    # El membrete de firma que cierra los correos de avisos e informes (los que
    # nacen como texto). Es la firma POR DEFECTO: el alta de un caso la
    # reemplaza con quien lo creó (nombre, rol · compañía y su correo de login).
    mail_firma_nombre: str = "Dra. Milady Inés Pareja Paredes"
    mail_firma_cargo: str = "Gerente General · Perito Médico"
    mail_firma_correo: str = "peritomedico@accumedical.med.ec"
    mail_firma_web: str = "www.accumedical.med.ec"
    # Base pública desde la que se construye el enlace de la invitación. Nunca se
    # deduce de la cabecera Host de la petición: sería suplantable.
    app_base_url: str = "http://localhost:8080"
    invitacion_ttl_horas: int = Field(default=72, gt=0)

    # ── IA (informe del auditor) ─────────────────────────────────────────────
    # Sin clave no se genera nada: el endpoint responde 503 con un mensaje claro
    # y el resto del panel —las notas dictadas— funciona igual. El único destino
    # posible es la API de Anthropic: la URL no sale de configuración de usuario
    # ni de ninguna petición (A10).
    claude_api_key: SecretStr = SecretStr("")
    claude_model: str = "claude-sonnet-5"
    # Holgado: un informe con muchas fotos ronda los 2 minutos de generación.
    claude_timeout_sec: int = Field(default=240, gt=0)
    # El dictado del auditor se transcribe LOCALMENTE con Whisper (faster-whisper,
    # CPU): el audio clínico no sale del servidor. El modelo se descarga una vez
    # al volumen de subidas. "small" equilibra calidad y velocidad en español.
    stt_modelo: str = "small"

    # ── Firma electrónica de los informes ────────────────────────────────────
    # El .p12 de la empresa (Registro Civil, Security Data, Uanataca…) firma
    # digitalmente (PAdES) cada PDF de informe. El archivo vive FUERA del
    # repositorio —dentro del volumen de subidas— y la contraseña solo aquí.
    # Sin configurar, los PDF salen sin firmar y todo lo demás funciona igual.
    firma_p12_path: str = ""
    firma_p12_password: SecretStr = SecretStr("")

    # ── API central (elvispareja/accumedical-central) ────────────────────────
    # Concurrencia publica allí sus pacientes (→ personas) y sus visitas
    # culminadas (→ eventos). Vacío = sin central: la app funciona igual y no
    # sincroniza nada. Credencial OAuth2 client credentials, creada en la
    # central con `python -m app.cli crear-credencial concurrencia --scopes app`.
    central_api_url: str = ""
    central_client_id: str = ""
    central_client_secret: SecretStr = SecretStr("")
    # Segunda credencial, la del NÚCLEO: replica aseguradoras, prestadores,
    # convenios, SLA y módulos contratados hacia la central (scope
    # replicacion:escribir). Vacía = no se replica.
    central_plataforma_client_id: str = ""
    central_plataforma_client_secret: SecretStr = SecretStr("")
    central_replicacion_intervalo_sec: int = Field(default=60, ge=15)
    central_timeout_sec: int = Field(default=10, gt=0, le=60)
    central_intervalo_sec: int = Field(default=120, ge=30)

    # ── Bootstrap ────────────────────────────────────────────────────────────
    superadmin_email: str = ""
    superadmin_password: SecretStr = SecretStr("")

    @field_validator("allowed_origins", mode="before")
    @classmethod
    def _parsear_origenes(cls, v: object) -> object:
        if isinstance(v, str) and not v.strip().startswith("["):
            return [o.strip() for o in v.split(",") if o.strip()]
        return v

    @field_validator("allowed_origins")
    @classmethod
    def _sin_barra_final(cls, v: list[str]) -> list[str]:
        # pydantic HttpUrl normalizaría añadiendo "/" y entonces jamás coincidiría
        # con la cabecera Origin del navegador: la allowlist no haría match nunca.
        return [o.rstrip("/") for o in v]

    @model_validator(mode="after")
    def _guardas_de_produccion(self) -> Settings:
        if self.cookie_secure is None:
            self.cookie_secure = self.environment == "production"
        if self.environment == "production":
            if self.debug:
                raise ValueError("DEBUG=True está prohibido en producción")
            if not self.cookie_secure:
                raise ValueError("COOKIE_SECURE=False está prohibido en producción")
            if not self.smtp_host or not self.mail_from:
                raise ValueError(
                    "SMTP_HOST y MAIL_FROM son obligatorios en producción: sin ellos "
                    "las invitaciones se perderían en silencio"
                )
            if not self.app_base_url.startswith("https://"):
                raise ValueError("APP_BASE_URL debe ser https en producción")
            # El cifrado solo es exigible aquí: los capturadores de correo que se
            # usan en desarrollo (MailHog, Mailpit) hablan SMTP en claro y no
            # tienen certificado, así que exigirlo allí impediría probar el envío.
            if not (self.smtp_starttls or self.smtp_ssl):
                raise ValueError(
                    "El correo saldría sin cifrar: activa SMTP_STARTTLS o SMTP_SSL"
                )
        return self

    @property
    def correo_configurado(self) -> bool:
        return bool(self.smtp_host and self.mail_from)

    @property
    def replicacion_central_configurada(self) -> bool:
        return bool(
            self.central_api_url
            and self.central_plataforma_client_id
            and self.central_plataforma_client_secret.get_secret_value()
        )

    @property
    def central_configurada(self) -> bool:
        return bool(
            self.central_api_url
            and self.central_client_id
            and self.central_client_secret.get_secret_value()
        )

    @property
    def database_url(self) -> str:
        """
        DSN construido desde variables discretas, no interpolado en el compose:
        una contraseña con @ / # % o : produciría un DSN inválido o conectaría al
        host equivocado con un error críptico.
        """
        usuario = quote_plus(self.postgres_user)
        clave = quote_plus(self.postgres_password.get_secret_value())
        return (
            f"postgresql+psycopg://{usuario}:{clave}"
            f"@{self.postgres_host}:{self.postgres_port}/{self.postgres_db}"
        )

    @property
    def nombre_cookie_sesion(self) -> str:
        return f"{self.cookie_prefix}session"

    @property
    def nombre_cookie_csrf(self) -> str:
        return f"{self.cookie_prefix}csrf_token"


settings = Settings()  # type: ignore[call-arg]
