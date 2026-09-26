from __future__ import annotations

import datetime as dt
import uuid

from sqlalchemy import CheckConstraint, ForeignKey, Index, String, Text, text
from sqlalchemy.dialects.postgresql import CITEXT
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import TS, AuditoriaFilaMixin, Base, BorradoLogicoMixin, columna_pk_uuid

# Escrito tal como Postgres normaliza la expresión, para que `autogenerate` no vea
# una diferencia en cada ejecución.
CODIGO_INTERNO_DEFAULT = (
    "('CONC-'::text || lpad((nextval('conc_visitas_codigo_interno_seq'::regclass))::text, "
    "4, '0'::text))"
)

ESTADOS = (
    "programada",
    "asignada",
    "auditando",
    "cancelada",
    "culminada",
    "no_auditado",
)


class Visita(Base, AuditoriaFilaMixin, BorradoLogicoMixin):
    """
    La ida del médico auditor a un prestador de la red, en una ventana de fecha y
    hora. Es el expediente raíz del módulo, así que lleva `aseguradora_id`: sin
    esa columna no habría forma de acotar la bandeja a la compañía del usuario.

    Que el prestador esté en la red de esa aseguradora, y que la sede sea suya, se
    validan en el servicio. Ninguna de las dos puede ser una FK: el convenio tiene
    unicidad parcial y un índice parcial no respalda claves foráneas, y la sede
    exigiría un UNIQUE redundante en una tabla del núcleo, que es justo lo que la
    regla de escalar a ocho módulos evita.
    """

    __tablename__ = "conc_visitas"
    __table_args__ = (
        CheckConstraint("hasta > desde", name="ventana"),
        # Seis estados, y **ninguno se elige**: cada uno lo pone una acción.
        #
        #   programada  nace así al crearse
        #   asignada    el coordinador la deriva a un auditor
        #   auditando   el auditor marca «Ya llegué» en la app
        #   culminada   el auditor envía el informe
        #   cancelada   el operador la cancela, mientras nadie haya llegado
        #   no_auditado la ventana venció sin llegada (lo aplica una tarea)
        #
        # Por eso no hay ningún desplegable de estado en la interfaz: el estado
        # es una consecuencia de lo que pasó, no un campo que se teclea.
        CheckConstraint(
            "estado IN ('programada','asignada','auditando','cancelada','culminada','no_auditado')",
            name="estado",
        ),
        Index("uq_conc_visitas_codigo_interno", "codigo_interno", unique=True),
        # El índice de la bandeja: lo de MI aseguradora, ordenado por fecha.
        Index(
            "ix_conc_visitas_bandeja",
            "aseguradora_id",
            "desde",
            postgresql_where="deleted_at IS NULL",
        ),
        Index(
            "ix_conc_visitas_prestador_id",
            "prestador_id",
            postgresql_where="deleted_at IS NULL",
        ),
        # La bandeja del auditor del futuro: «mis casos», vivos.
        Index(
            "ix_conc_visitas_auditor_id",
            "auditor_id",
            postgresql_where="deleted_at IS NULL AND auditor_id IS NOT NULL",
        ),
    )

    id: Mapped[uuid.UUID] = columna_pk_uuid()
    codigo_interno: Mapped[str] = mapped_column(
        String(20), nullable=False, server_default=text(CODIGO_INTERNO_DEFAULT)
    )
    aseguradora_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("aseguradoras.id", ondelete="RESTRICT"), nullable=False
    )
    prestador_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("prestadores.id", ondelete="RESTRICT"), nullable=False
    )
    # El paciente ES el caso: sin él no hay nada que auditar. Los cuatro campos
    # obligatorios; el formato del número lo valida el servicio contra el regex
    # del catálogo, igual que en los contactos.
    paciente_nombre_principal: Mapped[str] = mapped_column(String(100), nullable=False)
    paciente_nombre_secundario: Mapped[str | None] = mapped_column(String(100))
    paciente_apellido_paterno: Mapped[str] = mapped_column(String(100), nullable=False)
    paciente_apellido_materno: Mapped[str | None] = mapped_column(String(100))
    paciente_tipo_documento_codigo: Mapped[str] = mapped_column(
        ForeignKey("tipos_documento.codigo", ondelete="RESTRICT"), nullable=False
    )
    paciente_numero_documento: Mapped[str] = mapped_column(String(20), nullable=False)
    # NULL cuando el prestador no tiene sedes: se visita su dirección principal.
    sede_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("prestador_sedes.id", ondelete="RESTRICT")
    )
    desde: Mapped[dt.datetime] = mapped_column(TS, nullable=False)
    hasta: Mapped[dt.datetime] = mapped_column(TS, nullable=False)
    estado: Mapped[str] = mapped_column(String(20), nullable=False, server_default="programada")
    observaciones: Mapped[str | None] = mapped_column(Text)
    # La imagen que comprueba el cambio de horario pedido por correo. Solo la
    # ruta relativa dentro del volumen de subidas, como los logos.
    comprobante_horario_path: Mapped[str | None] = mapped_column(String(300))
    # A qué médico auditor se derivó el caso. NULL = todavía sin asignar. Quién
    # puede asignar y a quién lo decide el servicio; RESTRICT garantiza que un
    # auditor con casos no se pueda borrar.
    auditor_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT")
    )
    # El informe vigente del caso, redactado por la IA a partir de las notas del
    # auditor. Regenerarlo lo reemplaza; la película la lleva AuditLog.
    informe: Mapped[str | None] = mapped_column(Text)
    informe_actualizado_at: Mapped[dt.datetime | None] = mapped_column(TS)
    # Cuándo tocó «Ya llegué» el auditor. Nulo = nunca llegó: si la ventana
    # vence así, la tarea del servidor marca el caso como no_auditado.
    llegada_at: Mapped[dt.datetime | None] = mapped_column(TS)


