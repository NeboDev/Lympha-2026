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
