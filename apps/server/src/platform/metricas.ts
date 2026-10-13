import { createServer, type Server } from "node:http";

/**
 * Métricas en el formato de texto de Prometheus, sin dependencias: contadores con etiquetas y medidores.
 * Cada proceso (ingest, worker) las expone en su propio puerto interno (`METRICS_PORT`); ese puerto no se
 * publica fuera de la red de Docker. Las etiquetas son siempre valores acotados (motivos, tipos), nunca ids.
 */

type Etiquetas = Record<string, string>;

const clave = (e: Etiquetas) =>
  Object.keys(e)
    .sort()
    .map((k) => `${k}="${(e[k] as string).replace(/[\\"\n]/g, "_")}"`)
    .join(",");

export interface Contador {
  inc(etiquetas?: Etiquetas, n?: number): void;
  valor(etiquetas?: Etiquetas): number;
}

export interface Registro {
  contador(nombre: string, ayuda: string): Contador;
  medidor(nombre: string, ayuda: string, leer: () => number | Promise<number>): void;
  texto(): Promise<string>;
}

export function crearRegistro(): Registro {
  const contadores: { nombre: string; ayuda: string; valores: Map<string, number> }[] = [];
  const medidores: { nombre: string; ayuda: string; leer: () => number | Promise<number> }[] = [];

  return {
    contador(nombre, ayuda) {
      const valores = new Map<string, number>();
      contadores.push({ nombre, ayuda, valores });
      return {
        inc(etiquetas = {}, n = 1) {
          const k = clave(etiquetas);
          valores.set(k, (valores.get(k) ?? 0) + n);
        },
        valor: (etiquetas = {}) => valores.get(clave(etiquetas)) ?? 0,
      };
    },
    medidor(nombre, ayuda, leer) {
      medidores.push({ nombre, ayuda, leer });
    },
    async texto() {
      const lineas: string[] = [];
      for (const c of contadores) {
        lineas.push(`# HELP ${c.nombre} ${c.ayuda}`, `# TYPE ${c.nombre} counter`);
        if (c.valores.size === 0) lineas.push(`${c.nombre} 0`);
        for (const [k, v] of c.valores)
          lineas.push(k ? `${c.nombre}{${k}} ${v}` : `${c.nombre} ${v}`);
      }
      for (const m of medidores) {
        lineas.push(`# HELP ${m.nombre} ${m.ayuda}`, `# TYPE ${m.nombre} gauge`);
        try {
          lineas.push(`${m.nombre} ${await m.leer()}`);
        } catch {
          // un medidor que falla no tumba la página
        }
      }
      return `${lineas.join("\n")}\n`;
    },
  };
}

/** Sirve `GET /metrics` en `puerto` (todas las interfaces del contenedor). */
export function servirMetricas(registro: Registro, puerto: number): Promise<Server> {
  const servidor = createServer((req, res) => {
    if (req.method === "GET" && req.url === "/metrics") {
      registro
        .texto()
        .then((t) => {
          res.writeHead(200, { "content-type": "text/plain; version=0.0.4; charset=utf-8" });
          res.end(t);
        })
        .catch(() => {
          res.writeHead(500).end();
        });
      return;
    }
    res.writeHead(404).end();
  });
  return new Promise((resolve, reject) => {
    servidor.once("error", reject);
    servidor.listen(puerto, "0.0.0.0", () => resolve(servidor));
  });
}
