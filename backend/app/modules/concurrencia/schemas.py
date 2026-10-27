from __future__ import annotations

import datetime as dt
from decimal import Decimal
from typing import Annotated, Literal

from pydantic import AwareDatetime, BaseModel, EmailStr, Field, field_validator

from app.shared import personas

# El paciente se llama como cualquier persona de la plataforma: cuatro partes y
# solo letras. La regla vive en app/shared/personas.py, no aquí.

# **El estado no se captura: se deduce.** Cada uno lo pone una acción —crear,
# derivar, marcar la llegada, enviar el informe, cancelar— o el propio servidor
# cuando la ventana vence. Por eso este Literal es SOLO de lectura y no aparece
# en ningún esquema de escritura: no hay forma de mandarlo.
Estado = Literal[
    "programada", "asignada", "auditando", "cancelada", "culminada", "no_auditado"
]


class CorreoVisita(BaseModel):
    """
    Un correo del caso con la etiqueta de quién es: los contactos marcados la
    heredan de su ficha y los tecleados a mano la escriben ahí mismo. Viaja en
    la lista «Este aviso se envió a:» de los correos del caso.
    """

    email: EmailStr
    etiqueta: Annotated[str, Field(max_length=120)] | None = None


class ContactoElegible(BaseModel):
    """
    Un contacto del prestador, para marcar a quién se avisa de la visita. Lo que
    acaba guardado es su correo —`conc_visita_correos` no distingue de dónde
    salió cada uno—; el resto de campos son para reconocer a la persona.
    """

    id: str
    nombre_completo: str
    cargo: str | None
    email: str
    # La sede del contacto; None = la sede principal (para avisar solo a los de
    # la sede a la que se va, 26/10/2026).
    sede_id: str | None = None


class SedeElegible(BaseModel):
    """Una sede a la que se puede ir, tal como la ofrece el formulario."""

    id: str
    nombre: str
    direccion: str
    ciudad_nombre: str | None
    provincia_nombre: str | None
    estado: str


class PrestadorElegible(BaseModel):
    """
    Un prestador de la red, con lo que hace falta para decidir a dónde se va: su
    casa matriz —la dirección propia— o cualquiera de sus sedes.
    """

    id: str
    codigo_interno: str
    nombre: str
    tipo_nombre: str
    direccion: str | None
    ciudad_nombre: str | None
    provincia_nombre: str | None
    sedes: list[SedeElegible]
    contactos: list[ContactoElegible]


#: El parentesco del PACIENTE con el titular de la póliza.
Parentesco = Literal["conyuge", "hijo", "padre_madre", "otro"]


class VisitaCrear(BaseModel):
    prestador_id: str
    # El paciente, obligatorio: es a quién se va a auditar. Su nombre va en
    # cuatro partes, como el de toda persona; opcionales el segundo nombre y el
    # apellido materno.
    paciente_nombre_principal: personas.NombreObligatorio
    paciente_nombre_secundario: personas.NombreOpcional = None
    paciente_apellido_paterno: personas.NombreObligatorio
    paciente_apellido_materno: personas.NombreOpcional = None
    paciente_tipo_documento_codigo: Annotated[str, Field(min_length=1, max_length=10)]
    paciente_numero_documento: Annotated[str, Field(min_length=1, max_length=20)]
    # Nulo significa casa matriz: se visita la dirección propia del prestador.
    # Si viene una sede, el servicio comprueba contra la base que sea suya.
    sede_id: str | None = None
    # **Póliza y titular** (26/10/2026). El número de póliza es obligatorio en
    # el alta. Si el paciente no es el titular, van los datos del titular y el
    # parentesco; el servicio los exige y valida la identificación.
    poliza_numero: Annotated[str, Field(min_length=1, max_length=40)]
    paciente_es_titular: bool = True
    titular_parentesco: Parentesco | None = None
    titular_nombre_principal: personas.NombreOpcional = None
    titular_nombre_secundario: personas.NombreOpcional = None
    titular_apellido_paterno: personas.NombreOpcional = None
    titular_apellido_materno: personas.NombreOpcional = None
    titular_tipo_documento_codigo: Annotated[str, Field(max_length=10)] | None = None
    titular_numero_documento: Annotated[str, Field(max_length=20)] | None = None
    # Ya NO lo pone la aseguradora (26/10/2026): la hora de la visita la fija la
    # coordinación de Accumedical al asignar al auditor. Si llega, se ignora en
    # el alta de compañía; queda para el alta desde supervisión.
    desde: dt.datetime | None = None
    correos: list[CorreoVisita] = Field(default_factory=list)
    observaciones: str | None = None

    _obligatorios = field_validator(
        "paciente_nombre_principal", "paciente_apellido_paterno"
    )(personas.validar_solo_letras)
    _opcionales = field_validator(
        "paciente_nombre_secundario", "paciente_apellido_materno"
    )(personas.opcional_o_nulo)
    _titular = field_validator(
        "titular_nombre_principal",
        "titular_nombre_secundario",
        "titular_apellido_paterno",
        "titular_apellido_materno",
    )(personas.opcional_o_nulo)


