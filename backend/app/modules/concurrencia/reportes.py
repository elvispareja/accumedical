"""
**Reportería de Concurrencia** (pedido del usuario, 27/10/2026): lo que mira la
coordinación de Accumedical sobre los casos de TODAS las aseguradoras.

- **SLA**: si el informe se entregó dentro de las horas pactadas con la
  compañía. El reloj corre desde que llegó el pedido —el alta de la compañía
  (`created_at`) o el «Requerimiento» de nuestra coordinación
  (`requerimiento_recibido_at`)— hasta la PRIMERA entrega del informe firmado.
  El límite ya está materializado en `hasta` al crear el caso.
- **Edad** (27/10/2026): igual que el sexo, de la línea «EDAD: …» del informe.
  Rangos del usuario: 1–20, 21–40, 41–60 y más de 60; los menores de un año
  («8 meses», «15 días») cuentan en el primero.
- **Sexo**: sale del informe, ya auditado. La IA escribe la línea «GENERO: …»
  en DATOS GENERALES (`informe.INSTRUCCION`); lo que no diga femenino ni
  masculino cuenta como «no consta».

Los filtros Desde/Hasta son días de Ecuador sobre el INICIO del SLA (cuándo
llegó el pedido), igual para los dos reportes.
"""

from __future__ import annotations

import datetime as dt
import re
import uuid
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session as DbSession

from app.modules.concurrencia.models import InformeEntregado, Visita
from app.shared.aseguradoras.models import Aseguradora

_ZONA_EC = dt.timezone(dt.timedelta(hours=-5))

#: Estados del SLA de un caso, en el orden en que se enseñan.
ESTADOS_SLA = ("a_tiempo", "fuera_de_plazo", "vencido", "en_plazo", "cancelado")

SEXOS = ("femenino", "masculino", "no_consta")
#: Rangos de edad (pedido del usuario): (clave, desde, hasta incluido).
RANGOS_EDAD = (
    ("de_1_a_20", 0, 20),
    ("de_21_a_40", 21, 40),
    ("de_41_a_60", 41, 60),
    ("mas_de_60", 61, None),
)
EDADES = (*(r[0] for r in RANGOS_EDAD), "no_consta")
_LINEA_EDAD = re.compile(r"^\s*EDAD\s*:\s*(.*)$", re.IGNORECASE | re.MULTILINE)
_NUMERO = re.compile(r"\d{1,3}")
_LINEA_GENERO = re.compile(r"^\s*G[EÉ]NERO\s*:\s*(.*)$", re.IGNORECASE | re.MULTILINE)


def _inicio_del_dia_ec(dia: dt.date) -> dt.datetime:
    return dt.datetime.combine(dia, dt.time.min, tzinfo=_ZONA_EC)


def inicio_sla():
    """Cuándo empezó a correr el SLA: el «Requerimiento» o, si no hay, el alta."""
    return func.coalesce(Visita.requerimiento_recibido_at, Visita.created_at)


def _casos(
    db: DbSession,
    desde: dt.date | None,
    hasta: dt.date | None,
    aseguradora_id: uuid.UUID | None,
) -> list[Any]:
    # La PRIMERA entrega: corregir y reenviar crea otra, pero el plazo se
    # cumplió (o no) con la primera.
    entregas = (
        select(
            InformeEntregado.visita_id,
            func.min(InformeEntregado.entregado_at).label("entregado_at"),
        )
        .group_by(InformeEntregado.visita_id)
        .subquery()
    )
    inicio = inicio_sla().label("inicio_sla")
    consulta = (
        select(
            Visita,
            func.coalesce(Aseguradora.nombre_comercial, Aseguradora.razon_social).label(
                "aseguradora"
            ),
            inicio,
            entregas.c.entregado_at,
        )
        .join(Aseguradora, Aseguradora.id == Visita.aseguradora_id)
        .outerjoin(entregas, entregas.c.visita_id == Visita.id)
        .where(Visita.deleted_at.is_(None))
    )
    if aseguradora_id is not None:
        consulta = consulta.where(Visita.aseguradora_id == aseguradora_id)
    if desde:
        consulta = consulta.where(inicio_sla() >= _inicio_del_dia_ec(desde))
    if hasta:
        consulta = consulta.where(inicio_sla() < _inicio_del_dia_ec(hasta + dt.timedelta(days=1)))
    return db.execute(consulta.order_by(inicio_sla().desc())).all()


