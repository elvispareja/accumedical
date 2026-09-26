from __future__ import annotations

import uuid
from decimal import Decimal

from sqlalchemy import CHAR, CheckConstraint, ForeignKey, ForeignKeyConstraint, Index, String, text
from sqlalchemy.dialects.postgresql import CITEXT
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import (
    COORDENADA,
    AuditoriaFilaMixin,
    Base,
    BorradoLogicoMixin,
    columna_pk_uuid,
)

# Escrito tal como Postgres normaliza la expresión, para que `autogenerate` no vea
# una diferencia en cada ejecución.
CODIGO_INTERNO_DEFAULT = (
    "('PREST-'::text || lpad((nextval('prestadores_codigo_interno_seq'::regclass))::text, "
    "4, '0'::text))"
)


class Prestador(Base, AuditoriaFilaMixin, BorradoLogicoMixin):
    """
    Tabla única con catálogo de tipos, sin herencia por subtablas: los módulos
    referencian "un prestador" indistintamente (prestador_id) y con subtablas cada FK
    de módulo necesitaría resolución polimórfica, que Postgres no tiene.

    El catálogo `tipos_prestador` sigue distinguiendo un médico de un hospital con
    su `es_persona`, pero ya no gobierna ninguna validación: al retirarse el bloque
    de habilitación no quedan campos que enfrentar entre sí.
    """

    __tablename__ = "prestadores"
    __table_args__ = (
        CheckConstraint("estado IN ('activo','inactivo','suspendido')", name="estado"),
        CheckConstraint("latitud BETWEEN -90 AND 90", name="latitud"),
        CheckConstraint("longitud BETWEEN -180 AND 180", name="longitud"),
        CheckConstraint(r"ruc ~ '^[0-9]{13}$'", name="ruc_formato"),
        Index(
            "uq_prestadores_ruc",
            "ruc",
            unique=True,
            postgresql_where="deleted_at IS NULL",
        ),
        Index(
            "ix_prestadores_nombre_trgm",
            "nombre",
            postgresql_using="gin",
            postgresql_ops={"nombre": "gin_trgm_ops"},
        ),
        Index(
            "ix_prestadores_tipo_codigo",
            "tipo_codigo",
            postgresql_where="deleted_at IS NULL",
        ),
        Index("uq_prestadores_codigo_interno", "codigo_interno", unique=True),
        # Misma FK compuesta que en aseguradoras: la ciudad debe pertenecer a la
        # provincia elegida, garantizado por la base.
        ForeignKeyConstraint(
            ["ciudad_codigo", "provincia_codigo"],
            ["ciudades.codigo", "ciudades.provincia_codigo"],
            ondelete="RESTRICT",
            name="fk_prestadores_ciudad_codigo_ciudades",
        ),
    )

    id: Mapped[uuid.UUID] = columna_pk_uuid()
    # Identificador legible autogenerado por una secuencia de la base: PREST-0001.
    codigo_interno: Mapped[str] = mapped_column(
        String(20), nullable=False, server_default=text(CODIGO_INTERNO_DEFAULT)
    )
    tipo_codigo: Mapped[str] = mapped_column(
        String(20), ForeignKey("tipos_prestador.codigo", ondelete="RESTRICT"), nullable=False
    )
    nombre: Mapped[str] = mapped_column(String(200), nullable=False)
    # La identidad del prestador. Mismo formato y misma unicidad parcial que en
    # aseguradoras: no hay elección de tipo de documento porque solo hay uno.
    ruc: Mapped[str] = mapped_column(CHAR(13), nullable=False)
    direccion: Mapped[str | None] = mapped_column(String(300))
    provincia_codigo: Mapped[str | None] = mapped_column(
        String(2), ForeignKey("provincias.codigo", ondelete="RESTRICT")
    )
    ciudad_codigo: Mapped[str | None] = mapped_column(String(4))
    estado: Mapped[str] = mapped_column(String(20), nullable=False, server_default="activo")
    # Punto exacto en el mapa. Obligatorio: la dirección escrita ubica de forma
    # aproximada, el par de coordenadas ubica de verdad.
    latitud: Mapped[Decimal] = mapped_column(COORDENADA, nullable=False)
    longitud: Mapped[Decimal] = mapped_column(COORDENADA, nullable=False)
    # Ruta relativa del archivo ya validado. Nunca URL absoluta ni nombre original.
    logo_path: Mapped[str | None] = mapped_column(String(500))


