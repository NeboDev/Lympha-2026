import type { MqttClient } from "./mqtt.ts";

/**
 * Cliente de la API de administración de Mosquitto Dynamic Security
 * (`$CONTROL/dynamic-security/v1`). Postgres no guarda contraseñas MQTT: el broker es la fuente
 * de verdad de clientes, roles y ACL.
 */

const TOPICO_PETICION = "$CONTROL/dynamic-security/v1";
const TOPICO_RESPUESTA = "$CONTROL/dynamic-security/v1/response";

export type Comando = { command: string } & Record<string, unknown>;

export interface RespuestaComando {
  command: string;
  error?: string;
  data?: Record<string, unknown>;
  correlationData?: string;
}

export type TipoAcl =
  | "publishClientSend"
  | "publishClientReceive"
  | "subscribePattern"
  | "unsubscribePattern";

export interface Acl {
  acltype: TipoAcl;
  topic: string;
  allow: boolean;
  priority?: number;
}

export interface DefinicionRol {
  rolename: string;
  textname: string;
  acls: Acl[];
}

const P = "lympha/v1/d";

/**
 * Roles de la flota. `%u` (usuario) se sustituye en las ACL desde Mosquitto 2.1: un solo rol `nodo`
 * sirve a todos los equipos. Todo lo que no está aquí se niega (`defaultACLAccess` en `false`).
 */
export const ROLES: DefinicionRol[] = [
  {
    rolename: "nodo",
    textname: "Nodo de la flota",
    acls: [
      { acltype: "publishClientSend", topic: `${P}/%u/telemetry`, allow: true },
      { acltype: "publishClientSend", topic: `${P}/%u/attributes`, allow: true },
      { acltype: "publishClientSend", topic: `${P}/%u/status`, allow: true },
      { acltype: "publishClientSend", topic: `${P}/%u/cmd/ack`, allow: true },
      { acltype: "subscribePattern", topic: `${P}/%u/config`, allow: true },
      { acltype: "subscribePattern", topic: `${P}/%u/cmd`, allow: true },
      { acltype: "unsubscribePattern", topic: `${P}/%u/#`, allow: true },
      { acltype: "publishClientReceive", topic: `${P}/%u/#`, allow: true },
    ],
  },
  {
    rolename: "ingest",
    textname: "Proceso ingest",
    acls: [
      { acltype: "subscribePattern", topic: `${P}/+/telemetry`, allow: true },
      { acltype: "subscribePattern", topic: `${P}/+/attributes`, allow: true },
      { acltype: "subscribePattern", topic: `${P}/+/status`, allow: true },
      { acltype: "subscribePattern", topic: `${P}/+/cmd/ack`, allow: true },
      { acltype: "unsubscribePattern", topic: `${P}/+/#`, allow: true },
      { acltype: "publishClientReceive", topic: `${P}/+/#`, allow: true },
    ],
  },
  {
    rolename: "control",
    textname: "api y worker: config y comandos a los nodos",
    acls: [
      { acltype: "publishClientSend", topic: `${P}/+/config`, allow: true },
      { acltype: "publishClientSend", topic: `${P}/+/cmd`, allow: true },
    ],
  },
  {
    rolename: "admin",
    textname: "Administración de Dynamic Security",
    acls: [
      { acltype: "publishClientSend", topic: "$CONTROL/dynamic-security/#", allow: true },
      { acltype: "publishClientReceive", topic: "$CONTROL/dynamic-security/#", allow: true },
      { acltype: "subscribePattern", topic: "$CONTROL/dynamic-security/#", allow: true },
      { acltype: "unsubscribePattern", topic: "$CONTROL/dynamic-security/#", allow: true },
    ],
  },
  {
    // Se asigna con prioridad máxima a un cliente o grupo (lote) para negárselo todo en segundos.
    rolename: "revocado",
    textname: "Credencial revocada",
    acls: (
      [
        "publishClientSend",
        "publishClientReceive",
        "subscribePattern",
        "unsubscribePattern",
      ] as const
    ).map((acltype) => ({ acltype, topic: "#", allow: false, priority: 1000 })),
  },
];

