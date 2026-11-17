import { parseArgs } from "node:util";
import { ObjectId } from "mongodb";
import { cargarConfig, cargarConfigBlynk } from "../config.ts";
import { crearDocumentoNodo, type NodoDoc } from "../modulos/nodos/index.ts";
import { crearClienteBlynk } from "../plataforma/blynk.ts";
import { cargarCatalogo } from "../plataforma/catalogo.ts";
import { cifrar } from "../plataforma/cifrado.ts";
import { conectarMongo } from "../plataforma/mongo.ts";

// Herramienta de la fase de desarrollo: el alta por API con roles llega en el Paso 7.
const AYUDA = `Uso:
  pnpm nodo:alta --nombre "Tinaco azotea" [--comunidad "Comunidad demo"]
      Crea (si no existe) la comunidad y el nodo, con el token de BLYNK_TOKEN_PRUEBA cifrado.
  pnpm nodo:lista
      Muestra los nodos y su última lectura.
  pnpm nodo:borrar --id <id> --si
      Borra el nodo con sus muestras y eventos. Pide --si para confirmar.

El token nunca se imprime.`;

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    nombre: { type: "string" },
    comunidad: { type: "string", default: "Comunidad demo" },
    id: { type: "string" },
    si: { type: "boolean", default: false },
  },
});
const orden = positionals[0];
if (orden !== "alta" && orden !== "lista" && orden !== "borrar") {
  console.log(AYUDA);
  process.exit(orden === undefined ? 0 : 2);
}

const config = cargarConfig(process.env);
const mongo = await conectarMongo(config);
const nodos = mongo.db.collection<NodoDoc>("nodos");
const comunidades = mongo.db.collection<{ _id: ObjectId; nombre: string; tipo: string }>(
  "comunidades",
);

try {
  if (orden === "alta") {
    const nombre = values.nombre?.trim();
    if (!nombre) throw new Error("Falta --nombre");
    const { blynkHost, blynkToken } = cargarConfigBlynk(process.env);

    // Se comprueba que el token sirve antes de guardar nada.
    await crearClienteBlynk({ host: blynkHost }).leerTodo(blynkToken);

    const nombreComunidad = values.comunidad?.trim() || "Comunidad demo";
    let comunidad = await comunidades.findOne({ nombre: nombreComunidad });
    if (!comunidad) {
      comunidad = { _id: new ObjectId(), nombre: nombreComunidad, tipo: "otro" };
      await comunidades.insertOne({
        ...comunidad,
        miembros: [],
        telegram: null,
        creado: new Date(),
      } as never);
    }
    if (await nodos.findOne({ comunidad_id: comunidad._id, nombre })) {
      throw new Error(`Ya existe un nodo «${nombre}» en esa comunidad`);
    }
    const nodo = crearDocumentoNodo({
      comunidadId: comunidad._id,
      nombre,
      tokenCifrado: cifrar(blynkToken, config.claveCifrado),
      host: blynkHost,
      catalogo: cargarCatalogo(),
    });
    await nodos.insertOne(nodo);
    console.log(
      `Nodo creado.\n  nodo_id:      ${nodo._id.toHexString()}\n  comunidad_id: ${comunidad._id.toHexString()}\n  parámetros:   ${nodo.parametros.join(", ")}\n  token:        válido y guardado cifrado`,
    );
  } else if (orden === "lista") {
    const todos = await nodos.find({}).toArray();
    if (todos.length === 0) console.log("No hay nodos.");
    for (const n of todos) {
      const u = n.ultimo;
      console.log(
        `${n._id.toHexString()}  ${n.nombre}  [${n.parametros.join(",")}]  ` +
          (u
            ? `seq=${u.seq} sesión=${u.sesion} estado=${u.estado ?? "—"} v=${JSON.stringify(u.v)} sin_datos=${u.sin_datos} ts=${u.ts.toISOString()}`
            : "sin lecturas"),
      );
    }
  } else {
    if (!values.id || !ObjectId.isValid(values.id)) throw new Error("Falta --id (un id válido)");
    const id = new ObjectId(values.id);
    const nodo = await nodos.findOne({ _id: id });
    if (!nodo) throw new Error("No existe un nodo con ese id");
    const muestras = await mongo.db.collection("muestras").countDocuments({ nodo_id: id });
    const eventos = await mongo.db.collection("eventos").countDocuments({ nodo_id: id });
    if (!values.si) {
      console.log(
        `Se borrarían: el nodo «${nodo.nombre}», ${muestras} muestras y ${eventos} eventos. Esto no se puede deshacer.\nVuelve a correr el comando con --si para confirmar.`,
      );
    } else {
      await mongo.db.collection("muestras").deleteMany({ nodo_id: id });
      await mongo.db.collection("eventos").deleteMany({ nodo_id: id });
      await nodos.deleteOne({ _id: id });
      console.log(`Borrados: el nodo, ${muestras} muestras y ${eventos} eventos.`);
    }
  }
} catch (e) {
  console.error(`Error: ${e instanceof Error ? e.message : "desconocido"}`);
  process.exitCode = 1;
} finally {
  await mongo.cerrar();
}
