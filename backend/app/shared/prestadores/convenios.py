from __future__ import annotations

import uuid
from decimal import ROUND_HALF_UP, Decimal
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session as DbSession

from app.shared.aseguradoras.models import (
    CONCEPTOS_FC,
    MODOS_FC,
    Aseguradora,
    AseguradoraPrestador,
    ConvenioFC,
)
from app.shared.catalogos.models import Ciudad

# La relación aseguradora ↔ prestador NO es una M2M simple: es el convenio bajo el
# que el prestador pertenece a la red de esa aseguradora, y lleva vigencia, código
# contractual y estado propios. La tabla existe desde la migración inicial con esa
# forma; aquí solo se le da uso.


def listar(db: DbSession, prestador_id: uuid.UUID) -> list[tuple[Any, ...]]:
    """Cada convenio junto con los datos de su aseguradora, que es lo que se pinta."""
    filas = db.execute(
        select(
            AseguradoraPrestador,
            Aseguradora.razon_social,
            Aseguradora.nombre_comercial,
            Aseguradora.ruc,
        )
        .join(Aseguradora, Aseguradora.id == AseguradoraPrestador.aseguradora_id)
        .where(
            AseguradoraPrestador.prestador_id == prestador_id,
            AseguradoraPrestador.deleted_at.is_(None),
        )
        # Mismo desempate que en contactos y sedes: los vínculos de un mismo
        # guardado comparten `created_at`, que es la marca de la transacción.
        .order_by(Aseguradora.razon_social, AseguradoraPrestador.id)
    ).all()
    return [tuple(f) for f in filas]


def convenios_de_prestador(db: DbSession, prestador_id: uuid.UUID) -> list[dict[str, Any]]:
    """
    TODAS las compañías vivas, marcando con cuáles tiene convenio vivo ESTE
    prestador. Es el **espejo** de `convenios_de_aseguradora`: la misma tabla,
    la misma mecánica de marcar, leída desde el otro lado.

    La ficha propia de Accumedical queda fuera, como en todo listado de
    compañías: su red se arma en «Red convenio», no aquí.
    """
    vivos = {
        convenio.aseguradora_id: convenio
        for convenio in db.scalars(
            select(AseguradoraPrestador).where(
                AseguradoraPrestador.prestador_id == prestador_id,
                AseguradoraPrestador.deleted_at.is_(None),
            )
        ).all()
    }
    filas = db.execute(
        select(Aseguradora, Ciudad.nombre)
        .outerjoin(Ciudad, Ciudad.codigo == Aseguradora.ciudad_codigo)
        .where(Aseguradora.deleted_at.is_(None), Aseguradora.es_propia.is_(False))
        .order_by(Aseguradora.razon_social)
    ).all()
    return [
        {
            "aseguradora": aseguradora,
            "ciudad_nombre": ciudad,
            "marcado": aseguradora.id in vivos,
            "convenio": vivos.get(aseguradora.id),
        }
        for aseguradora, ciudad in filas
    ]


