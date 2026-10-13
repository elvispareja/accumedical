"""
Replicación del núcleo hacia la API central (paso 4b de la separación).

Mientras el admin de aseguradoras y prestadores viva aquí, ESTA base es la
fuente y la central su réplica: el admin sigue funcionando igual y la central
recibe, como mucho un minuto después, lo que cambió.

Cada entidad es una consulta explícita que traduce los nombres de aquí a los de
la central (`module_code` → `aplicacion_codigo`, `aseguradora_prestador` →
`convenios`…). Se toma la foto completa, se calcula su huella SHA-256 y solo si
cambió se envía a POST /api/replicacion/{entidad}. La central aplica un UPSERT
que solo toca las filas distintas, así que reenviar es inofensivo.

El orden importa (dependencias de claves foráneas): si una entidad falla, la
pasada se corta y se reintenta entera en la siguiente.
"""

from __future__ import annotations

import datetime as dt
import decimal
import hashlib
import json
import uuid
from typing import Any

from sqlalchemy import func, text
from sqlalchemy.orm import Session

from app.core.central import CentralError, ClienteCentral
from app.core.config import settings
from app.shared.central.models import CentralReplicacion

# (entidad en la central, SELECT en esta base con los nombres de la central).
# Consultas literales y constantes: nada del usuario entra en ellas.
ENTIDADES: list[tuple[str, str]] = [
    (
        "aplicaciones",
        "SELECT code AS codigo, nombre, descripcion, activo AS activa, grupo, subgrupo,"
        " created_at, updated_at"
        " FROM modules",
    ),
    (
        "tipos_prestador",
        "SELECT codigo, nombre, es_persona, activo, created_at, updated_at FROM tipos_prestador",
    ),
    (
        "aseguradoras",
        "SELECT id, codigo_interno, razon_social, nombre_comercial, ruc, tipo,"
        " provincia_codigo, ciudad_codigo, direccion_fiscal, latitud, longitud, estado,"
        " logo_path, es_propia,"
        " created_at, updated_at, created_by, updated_by, deleted_at, deleted_by"
        " FROM aseguradoras",
    ),
    (
        "aseguradora_contactos",
        "SELECT id, aseguradora_id, nombre_principal, nombre_secundario, apellido_paterno,"
        " apellido_materno, email::text AS email, telefono, tipo_documento_codigo,"
        " numero_documento, cargo,"
        " created_at, updated_at, created_by, updated_by, deleted_at, deleted_by"
        " FROM aseguradora_contactos",
    ),
    (
        "prestadores",
        "SELECT id, codigo_interno, tipo_codigo, nombre, ruc, direccion, provincia_codigo,"
        " ciudad_codigo, estado, latitud, longitud, logo_path,"
        " created_at, updated_at, created_by, updated_by, deleted_at, deleted_by"
        " FROM prestadores",
    ),
    (
        "prestador_contactos",
        "SELECT id, prestador_id, nombre_principal, nombre_secundario, apellido_paterno,"
        " apellido_materno, email::text AS email, telefono, tipo_documento_codigo,"
        " numero_documento, cargo,"
        " created_at, updated_at, created_by, updated_by, deleted_at, deleted_by"
        " FROM prestador_contactos",
    ),
    (
        "prestador_sedes",
        "SELECT id, prestador_id, nombre, provincia_codigo, ciudad_codigo, direccion,"
        " telefono, email::text AS email, latitud, longitud, estado,"
        " created_at, updated_at, created_by, updated_by, deleted_at, deleted_by"
        " FROM prestador_sedes",
    ),
    (
        "aseguradora_aplicaciones",
        "SELECT aseguradora_id, module_code AS aplicacion_codigo, activo, granted_at,"
        " granted_by, revoked_at, revoked_by, updated_at"
        " FROM aseguradora_modulos",
    ),
    (
        "aseguradora_sla",
        "SELECT aseguradora_id, module_code AS aplicacion_codigo, horas, precio,"
        " created_at, updated_at, created_by, updated_by"
        " FROM aseguradora_sla",
    ),
    (
        "aseguradora_coberturas",
        "SELECT aseguradora_id, module_code AS aplicacion_codigo, cobertura_codigo, activo,"
        " granted_at, granted_by, revoked_at, revoked_by, updated_at"
        " FROM aseguradora_coberturas",
    ),
    (
        "convenios",
        "SELECT id, aseguradora_id, prestador_id, codigo_convenio, red_privada, red_publica,"
        " fecha_inicio, fecha_fin, estado, observaciones,"
        # Listado en el almacén de la central: la referencia se convierte en su id.
        " CASE WHEN listado_precios_ruta LIKE 'central:%' THEN NULL"
        " ELSE listado_precios_ruta END AS listado_precios_ruta,"
        " listado_precios_nombre,"
        " CASE WHEN listado_precios_ruta LIKE 'central:%'"
        " THEN substring(listado_precios_ruta FROM 9)::uuid END AS listado_archivo_id,"
        " created_at, updated_at, created_by, updated_by, deleted_at, deleted_by"
        " FROM aseguradora_prestador",
    ),
    (
        "convenio_fc",
        "SELECT convenio_id, concepto, modo, valor, base,"
        " created_at, updated_at, created_by, updated_by"
        " FROM aseguradora_prestador_fc",
    ),
    # Documentos de la aseguradora (pestañas Pólizas, Cobertura, SLA, Convenios).
    (
        "documentos_aseguradora",
        "SELECT id, aseguradora_id,"
        " CASE categoria WHEN 'polizas' THEN 'poliza' WHEN 'convenios' THEN 'convenio'"
        " ELSE categoria END AS tipo_codigo,"
        " NULL::varchar AS aplicacion_codigo, nombre,"
        " CASE WHEN ruta LIKE 'central:%' THEN substring(ruta FROM 9)::uuid END AS archivo_id,"
        " created_at, updated_at, created_by, updated_by, deleted_at, deleted_by"
        " FROM aseguradora_polizas",
    ),
    # Directorio de usuarios. Columnas elegidas UNA A UNA: nunca password_hash,
    # mfa_secret, intentos de login, bloqueos ni último acceso. La central sabe
    # quién es cada uno, no cómo entra.
    (
        "usuarios",
        "SELECT id, email::text AS email, nombre_principal, nombre_secundario,"
        " apellido_paterno, apellido_materno, telefono, provincia_codigo, ciudad_codigo,"
        " is_superadmin AS es_superadmin, aseguradora_id, is_active AS activo,"
        " created_at, updated_at, deleted_at"
        " FROM users",
    ),
    (
        "usuario_aplicaciones",
        "SELECT a.id, a.user_id AS usuario_id, a.module_code AS aplicacion_codigo,"
        " r.code AS rol_codigo, r.activo AS rol_activo, a.activo, a.updated_at"
        " FROM user_module_access a JOIN roles r ON r.id = a.role_id",
    ),
    (
        "usuario_grupos",
        "SELECT id, user_id AS usuario_id, grupo, activo, updated_at FROM user_grupo_access",
    ),
    (
        "usuario_coordinaciones",
        "SELECT id, user_id AS usuario_id, aseguradora_id, activo, updated_at"
        " FROM user_aseguradora_coordinador",
    ),
]


