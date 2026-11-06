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
    Integer,
    Numeric,
    String,
    Text,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import ARRAY, CITEXT
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import (
    COORDENADA,
    IMPORTE,
    PORCENTAJE,
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
        # Qué clase de cliente es (5/11/2026, pedido del usuario).
        CheckConstraint("tipo IN ('aseguradora','broker','cooperativa')", name="tipo"),
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
    # **Qué clase de cliente es** (5/11/2026, pedido del usuario): aseguradora,
    # broker o cooperativa. Antes era una columna reservada sin uso
    # (pública/privada/prepagada), vacía en todas las filas.
    tipo: Mapped[str] = mapped_column(
        String(30), nullable=False, server_default=text("'aseguradora'")
    )
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

# Cómo se cobra la tarifa a AccuMedical y quién financia los medicamentos
# (especificación de la Central, M1). Espejo de los CHECK de la tabla.
UNIDADES_TARIFA = ("asegurado_mes", "evento", "fija_mensual")
FORMAS_PAGO_MEDICAMENTOS = ("reembolso_aparte", "incluido_en_tarifa")


class AseguradoraContrato(Base, AuditoriaFilaMixin):
    """
    **Los datos del contrato o póliza** (6/11/2026, especificación de la
    Central, M1 «Clientes y contratos»): vigencia, tarifa a AccuMedical con su
    unidad, fecha de revisión de la tarifa y forma de pago de los medicamentos.

    Uno por PDF de la pestaña «Contratos y pólizas» (`aseguradora_polizas` con
    categoría `polizas`): el PDF es el contrato y esta fila, sus datos. Se suben
    juntos; los PDF anteriores a esta tabla no tienen fila hasta que alguien
    completa sus datos. Sin borrado propio: retirar el PDF retira el contrato, y
    cada cambio queda con su antes y después en AuditLog.

    La tarifa (lo que el cliente paga a AccuMedical) NO es la cobertura del
    paciente: esa va en el producto. Desde el 6/11/2026 la tarifa, su unidad y
    la forma de pago de los medicamentos van solo en el contrato de un cliente
    con Farmacovigilancia (las tres juntas o ninguna): en los demás módulos lo
    que cobra AccuMedical es el precio por módulo de la pestaña SLA.
    """

    __tablename__ = "aseguradora_contratos"
    __table_args__ = (
        CheckConstraint("vigencia_hasta >= vigencia_desde", name="vigencia"),
        CheckConstraint("tarifa >= 0", name="tarifa"),
        CheckConstraint(
            "tarifa_unidad IN ('asegurado_mes', 'evento', 'fija_mensual')", name="tarifa_unidad"
        ),
        CheckConstraint(
            "forma_pago_medicamentos IN ('reembolso_aparte', 'incluido_en_tarifa')",
            name="forma_pago_medicamentos",
        ),
        CheckConstraint(
            "revision_tarifa IS NULL OR revision_tarifa >= vigencia_desde",
            name="revision_tarifa",
        ),
        CheckConstraint(
            "(tarifa IS NULL) = (tarifa_unidad IS NULL)"
            " AND (tarifa IS NULL) = (forma_pago_medicamentos IS NULL)",
            name="tarifa_completa",
        ),
    )

    poliza_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("aseguradora_polizas.id", ondelete="RESTRICT"), primary_key=True
    )
    vigencia_desde: Mapped[dt.date] = mapped_column(Date, nullable=False)
    vigencia_hasta: Mapped[dt.date] = mapped_column(Date, nullable=False)
    # Cuatro decimales: «USD 0,045 por asegurado al mes» sobre 54.000 asegurados
    # ya son dólares de diferencia.
    tarifa: Mapped[Decimal | None] = mapped_column(Numeric(14, 4))
    tarifa_unidad: Mapped[str | None] = mapped_column(String(20))
    revision_tarifa: Mapped[dt.date | None] = mapped_column(Date)
    forma_pago_medicamentos: Mapped[str | None] = mapped_column(String(30))


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