def fijar_convenios_de_prestador(
    db: DbSession,
    prestador_id: uuid.UUID,
    seleccion: list[dict[str, Any]],
    autor: uuid.UUID,
) -> dict[str, list[str]] | None:
    """
    Reconcilia la red del prestador: marcar crea el convenio (`vigente`),
    desmarcar lo retira con borrado lógico y cambiar las casillas corrige la red
    que cubre. Espejo exacto de `fijar_convenios` del lado de la aseguradora.

    **El convenio con la ficha propia de Accumedical no se toca**: no se ofrece
    en esta lista, así que su ausencia no puede leerse como «desmárcalo». Sin
    esta excepción, guardar aquí retiraría de la red propia a un prestador que
    nunca se vio en pantalla.
    """
    redes = {
        fila["aseguradora_id"]: (bool(fila["red_privada"]), bool(fila["red_publica"]))
        for fila in seleccion
    }
    deseados = set(redes)
    validas = set(
        db.scalars(
            select(Aseguradora.id).where(
                Aseguradora.deleted_at.is_(None), Aseguradora.es_propia.is_(False)
            )
        ).all()
    )
    if deseados - validas:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Alguna de las aseguradoras seleccionadas ya no existe",
        )

    propia = db.scalar(select(Aseguradora.id).where(Aseguradora.es_propia.is_(True)))
    vivos = {
        convenio.aseguradora_id: convenio
        for convenio in db.scalars(
            select(AseguradoraPrestador).where(
                AseguradoraPrestador.prestador_id == prestador_id,
                AseguradoraPrestador.deleted_at.is_(None),
            )
        ).all()
    }

    habilitados: list[str] = []
    retirados: list[str] = []
    recolocados: list[str] = []
    for aseguradora_id, convenio in vivos.items():
        if aseguradora_id == propia:
            continue
        if aseguradora_id not in deseados:
            convenio.deleted_at = func.now()
            convenio.deleted_by = autor
            retirados.append(str(aseguradora_id))
            continue
        privada, publica = redes[aseguradora_id]
        if (convenio.red_privada, convenio.red_publica) != (privada, publica):
            convenio.red_privada = privada
            convenio.red_publica = publica
            convenio.updated_by = autor
            recolocados.append(str(aseguradora_id))
    for aseguradora_id in deseados:
        if aseguradora_id in vivos:
            continue
        privada, publica = redes[aseguradora_id]
        db.add(
            AseguradoraPrestador(
                aseguradora_id=aseguradora_id,
                prestador_id=prestador_id,
                estado="vigente",
                red_privada=privada,
                red_publica=publica,
                created_by=autor,
                updated_by=autor,
            )
        )
        habilitados.append(str(aseguradora_id))

    if not (habilitados or retirados or recolocados):
        return None
    return {"habilitados": habilitados, "retirados": retirados, "red_cambiada": recolocados}


def obtener_convenio(
    db: DbSession, prestador_id: uuid.UUID, convenio_id: uuid.UUID
) -> tuple[AseguradoraPrestador, str]:
    """
    El convenio, comprobando que sea de ESE prestador. Sin esa comprobación, el
    identificador de un convenio ajeno abriría los valores de otra compañía.
    """
    fila = db.execute(
        select(AseguradoraPrestador, Aseguradora.razon_social)
        .join(Aseguradora, Aseguradora.id == AseguradoraPrestador.aseguradora_id)
        .where(
            AseguradoraPrestador.id == convenio_id,
            AseguradoraPrestador.prestador_id == prestador_id,
            AseguradoraPrestador.deleted_at.is_(None),
        )
    ).first()
    if fila is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Convenio no encontrado")
    return fila[0], fila[1]


# ──────────────── Valores del convenio (Factor de Cobertura) ────────────────
#
# Cada concepto se pacta de una de tres formas, y la elige quien pacta:
#   por punto  → el número es el valor de CADA PUNTO del tarifario
#   porcentaje → un tanto por ciento de OTRO concepto, el que diga `base`
#   fijo       → un importe cerrado, que no se multiplica por nada

# Cómo se lee cada concepto. Los códigos están CONGELADOS —son la identidad de
# la fila, como el `code` de un módulo—; lo que se lee puede cambiar sin tocar
# la base ni migrar nada. Vive aquí y no en la pantalla porque los mensajes del
# servidor lo nombran: «Ayudante sale de Cirugía, que también es un...».
NOMBRES_FC = {
    "cirugia": "Cirugía",
    "anestesia": "Anestesia",
    "evaluacion_manejo": "Evaluación y Manejo (E&M)",
    "uci": "UCI - Cuidado Intensivo",
    "ucin": "UCIN - Cuidados Intensivos Neonatales",
    "recien_nacido": "Recién Nacido / Neonatales",
    "medicina": "Medicina / Especialidades",
    "imagenologia": "Imagenología / Radiología",
    "ayudante": "Ayudante",
}


def _redondear(valor: Decimal | None) -> Decimal | None:
    """A dos decimales, como cualquier importe. HALF_UP, que es como se factura."""
    if valor is None:
        return None
    return valor.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def valor_derivado(base: Decimal | None, porcentaje: Decimal | None) -> Decimal | None:
    """
    El importe al que sale un porcentaje. No se guarda en ningún sitio: se
    calcula aquí, y aquí es donde hay que mirarlo cuando alguien pregunte por
    qué salió ese número.
    """
    if base is None or porcentaje is None:
        return None
    return _redondear(base * porcentaje / Decimal(100))


def fc_de(db: DbSession, convenio_id: uuid.UUID) -> list[ConvenioFC]:
    """Lo pactado, en el orden de la pantalla. Lista vacía = nada pactado aún."""
    filas = {
        fila.concepto: fila
        for fila in db.scalars(
            select(ConvenioFC).where(ConvenioFC.convenio_id == convenio_id)
        ).all()
    }
    return [filas[c] for c in CONCEPTOS_FC if c in filas]


