from __future__ import annotations

from decimal import Decimal
from typing import Annotated, Any

from fastapi import HTTPException, status
from pydantic import Field

# Coordenadas: mismo rango que los CHECK de la base y la misma escala que la
# columna `numeric(9,6)`. Se validan aquí para devolver un error legible en lugar
# de un fallo de integridad, y allí para que ninguna vía las esquive.
#
# Se reciben como Decimal —exacto— y se devuelven como float: JavaScript no tiene
# decimales exactos, y el valor guardado sigue siendo el de la base.
PRECISION = {"max_digits": 9, "decimal_places": 6}

Latitud = Annotated[Decimal, Field(ge=Decimal(-90), le=Decimal(90), **PRECISION)]
Longitud = Annotated[Decimal, Field(ge=Decimal(-180), le=Decimal(180), **PRECISION)]


def prohibir_vaciar(cambios: dict[str, Any]) -> None:
    """
    En una edición parcial, un `null` explícito en latitud o longitud llegaría a
    una columna NOT NULL y saldría como error de integridad. Se corta antes, con
    un mensaje que se entiende.
    """
    if any(campo in cambios and cambios[campo] is None for campo in ("latitud", "longitud")):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="La ubicación en el mapa no se puede vaciar: mueve el punto, no lo borres",
        )