class AseguradoraProducto(Base, AuditoriaFilaMixin, BorradoLogicoMixin):
    """
    **Los productos del cliente** (5/11/2026, pedido del usuario), de cualquier
    tipo desde el 6/11: nombre, valor y porcentaje, en la pestaña «Producto».
    Cada producto es exclusivo de su cliente.
    Se editan como lista con la ficha, igual que los contactos, y viajan a la
    central como una ficha más (`aseguradora_productos`). Quitar uno lo da de
    baja lógica: en medicina no se borra nada.
    """

    __tablename__ = "aseguradora_productos"
    __table_args__ = (
        CheckConstraint("valor >= 0", name="valor"),
        CheckConstraint("porcentaje BETWEEN 0 AND 100", name="porcentaje"),
        CheckConstraint(
            "vigencia_receta_horas IS NULL OR vigencia_receta_horas BETWEEN 1 AND 8760",
            name="vigencia_receta_horas",
        ),
        # Condiciones de M2 (6/11/2026): mismos valores que schemas.py y la central.
        CheckConstraint(
            "servicios <@ ARRAY['farmacia', 'teleconsulta', 'consulta_ambulatoria',"
            " 'hospitalaria']::varchar[]",
            name="servicios",
        ),
        CheckConstraint(
            "tope_unidad IS NULL OR tope_unidad IN ('evento', 'persona_mes', 'persona_anio',"
            " 'receta')",
            name="tope_unidad",
        ),
        CheckConstraint(
            "ventana_evento IS NULL OR ventana_evento IN ('mes_calendario', 'dias_moviles_30',"
            " 'vigencia_poliza')",
            name="ventana_evento",
        ),
        CheckConstraint("eventos_maximo IS NULL OR eventos_maximo >= 1", name="eventos_maximo"),
        CheckConstraint(
            "max_diagnosticos IS NULL OR max_diagnosticos BETWEEN 1 AND 20",
            name="max_diagnosticos",
        ),
        CheckConstraint("carencia_dias BETWEEN 0 AND 3650", name="carencia_dias"),
        CheckConstraint(
            "parentescos <@ ARRAY['conyuge', 'hijos', 'padres']::varchar[]", name="parentescos"
        ),
        # Sin beneficiarios no hay parentescos.
        CheckConstraint(
            "beneficiarios_incluidos OR cardinality(parentescos) = 0",
            name="parentescos_con_beneficiarios",
        ),
        # La receta solo existe en farmacia: con Farmacia, vigencia; sin ella, nada.
        CheckConstraint(
            "('farmacia' = ANY(servicios)) = (vigencia_receta_horas IS NOT NULL)",
            name="receta_con_farmacia",
        ),
        CheckConstraint(
            "'farmacia' = ANY(servicios)"
            " OR (requiere_vademecum IS NULL AND despacho_parcial IS NULL)",
            name="farmacia_campos",
        ),
        # Lista propia solo si el producto exige vademécum (6/11/2026).
        CheckConstraint(
            "requiere_vademecum IS TRUE OR cardinality(vademecum) = 0", name="vademecum_lista"
        ),
        Index(
            "ix_aseguradora_productos_aseguradora_id",
            "aseguradora_id",
            postgresql_where="deleted_at IS NULL",
        ),
        # El mismo nombre dos veces en la misma compañía es un error de captura.
        Index(
            "uq_aseguradora_productos_nombre",
            "aseguradora_id",
            "nombre",
            unique=True,
            postgresql_where="deleted_at IS NULL",
        ),
    )

    id: Mapped[uuid.UUID] = columna_pk_uuid()
    aseguradora_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("aseguradoras.id", ondelete="RESTRICT"), nullable=False
    )
    nombre: Mapped[str] = mapped_column(String(150), nullable=False)
    valor: Mapped[Decimal] = mapped_column(IMPORTE, nullable=False)
    porcentaje: Mapped[Decimal] = mapped_column(PORCENTAJE, nullable=False)
    # El SLA de farmacia (6/11/2026, decisión del usuario): las horas corridas que
    # tiene el paciente para ir con su receta; pasadas, la receta vence y la
    # farmacia ya no despacha. Va en el producto porque cada uno puede tener la
    # suya (72 h, 10 días…). Nulo = el producto no incluye Farmacia.
    vigencia_receta_horas: Mapped[int | None] = mapped_column(Integer)

    # ── Condiciones de cobertura (M2 de la especificación, 6/11/2026) ──
    # `valor` es el TOPE de cobertura en USD y `porcentaje` el % de cobertura
    # (el copago es 100 − porcentaje y no se guarda: se calcula).
    # Qué cubre: farmacia, teleconsulta, consulta ambulatoria, hospitalaria. De
    # esto dependen los demás datos (la receta, solo con farmacia).
    servicios: Mapped[list[str]] = mapped_column(ARRAY(String(30)), nullable=False)
    # Sobre qué se aplica el tope: por evento (diagnóstico), por persona al mes,
    # por persona al año o por receta.
    tope_unidad: Mapped[str | None] = mapped_column(String(20))
    # Cuánto dura un evento: mes calendario, 30 días móviles o vigencia de póliza.
    ventana_evento: Mapped[str | None] = mapped_column(String(20))
    # Nulo = eventos ilimitados.
    eventos_maximo: Mapped[int | None] = mapped_column(Integer)
    # Solo con Farmacia: si se limita al vademécum y si admite despacho parcial.
    requiere_vademecum: Mapped[bool | None] = mapped_column(Boolean)
    despacho_parcial: Mapped[bool | None] = mapped_column(Boolean)
    # Solo con teleconsulta o consulta ambulatoria. Nulo = sin límite.
    max_diagnosticos: Mapped[int | None] = mapped_column(Integer)
    beneficiarios_incluidos: Mapped[bool] = mapped_column(Boolean, nullable=False)
    parentescos: Mapped[list[str]] = mapped_column(ARRAY(String(20)), nullable=False)
    # Días desde el alta del asegurado antes de poder usar el producto.
    carencia_dias: Mapped[int] = mapped_column(Integer, nullable=False)
    # Medicamentos o diagnósticos que no cubre, en texto (la lista cerrada llegará
    # con el vademécum).
    exclusiones: Mapped[str | None] = mapped_column(String(2000))
    # El vademécum del producto (M5): los códigos del maestro (la central) que
    # cubre. Solo si «requiere vademécum»; entonces, al menos uno.
    vademecum: Mapped[list[str]] = mapped_column(ARRAY(String(9)), nullable=False)

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