def importes_derivados(conceptos: list[ConvenioFC]) -> dict[str, Decimal | None]:
    """
    El importe al que sale cada porcentaje. **No se guarda en ningún sitio**: se
    calcula aquí, y aquí es donde hay que mirarlo cuando alguien pregunte por
    qué salió ese número.

    Solo tiene importe el modo `porcentaje`, y solo si la base tiene cifra: un
    30 % de un concepto sin valor todavía no es ningún importe.
    """
    valores = {c.concepto: c.valor for c in conceptos if c.modo != "porcentaje"}
    return {
        c.concepto: valor_derivado(valores.get(c.base or ""), c.valor)
        for c in conceptos
        if c.modo == "porcentaje"
    }


def fijar_fc(
    db: DbSession, convenio_id: uuid.UUID, entrantes: list[dict[str, Any]], autor: uuid.UUID
) -> list[ConvenioFC]:
    """
    Guarda lo pactado, reconciliando la lista completa: lo que llega se crea o
    se actualiza, y el concepto que no llega se retira del convenio.

    Los CHECK de la base cubren cada fila por separado —modo válido, base solo
    en los porcentajes, rango del valor—, pero llegarían como un error de
    integridad ilegible: se cortan antes, con el nombre del concepto delante.
    **La regla que la base no puede ver es la cadena**: que un porcentaje salga
    de otro porcentaje. Eso mira OTRA fila, y comprobarlo en Postgres costaría
    un trigger, que este proyecto no usa para que la lógica se lea en el código.
    """
    pedidos: dict[str, dict[str, Any]] = {}
    for datos in entrantes:
        concepto = str(datos.get("concepto") or "")
        if concepto not in CONCEPTOS_FC:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Hay un concepto que no existe en el convenio",
            )
        if concepto in pedidos:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"«{NOMBRES_FC[concepto]}» viene dos veces",
            )
        pedidos[concepto] = datos

    for concepto, datos in pedidos.items():
        nombre = NOMBRES_FC[concepto]
        modo = datos.get("modo")
        if modo not in MODOS_FC:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"«{nombre}» no dice cómo se pacta",
            )
        valor = datos.get("valor")
        if valor is not None and valor < 0:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"«{nombre}»: el valor no puede ser negativo",
            )
        if modo == "porcentaje":
            if valor is not None and not (0 <= valor <= 100):
                raise HTTPException(
                    status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail=f"«{nombre}»: el porcentaje tiene que estar entre 0 y 100",
                )
            base = datos.get("base")
            if base not in pedidos:
                raise HTTPException(
                    status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail=f"«{nombre}» es un porcentaje: indica de qué concepto sale",
                )
            if base == concepto:
                raise HTTPException(
                    status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail=f"«{nombre}» no puede ser un porcentaje de sí mismo",
                )
            if pedidos[base].get("modo") == "porcentaje":
                raise HTTPException(
                    status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail=(
                        f"«{nombre}» sale de «{NOMBRES_FC[base]}», que también es un "
                        "porcentaje. Un porcentaje se calcula sobre un valor, no sobre "
                        "otro porcentaje"
                    ),
                )
        elif datos.get("base") is not None:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"«{nombre}» no es un porcentaje: no lleva concepto base",
            )

    vivos = {
        fila.concepto: fila
        for fila in db.scalars(
            select(ConvenioFC).where(ConvenioFC.convenio_id == convenio_id)
        ).all()
    }
    # Lo que no llega deja de estar pactado. Es una tabla de valores del
    # convenio, no un expediente: aquí no hay histórico que conservar, y lo que
    # cambia queda en la auditoría de la mutación.
    for concepto, fila in vivos.items():
        if concepto not in pedidos:
            db.delete(fila)
    for concepto, datos in pedidos.items():
        fila = vivos.get(concepto)
        if fila is None:
            fila = ConvenioFC(
                convenio_id=convenio_id,
                concepto=concepto,
                created_by=autor,
                updated_by=autor,
            )
            db.add(fila)
        fila.modo = datos["modo"]
        fila.valor = datos.get("valor")
        fila.base = datos.get("base") if datos["modo"] == "porcentaje" else None
        fila.updated_by = autor
    db.flush()
    return fc_de(db, convenio_id)
