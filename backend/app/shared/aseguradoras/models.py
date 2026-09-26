from __future__ import annotations

import datetime as dt
import uuid
from decimal import Decimal

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Numeric,
    String,
    Text,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import CITEXT
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import (
    COORDENADA,
    IMPORTE,
    AuditoriaFilaMixin,
    Base,
    BorradoLogicoMixin,
    MarcasTiempoMixin,
    columna_pk_uuid,
)

# Escrito tal como Postgres normaliza la expresión al guardarla. Si se escribiera
# en su forma "bonita", `alembic autogenerate` vería una diferencia en cada
# ejecución y el diff vacío dejaría de servir como comprobación.
CODIGO_INTERNO_DEFAULT = (
    "('ASEG-'::text || lpad((nextval('aseguradoras_codigo_interno_seq'::regclass))::text, "
    "4, '0'::text))"
)


class Aseguradora(Base, AuditoriaFilaMixin, BorradoLogicoMixin):
    __tablename__ = "aseguradoras"
    __table_args__ = (
        CheckConstraint(r"ruc ~ '^[0-9]{13}$'", name="ruc_formato"),
        CheckConstraint(
            "tipo IN ('publica','privada','medicina_prepagada')", name="tipo"
        ),
        CheckConstraint("estado IN ('activo','inactivo')", name="estado"),
        CheckConstraint("latitud BETWEEN -90 AND 90", name="latitud"),
        CheckConstraint("longitud BETWEEN -180 AND 180", name="longitud"),
        # La ciudad debe pertenecer a la provincia elegida, y eso lo garantiza la
        # base, no una validación de servicio. Con ambas nulas o solo la provincia
        # puesta, la restricción se satisface (MATCH SIMPLE).
        ForeignKeyConstraint(
            ["ciudad_codigo", "provincia_codigo"],
            ["ciudades.codigo", "ciudades.provincia_codigo"],
            ondelete="RESTRICT",
            name="fk_aseguradoras_ciudad_codigo_ciudades",
        ),
        Index("uq_aseguradoras_ruc", "ruc", unique=True, postgresql_where="deleted_at IS NULL"),
        Index("uq_aseguradoras_codigo_interno", "codigo_interno", unique=True),
        # El listado exige búsqueda server-side: con B-tree un ILIKE '%anda%' es seq scan.
        Index(
            "ix_aseguradoras_razon_social_trgm",
            "razon_social",
            postgresql_using="gin",
            postgresql_ops={"razon_social": "gin_trgm_ops"},
        ),
        Index(
            "ix_aseguradoras_nombre_comercial_trgm",
            "nombre_comercial",
            postgresql_using="gin",
            postgresql_ops={"nombre_comercial": "gin_trgm_ops"},
        ),
        Index(
            "ix_aseguradoras_listado",
            "estado",
            "created_at",
            postgresql_where="deleted_at IS NULL",
        ),
        # A lo sumo UNA ficha propia (la de Accumedical, para «Red convenio»).
        Index("uq_aseguradoras_propia", "es_propia", unique=True, postgresql_where="es_propia"),
    )

    id: Mapped[uuid.UUID] = columna_pk_uuid()
    # Identificador legible y autogenerado por una secuencia de la base: dos altas
    # simultáneas no pueden obtener el mismo número, cosa que sí pasaría calculando
    # el siguiente código en la aplicación.
    codigo_interno: Mapped[str] = mapped_column(
        String(20), nullable=False, server_default=text(CODIGO_INTERNO_DEFAULT)
    )
    razon_social: Mapped[str] = mapped_column(String(200), nullable=False)
    nombre_comercial: Mapped[str | None] = mapped_column(String(200))
    ruc: Mapped[str] = mapped_column(String(13), nullable=False)
    # Se conserva a la espera de definir su uso; ya no es obligatorio.
    tipo: Mapped[str | None] = mapped_column(String(30))
    provincia_codigo: Mapped[str | None] = mapped_column(
        String(2), ForeignKey("provincias.codigo", ondelete="RESTRICT")
    )
    ciudad_codigo: Mapped[str | None] = mapped_column(String(4))
    direccion_fiscal: Mapped[str | None] = mapped_column(String(300))
    # Punto exacto en el mapa. Obligatorio: la dirección escrita ubica de forma
    # aproximada, el par de coordenadas ubica de verdad.
    latitud: Mapped[Decimal] = mapped_column(COORDENADA, nullable=False)
    longitud: Mapped[Decimal] = mapped_column(COORDENADA, nullable=False)
    # Dato de negocio, independiente del borrado lógico: desactivar no es eliminar.
    estado: Mapped[str] = mapped_column(String(20), nullable=False, server_default="activo")
    # Ruta relativa del archivo ya validado. Nunca URL absoluta ni nombre original.
    logo_path: Mapped[str | None] = mapped_column(String(500))
    # La ficha interna de Accumedical: dueña de la «Red convenio» propia. Nunca
    # aparece en el listado ni en selectores; solo existe una (índice parcial).
    es_propia: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false")


