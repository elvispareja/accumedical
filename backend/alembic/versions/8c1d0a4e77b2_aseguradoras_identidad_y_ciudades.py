"""aseguradoras: identidad comercial, ubicacion y catalogo de ciudades

Revision ID: 8c1d0a4e77b2
Revises: 45a3efc24bb9
Create Date: 2026-08-28

Cambios:
  - Nuevo catálogo `ciudades` con los 222 cantones del Ecuador, tomados del
    Clasificador Geográfico Estadístico 2025 del INEC (DPA actualizada al 31 de
    diciembre de 2024). Se excluyen las jurisdicciones marcadas con un asterisco,
    que son cantones listados bajo su provincia ANTIGUA (Santa Elena bajo Guayas,
    Orellana bajo Napo, Santo Domingo bajo Pichincha); sí se conserva La Concordia,
    marcada con doble asterisco por figurar bajo su provincia nueva.
  - `aseguradoras` pasa a tener identidad comercial completa: razón social y
    nombre comercial separados, código interno autogenerado y ubicación
    provincia/ciudad.
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "8c1d0a4e77b2"
down_revision: str | None = "45a3efc24bb9"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # ── Catálogo de ciudades (cantones) ──────────────────────────────────────
    op.create_table(
        "ciudades",
        sa.Column("codigo", sa.String(length=4), nullable=False),
        sa.Column("provincia_codigo", sa.String(length=2), nullable=False),
        sa.Column("nombre", sa.String(length=80), nullable=False),
        sa.Column("activo", sa.Boolean(), server_default="true", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(
            ["provincia_codigo"], ["provincias.codigo"],
            name=op.f("fk_ciudades_provincia_codigo_provincias"), ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("codigo", name=op.f("pk_ciudades")),
        # Redundante con la PK, pero es lo que habilita la FK compuesta de más
        # abajo: sin ella no se puede garantizar en la base que la ciudad
        # pertenezca a la provincia elegida.
        sa.UniqueConstraint("codigo", "provincia_codigo", name="uq_ciudades_codigo_provincia_codigo"),
    )
    op.create_index("ix_ciudades_provincia_codigo", "ciudades", ["provincia_codigo"])

    # ── Nombres oficiales de provincia, del mismo clasificador ───────────────
    op.execute(
        """
        INSERT INTO provincias (codigo, nombre) VALUES
          ('01', 'Azuay'),
          ('02', 'Bolívar'),
          ('03', 'Cañar'),
          ('04', 'Carchi'),
          ('05', 'Cotopaxi'),
          ('06', 'Chimborazo'),
          ('07', 'El Oro'),
          ('08', 'Esmeraldas'),
          ('09', 'Guayas'),
          ('10', 'Imbabura'),
          ('11', 'Loja'),
          ('12', 'Los Ríos'),
          ('13', 'Manabí'),
          ('14', 'Morona Santiago'),
          ('15', 'Napo'),
          ('16', 'Pastaza'),
          ('17', 'Pichincha'),
          ('18', 'Tungurahua'),
          ('19', 'Zamora Chinchipe'),
          ('20', 'Galápagos'),
          ('21', 'Sucumbíos'),
          ('22', 'Orellana'),
          ('23', 'Santo Domingo de los Tsáchilas'),
          ('24', 'Santa Elena')
        ON CONFLICT (codigo) DO UPDATE SET nombre = EXCLUDED.nombre
        """
    )

    op.execute(
        """
        INSERT INTO ciudades (codigo, provincia_codigo, nombre) VALUES
          ('0101','01','Cuenca'), ('0102','01','Girón'), ('0103','01','Gualaceo'),
          ('0104','01','Nabón'), ('0105','01','Paute'), ('0106','01','Pucara'),
          ('0107','01','San Fernando'), ('0108','01','Santa Isabel'), ('0109','01','Sígsig'),
          ('0110','01','Oña'), ('0111','01','Chordeleg'), ('0112','01','El Pan'),
          ('0113','01','Sevilla de Oro'), ('0114','01','Guachapala'), ('0115','01','Camilo Ponce Enríquez'),
          ('0201','02','Guaranda'), ('0202','02','Chillanes'), ('0203','02','Chimbo'),
          ('0204','02','Echeandía'), ('0205','02','San Miguel'), ('0206','02','Caluma'),
          ('0207','02','Las Naves'), ('0301','03','Azogues'), ('0302','03','Biblián'),
          ('0303','03','Cañar'), ('0304','03','La Troncal'), ('0305','03','El Tambo'),
          ('0306','03','Déleg'), ('0307','03','Suscal'), ('0401','04','Tulcán'),
          ('0402','04','Bolívar'), ('0403','04','Espejo'), ('0404','04','Mira'),
          ('0405','04','Montúfar'), ('0406','04','San Pedro de Huaca'), ('0501','05','Latacunga'),
          ('0502','05','La Maná'), ('0503','05','Pangua'), ('0504','05','Pujili'),
          ('0505','05','Salcedo'), ('0506','05','Saquisilí'), ('0507','05','Sigchos'),
          ('0601','06','Riobamba'), ('0602','06','Alausi'), ('0603','06','Colta'),
          ('0604','06','Chambo'), ('0605','06','Chunchi'), ('0606','06','Guamote'),
          ('0607','06','Guano'), ('0608','06','Pallatanga'), ('0609','06','Penipe'),
          ('0610','06','Cumandá'), ('0701','07','Machala'), ('0702','07','Arenillas'),
          ('0703','07','Atahualpa'), ('0704','07','Balsas'), ('0705','07','Chilla'),
          ('0706','07','El Guabo'), ('0707','07','Huaquillas'), ('0708','07','Marcabelí'),
          ('0709','07','Pasaje'), ('0710','07','Piñas'), ('0711','07','Portovelo'),
          ('0712','07','Santa Rosa'), ('0713','07','Zaruma'), ('0714','07','Las Lajas'),
          ('0801','08','Esmeraldas'), ('0802','08','Eloy Alfaro'), ('0803','08','Muisne'),
          ('0804','08','Quinindé'), ('0805','08','San Lorenzo'), ('0806','08','Atacames'),
          ('0807','08','Ríoverde'), ('0901','09','Guayaquil'), ('0902','09','Alfredo Baquerizo Moreno'),
          ('0903','09','Balao'), ('0904','09','Balzar'), ('0905','09','Colimes'),
          ('0906','09','Daule'), ('0907','09','Durán'), ('0908','09','El Empalme'),
          ('0909','09','El Triunfo'), ('0910','09','Milagro'), ('0911','09','Naranjal'),
          ('0912','09','Naranjito'), ('0913','09','Palestina'), ('0914','09','Pedro Carbo'),
          ('0916','09','Samborondón'), ('0918','09','Santa Lucía'), ('0919','09','Salitre'),
          ('0920','09','San Jacinto de Yaguachi'), ('0921','09','Playas'), ('0922','09','Simón Bolívar'),
          ('0923','09','Coronel Marcelino Maridueña'), ('0924','09','Lomas de Sargentillo'), ('0925','09','Nobol'),
          ('0927','09','General Antonio Elizalde'), ('0928','09','Isidro Ayora'), ('1001','10','Ibarra'),
          ('1002','10','Antonio Ante'), ('1003','10','Cotacachi'), ('1004','10','Otavalo'),
          ('1005','10','Pimampiro'), ('1006','10','San Miguel de Urcuquí'), ('1101','11','Loja'),
          ('1102','11','Calvas'), ('1103','11','Catamayo'), ('1104','11','Celica'),
          ('1105','11','Chaguarpamba'), ('1106','11','Espíndola'), ('1107','11','Gonzanamá'),
          ('1108','11','Macará'), ('1109','11','Paltas'), ('1110','11','Puyango'),
          ('1111','11','Saraguro'), ('1112','11','Sozoranga'), ('1113','11','Zapotillo'),
          ('1114','11','Pindal'), ('1115','11','Quilanga'), ('1116','11','Olmedo'),
          ('1201','12','Babahoyo'), ('1202','12','Baba'), ('1203','12','Montalvo'),
          ('1204','12','Puebloviejo'), ('1205','12','Quevedo'), ('1206','12','Urdaneta'),
          ('1207','12','Ventanas'), ('1208','12','Vinces'), ('1209','12','Palenque'),
          ('1210','12','Buena Fé'), ('1211','12','Valencia'), ('1212','12','Mocache'),
          ('1213','12','Quinsaloma'), ('1301','13','Portoviejo'), ('1302','13','Bolívar'),
          ('1303','13','Chone'), ('1304','13','El Carmen'), ('1305','13','Flavio Alfaro'),
          ('1306','13','Jipijapa'), ('1307','13','Junín'), ('1308','13','Manta'),
          ('1309','13','Montecristi'), ('1310','13','Paján'), ('1311','13','Pichincha'),
          ('1312','13','Rocafuerte'), ('1313','13','Santa Ana'), ('1314','13','Sucre'),
          ('1315','13','Tosagua'), ('1316','13','24 de Mayo'), ('1317','13','Pedernales'),
          ('1318','13','Olmedo'), ('1319','13','Puerto López'), ('1320','13','Jama'),
          ('1321','13','Jaramijó'), ('1322','13','San Vicente'), ('1401','14','Morona'),
          ('1402','14','Gualaquiza'), ('1403','14','Limón Indanza'), ('1404','14','Palora'),
          ('1405','14','Santiago'), ('1406','14','Sucúa'), ('1407','14','Huamboya'),
          ('1408','14','San Juan Bosco'), ('1409','14','Taisha'), ('1410','14','Logroño'),
          ('1411','14','Pablo Sexto'), ('1412','14','Tiwintza'), ('1413','14','Sevilla Don Bosco'),
          ('1501','15','Tena'), ('1503','15','Archidona'), ('1504','15','El Chaco'),
          ('1507','15','Quijos'), ('1509','15','Carlos Julio Arosemena Tola'), ('1601','16','Pastaza'),
          ('1602','16','Mera'), ('1603','16','Santa Clara'), ('1604','16','Arajuno'),
          ('1701','17','Distrito Metropolitano de Quito'), ('1702','17','Cayambe'), ('1703','17','Mejia'),
          ('1704','17','Pedro Moncayo'), ('1705','17','Rumiñahui'), ('1707','17','San Miguel de los Bancos'),
          ('1708','17','Pedro Vicente Maldonado'), ('1709','17','Puerto Quito'), ('1801','18','Ambato'),
          ('1802','18','Baños de Agua Santa'), ('1803','18','Cevallos'), ('1804','18','Mocha'),
          ('1805','18','Patate'), ('1806','18','Quero'), ('1807','18','San Pedro de Pelileo'),
          ('1808','18','Santiago de Píllaro'), ('1809','18','Tisaleo'), ('1901','19','Zamora'),
          ('1902','19','Chinchipe'), ('1903','19','Nangaritza'), ('1904','19','Yacuambi'),
          ('1905','19','Yantzaza'), ('1906','19','El Pangui'), ('1907','19','Centinela del Cóndor'),
          ('1908','19','Palanda'), ('1909','19','Paquisha'), ('2001','20','San Cristóbal'),
          ('2002','20','Isabela'), ('2003','20','Santa Cruz'), ('2101','21','Lago Agrio'),
          ('2102','21','Gonzalo Pizarro'), ('2103','21','Putumayo'), ('2104','21','Shushufindi'),
          ('2105','21','Sucumbíos'), ('2106','21','Cascales'), ('2107','21','Cuyabeno'),
          ('2201','22','Francisco de Orellana'), ('2202','22','Aguarico'), ('2203','22','La Joya de los Sachas'),
          ('2204','22','Loreto'), ('2301','23','Santo Domingo'), ('2302','23','La Concordia'),
          ('2401','24','Santa Elena'), ('2402','24','La Libertad'), ('2403','24','Salinas')
        ON CONFLICT (codigo) DO NOTHING
        """
    )

    # ── aseguradoras ─────────────────────────────────────────────────────────
    op.alter_column("aseguradoras", "nombre", new_column_name="razon_social")
    op.alter_column("aseguradoras", "direccion", new_column_name="direccion_fiscal")

    op.add_column("aseguradoras", sa.Column("nombre_comercial", sa.String(length=200), nullable=True))
    op.add_column("aseguradoras", sa.Column("provincia_codigo", sa.String(length=2), nullable=True))
    op.add_column("aseguradoras", sa.Column("ciudad_codigo", sa.String(length=4), nullable=True))

    # El tipo deja de ser obligatorio: no entra en el formulario acordado y la
    # columna se conserva a la espera de definir su uso.
    op.alter_column("aseguradoras", "tipo", nullable=True)

    # Código interno legible y autogenerado: ASEG-0001, ASEG-0002...
    # La secuencia vive en la base y no en la aplicación, así que dos altas
    # simultáneas no pueden obtener el mismo número.
    op.execute("CREATE SEQUENCE aseguradoras_codigo_interno_seq")
    op.add_column("aseguradoras", sa.Column("codigo_interno", sa.String(length=20), nullable=True))
    op.execute(
        "ALTER TABLE aseguradoras ALTER COLUMN codigo_interno "
        "SET DEFAULT ('ASEG-' || lpad(nextval('aseguradoras_codigo_interno_seq')::text, 4, '0'))"
    )
    op.execute(
        "UPDATE aseguradoras SET codigo_interno = "
        "'ASEG-' || lpad(nextval('aseguradoras_codigo_interno_seq')::text, 4, '0') "
        "WHERE codigo_interno IS NULL"
    )
    op.alter_column("aseguradoras", "codigo_interno", nullable=False)
    op.create_index("uq_aseguradoras_codigo_interno", "aseguradoras", ["codigo_interno"], unique=True)

    # Estado: activo / inactivo, tal como se acordó para el formulario.
    # drop_constraint volvería a aplicar la convención de nombres y buscaría
    # "ck_aseguradoras_ck_aseguradoras_estado": con SQL directo no hay ambigüedad.
    op.execute("ALTER TABLE aseguradoras DROP CONSTRAINT ck_aseguradoras_estado")
    op.execute("UPDATE aseguradoras SET estado = 'activo' WHERE estado IN ('activa','suspendida')")
    op.execute("UPDATE aseguradoras SET estado = 'inactivo' WHERE estado = 'inactiva'")
    op.alter_column("aseguradoras", "estado", server_default="activo")
    op.create_check_constraint("estado", "aseguradoras", "estado IN ('activo','inactivo')")

    op.create_foreign_key(
        op.f("fk_aseguradoras_provincia_codigo_provincias"),
        "aseguradoras", "provincias", ["provincia_codigo"], ["codigo"], ondelete="RESTRICT",
    )
    # FK COMPUESTA: impide a nivel de datos guardar una ciudad que no pertenezca
    # a la provincia elegida. Con ambas columnas nulas, o con solo la provincia
    # puesta, la restricción se satisface (MATCH SIMPLE).
    op.create_foreign_key(
        "fk_aseguradoras_ciudad_codigo_ciudades",
        "aseguradoras", "ciudades",
        ["ciudad_codigo", "provincia_codigo"], ["codigo", "provincia_codigo"],
        ondelete="RESTRICT",
    )

    # Búsqueda server-side sobre los dos nombres.
    op.execute("ALTER INDEX ix_aseguradoras_nombre_trgm RENAME TO ix_aseguradoras_razon_social_trgm")
    op.create_index(
        "ix_aseguradoras_nombre_comercial_trgm", "aseguradoras", ["nombre_comercial"],
        postgresql_using="gin", postgresql_ops={"nombre_comercial": "gin_trgm_ops"},
    )


def downgrade() -> None:
    op.drop_index("ix_aseguradoras_nombre_comercial_trgm", table_name="aseguradoras")
    op.execute("ALTER INDEX ix_aseguradoras_razon_social_trgm RENAME TO ix_aseguradoras_nombre_trgm")
    op.drop_constraint("fk_aseguradoras_ciudad_codigo_ciudades", "aseguradoras", type_="foreignkey")
    op.drop_constraint(op.f("fk_aseguradoras_provincia_codigo_provincias"), "aseguradoras", type_="foreignkey")
    # drop_constraint volvería a aplicar la convención de nombres y buscaría
    # "ck_aseguradoras_ck_aseguradoras_estado": con SQL directo no hay ambigüedad.
    op.execute("ALTER TABLE aseguradoras DROP CONSTRAINT ck_aseguradoras_estado")
    op.execute("UPDATE aseguradoras SET estado = 'activa' WHERE estado = 'activo'")
    op.execute("UPDATE aseguradoras SET estado = 'inactiva' WHERE estado = 'inactivo'")
    op.alter_column("aseguradoras", "estado", server_default="activa")
    op.create_check_constraint("estado", "aseguradoras", "estado IN ('activa','inactiva','suspendida')")
    op.drop_index("uq_aseguradoras_codigo_interno", table_name="aseguradoras")
    op.drop_column("aseguradoras", "codigo_interno")
    op.execute("DROP SEQUENCE aseguradoras_codigo_interno_seq")
    op.alter_column("aseguradoras", "tipo", nullable=False)
    op.drop_column("aseguradoras", "ciudad_codigo")
    op.drop_column("aseguradoras", "provincia_codigo")
    op.drop_column("aseguradoras", "nombre_comercial")
    op.alter_column("aseguradoras", "direccion_fiscal", new_column_name="direccion")
    op.alter_column("aseguradoras", "razon_social", new_column_name="nombre")
    op.drop_index("ix_ciudades_provincia_codigo", table_name="ciudades")
    op.drop_table("ciudades")
