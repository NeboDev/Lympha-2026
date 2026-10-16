import { execFile } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import type { NodoFabricado } from "./lote.ts";

const ejecutar = promisify(execFile);

/** Namespace NVS de la partición `identity`; el firmware lee estas llaves y nada más. */
export const NAMESPACE_IDENTIDAD = "identity";

/** Tamaño de la partición `identity` (múltiplo de 4 KiB; mínimo 3 páginas de NVS). */
export const TAMANO_IDENTIDAD = 0x6000;

export interface DatosIdentidad {
  brokerUrl: string;
  /** Ruta del `ca.crt` que verifica al broker. */
  caFile: string;
}

const SIN_SALTOS = /^[^\r\n,"]+$/;

/**
 * CSV de `nvs_partition_gen` con la identidad de un nodo. Los valores van sin comillas ni comas (la contraseña
 * es base64url y la clave del AP y el código salen de un alfabeto cerrado); un valor raro se rechaza aquí en
 * vez de grabar una identidad corrupta.
 */
export function csvIdentidad(nodo: NodoFabricado, datos: DatosIdentidad): string {
  const filas: [string, string][] = [
    ["device_id", nodo.deviceId],
    ["mqtt_user", nodo.deviceId],
    ["mqtt_pass", nodo.mqttPassword],
    ["ap_key", nodo.apKey],
    ["broker_url", datos.brokerUrl],
  ];
  for (const [llave, valor] of filas) {
    if (!SIN_SALTOS.test(valor)) throw new Error(`valor no grabable para ${llave}`);
  }
  if (!SIN_SALTOS.test(datos.caFile)) throw new Error("ruta de la CA no grabable");
  return [
    "key,type,encoding,value",
    `${NAMESPACE_IDENTIDAD},namespace,,`,
    ...filas.map(([llave, valor]) => `${llave},data,string,${valor}`),
    `ca_pem,file,string,${datos.caFile}`,
    "",
  ].join("\n");
}

/** Intérprete de Python con `esptool` y `esp-idf-nvs-partition-gen` (el venv de `tools/factory/.venv`). */
export function rutaPython(raiz = process.cwd()): string {
  if (process.env.LYMPHA_PYTHON) return process.env.LYMPHA_PYTHON;
  const venv = resolve(raiz, "tools/factory/.venv");
  const exe =
    process.platform === "win32"
      ? join(venv, "Scripts", "python.exe")
      : join(venv, "bin", "python");
  if (!existsSync(exe)) {
    throw new Error(
      "falta el entorno de Python de la fábrica: python -m venv tools/factory/.venv && tools/factory/.venv/Scripts/python -m pip install esptool esp-idf-nvs-partition-gen (o define LYMPHA_PYTHON)",
    );
  }
  return exe;
}

/** Genera, una vez por lote, la llave de cifrado de NVS (`nvs_keys.bin`, 0600). Si ya existe, no la cambia. */
export async function asegurarLlaveNvs(python: string, dirLote: string): Promise<string> {
  const llave = join(dirLote, "nvs_keys.bin");
  if (existsSync(llave)) return llave;
  mkdirSync(dirLote, { recursive: true });
  // nvs_partition_gen deja la llave en <outdir>/keys/
  await ejecutar(python, [
    "-m",
    "esp_idf_nvs_partition_gen",
    "generate-key",
    "--keyfile",
    "nvs_keys.bin",
    "--outdir",
    dirLote,
  ]);
  renameSync(join(dirLote, "keys", "nvs_keys.bin"), llave);
  rmSync(join(dirLote, "keys"), { recursive: true, force: true });
  chmodSync(llave, 0o600);
  return llave;
}

/** Imagen cifrada de la partición `identity` de un nodo: `<dirLote>/imagenes/<deviceId>.bin`. */
export async function generarImagenIdentidad(
  python: string,
  dirLote: string,
  nodo: NodoFabricado,
  datos: DatosIdentidad,
  tamano = TAMANO_IDENTIDAD,
): Promise<string> {
  const dir = join(dirLote, "imagenes");
  mkdirSync(dir, { recursive: true });
  const csv = join(dir, `${nodo.deviceId}.csv`);
  const salida = join(dir, `${nodo.deviceId}.bin`);
  const llave = await asegurarLlaveNvs(python, dirLote);
  // el CSV tiene secretos: 0600 y se borra al terminar
  writeFileSync(csv, csvIdentidad(nodo, datos), { mode: 0o600 });
  try {
    await ejecutar(python, [
      "-m",
      "esp_idf_nvs_partition_gen",
      "encrypt",
      csv,
      salida,
      `0x${tamano.toString(16)}`,
      "--inputkey",
      llave,
    ]);
  } finally {
    rmSync(csv, { force: true });
  }
  return salida;
}

export interface OpcionesGrabado {
  puerto: string;
  /** Offsets de `partitions.csv` del firmware: no se adivinan. */
  offsetIdentidad: number;
  offsetLlaves: number;
  imagenIdentidad: string;
  llavesNvs: string;
  firmware?: { archivo: string; offset: number };
}

/** Argumentos de `esptool write-flash`; la fábrica no borra la flash entera para no tocar `nvs` ni `otadata` ajenos. */
export function argumentosEsptool(op: OpcionesGrabado): string[] {
  const args = [
    "-m",
    "esptool",
    "--port",
    op.puerto,
    "write-flash",
    `0x${op.offsetLlaves.toString(16)}`,
    op.llavesNvs,
    `0x${op.offsetIdentidad.toString(16)}`,
    op.imagenIdentidad,
  ];
  if (op.firmware) args.push(`0x${op.firmware.offset.toString(16)}`, op.firmware.archivo);
  return args;
}

export async function grabar(python: string, op: OpcionesGrabado): Promise<string> {
  const { stdout } = await ejecutar(python, argumentosEsptool(op), { timeout: 5 * 60_000 });
  return stdout;
}

/** Lee el `ca.crt` para fallar pronto si no existe, y devuelve su ruta absoluta. */
export function rutaCa(caFile: string): string {
  const abs = resolve(caFile);
  readFileSync(abs);
  return abs;
}