class AseguradoraPoliza(Base, AuditoriaFilaMixin, BorradoLogicoMixin):
    """
    Un documento PDF de pólizas y planes de la aseguradora: el nombre visible
    con el que se enseña, y la ruta relativa del archivo en el volumen de
    subidas (validado por contenido real, nombre UUID, fuera del árbol
    ejecutable — como el logo). Retirarlo es borrado lógico.
    """

    __tablename__ = "aseguradora_polizas"
    __table_args__ = (
        CheckConstraint(
            "categoria IN ('polizas', 'cobertura_condiciones', 'sla', 'convenios')",
            name="categoria_catalogo",
        ),
        Index(
            "ix_aseguradora_polizas_aseguradora_id",
            "aseguradora_id",
            postgresql_where="deleted_at IS NULL",
        ),
    )

    id: Mapped[uuid.UUID] = columna_pk_uuid()
    aseguradora_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("aseguradoras.id", ondelete="RESTRICT"), nullable=False
    )
    nombre: Mapped[str] = mapped_column(String(160), nullable=False)
    ruta: Mapped[str] = mapped_column(String(500), nullable=False)
    # La pestaña a la que pertenece: pólizas y planes, cobertura y condiciones,
    # SLA o convenios. Mismo panel, cuatro cajones.
    categoria: Mapped[str] = mapped_column(
        String(30), nullable=False, server_default="polizas"
    )


# Las categorías válidas de documentos, espejo del CHECK de la tabla.
CATEGORIAS_DOCUMENTO = ("polizas", "cobertura_condiciones", "sla", "convenios")


class AseguradoraPrestador(Base, AuditoriaFilaMixin, BorradoLogicoMixin):
    """
    El convenio: la relación entre aseguradora y prestador. No es una M2M simple,
    lleva vigencia y estado propios. Tiene PK surrogate para que un expediente de
    módulo pueda referenciar EL CONVENIO CONCRETO bajo el que se emitió y conserve
    su anclaje contractual histórico aunque después se renegocie.
    """

    __tablename__ = "aseguradora_prestador"
    __table_args__ = (
        CheckConstraint("estado IN ('vigente','suspendido','terminado')", name="estado"),
        CheckConstraint("fecha_fin IS NULL OR fecha_fin >= fecha_inicio", name="fechas"),
        # Un convenio que no cubre ninguna red no es un convenio. Las dos a la
        # vez sí: eso es «ambas», y por eso son dos casillas y no un valor con
        # tres opciones que habría que acordarse de incluir en cada consulta.
        CheckConstraint("red_privada OR red_publica", name="red"),
        Index(
            "uq_aseguradora_prestador_par",
            "aseguradora_id",
            "prestador_id",
            unique=True,
            postgresql_where="deleted_at IS NULL",
        ),
        Index("ix_aseguradora_prestador_prestador_id", "prestador_id"),
    )

    id: Mapped[uuid.UUID] = columna_pk_uuid()
    aseguradora_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("aseguradoras.id", ondelete="RESTRICT"), nullable=False
    )
    prestador_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("prestadores.id", ondelete="RESTRICT"), nullable=False
    )
    codigo_convenio: Mapped[str | None] = mapped_column(String(50))
    # Qué red cubre el convenio. Marcar las dos significa ambas.
    red_privada: Mapped[bool] = mapped_column(nullable=False, server_default="true")
    red_publica: Mapped[bool] = mapped_column(nullable=False, server_default="false")
    fecha_inicio: Mapped[dt.date] = mapped_column(
        Date, nullable=False, server_default=func.current_date()
    )
    fecha_fin: Mapped[dt.date | None] = mapped_column(Date)
    estado: Mapped[str] = mapped_column(String(20), nullable=False, server_default="vigente")
    observaciones: Mapped[str | None] = mapped_column(Text)
    # El listado de precios pactado: UN archivo (PDF o Excel) por convenio.
    # Subir otro lo reemplaza; el anterior queda en el volumen como evidencia.
    listado_precios_ruta: Mapped[str | None] = mapped_column(String(500))
    listado_precios_nombre: Mapped[str | None] = mapped_column(String(160))


