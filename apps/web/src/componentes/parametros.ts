export type ClaveParametro = "ph" | "temperatura" | "conductividad" | "turbidez" | "tds";

export interface Parametro {
  clave: ClaveParametro;
  nombre: string;
  unidad: string;
  decimales: number;
}

/** Los cinco parámetros que mide el nodo, con su unidad (la escala de la lectura cruda del contrato MQTT). */
export const PARAMETROS: Parametro[] = [
  { clave: "ph", nombre: "pH", unidad: "", decimales: 2 },
  { clave: "temperatura", nombre: "Temperatura", unidad: "°C", decimales: 1 },
  { clave: "conductividad", nombre: "Conductividad", unidad: "µS/cm", decimales: 0 },
  { clave: "turbidez", nombre: "Turbidez", unidad: "NTU", decimales: 1 },
  { clave: "tds", nombre: "Sólidos disueltos (TDS)", unidad: "mg/L", decimales: 0 },
];

export const parametroDe = (clave: ClaveParametro): Parametro => {
  const p = PARAMETROS.find((x) => x.clave === clave);
  if (!p) throw new Error(`parámetro desconocido: ${clave}`);
  return p;
};

/** «7.21», «24.5 °C»; `—` si no hay dato. */
export function formatearValor(p: Parametro, valor: number | null | undefined): string {
  if (valor === null || valor === undefined || Number.isNaN(valor)) return "—";
  const texto = valor.toLocaleString("es-MX", {
    minimumFractionDigits: p.decimales,
    maximumFractionDigits: p.decimales,
  });
  return p.unidad ? `${texto} ${p.unidad}` : texto;
}
