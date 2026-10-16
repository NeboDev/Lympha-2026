import { execFile } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { argumentosEsptool, csvIdentidad, generarImagenIdentidad, rutaPython } from "./grabado.ts";
import type { NodoFabricado } from "./lote.ts";

const ejecutar = promisify(execFile);

const nodo: NodoFabricado = {
  deviceId: "0192f3a7-5d1c-7a2b-8c3d-0123456789ab",
  mqttPassword: "pw_de-prueba_0123456789abcdefABCDEF",
  apKey: "ABCD234EFG",
  codigoReclamo: "ABCD-2345-EFGH",
};
const datos = { brokerUrl: "mqtts://192.168.1.50:8883", caFile: "/tmp/ca.crt" };

describe("csvIdentidad", () => {
  it("incluye las llaves de la partición identity", () => {
    const csv = csvIdentidad(nodo, datos);
    expect(csv).toContain("identity,namespace,,");
    for (const llave of ["device_id", "mqtt_user", "mqtt_pass", "ap_key", "broker_url"]) {
      expect(csv).toContain(`${llave},data,string,`);
    }
    expect(csv).toContain("ca_pem,file,string,/tmp/ca.crt");
  });

  it("no graba el código de reclamo (solo vive en la etiqueta y el hash del servidor)", () => {
    expect(csvIdentidad(nodo, datos)).not.toContain("ABCD-2345");
  });

  it("rechaza valores que romperían el CSV", () => {
    expect(() => csvIdentidad({ ...nodo, mqttPassword: "a,b" }, datos)).toThrow();
    expect(() => csvIdentidad({ ...nodo, apKey: "a\nb" }, datos)).toThrow();
  });
});

describe("argumentosEsptool", () => {
  it("graba llaves e identidad en los offsets recibidos y el firmware si se indica", () => {
    const args = argumentosEsptool({
      puerto: "COM5",
      offsetLlaves: 0x9000,
      offsetIdentidad: 0xf000,
      imagenIdentidad: "id.bin",
      llavesNvs: "keys.bin",
      firmware: { archivo: "fw.bin", offset: 0x20000 },
    });
    expect(args).toEqual([
      "-m",
      "esptool",
      "--port",
      "COM5",
      "write-flash",
      "0x9000",
      "keys.bin",
      "0xf000",
      "id.bin",
      "0x20000",
      "fw.bin",
    ]);
  });
});

function pythonDisponible(): string | null {
  try {
    return rutaPython(join(import.meta.dirname, "../../../../.."));
  } catch {
    return null;
  }
}

describe.skipIf(!pythonDisponible())("imagen cifrada con nvs_partition_gen real", () => {
  it("genera una imagen del tamaño de la partición que no contiene la contraseña en claro", async () => {
    const python = pythonDisponible() as string;
    const dir = mkdtempSync(join(tmpdir(), "lympha-fab-"));
    try {
      const ca = join(dir, "ca.crt");
      writeFileSync(ca, "-----BEGIN CERTIFICATE-----\nMIIBprueba\n-----END CERTIFICATE-----\n");
      const imagen = await generarImagenIdentidad(python, dir, nodo, { ...datos, caFile: ca });
      const bytes = readFileSync(imagen);
      expect(statSync(imagen).size).toBe(0x6000);
      expect(bytes.includes(Buffer.from(nodo.mqttPassword))).toBe(false);
      expect(readdirSync(join(dir, "imagenes")).filter((f) => f.endsWith(".csv"))).toEqual([]);
      expect(existsSync(join(dir, "nvs_keys.bin"))).toBe(true);

      await ejecutar(python, [
        "-m",
        "esp_idf_nvs_partition_gen",
        "decrypt",
        imagen,
        join(dir, "nvs_keys.bin"),
        join(dir, "claro.bin"),
      ]);
      const claro = readFileSync(join(dir, "claro.bin"));
      expect(claro.includes(Buffer.from(nodo.deviceId))).toBe(true);
      expect(claro.includes(Buffer.from(nodo.mqttPassword))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