/** Prioridad con la que se asigna `revocado` a un cliente o grupo. */
export const PRIORIDAD_REVOCADO = 1000;

const claveAcl = (a: Pick<Acl, "acltype" | "topic">) => `${a.acltype}\u0000${a.topic}`;

/** Diferencia entre las ACL actuales de un rol y las deseadas. */
export function diferenciarAcls(actuales: Acl[], deseadas: Acl[]) {
  const porClave = new Map(actuales.map((a) => [claveAcl(a), a]));
  const queridas = new Map(deseadas.map((a) => [claveAcl(a), a]));
  const quitar = actuales.filter((a) => {
    const q = queridas.get(claveAcl(a));
    return !q || q.allow !== a.allow || (q.priority ?? 0) !== (a.priority ?? 0);
  });
  const agregar = deseadas.filter((q) => {
    const a = porClave.get(claveAcl(q));
    return !a || a.allow !== q.allow || (a.priority ?? 0) !== (q.priority ?? 0);
  });
  return { quitar, agregar };
}

export class ErrorDynsec extends Error {
  readonly comando: string;
  constructor(comando: string, mensaje: string) {
    super(`Dynamic Security "${comando}": ${mensaje}`);
    this.name = "ErrorDynsec";
    this.comando = comando;
  }
}

export class ClienteDynsec {
  readonly #mqtt: MqttClient;
  #cola: Promise<unknown> = Promise.resolve();
  #pendiente: ((r: RespuestaComando[]) => void) | null = null;
  #listo: Promise<void> | null = null;