def _fin(visita: Visita, entregado_at: dt.datetime | None) -> dt.datetime | None:
    """Cuándo se entregó el informe (la primera entrega firmada, o la última
    versión en los culminados de antes de que existiera la entrega)."""
    if entregado_at is not None:
        return entregado_at
    return visita.informe_actualizado_at if visita.estado == "culminada" else None


def estado_sla(visita: Visita, entregado_at: dt.datetime | None, ahora: dt.datetime) -> str:
    """
    a_tiempo / fuera_de_plazo: ya se entregó, antes o después del límite.
    vencido: sin entregar y el límite ya pasó. en_plazo: sin entregar, a tiempo.
    cancelado: no cuenta para el cumplimiento.
    """
    # Los casos culminados de antes de que existiera la entrega firmada se
    # miden con la última versión del informe.
    entrega = _fin(visita, entregado_at)
    if entrega is not None:
        return "a_tiempo" if entrega <= visita.hasta else "fuera_de_plazo"
    if visita.estado == "cancelada":
        return "cancelado"
    return "vencido" if ahora > visita.hasta else "en_plazo"


def _cumplimiento(cuenta: dict[str, int]) -> float | None:
    """A tiempo entre todo lo que ya se puede juzgar (entregado o vencido)."""
    juzgables = cuenta["a_tiempo"] + cuenta["fuera_de_plazo"] + cuenta["vencido"]
    return round(100 * cuenta["a_tiempo"] / juzgables, 1) if juzgables else None


def reporte_sla(
    db: DbSession,
    desde: dt.date | None = None,
    hasta: dt.date | None = None,
    aseguradora_id: uuid.UUID | None = None,
) -> dict[str, Any]:
    ahora = dt.datetime.now(dt.UTC)
    total = dict.fromkeys(ESTADOS_SLA, 0)
    por_aseguradora: dict[uuid.UUID, dict[str, Any]] = {}
    casos = []
    for visita, aseguradora, inicio, entregado_at in _casos(db, desde, hasta, aseguradora_id):
        estado = estado_sla(visita, entregado_at, ahora)
        total[estado] += 1
        fila = por_aseguradora.setdefault(
            visita.aseguradora_id,
            {"aseguradora": aseguradora, **dict.fromkeys(ESTADOS_SLA, 0)},
        )
        fila[estado] += 1
        fin = _fin(visita, entregado_at)
        casos.append(
            {
                "id": str(visita.id),
                "codigo_interno": visita.codigo_interno,
                "aseguradora": aseguradora,
                "origen": visita.requerimiento_medio or "sistema",
                "inicio_sla": inicio,
                "limite": visita.hasta,
                "entregado_at": fin,
                # Horas usadas: hasta la entrega o, si no hay, hasta ahora.
                "horas": round(((fin or ahora) - inicio).total_seconds() / 3600, 1),
                "horas_sla": round((visita.hasta - inicio).total_seconds() / 3600, 1),
                "estado_sla": estado,
            }
        )
    return {
        "total": {**total, "casos": len(casos), "cumplimiento": _cumplimiento(total)},
        "por_aseguradora": sorted(
            (
                {
                    **fila,
                    "casos": sum(fila[e] for e in ESTADOS_SLA),
                    "cumplimiento": _cumplimiento(fila),
                }
                for fila in por_aseguradora.values()
            ),
            key=lambda f: f["aseguradora"],
        ),
        "casos": casos[:500],
    }


