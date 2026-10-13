import { createServer, type Server } from "node:http";
import { Counter, collectDefaultMetrics, Gauge, Histogram, Registry } from "prom-client";

/**
 * Métricas con prom-client (formato Prometheus). Cada proceso (ingest, worker) tiene su propio registro, con las
 * métricas por defecto del proceso (CPU, memoria, event loop, GC...) y las de dominio, y lo expone en su puerto
 * interno (`METRICS_PORT`); ese puerto no se publica fuera de la red de Docker. Las etiquetas son siempre valores
 * acotados (motivos, tipos), nunca ids.
 */

type Etiquetas = Record<string, string>;

export interface Contador {
  inc(etiquetas?: Etiquetas, n?: number): void;
}

export interface Histograma {
  observar(valor: number): void;
}

export interface Registro {
  /** Declara las etiquetas de antemano: prom-client no admite etiquetas que no se hayan declarado. */
  contador(nombre: string, ayuda: string, etiquetas?: readonly string[]): Contador;
  medidor(nombre: string, ayuda: string, leer: () => number | Promise<number>): void;
  /** Un valor por cada valor de `etiqueta` (p. ej. alarmas abiertas por tipo). Se relee en cada scrape. */
  medidorEtiquetado(
    nombre: string,
    ayuda: string,
    etiqueta: string,
    leer: () => Record<string, number> | Promise<Record<string, number>>,
  ): void;
  histograma(nombre: string, ayuda: string, cubetas: readonly number[]): Histograma;
  texto(): Promise<string>;
  contentType: string;
}

export function crearRegistro(opciones: { porDefecto?: boolean } = {}): Registro {
  const registro = new Registry();
  if (opciones.porDefecto ?? true) collectDefaultMetrics({ register: registro });

  return {
    contentType: registro.contentType,
    contador(nombre, ayuda, etiquetas = []) {
      const c = new Counter({
        name: nombre,
        help: ayuda,
        labelNames: [...etiquetas],
        registers: [registro],
      });
      // Sin etiquetas se materializa en 0 para que la serie exista desde el arranque.
      if (etiquetas.length === 0) c.inc(0);
      return {
        inc(valores = {}, n = 1) {
          if (etiquetas.length === 0) c.inc(n);
          else c.inc(valores, n);
        },
      };
    },
    medidor(nombre, ayuda, leer) {
      new Gauge({
        name: nombre,
        help: ayuda,
        registers: [registro],
        async collect() {
          try {
            this.set(await leer());
          } catch {
            // un medidor que falla no tumba la página
          }
        },
      });
    },
    medidorEtiquetado(nombre, ayuda, etiqueta, leer) {
      new Gauge({
        name: nombre,
        help: ayuda,
        labelNames: [etiqueta],
        registers: [registro],
        async collect() {
          try {
            const valores = await leer();
            this.reset();
            for (const [clave, valor] of Object.entries(valores))
              this.set({ [etiqueta]: clave }, valor);
          } catch {
            // un medidor que falla no tumba la página
          }
        },
      });
    },
    histograma(nombre, ayuda, cubetas) {
      const h = new Histogram({
        name: nombre,
        help: ayuda,
        buckets: [...cubetas],
        registers: [registro],
      });
      return { observar: (valor) => h.observe(valor) };
    },
    texto: () => registro.metrics(),
  };
}

/** Sirve `GET /metrics` en `puerto` (todas las interfaces del contenedor). */
export function servirMetricas(registro: Registro, puerto: number): Promise<Server> {
  const servidor = createServer((req, res) => {
    if (req.method === "GET" && req.url === "/metrics") {
      registro
        .texto()
        .then((t) => {
          res.writeHead(200, { "content-type": registro.contentType });
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
