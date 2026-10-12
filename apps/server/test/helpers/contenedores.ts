import { readFileSync } from "node:fs";
import { join } from "node:path";
import { GenericContainer, type StartedTestContainer, Wait } from "testcontainers";

/** Raíz del repositorio: los contenedores de prueba usan los mismos archivos de infra/ que Compose. */
export const RAIZ = join(import.meta.dirname, "..", "..", "..", "..");

const base = readFileSync(join(RAIZ, "infra", "compose", "base.yml"), "utf8");

/** La imagen sale de base.yml para que las pruebas y el entorno no puedan divergir. */
function imagenDe(patron: RegExp): string {
  const m = patron.exec(base);
  if (!m?.[1]) throw new Error(`No se encontró la imagen ${patron} en base.yml`);
  return m[1];
}

export const CONTRASENAS = {
  postgres: "test-superuser",
  owner: "test-owner",
  app: "test-app",
  system: "test-system",
  backup: "test-backup",
};

export interface PostgresDePrueba {
  contenedor: StartedTestContainer;
  url(rol: "owner" | "app" | "system" | "backup"): string;
  detener(): Promise<void>;
}

export async function iniciarPostgres(): Promise<PostgresDePrueba> {
  const contenedor = await new GenericContainer(imagenDe(/image:\s*(timescale\/timescaledb:\S+)/))
    .withEnvironment({
      POSTGRES_PASSWORD: CONTRASENAS.postgres,
      POSTGRES_DB: "lympha",
      PW_OWNER: CONTRASENAS.owner,
      PW_APP: CONTRASENAS.app,
      PW_SYSTEM: CONTRASENAS.system,
      PW_BACKUP: CONTRASENAS.backup,
    })
    .withCopyFilesToContainer([
      {
        source: join(RAIZ, "infra", "postgres", "init-roles.sh"),
        target: "/docker-entrypoint-initdb.d/10-init-roles.sh",
        mode: 0o755,
      },
    ])
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
    .withStartupTimeout(180_000)
    .start();

  return {
    contenedor,
    url: (rol) =>
      `postgres://lympha_${rol}:${CONTRASENAS[rol]}@${contenedor.getHost()}:${contenedor.getMappedPort(5432)}/lympha`,
    detener: async () => {
      await contenedor.stop();
    },
  };
}

export const VALKEY_PW = { api: "t-api", ingest: "t-ingest", worker: "t-worker" };

export interface ValkeyDePrueba {
  url(usuario: "api" | "ingest" | "worker"): string;
  detener(): Promise<void>;
}

export async function iniciarValkey(): Promise<ValkeyDePrueba> {
  const contenedor = await new GenericContainer(imagenDe(/image:\s*(valkey\/valkey:\S+)/))
    .withEntrypoint(["/bin/sh", "/usr/local/bin/lympha-entrypoint.sh"])
    .withEnvironment({
      VALKEY_PW_API: VALKEY_PW.api,
      VALKEY_PW_INGEST: VALKEY_PW.ingest,
      VALKEY_PW_WORKER: VALKEY_PW.worker,
    })
    .withCopyFilesToContainer([
      {
        source: join(RAIZ, "infra", "valkey", "entrypoint.sh"),
        target: "/usr/local/bin/lympha-entrypoint.sh",
        mode: 0o755,
      },
      {
        source: join(RAIZ, "infra", "valkey", "valkey.conf.tpl"),
        target: "/etc/valkey/valkey.conf.tpl",
        mode: 0o644,
      },
    ])
    .withExposedPorts(6379)
    .withWaitStrategy(Wait.forLogMessage(/Ready to accept connections/))
    .start();
  return {
    url: (u) =>
      `redis://${u}:${VALKEY_PW[u]}@${contenedor.getHost()}:${contenedor.getMappedPort(6379)}`,
    detener: async () => {
      await contenedor.stop();
    },
  };
}

export const MQTT_PW = {
  admin: "t-mqtt-admin",
  ingest: "t-mqtt-ingest",
  control: "t-mqtt-control",
};

export interface MosquittoDePrueba {
  url: string;
  detener(): Promise<void>;
}

/** Mosquitto con la misma configuración e init de infra/, sin el listener TLS (no hay certificados aquí). */
export async function iniciarMosquitto(): Promise<MosquittoDePrueba> {
  const confReal = readFileSync(join(RAIZ, "infra", "mosquitto", "mosquitto.conf"), "utf8");
  const conf = confReal
    .replace(/# Nodos: TLS[\s\S]*?tls_version tlsv1\.2\n/, "")
    .replace(/^listener 1883 0\.0\.0\.0$/m, "listener 1883 0.0.0.0");
  if (conf.includes("8883"))
    throw new Error("No se pudo quitar el listener TLS de la configuración");

  const contenedor = await new GenericContainer(imagenDe(/image:\s*(eclipse-mosquitto:\S+)/))
    .withEntrypoint(["/bin/sh", "/usr/local/bin/lympha-entrypoint.sh"])
    .withEnvironment({ MQTT_ADMIN_USER: "lympha-admin", MQTT_ADMIN_PASSWORD: MQTT_PW.admin })
    .withCopyFilesToContainer([
      {
        source: join(RAIZ, "infra", "mosquitto", "entrypoint.sh"),
        target: "/usr/local/bin/lympha-entrypoint.sh",
        mode: 0o755,
      },
    ])
    .withCopyContentToContainer([
      { content: conf, target: "/mosquitto/config/mosquitto.conf", mode: 0o644 },
    ])
    .withExposedPorts(1883)
    .withWaitStrategy(Wait.forListeningPorts())
    .start();
  return {
    url: `mqtt://${contenedor.getHost()}:${contenedor.getMappedPort(1883)}`,
    detener: async () => {
      await contenedor.stop();
    },
  };
}
