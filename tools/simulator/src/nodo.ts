import { readFileSync } from "node:fs";
import { estadoConexion, type Telemetria, telemetria, topico } from "@lympha/contracts";
import type { Mediciones } from "@lympha/wqi";
import { connect, type IClientOptions, type MqttClient } from "mqtt";
import { type Escenario, evaluarEscenario } from "./escenarios.ts";
import { aTelemetria, type Historia, medicionesDeHistoria } from "./historias.ts";

/**
 * Nodo simulado: se comporta como el firmware según el contrato v1 (identidad propia, TLS,
 * Last Will retenido en `status`, atributos al conectar y telemetría periódica con `seq` y `ts`).
 */

export interface OpcionesNodo {
  deviceId: string;
  password: string;
  /** p. ej. mqtts://localhost:8883 */
  url: string;
  /** CA propia de desarrollo; en staging/producción se usa el almacén del sistema. */
  caFile?: string | undefined;
  /** Segundos entre lecturas (el producto usa 60). */
  intervaloS?: number;
  /** Detenerse tras N lecturas (útil en pruebas). Sin valor, corre hasta cerrar. */
  maxLecturas?: number;
  /** Guion de mediciones (valores, rampas, sensor caído, caídas sin despedirse). Sin él, agua estable. */
  escenario?: Escenario;
  /** Historia de agua con nivel esperado (ver historias.ts): publica sus lecturas y termina sola. */
  historia?: Historia;
  /** Semilla del ruido de la historia. */
  semilla?: number;
  /** Versión de firmware que dice tener. */
  firmware?: string;
  log?: (mensaje: string, extra?: Record<string, unknown>) => void;
  /** Reloj inyectable para pruebas. */
  ahora?: () => number;
}

export interface NodoSimulado {
  readonly cliente: MqttClient;
  /** Lecturas publicadas y confirmadas por el broker. */
  readonly publicadas: () => number;
  /** Resuelve cuando se alcanza `maxLecturas`. */
  terminado: Promise<void>;
  detener(): Promise<void>;
}

/** Agua estable con ruido y una deriva lenta del pH, parecida al perfil "agua estable" del plan. */
export function crearModeloAgua(semilla = Date.now()) {
  let estado = semilla >>> 0 || 1;
  const azar = () => {
    // xorshift32: determinista para una misma semilla
    estado ^= estado << 13;
    estado >>>= 0;
    estado ^= estado >>> 17;
    estado ^= estado << 5;
    estado >>>= 0;
    return estado / 0xffffffff;
  };
  const ruido = (amplitud: number) => (azar() - 0.5) * 2 * amplitud;
  let ph = 7.2;
  return {
    siguiente(): Omit<Telemetria, "v" | "ts" | "seq"> {
      ph = Math.min(8.5, Math.max(6.0, ph + ruido(0.02)));
      return {
        ph: Number(ph.toFixed(2)),
        t: Number((22 + ruido(0.2)).toFixed(1)),
        ec: Math.round(450 + ruido(5)),
        turb: Number(Math.max(0, 0.6 + ruido(0.1)).toFixed(2)),
        tds: Math.round(290 + ruido(3)),
      };
    },
  };
}

