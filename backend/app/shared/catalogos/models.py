from __future__ import annotations

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    ForeignKey,
    Index,
    SmallInteger,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, MarcasTiempoMixin


class Module(Base, MarcasTiempoMixin):
    """
    Catálogo de módulos. Es la ÚNICA fuente de verdad en runtime: no existe ningún
    registro de módulos en código Python que autorice nada. Apagar un módulo con
    activo=False surte efecto inmediato en login, selector y autorización, sin desplegar.

    Doble identificador: `code` (snake_case) es la identidad canónica — PK, destino de
    todas las FKs, nombre del paquete Python y prefijo de sus tablas. `slug` (kebab-case)
    es la identidad pública — ruta del frontend y segmento de la API. La conversión
    slug → code ocurre en un solo sitio: la dependencia que resuelve el módulo de la ruta.
    """

    __tablename__ = "modules"
    __table_args__ = (
        CheckConstraint(r"code ~ '^[a-z][a-z0-9_]{1,29}$'", name="code_formato"),
        CheckConstraint(r"slug ~ '^[a-z][a-z0-9-]{1,29}$'", name="slug_formato"),
        CheckConstraint("grupo IN ('suscripcion', 'siniestro')", name="grupo_catalogo"),
    )

    code: Mapped[str] = mapped_column(String(30), primary_key=True)
    slug: Mapped[str] = mapped_column(String(30), nullable=False, unique=True)
    nombre: Mapped[str] = mapped_column(String(80), nullable=False)
    descripcion: Mapped[str | None] = mapped_column(String(300))
    icono: Mapped[str] = mapped_column(String(60), nullable=False)
    color_acento: Mapped[str] = mapped_column(String(30), nullable=False)
    orden: Mapped[int] = mapped_column(SmallInteger, nullable=False, server_default="0")
    activo: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="true")
    # La familia comercial (Suscripción | Siniestro) con la que se agrupa en las
    # pantallas. Pura presentación: no autoriza nada. Nulable: los retirados no la llevan.
    grupo: Mapped[str | None] = mapped_column(String(20))
    # La rama dentro de la familia («siniestros_hospitalarios»…). Presentación
    # pura, como `grupo`. Sin CHECK: solo lo escriben migraciones, y cada rama
    # nueva debe entrar sin ALTER.
    subgrupo: Mapped[str | None] = mapped_column(String(40))


class TipoDocumento(Base, MarcasTiempoMixin):
    __tablename__ = "tipos_documento"

    codigo: Mapped[str] = mapped_column(String(10), primary_key=True)
    nombre: Mapped[str] = mapped_column(String(60), nullable=False)
    # El formato es dato, no lógica: el service valida numero_documento con este regex.
    regex_validacion: Mapped[str | None] = mapped_column(String(100))
    activo: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="true")


class Provincia(Base, MarcasTiempoMixin):
    __tablename__ = "provincias"

    codigo: Mapped[str] = mapped_column(String(2), primary_key=True)  # código INEC
    nombre: Mapped[str] = mapped_column(String(60), nullable=False, unique=True)
    activo: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="true")


class Ciudad(Base, MarcasTiempoMixin):
    """
    Cantones del Ecuador. Código DPA de 4 dígitos del INEC: los dos primeros son
    la provincia, los dos siguientes el cantón dentro de ella. Se llama `ciudades`
    y no `cantones` porque es como lo pide y lo lee el usuario del sistema.
    """

    __tablename__ = "ciudades"
    __table_args__ = (
        # Redundante con la PK, pero habilita la FK compuesta desde aseguradoras:
        # sin ella no se puede garantizar en la base que la ciudad pertenezca a
        # la provincia elegida.
        UniqueConstraint("codigo", "provincia_codigo", name="uq_ciudades_codigo_provincia_codigo"),
        Index("ix_ciudades_provincia_codigo", "provincia_codigo"),
    )

    codigo: Mapped[str] = mapped_column(String(4), primary_key=True)
    provincia_codigo: Mapped[str] = mapped_column(
        String(2), ForeignKey("provincias.codigo", ondelete="RESTRICT"), nullable=False
    )
    nombre: Mapped[str] = mapped_column(String(80), nullable=False)
    activo: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="true")


class TipoPrestador(Base, MarcasTiempoMixin):
    __tablename__ = "tipos_prestador"

    codigo: Mapped[str] = mapped_column(String(20), primary_key=True)
    nombre: Mapped[str] = mapped_column(String(100), nullable=False)
    # Gobierna la validación: si es persona, el service exige especialidad y
    # registro profesional y prohíbe registro sanitario.
    es_persona: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false")
    activo: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="true")