# Con RED_PROPIA_EN_CENTRAL la red de la ficha propia vive en la central: no se
# replica (y la central, además, la ignora si llegara). Filtros literales.
_SIN_RED_PROPIA = {
    "convenios": " WHERE aseguradora_id NOT IN (SELECT id FROM aseguradoras WHERE es_propia)",
    "convenio_fc": (
        " WHERE convenio_id NOT IN (SELECT ap.id FROM aseguradora_prestador ap"
        " JOIN aseguradoras a ON a.id = ap.aseguradora_id WHERE a.es_propia)"
    ),
}


# Con REDES_EN_CENTRAL (paso 5a) la central es dueña de TODAS las redes: estas
# entidades ya no se envían (la central, además, las ignoraría).
_REDES = ("convenios", "convenio_fc")
_FICHAS = ("tipos_prestador", "aseguradoras", "aseguradora_contactos", "prestadores",
           "prestador_contactos", "prestador_sedes", "aseguradora_aplicaciones", "aseguradora_sla",
           "aseguradora_coberturas", "usuarios", "usuario_aplicaciones", "usuario_grupos",
           "usuario_coordinaciones")


def _json(valor: Any) -> Any:
    if isinstance(valor, dt.datetime | dt.date):
        return valor.isoformat()
    if isinstance(valor, uuid.UUID | decimal.Decimal):
        return str(valor)
    raise TypeError(type(valor).__name__)


def foto(db: Session, consulta: str) -> tuple[list[dict[str, Any]], str]:
    """Filas de la entidad (orden estable) y la huella SHA-256 de su contenido."""
    filas = [dict(f) for f in db.execute(text(consulta)).mappings()]
    cuerpo = json.dumps(filas, default=_json, sort_keys=True, ensure_ascii=False)
    filas = json.loads(cuerpo)  # ya serializables para el envío
    filas.sort(key=lambda f: json.dumps(f, sort_keys=True))
    huella = hashlib.sha256(json.dumps(filas, sort_keys=True).encode()).hexdigest()
    return filas, huella


def replicar(db: Session, c: ClienteCentral, *, forzar: bool = False) -> dict[str, str]:
    """Una pasada completa. Devuelve {entidad: resultado} para el log."""
    resultado: dict[str, str] = {}
    for entidad, consulta in ENTIDADES:
        if settings.redes_en_central and entidad in _REDES:
            continue
        if settings.fichas_en_central and entidad in _FICHAS:
            continue  # paso 5b: se publican al guardar (fichas.py), no por réplica
        marca = db.get(CentralReplicacion, entidad) or CentralReplicacion(entidad=entidad)
        db.add(marca)
        if settings.red_propia_en_central:
            consulta += _SIN_RED_PROPIA.get(entidad, "")
        filas, huella = foto(db, consulta)
        if not forzar and marca.huella == huella and marca.ultimo_error is None:
            continue
        try:
            estado, r = c.llamar("POST", f"/api/replicacion/{entidad}", {"filas": filas})
            if estado != 200:
                raise CentralError(estado, "replicar")
        except CentralError as error:
            # Sin el cuerpo de la respuesta: puede repetir datos de contacto.
            marca.ultimo_error = f"{error.estado or 'sin respuesta'}: {error.detalle}"[:200]
            db.commit()
            resultado[entidad] = f"error {error.estado}"
            break  # lo que sigue depende de esto: se reintenta todo en la próxima pasada
        marca.huella = huella
        marca.enviado_at = func.now()
        marca.ultimo_error = None
        db.commit()
        resultado[entidad] = f"+{r['insertadas']} ~{r['actualizadas']} -{r['borradas']}"
    return resultado