export async function iniciarNodo(op: OpcionesNodo): Promise<NodoSimulado> {
  const log = op.log ?? (() => undefined);
  const ahora = op.ahora ?? Date.now;
  const intervaloMs = (op.intervaloS ?? 60) * 1000;
  const modelo = crearModeloAgua();
  const guion = op.historia ? medicionesDeHistoria(op.historia, op.semilla) : undefined;
  const maxLecturas = op.maxLecturas ?? op.historia?.lecturas;
  let seq = 0;
  let publicadas = 0;
  const inicio = ahora();
  let temporizador: NodeJS.Timeout | undefined;
  let cerrado = false;
  /** El escenario lo tiene "caído": sin conexión y sin publicar. */
  let caido = false;

  const opciones: IClientOptions = {
    username: op.deviceId,
    password: op.password,
    clientId: op.deviceId, // el broker exige que coincida con el usuario
    protocolVersion: 5,
    clean: true,
    reconnectPeriod: 2000,
    // Si el nodo cae sin despedirse, el broker publica "offline" (retenido).
    will: {
      topic: topico(op.deviceId, "status"),
      payload: Buffer.from(estadoConexion.parse("offline")),
      qos: 1,
      retain: true,
    },
  };
  if (op.caFile) opciones.ca = readFileSync(op.caFile);

  const cliente = connect(op.url, opciones);
  cliente.on("error", (e) => log("error MQTT", { motivo: e.message }));
  cliente.on("reconnect", () => {
    if (!caido) log("reconectando");
  });

  await new Promise<void>((resolve, reject) => {
    cliente.once("connect", () => resolve());
    cliente.once("error", (e) => reject(e));
  });
  log("conectado", { url: op.url, tls: op.url.startsWith("mqtts") });

  /** Lo que hace el firmware en cada conexión: anunciarse y publicar sus atributos. */
  async function anunciarse(): Promise<void> {
    await cliente.publishAsync(topico(op.deviceId, "status"), "online", { qos: 1, retain: true });
    await cliente.publishAsync(
      topico(op.deviceId, "attributes"),
      JSON.stringify({ v: 1, fw: op.firmware ?? "sim-0.1.0", rssi: -58, buffered: 0 }),
      { qos: 1 },
    );
  }
  await anunciarse();
  // Tras una caída (del escenario o de la red) el nodo vuelve a anunciarse.
  cliente.on("connect", () => void anunciarse().catch(() => undefined));

  let alTerminar!: () => void;
  const terminado = new Promise<void>((r) => {
    alTerminar = r;
  });

  async function publicarLectura(): Promise<void> {
    const muestra = op.escenario ? evaluarEscenario(op.escenario, (ahora() - inicio) / 1000) : null;
    if (muestra?.desconectado) {
      if (!caido) {
        caido = true;
        log("caída sin despedirse (escenario)");
        cliente.end(true); // sin DISCONNECT: el broker publica el Last Will
      }
      return;
    }
    if (caido) {
      caido = false;
      log("vuelve a conectarse (escenario)");
      cliente.reconnect();
      await new Promise<void>((resolver) => cliente.once("connect", () => resolver()));
    }
    const numero = seq++;
    const base = guion
      ? aTelemetria(guion[numero] ?? (guion.at(-1) as Mediciones))
      : modelo.siguiente();
    const payload = telemetria.parse({
      v: 1,
      ts: Math.floor(ahora() / 1000),
      seq: numero,
      ...base,
      ...(muestra?.valores ?? {}),
    });
    try {
      await cliente.publishAsync(topico(op.deviceId, "telemetry"), JSON.stringify(payload), {
        qos: 1,
      });
      publicadas++;
      log("lectura publicada", { seq: payload.seq, ph: payload.ph });
    } catch (error) {
      log("lectura no confirmada", { motivo: (error as Error).message });
    }
    if (maxLecturas !== undefined && publicadas >= maxLecturas) alTerminar();
  }

  await publicarLectura();
  if (maxLecturas === undefined || publicadas < maxLecturas) {
    temporizador = setInterval(() => void publicarLectura(), intervaloMs);
  }

  return {
    cliente,
    publicadas: () => publicadas,
    terminado,
    async detener() {
      if (cerrado) return;
      cerrado = true;
      if (temporizador) clearInterval(temporizador);
      // desconexión limpia: el nodo avisa que se va (no se dispara el Last Will)
      await cliente
        .publishAsync(topico(op.deviceId, "status"), "offline", { qos: 1, retain: true })
        .catch(() => undefined);
      await cliente.endAsync(false);
    },
  };
}
