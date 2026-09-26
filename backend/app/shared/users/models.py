from __future__ import annotations

import datetime as dt
import uuid

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    SmallInteger,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import CITEXT
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import (
    TS,
    AuditoriaFilaMixin,
    Base,
    BorradoLogicoMixin,
    MarcasTiempoMixin,
    columna_pk_uuid,
)


class User(Base, AuditoriaFilaMixin, BorradoLogicoMixin):
    __tablename__ = "users"
    __table_args__ = (
        CheckConstraint(
            "failed_login_attempts BETWEEN 0 AND 100", name="failed_attempts_rango"
        ),
        CheckConstraint(
            "NOT mfa_enabled OR mfa_secret IS NOT NULL", name="mfa_coherente"
        ),
        # Un superadmin no pertenece a ninguna aseguradora: su scope es global y
        # el de la compañía lo contradiría.
        CheckConstraint(
            "NOT is_superadmin OR aseguradora_id IS NULL", name="superadmin_sin_aseguradora"
        ),
        # Igual que en los contactos: tipo y número de documento van juntos o no van.
        CheckConstraint(
            "(tipo_documento_codigo IS NULL) = (numero_documento IS NULL)", name="documento"
        ),
        # Unicidad PARCIAL: permite re-registrar el email de un usuario borrado lógicamente.
        Index(
            "uq_users_email",
            "email",
            unique=True,
            postgresql_where="deleted_at IS NULL",
        ),
        Index("ix_users_aseguradora_id", "aseguradora_id", postgresql_where="deleted_at IS NULL"),
        # Un contacto tiene como mucho un usuario vivo.
        Index(
            "uq_users_aseguradora_contacto_id",
            "aseguradora_contacto_id",
            unique=True,
            postgresql_where="deleted_at IS NULL AND aseguradora_contacto_id IS NOT NULL",
        ),
        # La misma FK compuesta de aseguradoras y prestadores: la ciudad debe
        # pertenecer a la provincia elegida, garantizado por la base.
        ForeignKeyConstraint(
            ["provincia_codigo"],
            ["provincias.codigo"],
            ondelete="RESTRICT",
            name="fk_users_provincia_codigo_provincias",
        ),
        ForeignKeyConstraint(
            ["ciudad_codigo", "provincia_codigo"],
            ["ciudades.codigo", "ciudades.provincia_codigo"],
            ondelete="RESTRICT",
            name="fk_users_ciudad_codigo_ciudades",
        ),
    )

    id: Mapped[uuid.UUID] = columna_pk_uuid()
    # citext: unicidad case-insensitive garantizada en la base, sin confiar en que
    # todo el código se acuerde de normalizar.
    email: Mapped[str] = mapped_column(CITEXT, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    # El nombre va en cuatro partes (ver app/shared/personas.py): obligatorios
    # el primer nombre y el apellido paterno, opcionales los otros dos.
    nombre_principal: Mapped[str] = mapped_column(String(100), nullable=False)
    nombre_secundario: Mapped[str | None] = mapped_column(String(100))
    apellido_paterno: Mapped[str] = mapped_column(String(100), nullable=False)
    apellido_materno: Mapped[str | None] = mapped_column(String(100))

    # Identificación del personal de plataforma, que no sale de ningún contacto
    # de aseguradora. Opcionales los tres; solo el nombre, el apellido paterno y
    # el correo son obligatorios para existir.
    tipo_documento_codigo: Mapped[str | None] = mapped_column(
        ForeignKey("tipos_documento.codigo", ondelete="RESTRICT")
    )
    numero_documento: Mapped[str | None] = mapped_column(String(20))
    telefono: Mapped[str | None] = mapped_column(String(25))

    # Dónde está el personal de plataforma: es la palanca de cercanía al derivar
    # un caso (auditores de la misma ciudad primero). Opcional, y sin uso para
    # los usuarios de aseguradora.
    provincia_codigo: Mapped[str | None] = mapped_column(String(2))
    ciudad_codigo: Mapped[str | None] = mapped_column(String(4))

    is_superadmin: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false")

    # A qué aseguradora pertenece. NULL es personal de la plataforma; hoy, solo el
    # administrador global. Es la misma palanca de ownership del resto de tablas.
    aseguradora_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("aseguradoras.id", ondelete="RESTRICT")
    )
    # De qué contacto salió. El usuario no se teclea aparte: nombre, apellido y
    # correo vienen del contacto y así no pueden divergir.
    aseguradora_contacto_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("aseguradora_contactos.id", ondelete="RESTRICT")
    )
    # Distinto de deleted_at: desactivar es administrativo y reversible, y es el
    # único mecanismo que mata TODAS las sesiones vivas de un usuario comprometido.
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="true")

    # A07: MFA preparado desde el día uno. El secreto se guarda cifrado con
    # MFA_ENCRYPTION_KEY, jamás en claro.
    mfa_secret: Mapped[str | None] = mapped_column(String(255))
    mfa_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false")

    # A04: bloqueo temporal por cuenta.
    failed_login_attempts: Mapped[int] = mapped_column(
        SmallInteger, nullable=False, server_default="0"
    )
    locked_until: Mapped[dt.datetime | None] = mapped_column(TS)

    last_login_at: Mapped[dt.datetime | None] = mapped_column(TS)
    password_changed_at: Mapped[dt.datetime] = mapped_column(
        TS, nullable=False, server_default=func.now()
    )

    # Preferencia de navegación: debe sobrevivir al logout, así que vive aquí y no
    # en sessions. SET NULL porque no es dato de negocio.
    last_module_code: Mapped[str | None] = mapped_column(
        String(30), ForeignKey("modules.code", ondelete="SET NULL")
    )