def sexo_del_informe(informe: str | None) -> str:
    """El sexo según la línea «GENERO:» del informe; sin dato claro, `no_consta`."""
    linea = _LINEA_GENERO.search(informe or "")
    if not linea:
        return "no_consta"
    valor = linea.group(1).strip().upper()
    if valor.startswith("FEM") or valor in ("F", "MUJER"):
        return "femenino"
    if valor.startswith("MAS") or valor in ("M", "HOMBRE", "VARON", "VARÓN"):
        return "masculino"
    return "no_consta"


def reporte_sexo(
    db: DbSession,
    desde: dt.date | None = None,
    hasta: dt.date | None = None,
    aseguradora_id: uuid.UUID | None = None,
) -> dict[str, Any]:
    """Solo los casos YA AUDITADOS (culminados): antes no hay informe del que sacarlo."""
    total = dict.fromkeys(SEXOS, 0)
    por_aseguradora: dict[uuid.UUID, dict[str, Any]] = {}
    for visita, aseguradora, _inicio, _entrega in _casos(db, desde, hasta, aseguradora_id):
        if visita.estado != "culminada":
            continue
        sexo = sexo_del_informe(visita.informe)
        total[sexo] += 1
        fila = por_aseguradora.setdefault(
            visita.aseguradora_id, {"aseguradora": aseguradora, **dict.fromkeys(SEXOS, 0)}
        )
        fila[sexo] += 1
    return {
        "total": {"auditados": sum(total.values()), **total},
        "por_aseguradora": sorted(
            (
                {**fila, "auditados": sum(fila[s] for s in SEXOS)}
                for fila in por_aseguradora.values()
            ),
            key=lambda f: f["aseguradora"],
        ),
    }


def edad_del_informe(informe: str | None) -> str:
    """
    El rango de edad según la línea «EDAD:» del informe. «45 años», «45», «45
    AÑOS DE EDAD» → 45. Meses o días sin años («8 meses») → menor de un año,
    primer rango. Sin número claro («No consta en el dictado.») o fuera de lo
    posible (> 130) → `no_consta`.
    """
    linea = _LINEA_EDAD.search(informe or "")
    if not linea:
        return "no_consta"
    texto = linea.group(1).strip().upper()
    numero = _NUMERO.search(texto)
    if not numero:
        return "no_consta"
    # «8 MESES» o «15 DÍAS» sin años delante: aún no cumple un año.
    if "AÑO" not in texto and re.search(r"MES|D[IÍ]A|SEMANA", texto):
        anios = 0
    else:
        anios = int(numero.group())
    if anios > 130:
        return "no_consta"
    for clave, desde, hasta in RANGOS_EDAD:
        if anios >= desde and (hasta is None or anios <= hasta):
            return clave
    return "no_consta"


def reporte_edad(
    db: DbSession,
    desde: dt.date | None = None,
    hasta: dt.date | None = None,
    aseguradora_id: uuid.UUID | None = None,
) -> dict[str, Any]:
    """Casos YA AUDITADOS (culminados) por rango de edad, del informe."""
    total = dict.fromkeys(EDADES, 0)
    por_aseguradora: dict[uuid.UUID, dict[str, Any]] = {}
    for visita, aseguradora, _inicio, _entrega in _casos(db, desde, hasta, aseguradora_id):
        if visita.estado != "culminada":
            continue
        rango = edad_del_informe(visita.informe)
        total[rango] += 1
        fila = por_aseguradora.setdefault(
            visita.aseguradora_id, {"aseguradora": aseguradora, **dict.fromkeys(EDADES, 0)}
        )
        fila[rango] += 1
    return {
        "total": {"auditados": sum(total.values()), **total},
        "por_aseguradora": sorted(
            (
                {**fila, "auditados": sum(fila[e] for e in EDADES)}
                for fila in por_aseguradora.values()
            ),
            key=lambda f: f["aseguradora"],
        ),
    }

