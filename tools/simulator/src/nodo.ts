import { readFileSync } from "node:fs";
import { comandoV1, estadoConexion, type Telemetria, telemetria, topico } from "@lympha/contracts";
import type { Mediciones } from "@lympha/wqi";
import { connect, type IClientOptions, type MqttClient } from "mqtt";
import { BufferLecturas, capacidadParaHoras, type LecturaGuardada } from "./buffer.ts";
import { type OpcionesOta, OTA_POR_DEFECTO, resolverOta } from "./comandos.ts";
import { type Escenario, evaluarEscenario } from "./escenarios.ts";
import { aTelemetria, type Historia, medicionesDeHistoria } from "./historias.ts";

/**
 * Nodo simulado: se comporta como el firmware según el contrato v1 (identidad propia, TLS,
 * Last Will retenido en `status`, atributos al conectar y telemetría periódica con `seq` y `ts`). Sin conexión
 * guarda las lecturas en un buffer (24 h) y las envía en orden al volver; atiende `cmd` (reboot, ota) y responde en
 * `cmd/ack`, incluido un reinicio y un rollback simulados.
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
  /** Cómo reacciona a un comando `ota` (por defecto: éxito, con descarga y verificación del hash). */
  ota?: Partial<OpcionesOta>;
  /** Lecturas que caben en el buffer sin conexión (por defecto, 24 h a su intervalo). */
  bufferMax?: number;
  /** Lecturas por segundo al vaciar el buffer tras reconectar. */
  vaciadoPorSegundo?: number;
  log?: (mensaje: string, extra?: Record<string, unknown>) => void;
  /** Reloj inyectable para pruebas. */
  ahora?: () => number;
}

