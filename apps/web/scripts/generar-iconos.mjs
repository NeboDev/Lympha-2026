// Genera los iconos de la PWA (public/*.png y favicon.svg) sin dependencias de imágenes: dibuja una gota de agua
// sobre un fondo azul con antialiasing por sobremuestreo y escribe PNG con zlib.
//   node apps/web/scripts/generar-iconos.mjs
// Los PNG resultantes se versionan; este script solo hace falta si cambia el diseño.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const PUBLICO = join(dirname(fileURLToPath(import.meta.url)), "..", "public");
mkdirSync(PUBLICO, { recursive: true });

const FONDO = [65, 111, 219]; // #416fdb (botones de marca)
const GOTA = [255, 255, 255];
const SUPERMUESTREO = 4;

/** ¿El punto (x, y), en [0,1]², cae dentro de la gota? Un círculo abajo y una punta triangular arriba. */
function dentroDeLaGota(x, y, escala) {
  // la gota ocupa `escala` del lado y está centrada
  const u = (x - 0.5) / escala + 0.5;
  const v = (y - 0.5) / escala + 0.5;
  const cx = 0.5;
  const cy = 0.63;
  const r = 0.24;
  if ((u - cx) ** 2 + (v - cy) ** 2 <= r * r) return true;
  // triángulo tangente al círculo, con la punta en (0.5, 0.14)
  const puntaY = 0.14;
  const baseY = 0.5;
  if (v < puntaY || v > baseY) return false;
  const ancho = ((v - puntaY) / (baseY - puntaY)) * 0.2;
  return Math.abs(u - cx) <= ancho;
}

function esquinaRedondeada(x, y, radio) {
  const dx = Math.max(radio - x, 0, x - (1 - radio));
  const dy = Math.max(radio - y, 0, y - (1 - radio));
  return dx * dx + dy * dy <= radio * radio;
}

/** Devuelve los píxeles RGBA de un icono cuadrado de `n` px. `conEsquinas`: fondo redondeado; si no, a sangre. */
function dibujar(n, { escalaGota, conEsquinas }) {
  const px = Buffer.alloc(n * n * 4);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      let fondo = 0;
      let gota = 0;
      for (let sy = 0; sy < SUPERMUESTREO; sy++) {
        for (let sx = 0; sx < SUPERMUESTREO; sx++) {
          const x = (i + (sx + 0.5) / SUPERMUESTREO) / n;
          const y = (j + (sy + 0.5) / SUPERMUESTREO) / n;
          if (!conEsquinas || esquinaRedondeada(x, y, 0.22)) {
            fondo++;
            if (dentroDeLaGota(x, y, escalaGota)) gota++;
          }
        }
      }
      const total = SUPERMUESTREO * SUPERMUESTREO;
      const alfa = fondo / total;
      const mezcla = fondo === 0 ? 0 : gota / fondo;
      const o = (j * n + i) * 4;
      for (let c = 0; c < 3; c++) {
        px[o + c] = Math.round(FONDO[c] * (1 - mezcla) + GOTA[c] * mezcla);
      }
      px[o + 3] = Math.round(alfa * 255);
    }
  }
  return px;
}

// --- codificador PNG mínimo (RGBA de 8 bits) ---
const TABLA_CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = TABLA_CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const trozo = (tipo, datos) => {
  const cuerpo = Buffer.concat([Buffer.from(tipo, "ascii"), datos]);
  const largo = Buffer.alloc(4);
  largo.writeUInt32BE(datos.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(cuerpo));
  return Buffer.concat([largo, cuerpo, crc]);
};
function png(n, rgba) {
  const cabecera = Buffer.alloc(13);
  cabecera.writeUInt32BE(n, 0);
  cabecera.writeUInt32BE(n, 4);
  cabecera[8] = 8; // profundidad
  cabecera[9] = 6; // RGBA
  const filas = Buffer.alloc(n * (n * 4 + 1));
  for (let j = 0; j < n; j++) {
    filas[j * (n * 4 + 1)] = 0; // sin filtro
    rgba.copy(filas, j * (n * 4 + 1) + 1, j * n * 4, (j + 1) * n * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    trozo("IHDR", cabecera),
    trozo("IDAT", deflateSync(filas, { level: 9 })),
    trozo("IEND", Buffer.alloc(0)),
  ]);
}

const iconos = [
  // «any»: esquinas redondeadas, gota grande
  ["icon-192.png", 192, { escalaGota: 0.85, conEsquinas: true }],
  ["icon-512.png", 512, { escalaGota: 0.85, conEsquinas: true }],
  // «maskable»: a sangre y gota dentro de la zona segura (80 % central) para que ninguna máscara la recorte
  ["icon-maskable-512.png", 512, { escalaGota: 0.66, conEsquinas: false }],
  // iOS no admite transparencia en el icono de la pantalla de inicio: a sangre
  ["apple-touch-icon.png", 180, { escalaGota: 0.8, conEsquinas: false }],
];
for (const [nombre, n, opciones] of iconos) {
  writeFileSync(join(PUBLICO, nombre), png(n, dibujar(n, opciones)));
  console.log(`${nombre} (${n}×${n})`);
}

writeFileSync(
  join(PUBLICO, "favicon.svg"),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="14" fill="#416fdb"/>
  <path d="M32 9 C32 9 17.5 26 17.5 38 a14.5 14.5 0 0 0 29 0 C46.5 26 32 9 32 9 Z" fill="#fff"/>
</svg>
`,
);
console.log("favicon.svg");