class VisitaCrearSupervision(VisitaCrear):
    """
    El alta desde plataforma: el coordinador de Concurrencia elige PRIMERO la
    aseguradora —a él los pedidos le llegan por correo— y el resto es el mismo
    formulario. El prestador se valida contra la red de ESA aseguradora.
    """

    aseguradora_id: str


class AseguradoraElegible(BaseModel):
    """Una compañía activa con Concurrencia habilitado, para el selector."""

    id: str
    nombre: str


class PacienteRegistrado(BaseModel):
    """
    Una persona que este módulo ha registrado, ya agrupada por su documento: sus
    cuatro partes del nombre, su identificación y cuánto ha pasado por aquí.
    Es lo que Concurrencia aporta al listado de pacientes de la plataforma.
    """

    tipo_documento_codigo: str
    numero_documento: str
    nombre_principal: str
    nombre_secundario: str | None = None
    apellido_paterno: str
    apellido_materno: str | None = None
    # Ya compuesto por el servidor: ninguna pantalla decide el orden del nombre.
    nombre_completo: str
    # Sin aseguradora: un mismo paciente puede entrar por varias, y una sola
    # sería mentira. El paciente es la persona.
    casos: int
    primer_caso: dt.datetime
    ultimo_caso: dt.datetime


class PaginaPacientes(BaseModel):
    items: list[PacienteRegistrado]
    total: int
    page: int
    page_size: int


class PacienteConocido(BaseModel):
    """
    Los nombres del paciente si ya existe: en la central (registro de pacientes
    de la plataforma, D49) o, si no, en un caso de ESA aseguradora.
    """

    encontrado: bool
    origen: Literal["central", "local"] | None = None
    nombre_principal: str | None = None
    nombre_secundario: str | None = None
    apellido_paterno: str | None = None
    apellido_materno: str | None = None


class VisitaActualizar(BaseModel):
    """Edición parcial: solo se toca lo que llega."""

    prestador_id: str | None = None
    paciente_nombre_principal: personas.NombreObligatorio | None = None
    paciente_nombre_secundario: personas.NombreOpcional = None
    paciente_apellido_paterno: personas.NombreObligatorio | None = None
    paciente_apellido_materno: personas.NombreOpcional = None
    paciente_tipo_documento_codigo: Annotated[str, Field(min_length=1, max_length=10)] | None = None
    paciente_numero_documento: Annotated[str, Field(min_length=1, max_length=20)] | None = None
    sede_id: str | None = None
    poliza_numero: Annotated[str, Field(min_length=1, max_length=40)] | None = None
    paciente_es_titular: bool | None = None
    titular_parentesco: Parentesco | None = None
    titular_nombre_principal: personas.NombreOpcional = None
    titular_nombre_secundario: personas.NombreOpcional = None
    titular_apellido_paterno: personas.NombreOpcional = None
    titular_apellido_materno: personas.NombreOpcional = None
    titular_tipo_documento_codigo: Annotated[str, Field(max_length=10)] | None = None
    titular_numero_documento: Annotated[str, Field(max_length=20)] | None = None
    # Mover esto es reprogramar: el servidor recalcula la entrega con el SLA y
    # devuelve el plazo de llegada a la hora nueva.
    desde: dt.datetime | None = None
    correos: list[CorreoVisita] | None = None
    observaciones: str | None = None

    _obligatorios = field_validator(
        "paciente_nombre_principal", "paciente_apellido_paterno"
    )(personas.validar_solo_letras)
    _opcionales = field_validator(
        "paciente_nombre_secundario", "paciente_apellido_materno"
    )(personas.opcional_o_nulo)
    _titular = field_validator(
        "titular_nombre_principal",
        "titular_nombre_secundario",
        "titular_apellido_paterno",
        "titular_apellido_materno",
    )(personas.opcional_o_nulo)


