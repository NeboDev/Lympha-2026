import { topico } from "@lympha/contracts";
import { CANAL_INVALIDAR_NODO, crearResolvedorNodo } from "../modules/dispositivos/index.ts";
import type { TrabajoLecturas } from "../modules/telemetria/index.ts";
import { crearIngesta } from "../modules/telemetria/index.ts";
import { type ConfigDe, cargarConfigOSalir } from "../platform/config.ts";
import { crearBdSistema } from "../platform/db.ts";
import { crearLogger, type Logger } from "../platform/logger.ts";
import { cerrarCliente, crearClienteMqtt } from "../platform/mqtt.ts";
import { alApagar } from "../platform/proceso.ts";
import { COLA_LECTURAS, crearCola } from "../platform/queues.ts";
import { crearConexionBullmq, crearValkey } from "../platform/valkey.ts";

export interface ProcesoIngest {
  detener(): Promise<void>;
}

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function iniciarIngest(
  config: ConfigDe<"ingest">,
  log: Logger,
): Promise<ProcesoIngest> {
  const bd = crearBdSistema(config.DATABASE_URL_SYSTEM, "ingest", 5);
  const valkey = crearValkey(config.VALKEY_URL, "ingest");
  const suscriptor = crearValkey(config.VALKEY_URL, "ingest-invalidar");
  const conexionCola = crearConexionBullmq(config.VALKEY_URL, "ingest");
  const cola = crearCola<TrabajoLecturas>(COLA_LECTURAS, conexionCola);
  const resolver = crearResolvedorNodo(valkey, bd);

  const ingesta = crearIngesta({
    resolver,
    encolar: async (trabajo) => {
      await cola.add("lote", trabajo);
    },
    log,
  });

  let cerrando = false;

  /**
   * El PUBACK sale solo después de que el trabajo está en la cola (RNF-11). Si Valkey o Postgres
   * fallan, se reintenta SIN confirmar: mqtt.js procesa un mensaje a la vez, así que el reintento
   * frena la lectura y el broker acumula los QoS 1 hasta que la infraestructura vuelva.
   */
  async function atender(topicoRecibido: string, carga: Buffer): Promise<number | null> {
    let espera = 500;
    while (!cerrando) {
      try {
        return await ingesta.manejar(topicoRecibido, carga);
      } catch (error) {
        log.error({ err: error }, "fallo de infraestructura; se reintenta sin confirmar");
        await dormir(espera);
        espera = Math.min(espera * 2, 5000);
      }
    }
    return null; // apagando: sin PUBACK, el broker reentrega al reconectar (sesión persistente)
  }

  const mqtt = crearClienteMqtt({
    url: config.MQTT_URL,
    username: config.MQTT_INGEST_USER,
    password: config.MQTT_INGEST_PASSWORD,
    // el cliente "lympha-ingest" está fijado a este client id en Dynamic Security
    clientId: config.MQTT_INGEST_USER,
    caFile: config.MQTT_CA_FILE,
    clean: false, // sesión persistente: el broker guarda los QoS 1 mientras ingest se reinicia
    sessionExpiryInterval: 2 * 3600, // igual que persistent_client_expiration del broker
    customHandleAcks: (topicoRecibido, carga, _paquete, confirmar) => {
      void atender(topicoRecibido, carga).then((codigo) => {
        if (codigo !== null) confirmar(codigo);
      });
    },
  });
  mqtt.on("error", (e) => log.error({ err: e }, "MQTT"));
  mqtt.on("reconnect", () => log.warn("MQTT: reconectando"));
  mqtt.on("connect", () => {
    log.info("MQTT conectado");
    mqtt.subscribe(topico("+", "telemetry"), { qos: 1 }, (error, granted) => {
      if (error || granted?.some((g) => g.qos >= 128)) {
        log.error({ err: error }, "suscripción a telemetría denegada");
      }
    });
  });

  suscriptor.on("message", (_canal, mensaje) => {
    resolver.invalidar(mensaje).catch((e: unknown) => log.warn({ err: e }, "no se pudo invalidar"));
  });
  await suscriptor.subscribe(CANAL_INVALIDAR_NODO);

  log.info("ingest iniciado");
  return {
    async detener() {
      cerrando = true;
      await cerrarCliente(mqtt).catch(() => mqtt.end(true));
      await cola.close();
      suscriptor.disconnect();
      valkey.disconnect();
      conexionCola.disconnect();
      await bd.cerrar();
    },
  };
}

if (import.meta.main) {
  const config = cargarConfigOSalir("ingest");
  const log = crearLogger("ingest", config.LOG_LEVEL);
  const proceso = await iniciarIngest(config, log);
  alApagar(log, proceso.detener);
}
