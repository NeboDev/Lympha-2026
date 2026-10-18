// Subcomandos de la fábrica que no tocan la base ni el broker: trabajan sobre los archivos de un lote.
//
//   pnpm factory imagenes <loteId> --broker-url mqtts://192.168.1.50:8883 [--ca infra/certs/ca.crt]
//   pnpm factory etiquetas <loteId>
//   pnpm factory grabar <loteId> <deviceId> --puerto COM5 --offset-llaves 0x.. --offset-identidad 0x..
//                        [--firmware fw.bin --offset-firmware 0x..]
//   pnpm factory diagnostico            (pendiente: necesita el firmware y una placa)
//
// Entrada: tools/factory/lotes/<loteId>/identidades.json (la escribe `factory lote`).
// Salida en el mismo directorio: nvs_keys.bin (llave de cifrado del lote, 0600), imagenes/<deviceId>.bin y
// etiquetas/<deviceId>.svg. Los offsets salen de `partitions.csv` del firmware y no se adivinan.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  asegurarLlaveNvs,
  etiquetaSvg,
  generarImagenIdentidad,
  grabar,
  type NodoFabricado,
  rutaCa,
  rutaPython,
} from "../modules/fabrica/index.ts";

export const COMANDOS_GRABADO = ["imagenes", "etiquetas", "grabar", "diagnostico"];

interface Identidades {
  loteId: string;
  nodos: NodoFabricado[];
}

const hex = (valor: string | undefined, nombre: string): number => {
  const n = Number(valor);
  if (!valor || !Number.isInteger(n) || n < 0) throw new Error(`falta o es inválido --${nombre}`);
  return n;
};

function cargarLote(salida: string, loteId: string | undefined) {
  if (!loteId) throw new Error("falta el loteId");
  const dir = resolve(salida, loteId);
  const ident = JSON.parse(readFileSync(join(dir, "identidades.json"), "utf8")) as Identidades;
  const manifiesto = JSON.parse(readFileSync(join(dir, "manifiesto.json"), "utf8")) as {
    versionHw: string;
  };
  return { dir, ident, versionHw: manifiesto.versionHw };
}

export async function ejecutarGrabado(comando: string, args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      salida: { type: "string", default: "tools/factory/lotes" },
      "broker-url": { type: "string" },
      ca: { type: "string", default: "infra/certs/ca.crt" },
      puerto: { type: "string" },
      "offset-llaves": { type: "string" },
      "offset-identidad": { type: "string" },
      firmware: { type: "string" },
      "offset-firmware": { type: "string" },
    },
  });
  const salida = values.salida as string;

  if (comando === "diagnostico") {
    throw new Error("diagnóstico no implementado: depende del firmware y de una placa conectada");
  }

  const [loteId, deviceId] = positionals;
  const { dir, ident, versionHw } = cargarLote(salida, loteId);

  if (comando === "imagenes") {
    const brokerUrl = values["broker-url"];
    if (!brokerUrl) throw new Error("falta --broker-url (p. ej. mqtts://192.168.1.50:8883)");
    const python = rutaPython();
    const caFile = rutaCa(values.ca as string);
    for (const nodo of ident.nodos) {
      await generarImagenIdentidad(python, dir, nodo, { brokerUrl, caFile });
    }
    console.log(`${ident.nodos.length} imágenes en ${join(dir, "imagenes")}`);
  } else if (comando === "etiquetas") {
    const destino = join(dir, "etiquetas");
    mkdirSync(destino, { recursive: true });
    for (const nodo of ident.nodos) {
      // el SVG contiene el código de reclamo en claro: mismos permisos que identidades.json
      writeFileSync(
        join(destino, `${nodo.deviceId}.svg`),
        etiquetaSvg({
          deviceId: nodo.deviceId,
          codigoReclamo: nodo.codigoReclamo,
          loteId: ident.loteId,
          versionHw,
          apKey: nodo.apKey,
        }),
        { mode: 0o600 },
      );
    }
    console.log(`${ident.nodos.length} etiquetas en ${destino}`);
  } else if (comando === "grabar") {
    if (!deviceId) throw new Error("falta el deviceId");
    if (!values.puerto) throw new Error("falta --puerto");
    const nodo = ident.nodos.find((n) => n.deviceId === deviceId);
    if (!nodo) throw new Error(`el nodo ${deviceId} no está en el lote ${loteId}`);
    const python = rutaPython();
    const imagen = join(dir, "imagenes", `${deviceId}.bin`);
    const llavesNvs = await asegurarLlaveNvs(python, dir);
    const salidaEsptool = await grabar(python, {
      puerto: values.puerto,
      offsetLlaves: hex(values["offset-llaves"], "offset-llaves"),
      offsetIdentidad: hex(values["offset-identidad"], "offset-identidad"),
      imagenIdentidad: imagen,
      llavesNvs,
      ...(values.firmware
        ? {
            firmware: {
              archivo: resolve(values.firmware),
              offset: hex(values["offset-firmware"], "offset-firmware"),
            },
          }
        : {}),
    });
    console.log(salidaEsptool);
  }
}