class VisitaResumen(BaseModel):
    id: str
    codigo_interno: str
    # El paciente viaja en el resumen: toda vista del caso lo necesita. Aquí va
    # ya compuesto porque el resumen SOLO se enseña; quien edita usa el detalle,
    # que trae las cuatro partes por separado.
    paciente_nombre_completo: str
    paciente_tipo_documento_codigo: str
    paciente_numero_documento: str
    prestador_id: str
    prestador_nombre: str
    sede_id: str | None
    sede_nombre: str | None
    # A dónde hay que ir, ya resuelto al destino real: si la visita es a una sede,
    # los datos de la sede; si es a la casa matriz, los del prestador. La ciudad
    # y la provincia van aparte de `lugar` porque la dirección es opcional y ellas
    # casi nunca faltan: son las que identifican el sitio.
    lugar: str | None
    ciudad_nombre: str | None
    provincia_nombre: str | None
    # A qué hora debe llegar el auditor. **La aseguradora NO lo ve** (26/10/2026):
    # en su vista va nulo; solo Accumedical maneja el horario.
    desde: dt.datetime | None
    # Cuándo vence la entrega del informe: `desde` + el SLA de la compañía.
    hasta: dt.datetime | None
    # Hasta cuándo se le acepta la llegada, prórrogas incluidas.
    llegada_limite: dt.datetime | None
    estado: str
    total_correos: int


class VisitaDetalle(VisitaResumen):
    # Las cuatro partes, para que el formulario pueda reabrirse y editarse.
    paciente_nombre_principal: str
    paciente_nombre_secundario: str | None
    paciente_apellido_paterno: str
    paciente_apellido_materno: str | None
    observaciones: str | None
    correos: list[CorreoVisita]
    # Póliza y titular (26/10/2026); nulos el número y el titular en los casos
    # de antes, y el titular cuando el paciente lo es.
    poliza_numero: str | None = None
    paciente_es_titular: bool = True
    titular_parentesco: str | None = None
    titular_nombre_principal: str | None = None
    titular_nombre_secundario: str | None = None
    titular_apellido_paterno: str | None = None
    titular_apellido_materno: str | None = None
    titular_tipo_documento_codigo: str | None = None
    titular_numero_documento: str | None = None
    # Si el auditor ya generó el informe de la visita: el texto no viaja aquí,
    # el PDF se pide a su propio endpoint autenticado.
    tiene_informe: bool = False


class PaginaVisitas(BaseModel):
    items: list[VisitaResumen]
    total: int
    page: int
    page_size: int


class CorreoPorDefecto(BaseModel):
    """
    Un correo al que el aviso llega SIEMPRE, se anote a quien se anote: quien
    crea el caso y las dos coordinaciones. El formulario los enseña al programar
    —deshabilitados, porque no se quitan— para que nadie los vuelva a teclear.
    """

    email: str
    # Quién es: «creó el caso», «coordinador de Concurrencia»…
    quien: str


class OperadorElegible(BaseModel):
    """Un operador de la compania, para filtrar el historial por sus casos."""

    id: str
    nombre_completo: str
    email: str
    activo: bool


# «charla_enfermeria» sigue aquí SOLO por las notas de legado que salen en el
# panel: crear una nueva la rechaza el servicio (TIPOS_NOTA ya no la incluye).
TipoNota = Literal["historial_clinico", "charla_enfermeria", "charla_medico", "observacion"]


class NotaCrear(BaseModel):
    """Un dictado del auditor en el hospital, ya convertido a texto."""

    tipo: TipoNota
    texto: Annotated[str, Field(min_length=1, max_length=20000)]


class NotaOut(BaseModel):
    id: str
    tipo: TipoNota
    texto: str
    creada_at: dt.datetime


class FotoOut(BaseModel):
    """Una foto del caso; el archivo se pide a su propio endpoint, con Bearer."""

    id: str
    creada_at: dt.datetime


class PanelAuditorOut(BaseModel):
    """El panel del caso en la app: las notas dictadas y el informe vigente."""

    notas: list[NotaOut]
    fotos: list[FotoOut] = []
    informe: str | None
    informe_actualizado_at: dt.datetime | None
    # Cuándo marcó «Ya llegué»: la app decide con esto en qué etapa abrir.
    llegada_at: dt.datetime | None = None


class CorregirInformeRequest(BaseModel):
    """Lo que el auditor dicta tras revisar el informe; la IA aplica SOLO eso."""

    instrucciones: str = Field(min_length=1, max_length=8000)


class InformeOut(BaseModel):
    informe: str
    informe_actualizado_at: dt.datetime


class CifrasVisitasOut(BaseModel):
    """
    Los cuadros del panel: cuántas visitas hay en cada estado y cuántas tocan
    hoy. Las mismas cifras para los dos paneles —el de la compañía y el de
    supervisión—, que solo se diferencian en lo que abarcan.
    """

    programadas: int
    # Sin auditor, en cualquier estado: lo mismo que el filtro «Sin asignar».
    sin_asignar: int = 0
    # Derivadas a un auditor que todavía no ha llegado.
    asignadas: int = 0
    # El auditor marcó «Ya llegué» y el informe no ha salido.
    auditando: int = 0
    canceladas: int
    culminadas: int
    no_auditadas: int = 0
    # Visitas programadas cuya ventana toca el día de HOY, hora de Ecuador.
    hoy: int