  constructor(mqtt: MqttClient) {
    this.#mqtt = mqtt;
    mqtt.on("message", (topico, carga) => {
      if (topico !== TOPICO_RESPUESTA || !this.#pendiente) return;
      try {
        const cuerpo = JSON.parse(carga.toString("utf8")) as { responses?: RespuestaComando[] };
        const resolver = this.#pendiente;
        this.#pendiente = null;
        resolver(cuerpo.responses ?? []);
      } catch {
        // respuesta ilegible: la petición caducará por tiempo
      }
    });
  }

  #asegurarSuscripcion(): Promise<void> {
    this.#listo ??= this.#mqtt.subscribeAsync(TOPICO_RESPUESTA, { qos: 1 }).then((granted) => {
      const denegado = granted.some((g) => g.qos >= 128);
      if (denegado) throw new Error("Dynamic Security: suscripción a las respuestas denegada");
    });
    return this.#listo;
  }

  /** Envía comandos en una sola petición y devuelve una respuesta por comando. Una a la vez. */
  ejecutar(comandos: Comando[], ms = 10_000): Promise<RespuestaComando[]> {
    const turno = this.#cola.then(async () => {
      await this.#asegurarSuscripcion();
      return new Promise<RespuestaComando[]>((resolve, reject) => {
        const temporizador = setTimeout(() => {
          this.#pendiente = null;
          reject(new Error("Dynamic Security: sin respuesta del broker"));
        }, ms);
        this.#pendiente = (r) => {
          clearTimeout(temporizador);
          resolve(r);
        };
        this.#mqtt
          .publishAsync(TOPICO_PETICION, JSON.stringify({ commands: comandos }), { qos: 1 })
          .catch((e: unknown) => {
            clearTimeout(temporizador);
            this.#pendiente = null;
            reject(e);
          });
      });
    });
    this.#cola = turno.catch(() => undefined);
    return turno;
  }

  /** Ejecuta un comando; lanza si el broker devuelve error, salvo que coincida con `tolerado`. */
  async comando(c: Comando, tolerado?: RegExp): Promise<RespuestaComando> {
    const [respuesta] = await this.ejecutar([c]);
    if (!respuesta) throw new ErrorDynsec(c.command, "respuesta vacía");
    if (respuesta.error && !(tolerado?.test(respuesta.error) ?? false)) {
      throw new ErrorDynsec(c.command, respuesta.error);
    }
    return respuesta;
  }

  /** Crea el rol si falta y deja sus ACL exactamente como `rol.acls` (sin tocar a los clientes). */
  async asegurarRol(rol: DefinicionRol): Promise<void> {
    await this.comando(
      { command: "createRole", rolename: rol.rolename, textname: rol.textname },
      /already exists/i,
    );
    const actual = await this.comando({ command: "getRole", rolename: rol.rolename });
    const roleData = actual.data?.role as { acls?: Acl[] } | undefined;
    const { quitar, agregar } = diferenciarAcls(roleData?.acls ?? [], rol.acls);
    for (const a of quitar) {
      await this.comando({
        command: "removeRoleACL",
        rolename: rol.rolename,
        acltype: a.acltype,
        topic: a.topic,
      });
    }
    for (const a of agregar) {
      await this.comando({
        command: "addRoleACL",
        rolename: rol.rolename,
        acltype: a.acltype,
        topic: a.topic,
        allow: a.allow,
        priority: a.priority ?? 0,
      });
    }
  }

  /** Todo lo que no está en un rol se niega. */
  async negarPorDefecto(): Promise<void> {
    await this.comando({
      command: "setDefaultACLAccess",
      acls: [
        { acltype: "publishClientSend", allow: false },
        { acltype: "publishClientReceive", allow: false },
        { acltype: "subscribe", allow: false },
        { acltype: "unsubscribe", allow: false },
      ],
    });
  }

  /** Crea el cliente con su rol o, si ya existe, deja la contraseña y el rol al día. */
  async asegurarCliente(c: {
    username: string;
    password: string;
    clientid?: string;
    rolename: string;
    grupo?: string;
  }): Promise<void> {
    const crear = await this.ejecutar([
      {
        command: "createClient",
        username: c.username,
        password: c.password,
        clientid: c.clientid ?? c.username,
        roles: [{ rolename: c.rolename }],
        ...(c.grupo ? { groups: [{ groupname: c.grupo }] } : {}),
      },
    ]);
    const error = crear[0]?.error;
    if (!error) return;
    if (!/already exists/i.test(error)) throw new ErrorDynsec("createClient", error);
    await this.comando({
      command: "setClientPassword",
      username: c.username,
      password: c.password,
    });
    // addClientRole / addGroupClient devuelven "Internal error" si ya existen: se consulta primero.
    const actual = await this.comando({ command: "getClient", username: c.username });
    const cliente = actual.data?.client as
      | { roles?: { rolename: string }[]; groups?: { groupname: string }[] }
      | undefined;
    if (!cliente?.roles?.some((r) => r.rolename === c.rolename)) {
      await this.comando({ command: "addClientRole", username: c.username, rolename: c.rolename });
    }
    if (c.grupo && !cliente?.groups?.some((g) => g.groupname === c.grupo)) {
      await this.comando({ command: "addGroupClient", groupname: c.grupo, username: c.username });
    }
  }

  async asegurarGrupo(groupname: string): Promise<void> {
    await this.comando({ command: "createGroup", groupname }, /already exists/i);
  }

  /** Alta de un nodo de la flota: cliente con `deviceId` como usuario y client id, en el grupo de su lote. */
  async asegurarNodo(n: { deviceId: string; password: string; loteId: string }): Promise<void> {
    const grupo = `lote:${n.loteId}`;
    await this.asegurarGrupo(grupo);
    await this.asegurarCliente({
      username: n.deviceId,
      clientid: n.deviceId,
      password: n.password,
      rolename: "nodo",
      grupo,
    });
  }

  /** Base del broker: ACL por defecto, roles y clientes internos. Idempotente. */
  async aplicarBase(internos: { username: string; password: string; rolename: string }[]) {
    await this.negarPorDefecto();
    for (const rol of ROLES) await this.asegurarRol(rol);
    for (const i of internos) await this.asegurarCliente(i);
  }
}
