/**
 * Buffer de lecturas sin conexión del nodo simulado: imita el del firmware (cola circular en flash, 24 h).
 * Conserva el orden, descarta lo más viejo cuando se llena y se vacía a ritmo limitado, siempre con el `ts` y el
 * `seq` originales (el servidor evalúa por lecturas consecutivas, no por reloj).
 */

export interface LecturaGuardada {
  ts: number;
  seq: number;
  [medicion: string]: unknown;
}

/** Lecturas que caben en `horas` con una lectura cada `intervaloS` segundos. */
export function capacidadParaHoras(horas: number, intervaloS: number): number {
  return Math.max(1, Math.ceil((horas * 3600) / intervaloS));
}

export class BufferLecturas {
  private cola: LecturaGuardada[] = [];
  private descartadasTotal = 0;

  readonly capacidad: number;

  constructor(capacidad: number) {
    if (!Number.isInteger(capacidad) || capacidad < 1) throw new Error("capacidad inválida");
    this.capacidad = capacidad;
  }

  get tamano(): number {
    return this.cola.length;
  }

  /** Lecturas perdidas por desbordamiento desde el inicio (el servidor las verá como huecos de `seq`). */
  get descartadas(): number {
    return this.descartadasTotal;
  }

  agregar(lectura: LecturaGuardada): void {
    if (this.cola.length >= this.capacidad) {
      this.cola.shift();
      this.descartadasTotal++;
    }
    this.cola.push(lectura);
  }

  /**
   * Publica el contenido en orden, una lectura a la vez. Una lectura solo sale del buffer cuando `publicar`
   * resuelve; si falla (se cayó la conexión), se conserva y el vaciado se detiene.
   * Devuelve cuántas salieron. `vigente()` permite abortar si la conexión se perdió.
   */
  async vaciar(
    publicar: (lectura: LecturaGuardada) => Promise<void>,
    op: { porSegundo: number; esperar?: (ms: number) => Promise<void>; vigente?: () => boolean },
  ): Promise<number> {
    const esperar = op.esperar ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    const pausaMs = 1000 / Math.max(1, op.porSegundo);
    let salieron = 0;
    while (this.cola.length > 0 && (op.vigente?.() ?? true)) {
      const primera = this.cola[0] as LecturaGuardada;
      try {
        await publicar(primera);
      } catch {
        break;
      }
      // solo se quita si sigue siendo la misma (un desbordamiento durante el envío la pudo descartar)
      if (this.cola[0] === primera) this.cola.shift();
      salieron++;
      if (this.cola.length > 0) await esperar(pausaMs);
    }
    return salieron;
  }
}