class AseguradoraModulo(Base):
    """
    A qué módulos puede entrar una aseguradora. Es la tabla que alimenta las
    casillas de la pestaña Requerimientos.

    Destildar una casilla pone `activo = False` y conserva la fila con quién y
    cuándo la revocó, en lugar de borrarla: queda rastro y se respeta la regla de
    que aquí no hay borrado físico. Las casillas se generan a partir de `modules`,
    así que agregar un módulo nuevo hace aparecer su casilla sin tocar código.
    """

    __tablename__ = "aseguradora_modulos"
    __table_args__ = (
        # Responde "¿qué aseguradoras tienen habilitado el módulo X?", que es la
        # consulta que harán los módulos cuando tengan lógica propia.
        Index("ix_aseguradora_modulos_module_code", "module_code"),
    )

    aseguradora_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("aseguradoras.id", ondelete="RESTRICT"), primary_key=True
    )
    module_code: Mapped[str] = mapped_column(
        String(30), ForeignKey("modules.code", ondelete="RESTRICT"), primary_key=True
    )
    activo: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="true")
    granted_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    granted_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT")
    )
    revoked_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))
    revoked_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT")
    )
    updated_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )


class AseguradoraSla(Base, MarcasTiempoMixin):
    """
    Lo pactado con la compañía para cada módulo que tiene contratado: las horas
    de SLA y el precio. Ambos opcionales, porque se van acordando.

    Destildar el módulo NO borra la fila —la FK compuesta solo exige que exista,
    no que esté activa—: un acuerdo se conserva y reaparece si el módulo vuelve
    a marcarse.
    """

    __tablename__ = "aseguradora_sla"
    __table_args__ = (
        CheckConstraint(
            "(horas IS NULL OR horas >= 0) AND (precio IS NULL OR precio >= 0)",
            name="importes",
        ),
        ForeignKeyConstraint(
            ["aseguradora_id", "module_code"],
            ["aseguradora_modulos.aseguradora_id", "aseguradora_modulos.module_code"],
            ondelete="RESTRICT",
            name="fk_aseguradora_sla_modulo",
        ),
    )

    aseguradora_id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    module_code: Mapped[str] = mapped_column(String(30), primary_key=True)
    # Obligatorios desde `c3f7b8e1d952`: un módulo contratado sin SLA es un
    # acuerdo a medias. Numeric y no entero: media hora es pactable.
    horas: Mapped[Decimal] = mapped_column(Numeric(6, 2), nullable=False)
    precio: Mapped[Decimal] = mapped_column(IMPORTE, nullable=False)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT")
    )
    updated_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT")
    )


class AseguradoraCobertura(Base):
    """
    Coberturas contratadas por una aseguradora dentro de un módulo. Son subramas:
    hoy solo `calificacion` tiene (vida, asistencia médica y vida desgravamen).

    No hay tabla de catálogo, por decisión explícita: las coberturas válidas viven
    en el CHECK y en la constante COBERTURAS del servicio. Añadir una, o dárselas a
    otro módulo, exige migración.
    """

    __tablename__ = "aseguradora_coberturas"
    __table_args__ = (
        # La aseguradora debe tener fila para ese módulo. Basta con que exista,
        # aunque esté inactiva: es justo lo que permite conservar las coberturas
        # al destildar el módulo.
        ForeignKeyConstraint(
            ["aseguradora_id", "module_code"],
            ["aseguradora_modulos.aseguradora_id", "aseguradora_modulos.module_code"],
            ondelete="RESTRICT",
            name="fk_aseguradora_coberturas_modulo",
        ),
        CheckConstraint(
            "module_code = 'calificacion' AND cobertura_codigo IN "
            "('vida', 'asistencia_medica', 'vida_desgravamen')",
            name="catalogo",
        ),
    )

    aseguradora_id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    module_code: Mapped[str] = mapped_column(String(30), primary_key=True)
    cobertura_codigo: Mapped[str] = mapped_column(String(40), primary_key=True)
    activo: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="true")
    granted_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    granted_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT")
    )
    revoked_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))
    revoked_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT")
    )
    updated_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )


class AseguradoraContacto(Base, AuditoriaFilaMixin, BorradoLogicoMixin):
    """
    Personas de contacto de una aseguradora. Nombre, apellido y correo son
    obligatorios; teléfono y documento, opcionales.

    El tipo de documento sale del catálogo `tipos_documento` que ya existía
    (cédula, RUC, pasaporte), lo que además permite validar el número contra su
    `regex_validacion` sin hardcodear formatos.
    """

    __tablename__ = "aseguradora_contactos"
    __table_args__ = (
        # El documento es opcional, pero a medias no: o tipo y número, o ninguno.
        CheckConstraint(
            "(tipo_documento_codigo IS NULL) = (numero_documento IS NULL)",
            name="documento",
        ),
        Index(
            "ix_aseguradora_contactos_aseguradora_id",
            "aseguradora_id",
            postgresql_where="deleted_at IS NULL",
        ),
        # Unicidad PARCIAL: un correo borrado lógicamente no debe impedir volver
        # a darlo de alta.
        Index(
            "uq_aseguradora_contactos_email",
            "aseguradora_id",
            "email",
            unique=True,
            postgresql_where="deleted_at IS NULL",
        ),
    )

    id: Mapped[uuid.UUID] = columna_pk_uuid()
    aseguradora_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("aseguradoras.id", ondelete="RESTRICT"), nullable=False
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


# Los conceptos que se pactan en un convenio y cómo se pacta cada uno. El
# orden es el de la pantalla, de arriba hacia abajo.
CONCEPTOS_FC = (
    "cirugia",
    "anestesia",
    "evaluacion_manejo",
    "uci",
    "ucin",
    "recien_nacido",
    "medicina",
    "imagenologia",
    # Va al final porque es el único que nace como porcentaje de otro.
    "ayudante",
)

# Las tres formas de pactar un concepto:
#   punto      → el número es el valor de CADA PUNTO del tarifario; se multiplica
#                por los puntos del procedimiento.
#   porcentaje → un tanto por ciento de OTRO concepto, el que diga `base`.
#   fijo       → un importe cerrado, que no se multiplica por nada.
MODOS_FC = ("punto", "porcentaje", "fijo")

_EN_LISTA = ", ".join(f"'{c}'" for c in CONCEPTOS_FC)


class ConvenioFC(Base, MarcasTiempoMixin):
    """
    **Un concepto pactado del convenio, por fila**: el Factor de Cobertura.

    Antes era una tabla de una sola fila con una columna por concepto, y cada
    uno tenía su forma congelada en el esquema —Cirugía era un valor, Ayudante
    un porcentaje, la UCI fija o por puntos—. Desde `b4f1a72c9e38` cada concepto
    **elige** cómo se pacta, así que la forma pasa a ser un dato (`modo`) y no
    una columna distinta: seis filas iguales en vez de doce columnas y seis
    CHECK repetidos.

    Que no haya fila para un concepto responde sin ambigüedad a «ese no se ha
    pactado todavía».

    Los importes derivados NO se guardan: un porcentaje vale `valor de la base
    × porcentaje / 100`, y almacenarlo sería duplicar un dato que puede quedar
    desincronizado del que lo origina.
    """

    __tablename__ = "aseguradora_prestador_fc"
    __table_args__ = (
        CheckConstraint(f"concepto IN ({_EN_LISTA})", name="concepto"),
        CheckConstraint("modo IN ('punto','porcentaje','fijo')", name="modo"),
        CheckConstraint(f"base IS NULL OR base IN ({_EN_LISTA})", name="base"),
        # La base existe exactamente cuando hace falta: un porcentaje sin decir
        # de qué no es liquidable, y un importe con base sobra.
        CheckConstraint(
            "(modo = 'porcentaje') = (base IS NOT NULL)", name="base_solo_en_porcentaje"
        ),
        CheckConstraint("base IS NULL OR base <> concepto", name="base_distinta"),
        # Un porcentaje va de 0 a 100; lo demás es dinero y no es negativo.
        CheckConstraint(
            "valor IS NULL "
            "OR (modo = 'porcentaje' AND valor BETWEEN 0 AND 100) "
            "OR (modo <> 'porcentaje' AND valor >= 0)",
            name="valor",
        ),
    )

    convenio_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("aseguradora_prestador.id", ondelete="RESTRICT"), primary_key=True
    )
    concepto: Mapped[str] = mapped_column(String(30), primary_key=True)
    modo: Mapped[str] = mapped_column(String(12), nullable=False)
    # Nulo mientras el concepto está pactado pero sin cifra todavía.
    valor: Mapped[Decimal | None] = mapped_column(IMPORTE)
    # De qué concepto sale el porcentaje. Nulo en los otros dos modos. Que la
    # base no sea a su vez un porcentaje —una cadena— lo comprueba el servicio:
    # es una regla ENTRE filas, y en la base costaría un trigger, que este
    # proyecto no usa para que la lógica se lea en el código.
    base: Mapped[str | None] = mapped_column(String(30))
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT")
    )
    updated_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT")
    )
