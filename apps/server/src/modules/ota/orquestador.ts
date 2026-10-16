import { cohorte, ETAPAS, evaluarEtapa, type NodoOta, VENTANA_NODO_MS } from "./despliegue.ts";

export interface DepsOrquestador {
  /** Nodos en línea con otra versión, ordenados por `deviceId`. */
  elegibles(version: string): Promise<string[]>;
  crearDespliegue(version: string, etapa: number): Promise<string>;
  cambiarEtapa(despliegueId: string, etapa: number): Promise<void>;
  cerrar(despliegueId: string, estado: "completado" | "detenido", motivo?: string): Promise<void>;
  /** Registra el comando y lo publica. Solo se llama una vez por nodo y despliegue. */
  enviar(despliegueId: string, nodoId: string, version: string): Promise<void>;
  estados(despliegueId: string, nodoIds: string[]): Promise<NodoOta[]>;
  /** `true` si alguien detuvo el despliegue desde fuera (`pnpm ota abortar`). */
  detenido(despliegueId: string): Promise<boolean>;
  ahora(): Date;
  dormir(ms: number): Promise<void>;
  aviso(texto: string): void;
}

export interface OpcionesDespliegue {
  etapas?: readonly number[];
  ventanaMs?: number;
  sondeoMs?: number;
}

export interface ResultadoDespliegue {
  estado: "completado" | "detenido";
  etapa: number;
  motivo?: string;
  actualizados: number;
}

/**
 * Despliegue gradual: envía el comando a la cohorte de cada etapa y solo avanza si todos los nodos de la
 * cohorte volvieron en línea con la versión nueva y publicando. Ante la primera falla se detiene y no toca
 * a los demás; el rollback de cada nodo lo hace su bootloader.
 */
export async function desplegar(
  deps: DepsOrquestador,
  version: string,
  op: OpcionesDespliegue = {},
): Promise<ResultadoDespliegue> {
  const etapas = op.etapas ?? ETAPAS;
  const ventanaMs = op.ventanaMs ?? VENTANA_NODO_MS;
  const sondeoMs = op.sondeoMs ?? 5000;

  const elegibles = await deps.elegibles(version);
  if (elegibles.length === 0) {
    throw new Error(`no hay nodos en línea con una versión distinta de ${version}`);
  }
  const id = await deps.crearDespliegue(version, etapas[0] as number);
  const enviados = new Set<string>();
  let actualizados = 0;

  for (const etapa of etapas) {
    await deps.cambiarEtapa(id, etapa);
    const grupo = cohorte(elegibles, etapa);
    deps.aviso(`etapa ${etapa} %: ${grupo.length} de ${elegibles.length} nodos`);
    for (const nodoId of grupo) {
      if (enviados.has(nodoId)) continue;
      await deps.enviar(id, nodoId, version);
      enviados.add(nodoId);
    }
    for (;;) {
      if (await deps.detenido(id)) {
        return { estado: "detenido", etapa, motivo: "detenido por el operador", actualizados };
      }
      const v = evaluarEtapa(await deps.estados(id, grupo), version, deps.ahora(), ventanaMs);
      if (v.tipo === "completa") {
        actualizados = grupo.length;
        break;
      }
      if (v.tipo === "falla") {
        await deps.cerrar(id, "detenido", v.motivo);
        return { estado: "detenido", etapa, motivo: v.motivo, actualizados };
      }
      await deps.dormir(sondeoMs);
    }
  }
  await deps.cerrar(id, "completado");
  return { estado: "completado", etapa: etapas[etapas.length - 1] as number, actualizados };
}