class PrestadorContacto(Base, AuditoriaFilaMixin, BorradoLogicoMixin):
    """
    Personas de contacto de un prestador. Estructura idéntica a la de aseguradoras,
    pero en tabla propia: los prestadores tendrán campos que no aplican a una
    aseguradora, y con FK real la base garantiza que ningún contacto quede
    apuntando a un dueño inexistente.
    """

    __tablename__ = "prestador_contactos"
    __table_args__ = (
        CheckConstraint(
            "(tipo_documento_codigo IS NULL) = (numero_documento IS NULL)",
            name="documento",
        ),
        Index(
            "ix_prestador_contactos_prestador_id",
            "prestador_id",
            postgresql_where="deleted_at IS NULL",
        ),
        Index(
            "uq_prestador_contactos_email",
            "prestador_id",
            "email",
            unique=True,
            postgresql_where="deleted_at IS NULL",
        ),
    )

    id: Mapped[uuid.UUID] = columna_pk_uuid()
    prestador_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("prestadores.id", ondelete="RESTRICT"), nullable=False
    )
    # Cuatro partes, como toda persona (ver app/shared/personas.py).
    nombre_principal: Mapped[str] = mapped_column(String(100), nullable=False)
    nombre_secundario: Mapped[str | None] = mapped_column(String(100))
    apellido_paterno: Mapped[str] = mapped_column(String(100), nullable=False)
    apellido_materno: Mapped[str | None] = mapped_column(String(100))
    email: Mapped[str] = mapped_column(CITEXT, nullable=False)
    telefono: Mapped[str | None] = mapped_column(String(25))
    tipo_documento_codigo: Mapped[str | None] = mapped_column(
        String(10), ForeignKey("tipos_documento.codigo", ondelete="RESTRICT")
    )
    numero_documento: Mapped[str | None] = mapped_column(String(20))
    # Puesto que ocupa: «Gerente de Siniestros». Opcional.
    cargo: Mapped[str | None] = mapped_column(String(100))


class PrestadorSede(Base, AuditoriaFilaMixin, BorradoLogicoMixin):
    """
    Sitios donde atiende el prestador: matriz, sucursales, consultorios.

    Tener sedes es opcional; la sede que se crea, no: lleva nombre, ubicación
    administrativa, dirección y punto en el mapa, porque una sede sin punto no
    sirve para lo único que se le pide, saber dónde está.
    """

    __tablename__ = "prestador_sedes"
    __table_args__ = (
        CheckConstraint("estado IN ('activa','inactiva')", name="estado"),
        CheckConstraint("latitud BETWEEN -90 AND 90", name="latitud"),
        CheckConstraint("longitud BETWEEN -180 AND 180", name="longitud"),
        Index(
            "ix_prestador_sedes_prestador_id",
            "prestador_id",
            postgresql_where="deleted_at IS NULL",
        ),
        # Dos sedes con el mismo nombre en el mismo prestador es error de captura.
        Index(
            "uq_prestador_sedes_nombre",
            "prestador_id",
            "nombre",
            unique=True,
            postgresql_where="deleted_at IS NULL",
        ),
        # La misma FK compuesta de siempre: la ciudad pertenece a la provincia.
        ForeignKeyConstraint(
            ["ciudad_codigo", "provincia_codigo"],
            ["ciudades.codigo", "ciudades.provincia_codigo"],
            ondelete="RESTRICT",
            name="fk_prestador_sedes_ciudad_codigo_ciudades",
        ),
    )

    id: Mapped[uuid.UUID] = columna_pk_uuid()
    prestador_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("prestadores.id", ondelete="RESTRICT"), nullable=False
    )
    nombre: Mapped[str] = mapped_column(String(150), nullable=False)
    provincia_codigo: Mapped[str] = mapped_column(
        String(2), ForeignKey("provincias.codigo", ondelete="RESTRICT"), nullable=False
    )
    ciudad_codigo: Mapped[str] = mapped_column(String(4), nullable=False)
    direccion: Mapped[str] = mapped_column(String(300), nullable=False)
    telefono: Mapped[str | None] = mapped_column(String(25))
    email: Mapped[str | None] = mapped_column(CITEXT)
    latitud: Mapped[Decimal] = mapped_column(COORDENADA, nullable=False)
    longitud: Mapped[Decimal] = mapped_column(COORDENADA, nullable=False)
    estado: Mapped[str] = mapped_column(String(20), nullable=False, server_default="activa")
