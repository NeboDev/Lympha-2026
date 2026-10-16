import { randomUUID } from "node:crypto";
import type pg from "pg";
import type { MqttClient } from "../../platform/mqtt.ts";
import { publicarComando, urlDeFirmware } from "./comandos.ts";
import type { DepsOrquestador } from "./orquestador.ts";
import {
  cambiarEtapa,
  cerrarDespliegue,
  crearDespliegue,
  despliegueDetenido,
  estadosDeNodos,
  nodosElegibles,
  registrarComando,
  type VersionFirmware,
} from "./repo.ts";

/** Conecta el orquestador con Postgres (rol lympha_owner) y el broker (`lympha-control`). */
export function depsDesdeBd(
  db: pg.Client,
  mqtt: MqttClient,
  fw: VersionFirmware,
  baseUrl: string,
  aviso: (texto: string) => void = () => undefined,
): DepsOrquestador {
  const url = urlDeFirmware(baseUrl, fw.archivo);
  return {
    elegibles: (v) => nodosElegibles(db, v),
    crearDespliegue: (v, etapa) => crearDespliegue(db, v, etapa),
    cambiarEtapa: (id, etapa) => cambiarEtapa(db, id, etapa),
    cerrar: (id, estado, motivo) => cerrarDespliegue(db, id, estado, motivo),
    enviar: async (despliegueId, nodoId, version) => {
      const id = randomUUID();
      // primero el registro: un ack que llegue antes de que termine el publish debe encontrar la fila
      await registrarComando(db, { id, nodoId, despliegueId, op: "ota", version });
      await publicarComando(mqtt, nodoId, {
        v: 1,
        id,
        op: "ota",
        url,
        sha256: fw.sha256,
        version,
      });
    },
    estados: (id, nodos) => estadosDeNodos(db, id, nodos),
    detenido: (id) => despliegueDetenido(db, id),
    ahora: () => new Date(),
    dormir: (ms) => new Promise((res) => setTimeout(res, ms)),
    aviso,
  };
}