class Role(Base, MarcasTiempoMixin):
    """
    Los roles son POR MÓDULO. Entidad de configuración: usa `activo`, no borrado
    lógico, para que la unicidad (module_code, code) pueda ser total.
    """

    __tablename__ = "roles"
    __table_args__ = (
        UniqueConstraint("module_code", "code", name="uq_roles_module_code_code"),
        # Clave compuesta redundante que habilita la FK de integridad rol-módulo
        # de user_module_access. Sin ella no se puede expresar esa garantía.
        UniqueConstraint("id", "module_code", name="uq_roles_id_module_code"),
    )

    id: Mapped[uuid.UUID] = columna_pk_uuid()
    module_code: Mapped[str] = mapped_column(
        String(30), ForeignKey("modules.code", ondelete="RESTRICT"), nullable=False
    )
    code: Mapped[str] = mapped_column(String(50), nullable=False)
    nombre: Mapped[str] = mapped_column(String(80), nullable=False)
    descripcion: Mapped[str | None] = mapped_column(String(300))
    es_sistema: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false")
    activo: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="true")


class Permission(Base):
    """
    Permisos `recurso:accion` con scope de módulo en columna (NULL = permiso del núcleo).
    El scope va en columna y no incrustado en el string para que dos módulos puedan
    tener `solicitudes:leer` sin colisión y sin parsear strings en la administración.
    """

    __tablename__ = "permissions"
    __table_args__ = (
        UniqueConstraint(
            "module_code",
            "code",
            name="uq_permissions_module_code_code",
            # PG15+: sin esto, dos permisos de núcleo (module_code NULL) podrían
            # repetir código, porque NULL != NULL en un UNIQUE normal.
            postgresql_nulls_not_distinct=True,
        ),
        CheckConstraint(r"code ~ '^[a-z_]+:[a-z_]+$'", name="code_formato"),
    )

    id: Mapped[uuid.UUID] = columna_pk_uuid()
    module_code: Mapped[str | None] = mapped_column(
        String(30), ForeignKey("modules.code", ondelete="RESTRICT")
    )
    code: Mapped[str] = mapped_column(String(100), nullable=False)
    descripcion: Mapped[str | None] = mapped_column(String(300))
    created_at: Mapped[dt.datetime] = mapped_column(
        TS, nullable=False, server_default=func.now()
    )


class RolePermission(Base):
    __tablename__ = "role_permissions"
    __table_args__ = (Index("ix_role_permissions_permission_id", "permission_id"),)

    role_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("roles.id", ondelete="CASCADE"), primary_key=True
    )
    # RESTRICT, no CASCADE: el código de un permiso está referenciado por las
    # dependencias de FastAPI; borrarlo implica revisar código, no arrastrar filas.
    permission_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("permissions.id", ondelete="RESTRICT"), primary_key=True
    )
    granted_at: Mapped[dt.datetime] = mapped_column(
        TS, nullable=False, server_default=func.now()
    )
    granted_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT")
    )


