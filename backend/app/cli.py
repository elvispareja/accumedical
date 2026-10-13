from __future__ import annotations

import sys

from sqlalchemy import select

import app.shared  # noqa: F401  (registra los modelos)
from app.core.config import settings
from app.core.db import SessionLocal
from app.core.security import passwords
from app.shared.users.models import User

AYUDA = """Comandos disponibles:
  create-superadmin    Crea (o reactiva) el administrador global desde SUPERADMIN_EMAIL
                       y SUPERADMIN_PASSWORD. Es idempotente.
  sincronizar-central  Publica en la API central lo pendiente de Concurrencia
                       (pacientes → personas, visitas culminadas → eventos).
                       Idempotente: lo ya publicado no se repite.
  migrar-documentos-central
                       Sube al almacén cifrado de la central los documentos de
                       aseguradora y los listados de precios que aún están en el
                       volumen local, y deja la referencia `central:<id>`. NO borra
                       los archivos locales (eso es aparte, cuando se confirme).
  comparar-nucleo      Compara, con los datos reales, lo que Concurrencia obtiene de
                       su base (local) y de la API central: compañías, red, sedes,
                       SLA y validación de destino. Sale con 1 si hay diferencias.
  replicar-central     Replica el núcleo (aseguradoras, prestadores, convenios, SLA,
                       módulos contratados) en la central. Con --forzar reenvía
                       todo aunque no haya cambiado.
"""


def migrar_documentos_central() -> int:
    if not settings.replicacion_central_configurada:
        print("Falta CENTRAL_API_URL / CENTRAL_PLATAFORMA_CLIENT_*", file=sys.stderr)
        return 2
    import hashlib
    from pathlib import Path

    from app.shared.aseguradoras.models import (
        Aseguradora,
        AseguradoraPoliza,
        AseguradoraPrestador,
    )
    from app.shared.central import archivos, red_propia

    base = Path(settings.upload_dir)
    hechos = errores = 0

    def mover(ruta: str, nombre: str) -> str | None:
        nonlocal hechos, errores
        archivo = base / ruta
        if not archivo.is_file():
            print(f"  ⚠ no existe en el volumen: {ruta}")
            errores += 1
            return None
        contenido = archivo.read_bytes()
        archivo_id = archivos.subir(contenido, nombre, None)
        devuelto, meta = archivos.descargar(archivo_id)
        if hashlib.sha256(devuelto).hexdigest() != hashlib.sha256(contenido).hexdigest():
            print(f"  ✗ la copia en la central no coincide: {ruta}")
            errores += 1
            return None
        hechos += 1
        return archivos.referencia(archivo_id)

    with SessionLocal() as db:
        for poliza in db.scalars(select(AseguradoraPoliza)):
            if poliza.ruta and not archivos.es_referencia(poliza.ruta):
                ref = mover(poliza.ruta, poliza.nombre)
                if ref:
                    poliza.ruta = ref
                    db.commit()
        for convenio in db.scalars(select(AseguradoraPrestador)):
            ruta = convenio.listado_precios_ruta
            if ruta and not archivos.es_referencia(ruta):
                if red_propia.activa() and red_propia.es_propia(db, convenio.aseguradora_id):
                    continue  # la red propia se migra abajo, desde la central (su dueña)
                ref = mover(ruta, convenio.listado_precios_nombre or "Listado de precios")
                if ref:
                    convenio.listado_precios_ruta = ref
                    db.commit()
        if red_propia.activa():
            propia = db.scalar(select(Aseguradora.id).where(Aseguradora.es_propia.is_(True)))
            if propia is not None:
                for convenio in red_propia.convenios_vivos(propia).values():
                    ruta = convenio.listado_precios_ruta
                    if ruta and not archivos.es_referencia(ruta):
                        nombre = convenio.listado_precios_nombre or "Listado de precios"
                        ref = mover(ruta, nombre)
                        if ref:
                            red_propia.guardar_listado(convenio.id, ref, nombre, None)
    print(f"Migrados al almacén de la central: {hechos} · con problema: {errores}")
    return 1 if errores else 0