export interface NodoSimulado {
  readonly cliente: MqttClient;
  /** Lecturas publicadas y confirmadas por el broker. */
  readonly publicadas: () => number;
  /** Lecturas esperando conexión en el buffer. */
  readonly enBuffer: () => number;
  /** Lecturas perdidas porque el buffer se llenó. */
  readonly descartadas: () => number;
  /** Versión de firmware actual (cambia tras un OTA exitoso). */
  readonly firmware: () => string;
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
  const intervaloS = op.intervaloS ?? 60;
  const intervaloMs = intervaloS * 1000;
  const modelo = crearModeloAgua();
  const guion = op.historia ? medicionesDeHistoria(op.historia, op.semilla) : undefined;
  const maxLecturas = op.maxLecturas ?? op.historia?.lecturas;
  const ota: OpcionesOta = { ...OTA_POR_DEFECTO, ...op.ota };
  const buffer = new BufferLecturas(op.bufferMax ?? capacidadParaHoras(24, intervaloS));
  let firmware = op.firmware ?? "sim-0.1.0";
  let seq = 0;
  let publicadas = 0;
  const inicio = ahora();
  let temporizador: NodeJS.Timeout | undefined;
  let temporizadorReinicio: NodeJS.Timeout | undefined;
  let cerrado = false;
  let vaciando = false;
  /** Motivos por los que el nodo está sin conexión a propósito. */
  let caidoEscenario = false;
  let caidoReinicio = false;
  let sinConexion = false;

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
    if (!sinConexion) log("reconectando");
  });

  await new Promise<void>((resolve, reject) => {
    cliente.once("connect", () => resolve());
    cliente.once("error", (e) => reject(e));
  });
  log("conectado", { url: op.url, tls: op.url.startsWith("mqtts") });

  let alTerminar!: () => void;
  const terminado = new Promise<void>((r) => {
    alTerminar = r;
  });

  /** Cae o vuelve a conectarse según los motivos activos. Una caída no manda DISCONNECT: se dispara el Last Will. */
  async function ajustarConexion(): Promise<void> {
    if (cerrado) return;
    const quiereConexion = !caidoEscenario && !caidoReinicio;
    if (!quiereConexion && !sinConexion) {
      sinConexion = true;
      log("sin conexión", { escenario: caidoEscenario, reinicio: caidoReinicio });
      cliente.end(true);
    } else if (quiereConexion && sinConexion) {
      sinConexion = false;
      log("vuelve a conectarse");
      cliente.reconnect();
      await new Promise<void>((resolver) => cliente.once("connect", () => resolver()));
    }
  }

  async function publicarGuardada(l: LecturaGuardada): Promise<void> {
    await cliente.publishAsync(
      topico(op.deviceId, "telemetry"),
      JSON.stringify(telemetria.parse({ v: 1, ...l })),
      { qos: 1 },
    );
    publicadas++;
    log("lectura publicada", { seq: l.seq, ph: l.ph });
    if (maxLecturas !== undefined && publicadas >= maxLecturas) alTerminar();
  }

  /** Envía en orden lo acumulado sin conexión, a ritmo limitado y con el `ts` y el `seq` originales. */
  async function vaciarBuffer(): Promise<void> {
    if (vaciando || buffer.tamano === 0) return;
    vaciando = true;
    try {
      const n = await buffer.vaciar(publicarGuardada, {
        porSegundo: op.vaciadoPorSegundo ?? 20,
        vigente: () => cliente.connected && !cerrado,
      });
      if (n > 0) log("buffer vaciado", { lecturas: n, restantes: buffer.tamano });
    } finally {
      vaciando = false;
    }
  }

  /** Lo que hace el firmware en cada conexión: escuchar comandos, anunciarse, publicar atributos y vaciar el buffer. */
  async function alConectar(): Promise<void> {
    await cliente.subscribeAsync(topico(op.deviceId, "cmd"), { qos: 1 });
    await cliente.publishAsync(topico(op.deviceId, "status"), "online", { qos: 1, retain: true });
    await cliente.publishAsync(
      topico(op.deviceId, "attributes"),
      JSON.stringify({ v: 1, fw: firmware, rssi: -58, buffered: buffer.tamano }),
      { qos: 1 },
    );
    await vaciarBuffer();
  }
  await alConectar();
  cliente.on("connect", () => void alConectar().catch(() => undefined));

  async function responder(id: string, ok: boolean, detail: string): Promise<void> {
    await cliente
      .publishAsync(topico(op.deviceId, "cmd/ack"), JSON.stringify({ v: 1, id, ok, detail }), {
        qos: 1,
      })
      .catch((e: Error) => log("ack no enviado", { motivo: e.message }));
  }

  /** Reinicio: cae sin despedirse, espera y vuelve con `nuevaVersion` (o con la misma si es un reinicio o rollback). */
  function reiniciar(nuevaVersion: string | null, segundos: number): void {
    caidoReinicio = true;
    void ajustarConexion();
    temporizadorReinicio = setTimeout(() => {
      if (nuevaVersion) firmware = nuevaVersion;
      caidoReinicio = false;
      void ajustarConexion().catch(() => undefined);
    }, segundos * 1000);
  }

  async function atenderComando(carga: Buffer): Promise<void> {
    let json: unknown;
    try {
      json = JSON.parse(carga.toString("utf8"));
    } catch {
      log("comando ilegible");
      return;
    }
    const c = comandoV1.safeParse(json);
    if (!c.success) {
      log("comando no válido");
      return;
    }
    const cmd = c.data;
    log("comando recibido", { op: cmd.op, id: cmd.id });
    if (cmd.op === "reboot") {
      await responder(cmd.id, true, "reiniciando");
      reiniciar(null, ota.reinicioS);
      return;
    }
    const r = await resolverOta(cmd, ota);
    if (r.ack) await responder(cmd.id, r.ack.ok, r.ack.detalle);
    if (r.luego === "reiniciar_nueva") reiniciar(cmd.version, ota.reinicioS);
    // la versión nueva no logra conectarse: el bootloader revierte y vuelve la versión anterior
    if (r.luego === "reiniciar_y_revertir") reiniciar(null, ota.rollbackS);
  }
  cliente.on("message", (t, carga) => {
    if (t === topico(op.deviceId, "cmd")) void atenderComando(carga);
  });

  async function enviar(lectura: LecturaGuardada): Promise<void> {
    if (cliente.connected && buffer.tamano === 0 && !vaciando) {
      try {
        await publicarGuardada(lectura);
      } catch (error) {
        log("lectura no confirmada; se guarda en el buffer", { motivo: (error as Error).message });
        buffer.agregar(lectura);
      }
      return;
    }
    // sin conexión, o con lecturas viejas por salir: se respeta el orden
    buffer.agregar(lectura);
    if (cliente.connected) void vaciarBuffer();
  }

  async function tomarLectura(): Promise<void> {
    if (maxLecturas !== undefined && seq >= maxLecturas) return;
    const muestra = op.escenario ? evaluarEscenario(op.escenario, (ahora() - inicio) / 1000) : null;
    if (muestra) {
      caidoEscenario = muestra.desconectado;
      await ajustarConexion();
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
    const { v: _v, ...lectura } = payload;
    await enviar(lectura as LecturaGuardada);
  }

  await tomarLectura();
  if (maxLecturas === undefined || seq < maxLecturas) {
    temporizador = setInterval(() => void tomarLectura().catch(() => undefined), intervaloMs);
  }

  return {
    cliente,
    publicadas: () => publicadas,
    enBuffer: () => buffer.tamano,
    descartadas: () => buffer.descartadas,
    firmware: () => firmware,
    terminado,
    async detener() {
      if (cerrado) return;
      cerrado = true;
      if (temporizador) clearInterval(temporizador);
      if (temporizadorReinicio) clearTimeout(temporizadorReinicio);
      // desconexión limpia: el nodo avisa que se va (no se dispara el Last Will)
      if (cliente.connected) {
        await cliente
          .publishAsync(topico(op.deviceId, "status"), "offline", { qos: 1, retain: true })
          .catch(() => undefined);
      }
      await cliente.endAsync(false);
    },
  };
}
