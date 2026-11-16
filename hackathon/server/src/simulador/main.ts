import { parseArgs } from "node:util";
import { cargarConfigBlynk } from "../config.ts";
import { parametroDe } from "../dominio/catalogo.ts";
import { BlynkError, crearClienteBlynk } from "../plataforma/blynk.ts";
import { cargarCatalogo } from "../plataforma/catalogo.ts";
import {
  descripcionDe,
  duracionDe,
  esEscenario,
  muestra,
  NOMBRES_ESCENARIOS,
} from "./escenarios.ts";

// Pines del nodo (ARQUITECTURA.md §4.1). `ph` y `ph_crudo` salen del catálogo.
const PIN_ESTADO = "v4";
const PIN_ESTABLE = "v5";
const PIN_SEQ = "v6";
const MAX_ERRORES_SEGUIDOS = 5;

const AYUDA = `Simulador de nodo Atl: escribe ph, ph_crudo, estado, estable y seq en Blynk.

Uso: pnpm simulador --escenario <nombre> [opciones]

  --escenario <nombre>   ${NOMBRES_ESCENARIOS.join(" | ")} (por defecto: estable)
  --lista                muestra los escenarios y termina
  --intervalo-s <n>      segundos entre escrituras (por defecto: 5)
  --velocidad <x>        comprime el tiempo del escenario (por defecto: 1)
  --duracion-s <n>       termina tras n segundos reales (por defecto: duración del escenario / velocidad)
  --sin-escribir         solo imprime lo que escribiría (no usa la red ni el token)

El token se toma de BLYNK_TOKEN_PRUEBA en server/.env y nunca se imprime.`;

const { values } = parseArgs({
  options: {
    escenario: { type: "string", default: "estable" },
    lista: { type: "boolean", default: false },
    "intervalo-s": { type: "string", default: "5" },
    velocidad: { type: "string", default: "1" },
    "duracion-s": { type: "string" },
    "sin-escribir": { type: "boolean", default: false },
    ayuda: { type: "boolean", default: false },
  },
  strict: true,
});

function numeroPositivo(nombre: string, texto: string | undefined): number | null {
  if (texto === undefined) return null;
  const n = Number(texto);
  if (!Number.isFinite(n) || n <= 0) {
    console.error(`--${nombre} debe ser un número positivo.`);
    process.exit(2);
  }
  return n;
}

if (values.ayuda) {
  console.log(AYUDA);
  process.exit(0);
}
if (values.lista) {
  for (const n of NOMBRES_ESCENARIOS) console.log(`${n.padEnd(20)} ${descripcionDe(n)}`);
  process.exit(0);
}

const nombre = values.escenario ?? "estable";
if (!esEscenario(nombre)) {
  console.error(`Escenario desconocido: ${nombre}. Usa --lista.`);
  process.exit(2);
}
const intervaloS = numeroPositivo("intervalo-s", values["intervalo-s"]) ?? 5;
const velocidad = numeroPositivo("velocidad", values.velocidad) ?? 1;
const duracionS =
  numeroPositivo("duracion-s", values["duracion-s"]) ?? duracionDe(nombre) / velocidad;

const catalogo = cargarCatalogo();
const ph = parametroDe(catalogo, "ph");
if (!ph.norma || ph.norma.min === null || ph.norma.max === null || !ph.blynk?.crudo) {
  throw new Error("El catálogo de pH debe traer norma con min y max, y los pines de Blynk");
}
const norma = { min: ph.norma.min, max: ph.norma.max };
const PIN_PH = ph.blynk.pin;
const PIN_CRUDO = ph.blynk.crudo;

const escribir = !values["sin-escribir"];
const cliente = escribir
  ? crearClienteBlynk({ host: cargarConfigBlynk(process.env).blynkHost })
  : null;
const token = escribir ? cargarConfigBlynk(process.env).blynkToken : "";

let seq = 0;
if (cliente) {
  try {
    const actual = await cliente.leerTodo(token);
    const previo = Number(actual[PIN_SEQ]);
    seq = Number.isFinite(previo) ? Math.max(0, Math.floor(previo)) : 0;
  } catch (e) {
    console.warn(
      `No pude leer el seq actual (${e instanceof Error ? e.message : "error"}); empiezo en 0.`,
    );
  }
}

console.log(
  `Escenario «${nombre}»: ${descripcionDe(nombre)}\n` +
    `Cada ${intervaloS} s · velocidad ×${velocidad} · ${Math.round(duracionS)} s reales${escribir ? "" : " · SIN ESCRIBIR"}. Ctrl+C para detener.`,
);

let parar = false;
process.on("SIGINT", () => {
  parar = true;
});

const inicio = Date.now();
let erroresSeguidos = 0;
while (!parar) {
  const transcurridoS = (Date.now() - inicio) / 1000;
  if (transcurridoS >= duracionS) break;
  const t = transcurridoS * velocidad;
  const m = muestra(nombre, t, norma);
  const marca = `t=${String(Math.round(t)).padStart(4)} s`;

  if (!m.escribe) {
    console.log(`${marca}  nodo detenido: no escribe (seq queda en ${seq})`);
  } else {
    seq++;
    const linea = `${marca}  seq=${seq}  pH=${m.ph.toFixed(2)} (crudo ${m.phCrudo.toFixed(2)})  estado=${m.estado}  estable=${m.estable ? 1 : 0}`;
    if (!cliente) {
      console.log(`${linea}  [no escrito]`);
    } else {
      try {
        await cliente.escribirPines(token, {
          [PIN_PH]: Number(m.ph.toFixed(2)),
          [PIN_CRUDO]: Number(m.phCrudo.toFixed(2)),
          [PIN_ESTADO]: m.estado,
          [PIN_ESTABLE]: m.estable ? 1 : 0,
          [PIN_SEQ]: seq,
        });
        erroresSeguidos = 0;
        console.log(linea);
      } catch (e) {
        erroresSeguidos++;
        const causa = e instanceof BlynkError ? e.message : "error desconocido";
        console.error(`${marca}  no se pudo escribir en Blynk: ${causa}`);
        if (erroresSeguidos >= MAX_ERRORES_SEGUIDOS) {
          console.error(`${MAX_ERRORES_SEGUIDOS} errores seguidos: me detengo.`);
          process.exit(1);
        }
      }
    }
  }
  await new Promise((r) => setTimeout(r, intervaloS * 1000));
}
console.log("Simulador detenido.");