class UserModuleAccess(Base):
    """
    La puerta de entrada. Se consulta en CADA request: por eso revocar
    (activo=False) surte efecto inmediato sobre sesiones ya abiertas.
    """

    __tablename__ = "user_module_access"
    __table_args__ = (
        # Total, no parcial: a lo sumo una fila por usuario y módulo. Cambiar de rol
        # o revocar/reactivar es UPDATE sobre esa fila; el historial vive en audit_log.
        UniqueConstraint(
            "user_id", "module_code", name="uq_user_module_access_user_id_module_code"
        ),
        # FK COMPUESTA: hace imposible a nivel de datos asignar a un usuario un rol
        # de otro módulo. Ningún bug de servicio puede crear "supervisor de
        # calificación dentro de suscripción".
        ForeignKeyConstraint(
            ["role_id", "module_code"],
            ["roles.id", "roles.module_code"],
            ondelete="RESTRICT",
            name="fk_user_module_access_role_id_roles",
        ),
        Index("ix_user_module_access_role_id", "role_id"),
    )

    id: Mapped[uuid.UUID] = columna_pk_uuid()
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    module_code: Mapped[str] = mapped_column(String(30), nullable=False)
    role_id: Mapped[uuid.UUID] = mapped_column(nullable=False)

    activo: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="true")
    granted_at: Mapped[dt.datetime] = mapped_column(
        TS, nullable=False, server_default=func.now()
    )
    granted_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT")
    )
    revoked_at: Mapped[dt.datetime | None] = mapped_column(TS)
    revoked_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT")
    )
    updated_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )


class UserGrupoAccess(Base):
    """
    El coordinador de plataforma, que abarca una FAMILIA entera: toda
    Suscripción o todo Siniestro.

    Se guarda la familia y no la lista de módulos de hoy a propósito: el día que
    entre un módulo nuevo a Siniestro, su coordinador ya lo cubre sin que nadie
    reedite su ficha. El rol con el que entra a cada módulo es el `supervisor`
    de ESE módulo —nombre visible «Coordinador»—, así que los permisos salen del
    mismo sitio de siempre.

    Es solo del personal propio: el coordinador de una aseguradora sigue siendo
    por módulo, con su fila en `user_module_access`.
    """

    __tablename__ = "user_grupo_access"
    __table_args__ = (
        CheckConstraint("grupo IN ('suscripcion', 'siniestro')", name="grupo"),
        # Total, como en user_module_access: una fila por usuario y familia.
        UniqueConstraint("user_id", "grupo", name="uq_user_grupo_access_user_id_grupo"),
        # UNO SOLO por familia, garantizado por la base y no por la disciplina
        # del servicio: parcial sobre las filas vivas, para que revocar libere
        # el puesto sin borrar el historial.
        Index(
            "uq_user_grupo_access_coordinador_unico",
            "grupo",
            unique=True,
            postgresql_where="activo",
        ),
    )

    id: Mapped[uuid.UUID] = columna_pk_uuid()
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    grupo: Mapped[str] = mapped_column(String(20), nullable=False)
    activo: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="true")
    granted_at: Mapped[dt.datetime] = mapped_column(
        TS, nullable=False, server_default=func.now()
    )
    granted_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT")
    )
    revoked_at: Mapped[dt.datetime | None] = mapped_column(TS)
    revoked_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT")
    )
    updated_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )


class UserFuncion(Base):
    """
    Las funciones transversales del personal propio: **Convenio** y
    **Contabilidad**. De cada una hay una sola persona.

    No entran por módulo ni por familia —su trabajo cruza todo el catálogo—, así
    que tienen tabla propia. Qué ve cada una está por definir: hoy el rol se
    asigna y nada más.
    """

    __tablename__ = "user_funcion"
    __table_args__ = (
        CheckConstraint("funcion IN ('convenio', 'contabilidad')", name="catalogo"),
        # Una fila por persona: cambiar de rol es UPDATE sobre ella.
        UniqueConstraint("user_id", name="uq_user_funcion_user_id"),
        # UNO SOLO de cada función, garantizado por la base sobre las vivas.
        Index("uq_user_funcion_unica", "funcion", unique=True, postgresql_where="activo"),
    )

    id: Mapped[uuid.UUID] = columna_pk_uuid()
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    funcion: Mapped[str] = mapped_column(String(20), nullable=False)
    activo: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="true")
    granted_at: Mapped[dt.datetime] = mapped_column(
        TS, nullable=False, server_default=func.now()
    )
    granted_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT")
    )
    revoked_at: Mapped[dt.datetime | None] = mapped_column(TS)
    revoked_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT")
    )
    updated_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )


class UserAseguradoraCoordinador(Base):
    """
    El coordinador de una compañía: UNO por aseguradora, y entra a todos los
    módulos que ella tenga habilitados.

    Como el alcance es «lo que su compañía tenga marcado», no se guarda ninguna
    lista: se calcula de `aseguradora_modulos`. Contratar un módulo se lo da;
    destildarlo se lo quita. El operador, en cambio, sigue entrando por
    `user_module_access`, módulo a módulo.
    """

    __tablename__ = "user_aseguradora_coordinador"
    __table_args__ = (
        # Una fila por persona: cambiar de rol es UPDATE sobre ella.
        UniqueConstraint("user_id", name="uq_user_aseguradora_coordinador_user_id"),
        # UNO SOLO por compañía, garantizado por la base sobre las filas vivas.
        Index(
            "uq_user_aseguradora_coordinador_unico",
            "aseguradora_id",
            unique=True,
            postgresql_where="activo",
        ),
    )

    id: Mapped[uuid.UUID] = columna_pk_uuid()
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    # Redundante con `users.aseguradora_id` a propósito: sin ella no se puede
    # escribir el índice «uno por compañía», que es la regla entera.
    aseguradora_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("aseguradoras.id", ondelete="RESTRICT"), nullable=False
    )
    activo: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="true")
    granted_at: Mapped[dt.datetime] = mapped_column(
        TS, nullable=False, server_default=func.now()
    )
    granted_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT")
    )
    revoked_at: Mapped[dt.datetime | None] = mapped_column(TS)
    revoked_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT")
    )
    updated_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )


class UserCoberturaAccess(Base):
    """
    Estrecha el acceso a un módulo que tiene coberturas. `user_module_access`
    sigue siendo la puerta —una fila por usuario y módulo, revocable al instante—;
    esta tabla dice a cuáles de sus coberturas entra y con qué rol.

    El rol es propio y no heredado: el rol se elige por requerimiento, así que la
    misma persona puede ser supervisora en Vida y operadora en Vida desgravamen.
    """

    __tablename__ = "user_cobertura_access"
    __table_args__ = (
        UniqueConstraint(
            "user_id",
            "module_code",
            "cobertura_codigo",
            name="uq_user_cobertura_access_user_id_module_code_cobertura_codigo",
        ),
        CheckConstraint(
            "module_code = 'calificacion' AND cobertura_codigo IN "
            "('vida', 'asistencia_medica', 'vida_desgravamen')",
            name="catalogo",
        ),
        # No se puede conceder una cobertura de un módulo al que el usuario no
        # entra: lo garantiza la base, no una comprobación de servicio.
        ForeignKeyConstraint(
            ["user_id", "module_code"],
            ["user_module_access.user_id", "user_module_access.module_code"],
            ondelete="RESTRICT",
            name="fk_user_cobertura_access_user_module_access",
        ),
        ForeignKeyConstraint(
            ["role_id", "module_code"],
            ["roles.id", "roles.module_code"],
            ondelete="RESTRICT",
            name="fk_user_cobertura_access_role_id_roles",
        ),
        Index("ix_user_cobertura_access_role_id", "role_id"),
    )

    id: Mapped[uuid.UUID] = columna_pk_uuid()
    user_id: Mapped[uuid.UUID] = mapped_column(nullable=False)
    module_code: Mapped[str] = mapped_column(String(30), nullable=False)
    cobertura_codigo: Mapped[str] = mapped_column(String(30), nullable=False)
    role_id: Mapped[uuid.UUID] = mapped_column(nullable=False)

    activo: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="true")
    granted_at: Mapped[dt.datetime] = mapped_column(TS, nullable=False, server_default=func.now())
    granted_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT")
    )
    revoked_at: Mapped[dt.datetime | None] = mapped_column(TS)
    revoked_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT")
    )


class PasswordSetupToken(Base):
    """
    Invitación para fijar la contraseña. Del token opaco de 256 bits solo se
    guarda su SHA-256, igual que en `sessions`: quien lea la base no puede fijar
    la contraseña de nadie. De un solo uso y con caducidad.
    """

    __tablename__ = "password_setup_tokens"
    __table_args__ = (
        UniqueConstraint("token_hash", name="uq_password_setup_tokens_token_hash"),
        Index(
            "ix_password_setup_tokens_user_id", "user_id", postgresql_where="used_at IS NULL"
        ),
        Index("ix_password_setup_tokens_expires_at", "expires_at"),
    )

    id: Mapped[uuid.UUID] = columna_pk_uuid()
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    expires_at: Mapped[dt.datetime] = mapped_column(TS, nullable=False)
    used_at: Mapped[dt.datetime | None] = mapped_column(TS)
    created_at: Mapped[dt.datetime] = mapped_column(TS, nullable=False, server_default=func.now())
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT")
    )