class VisitaCorreo(Base, AuditoriaFilaMixin, BorradoLogicoMixin):
    """A quién se avisa de la visita. Tabla aparte porque son varios por visita."""

    __tablename__ = "conc_visita_correos"
    __table_args__ = (
        Index(
            "ix_conc_visita_correos_visita_id",
            "visita_id",
            postgresql_where="deleted_at IS NULL",
        ),
        Index(
            "uq_conc_visita_correos_email",
            "visita_id",
            "email",
            unique=True,
            postgresql_where="deleted_at IS NULL",
        ),
    )

    id: Mapped[uuid.UUID] = columna_pk_uuid()
    visita_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("conc_visitas.id", ondelete="RESTRICT"), nullable=False
    )
    email: Mapped[str] = mapped_column(CITEXT, nullable=False)
    # Quién es esa persona: los contactos marcados la heredan de su ficha
    # («RODOLFO ALARCON · Gerente General»); los tecleados a mano la escriben.
    etiqueta: Mapped[str | None] = mapped_column(String(120))


# Lo que el auditor dicta en el hospital, por tipo de fuente.
# Los tipos que se pueden DICTAR hoy. «charla_enfermeria» se retiró del flujo
# (sep 2026) pero sigue en el CHECK de la tabla: las notas ya dictadas se
# conservan y se muestran; solo no se crean nuevas.
TIPOS_NOTA = ("historial_clinico", "charla_medico", "observacion")


class VisitaNota(Base, AuditoriaFilaMixin, BorradoLogicoMixin):
    """
    Una nota dictada por el auditor durante la visita: el historial clínico del
    paciente, una charla con el médico, o una observación suelta (las charlas
    con enfermería existen solo como legado). Son la materia prima del informe
    que redacta la IA.
    """

    __tablename__ = "conc_visita_notas"
    __table_args__ = (
        CheckConstraint(
            "tipo IN ('historial_clinico','charla_enfermeria','charla_medico','observacion')",
            name="tipo",
        ),
        Index(
            "ix_conc_visita_notas_visita_id",
            "visita_id",
            postgresql_where="deleted_at IS NULL",
        ),
    )

    id: Mapped[uuid.UUID] = columna_pk_uuid()
    visita_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("conc_visitas.id", ondelete="RESTRICT"), nullable=False
    )
    tipo: Mapped[str] = mapped_column(String(30), nullable=False)
    texto: Mapped[str] = mapped_column(Text, nullable=False)


class VisitaFoto(Base, AuditoriaFilaMixin, BorradoLogicoMixin):
    """
    Una foto tomada por el auditor durante la visita: hojas del expediente,
    resultados, la pizarra de enfermería. Acompañan a las notas como materia
    prima del informe —la IA las recibe junto al dictado—. Aquí vive solo la
    ruta relativa dentro del volumen de subidas, como el comprobante de horario.
    """

    __tablename__ = "conc_visita_fotos"
    __table_args__ = (
        Index(
            "ix_conc_visita_fotos_visita_id",
            "visita_id",
            postgresql_where="deleted_at IS NULL",
        ),
    )

    id: Mapped[uuid.UUID] = columna_pk_uuid()
    visita_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("conc_visitas.id", ondelete="RESTRICT"), nullable=False
    )
    ruta: Mapped[str] = mapped_column(String(300), nullable=False)
