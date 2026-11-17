import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { ObjectId } from "mongodb";
import { cargarConfig } from "../config.ts";
import { crearServicioReportes, ErrorReporte } from "../modulos/reportes/index.ts";
import { crearAlmacenReportesMongo } from "../plataforma/almacen-reportes-mongo.ts";
import { cargarCatalogo } from "../plataforma/catalogo.ts";
import { crearGeneradorPdf } from "../plataforma/generador-reportes.ts";
import { cargarSimboloLympha } from "../plataforma/logo-svg.ts";
import { cargarMarca } from "../plataforma/marca.ts";
import { conectarMongo } from "../plataforma/mongo.ts";

// Herramienta de desarrollo: genera el mismo PDF que pedirán `/reporte` (Telegram) y la web.
const AYUDA = `Uso:
  pnpm reporte --nodo <id> [--dias 7] [--salida reporte.pdf]
      Genera el reporte PDF de los últimos días del nodo y lo guarda en un archivo.
      El id sale de \`pnpm nodo:lista\`. También guarda el resumen en la colección «reportes».`;

const { values } = parseArgs({
  options: {
    nodo: { type: "string" },
    dias: { type: "string" },
    salida: { type: "string" },
    ayuda: { type: "boolean", default: false },
  },
});
if (values.ayuda || !values.nodo) {
  console.log(AYUDA);
  process.exit(values.ayuda ? 0 : 2);
}
if (!ObjectId.isValid(values.nodo)) {
  console.error("--nodo debe ser un id válido (mira `pnpm nodo:lista`)");
  process.exit(2);
}

const config = cargarConfig(process.env);
const catalogo = cargarCatalogo();
const dias = values.dias === undefined ? catalogo.reporte.dias_defecto : Number(values.dias);
if (!Number.isInteger(dias) || dias < 1 || dias > catalogo.reporte.dias_max) {
  console.error(`--dias debe ser un entero de 1 a ${catalogo.reporte.dias_max}`);
  process.exit(2);
}

const mongo = await conectarMongo(config);
try {
  const generador = crearGeneradorPdf({
    servicio: crearServicioReportes({
      almacen: crearAlmacenReportesMongo(mongo.db),
      catalogo,
      marca: cargarMarca(),
    }),
    logo: cargarSimboloLympha(),
  });
  const r = await generador.ultimosDias(new ObjectId(values.nodo), dias, "Línea de comandos");
  const salida = resolve(values.salida ?? r.nombreArchivo);
  await writeFile(salida, r.pdf);
  const c = r.reporte.contenido;
  console.log(
    `Reporte ${r.reporte.id} listo: ${salida}\n` +
      `  ${c.comunidad} · ${c.nodo.nombre} · últimos ${dias} ${dias === 1 ? "día" : "días"} · cobertura ${c.coberturaPct.toFixed(0)} %\n` +
      `  huella ${r.reporte.hash}`,
  );
} catch (e) {
  if (e instanceof ErrorReporte) {
    console.error(e.message);
    process.exitCode = 1;
  } else {
    throw e;
  }
} finally {
  await mongo.cerrar();
}
