import { ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";
import type { Estado } from "../evaluacion/index.ts";
import type { DetalleParametro, UltimoNodo } from "../nodos/index.ts";
import { type AlertaAbierta, alertasDeseadas, reconciliar, recordatorioDebido } from "./reglas.ts";

const T = new Date(Date.UTC(2026, 10, 19, 15, 0, 0));

function ultimo(
  estados: Record<string, Estado>,
  extra: {
    v?: Record<string, number>;
    detalles?: Record<string, Partial<DetalleParametro>>;
    sin_datos?: boolean;
  } = {},
): UltimoNodo {
  const detalles: Record<string, DetalleParametro> = {};
  for (const [id, d] of Object.entries(extra.detalles ?? {})) {
    detalles[id] = { cambio_rapido: false, cambio: null, motivos_sensor: [], ...d };
  }
  return {
    ts: T,
    v: extra.v ?? { ph: 7.1 },
    estado: null,
    estados,
    detalles,
    seq: 1,
    sesion: 0,
    estable: true,
    ultimo_cambio: T,
    sin_datos: extra.sin_datos ?? false,
  };
}

function abierta(
  tipo: AlertaAbierta["tipo"],
  parametro: string | null,
  severidad: AlertaAbierta["severidad"],
  ultimoAviso: Date | null = T,
): AlertaAbierta {
  return {
    _id: new ObjectId(),
    tipo,
    parametro,
    severidad,
    severidad_maxima: severidad,
    ultimo_aviso: ultimoAviso,
    abierta: T,
  };
}

describe("alertasDeseadas", () => {
  it("en rango y atención por cercanía al límite no avisan", () => {
    expect(alertasDeseadas(ultimo({ ph: "en_rango" }))).toEqual([]);
    expect(alertasDeseadas(ultimo({ ph: "atencion" }))).toEqual([]);
    expect(alertasDeseadas(ultimo({}))).toEqual([]);
  });

  it("atención por cambio rápido sí avisa, con severidad «atención»", () => {
    const d = alertasDeseadas(
      ultimo({ ph: "atencion" }, { detalles: { ph: { cambio_rapido: true, cambio: 0.6 } } }),
    );
    expect(d).toEqual([
      { tipo: "cambio_rapido", parametro: "ph", severidad: "atencion", valor: 7.1 },
    ]);
  });

  it("fuera de rango → nivel alta; crítico → nivel crítica; sensor → sensor alta", () => {
    const v = { ph: 6.2 };
    expect(alertasDeseadas(ultimo({ ph: "fuera_de_rango" }, { v }))).toEqual([
      { tipo: "nivel", parametro: "ph", severidad: "alta", valor: 6.2 },
    ]);
    expect(alertasDeseadas(ultimo({ ph: "critico" }, { v }))).toEqual([
      { tipo: "nivel", parametro: "ph", severidad: "critica", valor: 6.2 },
    ]);
    expect(alertasDeseadas(ultimo({ ph: "revisar_sensor" }, { v }))).toEqual([
      { tipo: "sensor", parametro: "ph", severidad: "alta", valor: 6.2 },
    ]);
  });

  it("un nodo sin datos solo tiene «sin conexión»: sus estados viejos no se juzgan", () => {
    const d = alertasDeseadas(ultimo({ ph: "critico" }, { sin_datos: true }));
    expect(d).toEqual([{ tipo: "sin_conexion", parametro: null, severidad: "alta", valor: null }]);
  });

  it("evalúa cada parámetro por separado y genérico (no solo pH)", () => {
    const d = alertasDeseadas(
      ultimo({ ph: "en_rango", turbidez: "fuera_de_rango" }, { v: { ph: 7, turbidez: 9 } }),
    );
    expect(d).toEqual([{ tipo: "nivel", parametro: "turbidez", severidad: "alta", valor: 9 }]);
  });
});

describe("reconciliar", () => {
  const nivelAlta = { tipo: "nivel", parametro: "ph", severidad: "alta", valor: 6.2 } as const;

  it("abre lo que falta", () => {
    expect(reconciliar([], [nivelAlta], false)).toEqual([{ tipo: "abrir", deseada: nivelAlta }]);
  });

  it("no hace nada si ya coincide (idempotente)", () => {
    expect(reconciliar([abierta("nivel", "ph", "alta")], [nivelAlta], false)).toEqual([]);
    expect(reconciliar([], [], false)).toEqual([]);
  });

  it("escala de fuera de rango a crítico y baja de crítico a fuera de rango", () => {
    const a = abierta("nivel", "ph", "alta");
    const sube = reconciliar([a], [{ ...nivelAlta, severidad: "critica" }], false);
    expect(sube).toEqual([{ tipo: "escalar", alerta: a, a: "critica" }]);

    const c = abierta("nivel", "ph", "critica");
    const baja = reconciliar([c], [nivelAlta], false);
    expect(baja).toEqual([{ tipo: "bajar", alerta: c, a: "alta" }]);
  });

  it("cierra lo que ya no debe existir: es una recuperación (con aviso)", () => {
    const a = abierta("nivel", "ph", "alta");
    expect(reconciliar([a], [], false)).toEqual([{ tipo: "cerrar", alerta: a, silenciosa: false }]);
  });

  it("cuando el mismo parámetro sigue con otra alerta, el cierre es silencioso", () => {
    // El cambio rápido se vuelve fuera de rango: no es una recuperación.
    const cambio = abierta("cambio_rapido", "ph", "atencion");
    const acciones = reconciliar([cambio], [nivelAlta], false);
    expect(acciones).toContainEqual({ tipo: "abrir", deseada: nivelAlta });
    expect(acciones).toContainEqual({ tipo: "cerrar", alerta: cambio, silenciosa: true });
  });

  it("si el agua vuelve al rango pero el cambio rápido sigue, el cierre del nivel SÍ avisa", () => {
    const nivel = abierta("nivel", "ph", "alta");
    const cambio = {
      tipo: "cambio_rapido",
      parametro: "ph",
      severidad: "atencion",
      valor: 7.4,
    } as const;
    const acciones = reconciliar([nivel], [cambio], false);
    expect(acciones).toContainEqual({ tipo: "cerrar", alerta: nivel, silenciosa: false });
    expect(acciones).toContainEqual({ tipo: "abrir", deseada: cambio });
  });

  it("un nivel que pasa a «revisar sensor» se cierra en silencio (no se puede decir que volvió al rango)", () => {
    const nivel = abierta("nivel", "ph", "alta");
    const sensor = { tipo: "sensor", parametro: "ph", severidad: "alta", valor: 14 } as const;
    expect(reconciliar([nivel], [sensor], false)).toContainEqual({
      tipo: "cerrar",
      alerta: nivel,
      silenciosa: true,
    });
  });

  it("un sensor que se recupera avisa aunque el agua siga fuera de rango", () => {
    const sensor = abierta("sensor", "ph", "alta");
    expect(reconciliar([sensor], [nivelAlta], false)).toContainEqual({
      tipo: "cerrar",
      alerta: sensor,
      silenciosa: false,
    });
  });

  it("nodo detenido: no cierra las alertas del agua, pero sí «sin conexión» al volver", () => {
    const nivel = abierta("nivel", "ph", "alta");
    const sinConexion = abierta("sin_conexion", null, "alta");
    // Detenido: solo se gobierna «sin conexión».
    const dormido = [
      { tipo: "sin_conexion", parametro: null, severidad: "alta", valor: null },
    ] as const;
    expect(reconciliar([nivel], [...dormido], true)).toEqual([
      { tipo: "abrir", deseada: dormido[0] },
    ]);
    // Al volver: ya no hay «sin conexión» deseada; el nivel se juzga de nuevo con datos frescos.
    expect(reconciliar([nivel, sinConexion], [nivelAlta], false)).toEqual([
      { tipo: "cerrar", alerta: sinConexion, silenciosa: false },
    ]);
  });

  it("aplicar dos veces el mismo estado da lo mismo (el segundo ciclo no hace nada)", () => {
    const deseadas = [nivelAlta];
    const primera = reconciliar([], deseadas, false);
    expect(primera).toHaveLength(1);
    const yaAbierta = abierta("nivel", "ph", "alta");
    expect(reconciliar([yaAbierta], deseadas, false)).toEqual([]);
  });
});

describe("recordatorioDebido", () => {
  const base = (min: number) => new Date(T.getTime() + min * 60_000);

  it("cada 30 min para alertas normales", () => {
    const a = abierta("nivel", "ph", "alta", T);
    expect(recordatorioDebido(a, base(29), 30)).toBe(false);
    expect(recordatorioDebido(a, base(30), 30)).toBe(true);
  });

  it("la mitad de tiempo si es crítica", () => {
    const a = abierta("nivel", "ph", "critica", T);
    expect(recordatorioDebido(a, base(14), 30)).toBe(false);
    expect(recordatorioDebido(a, base(15), 30)).toBe(true);
  });

  it("el cambio rápido no recuerda y sin primer aviso no hay nada que recordar", () => {
    expect(recordatorioDebido(abierta("cambio_rapido", "ph", "atencion", T), base(999), 30)).toBe(
      false,
    );
    expect(recordatorioDebido(abierta("nivel", "ph", "alta", null), base(999), 30)).toBe(false);
  });

  it("también recuerda «sin conexión» y «sensor»", () => {
    expect(recordatorioDebido(abierta("sin_conexion", null, "alta", T), base(31), 30)).toBe(true);
    expect(recordatorioDebido(abierta("sensor", "ph", "alta", T), base(31), 30)).toBe(true);
  });
});