class DashboardOut(CifrasVisitasOut):
    """El panel del supervisor de la compañía: las cifras y lo que viene."""

    proximas: list[VisitaResumen]


# ────────────────── Supervisión de plataforma: derivar casos ─────────────────


class VisitaSupervisionResumen(VisitaResumen):
    """Una fila de la bandeja del supervisor: el caso, de qué compañía llegó y
    a qué auditor está derivado (o nada, si sigue sin asignar)."""

    aseguradora_nombre: str
    auditor_id: str | None
    auditor_nombre: str | None
    # Si el caso ya tiene informe emitido. Un caso puede estar terminado sin él
    # —los de antes de que existiera—, y quien pinta la fila necesita saberlo
    # para no ofrecer un PDF que no está.
    tiene_informe: bool = False


class VisitaSupervisionDetalle(VisitaSupervisionResumen):
    """El caso completo para la página del supervisor: lo mismo que capturó la
    compañía, para verlo tal cual (la pantalla lo pinta deshabilitado)."""

    # Las cuatro partes del nombre, por el mismo motivo que en `VisitaDetalle`:
    # esta vista enseña el caso TAL COMO SE CAPTURÓ, y se capturó en cuatro
    # casillas. Con el nombre ya compuesto se vería en una sola, que es
    # precisamente lo que no se quiere.
    paciente_nombre_principal: str
    paciente_nombre_secundario: str | None
    paciente_apellido_paterno: str
    paciente_apellido_materno: str | None
    observaciones: str | None
    correos: list[CorreoVisita]
    # Póliza y titular (26/10/2026); nulos el número y el titular en los casos
    # de antes, y el titular cuando el paciente lo es.
    poliza_numero: str | None = None
    paciente_es_titular: bool = True
    titular_parentesco: str | None = None
    titular_nombre_principal: str | None = None
    titular_nombre_secundario: str | None = None
    titular_apellido_paterno: str | None = None
    titular_apellido_materno: str | None = None
    titular_tipo_documento_codigo: str | None = None
    titular_numero_documento: str | None = None
    # Si hay imagen que comprueba un cambio de horario. La ruta no viaja: la
    # imagen se pide a su propio endpoint autenticado.
    tiene_comprobante: bool
    # Si el auditor ya generó el informe: el PDF se pide a su propio endpoint.
    tiene_informe: bool = False
    # El punto exacto del destino, para abrir el mapa desde la app del auditor.
    # Solo su endpoint lo llena; a las vistas de supervisión les sobra.
    destino_latitud: float | None = None
    destino_longitud: float | None = None


class ReprogramarRequest(BaseModel):
    """La nueva hora de llegada. La entrega se recalcula con el SLA."""

    desde: dt.datetime


class ProrrogaRequest(BaseModel):
    """
    Cuántas horas más se le dan al auditor para llegar, **contadas desde
    ahora**: el coordinador concede a las 16:00 dos horas y el plazo queda en
    las 18:00, no en la hora original más dos.
    """

    horas: Annotated[Decimal, Field(gt=0, le=72, max_digits=4, decimal_places=2)]


class ProrrogaOut(BaseModel):
    llegada_limite: dt.datetime
    estado: str


class SlaDelModulo(BaseModel):
    """Lo pactado para Concurrencia, que es de donde sale la entrega."""

    horas: float


class PaginaSupervision(BaseModel):
    items: list[VisitaSupervisionResumen]
    total: int
    page: int
    page_size: int


class AuditorElegible(BaseModel):
    id: str
    nombre_completo: str
    # Dónde está, para ofrecer primero a los de la misma ciudad del destino,
    # luego a los de la provincia y al final al resto. Nulos si no se registró.
    ciudad_nombre: str | None
    provincia_nombre: str | None


class PersonaDelFiltro(BaseModel):
    """
    Alguien del personal que está o estuvo en Concurrencia, para filtrar los
    casos en los que intervino. `detalle` dice con qué rol y si sigue.
    """

    id: str
    nombre_completo: str
    detalle: str
    vigente: bool


class FiltrosSupervision(BaseModel):
    """Lo que ofrecen los selectores de la bandeja de supervisión."""

    personal: list[PersonaDelFiltro]
    aseguradoras: list[AseguradoraElegible]


class AsignarAuditorRequest(BaseModel):
    """`null` deja el caso sin asignar; un id lo deriva a ese auditor."""

    auditor_id: str | None = None
    # La ventana en que el auditor debe ir al hospital: desde y hasta (26/10/2026;
    # «hasta» = plazo de llegada). Obligatorias al derivar a un auditor. Con zona
    # horaria: una hora «a secas» no dice si es la de Guayaquil o la de UTC.
    desde: AwareDatetime | None = None
    hasta: AwareDatetime | None = None