def comparar_nucleo() -> int:
    if not settings.central_configurada:
        print("La central no está configurada (CENTRAL_*)", file=sys.stderr)
        return 2
    import app.modules  # noqa: F401
    from app.core.central import CentralError
    from app.modules.concurrencia.nucleo import _Central as Central
    from app.modules.concurrencia.nucleo import _Local as Local
    from app.shared.aseguradoras.models import Aseguradora
    from app.shared.prestadores.models import Prestador

    respaldos = 0

    def central(fn, local):  # noqa: ANN001, ANN202
        nonlocal respaldos
        try:
            return fn()
        except CentralError:  # p. ej. una compañía dada de baja: igual que en producción
            respaldos += 1
            return local()

    def red(filas):  # noqa: ANN001, ANN202
        return sorted(
            (
                str(f["prestador"].id),
                f["prestador"].nombre,
                f["tipo_nombre"],
                f["ciudad_nombre"],
                tuple(sorted((str(s.id), s.nombre, c, p) for s, c, p in f["sedes"])),
                tuple(sorted((str(c.id), c.email) for c in f["contactos"])),
            )
            for f in filas
        )

    def compania(xs):  # noqa: ANN001, ANN202
        return sorted((str(x.id), x.razon_social, x.nombre_comercial) for x in xs)

    casos = diferencias = 0
    with SessionLocal() as db:
        asegs = list(db.scalars(select(Aseguradora.id)))
        prests = list(db.scalars(select(Prestador.id)))
        pares = [("compañías", compania(Local.aseguradoras(db, None)),
                  compania(Central.aseguradoras(db, None)))]
        for a in asegs:
            pares.append(("red", red(Local.red(db, a, None)),
                          red(central(lambda a=a: Central.red(db, a, None),
                                      lambda a=a: Local.red(db, a, None)))))
            pares.append(("sla", Local.horas_sla(db, a),
                          central(lambda a=a: Central.horas_sla(db, a),
                                  lambda a=a: Local.horas_sla(db, a))))
            for p in prests:
                pares.append(("en_red", Local.en_red(db, a, p),
                              central(lambda a=a, p=p: Central.en_red(db, a, p),
                                      lambda a=a, p=p: Local.en_red(db, a, p))))
        for p in prests:
            pares.append(("sedes", sorted(Local.sedes_activas(db, p)),
                          sorted(central(lambda p=p: Central.sedes_activas(db, p),
                                         lambda p=p: Local.sedes_activas(db, p)))))
        for nombre, local, remoto in pares:
            casos += 1
            if local != remoto:
                diferencias += 1
                print(f"  diferencia en {nombre}")
    print(f"{casos} comparaciones · {diferencias} diferencias · {respaldos} respaldos a local")
    return 1 if diferencias else 0


def replicar_central(forzar: bool) -> int:
    if not settings.replicacion_central_configurada:
        print(
            "La réplica no está configurada (CENTRAL_API_URL / CENTRAL_PLATAFORMA_CLIENT_*)",
            file=sys.stderr,
        )
        return 2
    from app.core.central import cliente_plataforma
    from app.shared.central import replicacion

    with SessionLocal() as db:
        resultado = replicacion.replicar(db, cliente_plataforma(), forzar=forzar)
    for entidad, r in resultado.items():
        print(f"  {entidad:<26} {r}")
    if not resultado:
        print("Sin cambios: la central ya está al día.")
    return 1 if any(r.startswith("error") for r in resultado.values()) else 0


def sincronizar_central() -> int:
    if not settings.central_configurada:
        print(
            "La central no está configurada (CENTRAL_API_URL / CENTRAL_CLIENT_*)", file=sys.stderr
        )
        return 2
    import app.modules  # noqa: F401  (registra los modelos de los módulos)
    from app.core.central import cliente
    from app.modules.concurrencia import central

    total_ok = total_mal = 0
    with SessionLocal() as db:
        while True:
            ok, mal = central.sincronizar_pendientes(db, cliente(), limite=100)
            total_ok += ok
            total_mal += mal
            if ok == 0:  # nada nuevo salió bien en esta pasada: lo que queda está atascado
                break
    print(f"Sincronizadas: {total_ok} · con error: {total_mal}")
    return 0 if total_mal == 0 else 1


def create_superadmin() -> int:
    """
    El superadmin NO se siembra en la migración: un hash de contraseña en el
    historial de migraciones es un secreto filtrado y además idéntico en todos los
    despliegues. Se crea aquí, leyendo credenciales del entorno ya validado.
    """
    email = settings.superadmin_email.strip()
    password = settings.superadmin_password.get_secret_value()

    if not email or not password:
        print("ERROR: define SUPERADMIN_EMAIL y SUPERADMIN_PASSWORD en el .env", file=sys.stderr)
        return 2

    if len(password) < settings.password_min_length:
        print(
            f"ERROR: la contraseña debe tener al menos {settings.password_min_length} "
            f"caracteres (tiene {len(password)}).",
            file=sys.stderr,
        )
        return 2

    with SessionLocal() as db:
        existente = db.scalar(select(User).where(User.email == email))
        if existente is not None:
            existente.password_hash = passwords.hashear(password)
            existente.is_superadmin = True
            existente.is_active = True
            existente.deleted_at = None
            existente.failed_login_attempts = 0
            existente.locked_until = None
            db.commit()
            print(f"Administrador global actualizado: {email}")
            return 0

        usuario = User(
            email=email,
            password_hash=passwords.hashear(password),
            nombre_principal="Administrador",
            apellido_paterno="General",
            is_superadmin=True,
            is_active=True,
            created_by=None,  # bootstrap: no hay nadie que lo haya creado
        )
        db.add(usuario)
        db.commit()
        print(f"Administrador global creado: {email}")
        return 0


def main() -> int:
    if len(sys.argv) < 2:
        print(AYUDA, file=sys.stderr)
        return 2
    comando = sys.argv[1]
    if comando == "create-superadmin":
        return create_superadmin()
    if comando == "sincronizar-central":
        return sincronizar_central()
    if comando == "migrar-documentos-central":
        return migrar_documentos_central()
    if comando == "comparar-nucleo":
        return comparar_nucleo()
    if comando == "replicar-central":
        return replicar_central(forzar="--forzar" in sys.argv[2:])
    print(f"Comando desconocido: {comando}\n\n{AYUDA}", file=sys.stderr)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
