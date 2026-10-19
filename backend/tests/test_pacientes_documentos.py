"""Pacientes: los documentos de un caso finalizado (19/10/2026).

El informe final de Concurrencia sigue siendo el «informe» del caso; los
documentos de Calificación de Riesgo (exámenes y veredicto) van a la lista
`documentos`, agrupados con su cierre por el código del caso.
"""

import datetime as dt
import uuid

from app.shared.pacientes.router import Evento, _casos


def _evento(tipo, codigo, documento=None, minuto=0, app="calificacion_riesgo"):
    return Evento(
        id=uuid.uuid4(), tipo_evento=tipo,
        fecha_evento=dt.datetime(2026, 10, 16, 12, minuto, tzinfo=dt.UTC),
        aplicacion_codigo=app, aplicacion_nombre="App", aseguradora_nombre="LA UNION",
        resumen={"codigo": codigo}, ruta_caso=None, documento=documento,
    )


def test_documentos_de_calificacion_van_a_la_lista_con_el_veredicto_primero():
    cierre = _evento("caso_calificacion_riesgo", "CS-1", minuto=5)
    lab = _evento("documento_calificacion_riesgo", "CS-1",
                  {"tipo": "documento_caso", "nombre": "lab.pdf", "categoria": "Laboratorio"}, minuto=1)
    examen = _evento("documento_calificacion_riesgo", "CS-1",
                     {"tipo": "documento_caso", "nombre": "examen.pdf", "categoria": "Examen"}, minuto=2)
    veredicto = _evento("documento_calificacion_riesgo", "CS-1",
                        {"tipo": "veredicto", "nombre": "Veredicto.pdf", "firmado": True}, minuto=6)
    casos = _casos([lab, examen, cierre, veredicto], abre=set())
    assert len(casos) == 1
    caso = casos[0]
    assert caso.tipo_evento == "caso_calificacion_riesgo"
    assert caso.informe is None and caso.informe_evento_id is None
    assert [d["tipo"] for d in caso.documentos] == ["veredicto", "documento_caso", "documento_caso"]
    assert [d.get("categoria") for d in caso.documentos[1:]] == ["Examen", "Laboratorio"]
    assert caso.documentos[0]["evento_id"] == str(veredicto.id)


def test_el_informe_de_concurrencia_sigue_igual():
    visita = _evento("visita_concurrencia", "CONC-1", app="concurrencia")
    informe = _evento("informe_concurrencia", None,
                      {"tipo": "informe_final", "visita_codigo": "CONC-1", "numero_entrega": 1},
                      minuto=3, app="concurrencia")
    informe.resumen = {}
    casos = _casos([visita, informe], abre=set())
    assert len(casos) == 1
    assert casos[0].informe_evento_id == informe.id
    assert casos[0].documentos == []


def test_del_veredicto_se_muestra_solo_la_version_mas_reciente():
    cierre = _evento("caso_calificacion_riesgo", "CS-2", minuto=1)
    v1 = _evento("documento_calificacion_riesgo", "CS-2", {"tipo": "veredicto", "version": 1}, minuto=2)
    v2 = _evento("documento_calificacion_riesgo", "CS-2", {"tipo": "veredicto", "version": 2}, minuto=9)
    caso = _casos([cierre, v1, v2], abre=set())[0]
    assert [d["evento_id"] for d in caso.documentos] == [str(v2.id)]
