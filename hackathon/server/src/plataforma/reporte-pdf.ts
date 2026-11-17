import PDFDocument from "pdfkit";
import {
  AVISO_NO_CUBRE,
  fechaMx,
  type Insignia,
  type NivelInsignia,
  periodoLegible,
  pieReporte,
  TEXTO_HUECOS_GRAFICA,
  TEXTO_NO_MEDIDOS,
  TEXTO_SIN_DATOS_GRAFICA,
  TEXTO_SIN_REGISTROS,
  TITULO_REPORTE,
} from "../dominio/frases.ts";
import type { ContenidoReporte, ParametroReporte } from "../modulos/reportes/index.ts";
import type { LogoSvg } from "./logo-svg.ts";

/**
 * Dibuja el reporte (carta) con pdfkit. Identidad de Lympha: tinta sobre blanco huevo, acento verde
 * agua del logo (solo en filetes y rellenos, nunca en texto) y los cuatro colores de estado solo en
 * la insignia, siempre con símbolo y palabra. Fuentes estándar (Helvetica): sin emoji ni ✓ o ≥.
 * Impreso en blanco y negro debe seguir entendiéndose.
 */

const COLOR = {
  tinta: "#0a0c0c",
  humo: "#6b655d",
  linea: "#ebe8e4",
  panel: "#f5f3f1",
  agua: "#5fbfb2",
  sobreEstado: "#101317",
  estado: { bien: "#5dc756", atencion: "#ffda26", fuera: "#ff7136", sin_datos: "#9aa0a6" },
} as const;

const PAGINA = { ancho: 612, alto: 792 };
const MARGEN = 48;
const ANCHO = PAGINA.ancho - MARGEN * 2;
/** Por debajo de esta altura no se escribe contenido: queda el pie. */
const LIMITE_Y = PAGINA.alto - 64;

export type MetaReporte = {
  id: string;
  /** «sha256:…» completo; en el pie se muestran 12 caracteres. */
  hash: string;
  generado: Date;
  generadoPor: string;
};

type Doc = InstanceType<typeof PDFDocument>;

const MAX_FILAS_EVENTOS = 60;
const MAX_FILAS_BITACORA = 40;

export function renderizarPdf(
  contenido: ContenidoReporte,
  meta: MetaReporte,
  logo: LogoSvg,
): Promise<Buffer> {
  const doc = new PDFDocument({
    size: "LETTER",
    margin: MARGEN,
    bufferPages: true,
    info: {
      Title: `${contenido.marca} · ${TITULO_REPORTE}`,
      Author: contenido.marca,
      Subject: `${contenido.comunidad} · ${contenido.nodo.nombre}`,
      CreationDate: meta.generado,
    },
  });
  const trozos: Buffer[] = [];
  const terminado = new Promise<Buffer>((resolver, rechazar) => {
    doc.on("data", (t: Buffer) => trozos.push(t));
    doc.on("end", () => resolver(Buffer.concat(trozos)));
    doc.on("error", rechazar);
  });

  encabezado(doc, contenido, meta, logo);
  seccion(doc, "Resumen");
  for (const linea of contenido.resumen) {
    texto(doc, linea, { tam: 10.5, alto: 4 });
  }
  const conInsignia = contenido.parametros.filter((p) => p.insignia);
  if (conInsignia.length > 0) {
    doc.moveDown(0.4);
    for (const p of conInsignia) insignia(doc, p.insignia as Insignia);
  }

  seccion(doc, "Estadísticas por parámetro");
  tablaEstadisticas(doc, contenido.parametros);

  for (const p of contenido.parametros) {
    seccion(doc, `Gráfica de ${p.nombre}`);
    grafica(doc, p, contenido.desde, contenido.hasta);
  }

  seccion(doc, "Eventos y alertas");
  if (contenido.eventos.length === 0) {
    texto(doc, TEXTO_SIN_REGISTROS, { color: COLOR.humo });
  } else {
    const filas = contenido.eventos.slice(0, MAX_FILAS_EVENTOS);
    tabla(
      doc,
      [
        { titulo: "Fecha (hora de México)", ancho: 120 },
        { titulo: "Evento", ancho: 150 },
        { titulo: "Detalle", ancho: 246 },
      ],
      filas.map((e) => [fechaMx(e.ts), e.titulo, e.detalle]),
    );
    if (contenido.eventos.length > filas.length) {
      texto(doc, `Y ${contenido.eventos.length - filas.length} más que no caben en este reporte.`, {
        tam: 9,
        color: COLOR.humo,
      });
    }
  }

  seccion(doc, "Calibraciones");
  if (contenido.calibraciones.length === 0) {
    texto(doc, TEXTO_SIN_REGISTROS, { color: COLOR.humo });
  } else {
    tabla(
      doc,
      [
        { titulo: "Fecha", ancho: 110 },
        { titulo: "Parámetro", ancho: 100 },
        { titulo: "Pendiente", ancho: 120 },
        { titulo: "Offset", ancho: 90 },
        { titulo: "Diagnóstico", ancho: 96 },
      ],
      contenido.calibraciones.map((c) => [
        fechaMx(c.ts),
        c.parametro,
        c.pendiente,
        c.offset,
        c.diagnostico,
      ]),
    );
  }

  seccion(doc, "Bitácora de la comunidad");
  if (contenido.bitacora.length === 0) {
    texto(doc, TEXTO_SIN_REGISTROS, { color: COLOR.humo });
  } else {
    for (const b of contenido.bitacora.slice(0, MAX_FILAS_BITACORA)) {
      nota(doc, fechaMx(b.ts), b.texto);
    }
    if (contenido.bitacora.length > MAX_FILAS_BITACORA) {
      texto(
        doc,
        `Y ${contenido.bitacora.length - MAX_FILAS_BITACORA} notas más que no caben en este reporte.`,
        { tam: 9, color: COLOR.humo },
      );
    }
  }

  seccion(doc, "Lo que este reporte no cubre");
  if (contenido.noMedidos.length > 0) {
    texto(doc, TEXTO_NO_MEDIDOS, { tam: 10 });
    for (const n of contenido.noMedidos) {
      texto(doc, `•  ${n.nombre}${n.unidad ? ` (${n.unidad})` : ""}`, { tam: 10, sangria: 12 });
    }
    doc.moveDown(0.3);
  }
  for (const a of AVISO_NO_CUBRE) texto(doc, a, { tam: 10 });

  pies(doc, contenido, meta);
  doc.end();
  return terminado;
}

/* ---- Piezas ---- */

function asegurar(doc: Doc, alto: number): void {
  if (doc.y + alto > LIMITE_Y) doc.addPage();
}

function texto(
  doc: Doc,
  t: string,
  o: { tam?: number; color?: string; negrita?: boolean; alto?: number; sangria?: number } = {},
): void {
  doc.font(o.negrita ? "Helvetica-Bold" : "Helvetica").fontSize(o.tam ?? 10.5);
  const x = MARGEN + (o.sangria ?? 0);
  const ancho = ANCHO - (o.sangria ?? 0);
  asegurar(doc, doc.heightOfString(t, { width: ancho }) + (o.alto ?? 2));
  doc.fillColor(o.color ?? COLOR.tinta).text(t, x, doc.y, { width: ancho, lineGap: o.alto ?? 2 });
}

function seccion(doc: Doc, titulo: string): void {
  asegurar(doc, 70);
  doc.moveDown(1.1);
  const y = doc.y;
  doc.rect(MARGEN, y + 1, 3, 14).fill(COLOR.agua);
  doc
    .font("Helvetica-Bold")
    .fontSize(13)
    .fillColor(COLOR.tinta)
    .text(titulo, MARGEN + 10, y, { width: ANCHO - 10 });
  doc
    .moveTo(MARGEN, doc.y + 4)
    .lineTo(MARGEN + ANCHO, doc.y + 4)
    .lineWidth(0.5)
    .strokeColor(COLOR.linea)
    .stroke();
  doc.y += 10;
}

function encabezado(doc: Doc, c: ContenidoReporte, meta: MetaReporte, logo: LogoSvg): void {
  const altoLogo = 46;
  const escala = altoLogo / logo.alto;
  doc.save();
  doc.translate(MARGEN, MARGEN - 4);
  doc.scale(escala);
  doc.translate(-logo.x, -logo.y);
  for (const t of logo.trazos) doc.path(t.d).fill(t.relleno, t.regla);
  doc.restore();

  const xTitulo = MARGEN + logo.ancho * escala + 14;
  doc
    .font("Helvetica-Bold")
    .fontSize(23)
    .fillColor(COLOR.tinta)
    .text(c.marca, xTitulo, MARGEN - 2, { width: ANCHO - (xTitulo - MARGEN), lineBreak: false });
  doc
    .font("Helvetica")
    .fontSize(12)
    .fillColor(COLOR.humo)
    .text(TITULO_REPORTE, xTitulo, MARGEN + 26, { lineBreak: false });

  const yFilete = MARGEN + altoLogo + 8;
  doc.rect(MARGEN, yFilete, ANCHO, 2).fill(COLOR.agua);

  // Datos del reporte en un panel de dos columnas.
  const y0 = yFilete + 14;
  const alto = 64;
  doc.roundedRect(MARGEN, y0, ANCHO, alto, 8).fill(COLOR.panel);
  const mitad = ANCHO / 2;
  const dato = (etiqueta: string, valor: string, x: number, y: number, ancho: number) => {
    doc.font("Helvetica").fontSize(8).fillColor(COLOR.humo).text(etiqueta.toUpperCase(), x, y, {
      width: ancho,
      lineBreak: false,
    });
    doc
      .font("Helvetica-Bold")
      .fontSize(10)
      .fillColor(COLOR.tinta)
      .text(valor, x, y + 10, {
        width: ancho,
        lineBreak: false,
        ellipsis: true,
      });
  };
  const x1 = MARGEN + 14;
  const x2 = MARGEN + mitad + 4;
  dato("Comunidad", c.comunidad, x1, y0 + 9, mitad - 24);
  dato(
    "Nodo",
    c.nodo.ubicacion ? `${c.nodo.nombre} · ${c.nodo.ubicacion}` : c.nodo.nombre,
    x2,
    y0 + 9,
    mitad - 18,
  );
  dato("Periodo", periodoLegible(c.desde, c.hasta), x1, y0 + 37, ANCHO - 28);
  doc.y = y0 + alto + 4;
  // El reporte se identifica y se firma en el pie; aquí solo se anota quién lo pidió.
  doc
    .font("Helvetica")
    .fontSize(8.5)
    .fillColor(COLOR.humo)
    .text(`Generado por: ${meta.generadoPor}`, MARGEN, doc.y, { width: ANCHO });
}

/** Símbolo de cada nivel, dibujado con trazos (las fuentes estándar no traen ✓ ni ⚠). */
function simbolo(doc: Doc, nivel: NivelInsignia, cx: number, cy: number, r: number): void {
  const tinta = COLOR.sobreEstado;
  doc.lineWidth(1.6).strokeColor(tinta).fillColor(tinta).lineJoin("round").lineCap("round");
  switch (nivel) {
    case "bien":
      doc.circle(cx, cy, r).stroke();
      doc
        .moveTo(cx - r * 0.5, cy)
        .lineTo(cx - r * 0.1, cy + r * 0.4)
        .lineTo(cx + r * 0.55, cy - r * 0.4)
        .stroke();
      break;
    case "atencion":
      doc
        .moveTo(cx, cy - r)
        .lineTo(cx + r, cy + r * 0.8)
        .lineTo(cx - r, cy + r * 0.8)
        .closePath()
        .stroke();
      doc
        .moveTo(cx, cy - r * 0.35)
        .lineTo(cx, cy + r * 0.2)
        .stroke();
      doc.circle(cx, cy + r * 0.5, 0.9).fill();
      break;
    case "fuera":
      doc
        .moveTo(cx, cy - r)
        .lineTo(cx + r, cy)
        .lineTo(cx, cy + r)
        .lineTo(cx - r, cy)
        .closePath()
        .stroke();
      doc
        .moveTo(cx, cy - r * 0.45)
        .lineTo(cx, cy + r * 0.1)
        .stroke();
      doc.circle(cx, cy + r * 0.45, 0.9).fill();
      break;
    case "sin_datos":
      doc.circle(cx, cy, r).dash(2, { space: 2 }).stroke().undash();
      doc
        .moveTo(cx - r * 0.45, cy)
        .lineTo(cx + r * 0.45, cy)
        .stroke();
      break;
  }
}

function insignia(doc: Doc, i: Insignia): void {
  const alto = 50;
  asegurar(doc, alto + 8);
  const y = doc.y;
  doc.roundedRect(MARGEN, y, ANCHO, alto, 10).fill(COLOR.estado[i.nivel]);
  simbolo(doc, i.nivel, MARGEN + 26, y + alto / 2, 12);
  doc
    .font("Helvetica-Bold")
    .fontSize(12)
    .fillColor(COLOR.sobreEstado)
    .text(i.rotulo, MARGEN + 52, y + 9, { width: ANCHO - 64, lineBreak: false });
  doc
    .font("Helvetica")
    .fontSize(9.5)
    .text(i.texto, MARGEN + 52, y + 25, { width: ANCHO - 64, height: 22 });
  doc.y = y + alto + 8;
}

type Columna = { titulo: string; ancho: number };

function tabla(doc: Doc, columnas: Columna[], filas: string[][]): void {
  const pad = 5;
  const cabecera = () => {
    const y = doc.y;
    doc.rect(MARGEN, y, ANCHO, 20).fill(COLOR.linea);
    let x = MARGEN;
    doc.font("Helvetica-Bold").fontSize(8.5).fillColor(COLOR.tinta);
    for (const c of columnas) {
      doc.text(c.titulo, x + pad, y + 6, {
        width: c.ancho - pad * 2,
        lineBreak: false,
        ellipsis: true,
      });
      x += c.ancho;
    }
    doc.y = y + 20;
  };
  asegurar(doc, 60);
  cabecera();
  for (const fila of filas) {
    doc.font("Helvetica").fontSize(9);
    const alto =
      Math.max(
        ...fila.map((celda, i) =>
          doc.heightOfString(celda, { width: (columnas[i] as Columna).ancho - pad * 2 }),
        ),
      ) +
      pad * 2 -
      2;
    if (doc.y + alto > LIMITE_Y) {
      doc.addPage();
      cabecera();
    }
    const y = doc.y;
    let x = MARGEN;
    doc.fillColor(COLOR.tinta);
    fila.forEach((celda, i) => {
      const c = columnas[i] as Columna;
      doc.text(celda, x + pad, y + pad - 1, { width: c.ancho - pad * 2 });
      x += c.ancho;
    });
    doc
      .moveTo(MARGEN, y + alto)
      .lineTo(MARGEN + ANCHO, y + alto)
      .lineWidth(0.5)
      .strokeColor(COLOR.linea)
      .stroke();
    doc.y = y + alto;
  }
  doc.moveDown(0.3);
}

function tablaEstadisticas(doc: Doc, parametros: ParametroReporte[]): void {
  if (parametros.length === 0) {
    texto(doc, TEXTO_SIN_REGISTROS, { color: COLOR.humo });
    return;
  }
  const num = (v: number | null, p: ParametroReporte) =>
    v === null ? "—" : `${v.toFixed(p.decimales)}${p.unidad ? ` ${p.unidad}` : ""}`;
  tabla(
    doc,
    [
      { titulo: "Parámetro", ancho: 100 },
      { titulo: "Promedio", ancho: 52 },
      { titulo: "Mínimo", ancho: 48 },
      { titulo: "Máximo", ancho: 48 },
      { titulo: "Límites de la norma", ancho: 100 },
      { titulo: "% en rango", ancho: 56 },
      { titulo: "Muestras", ancho: 52 },
      { titulo: "Cobertura", ancho: 60 },
    ],
    parametros.map((p) => {
      const e = p.estadisticas;
      const limites = p.norma?.texto
        ? `${p.norma.texto}${p.norma.porVerificar ? " (por verificar)" : ""}`
        : "—";
      return [
        p.nombre,
        num(e.promedio, p),
        num(e.minimo, p),
        num(e.maximo, p),
        limites,
        e.pctEnRango === null ? "—" : `${e.pctEnRango.toFixed(1)} %`,
        String(e.n),
        `${e.coberturaPct.toFixed(0)} %`,
      ];
    }),
  );
  texto(
    doc,
    "% en rango: del tiempo con datos. Cobertura: del tiempo del periodo en que el nodo envió datos.",
    { tam: 8.5, color: COLOR.humo },
  );
}

function nota(doc: Doc, fecha: string, t: string): void {
  doc.font("Helvetica").fontSize(10);
  const alto = doc.heightOfString(t, { width: ANCHO - 24 }) + 22;
  asegurar(doc, alto + 6);
  const y = doc.y;
  doc.roundedRect(MARGEN, y, ANCHO, alto, 6).fill(COLOR.panel);
  doc.rect(MARGEN, y, 3, alto).fill(COLOR.agua);
  doc
    .font("Helvetica")
    .fontSize(8)
    .fillColor(COLOR.humo)
    .text(fecha, MARGEN + 14, y + 6, { lineBreak: false });
  doc
    .font("Helvetica")
    .fontSize(10)
    .fillColor(COLOR.tinta)
    .text(t, MARGEN + 14, y + 17, { width: ANCHO - 24 });
  doc.y = y + alto + 6;
}

/* ---- Gráfica ---- */

const ALTO_GRAFICA = 170;

function marcasY(min: number, max: number): number[] {
  const paso = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100].find((p) => (max - min) / p <= 6) ?? 100;
  const marcas: number[] = [];
  for (let v = Math.ceil(min / paso) * paso; v <= max + 1e-9; v += paso) {
    marcas.push(Number(v.toFixed(6)));
  }
  return marcas;
}

function grafica(doc: Doc, p: ParametroReporte, desde: Date, hasta: Date): void {
  const valores = p.serie.filter((v): v is number => v !== null);
  if (valores.length === 0) {
    texto(doc, TEXTO_SIN_DATOS_GRAFICA, { color: COLOR.humo });
    return;
  }
  asegurar(doc, ALTO_GRAFICA + 52);
  const x0 = MARGEN + 40;
  const ancho = ANCHO - 48;
  const y0 = doc.y + 4;
  const alto = ALTO_GRAFICA;

  const norma = p.norma;
  let minY = Math.min(
    ...valores,
    ...(norma?.min !== null && norma?.min !== undefined ? [norma.min] : []),
  );
  let maxY = Math.max(
    ...valores,
    ...(norma?.max !== null && norma?.max !== undefined ? [norma.max] : []),
  );
  const margen = Math.max((maxY - minY) * 0.12, 0.25);
  minY -= margen;
  maxY += margen;
  const py = (v: number) => y0 + alto - ((v - minY) / (maxY - minY)) * alto;
  const px = (i: number) => x0 + (i / Math.max(1, p.serie.length - 1)) * ancho;

  // Franja de la norma.
  if (norma && (norma.min !== null || norma.max !== null)) {
    const arriba = norma.max !== null ? Math.min(py(norma.max), y0 + alto) : y0;
    const abajo = norma.min !== null ? Math.max(py(norma.min), y0) : y0 + alto;
    if (abajo > arriba) {
      doc
        .save()
        .opacity(0.22)
        .rect(x0, arriba, ancho, abajo - arriba)
        .fill(COLOR.agua)
        .restore();
    }
  }
  // Cuadrícula y etiquetas del eje Y.
  doc.font("Helvetica").fontSize(8).lineWidth(0.5);
  for (const v of marcasY(minY, maxY)) {
    const y = py(v);
    doc
      .moveTo(x0, y)
      .lineTo(x0 + ancho, y)
      .strokeColor(COLOR.linea)
      .stroke();
    doc.fillColor(COLOR.humo).text(v.toFixed(Math.min(p.decimales, 1)), MARGEN, y - 4, {
      width: 34,
      align: "right",
      lineBreak: false,
    });
  }
  // Límites de la norma (discontinuos).
  for (const lim of [norma?.min, norma?.max]) {
    if (lim === null || lim === undefined) continue;
    doc
      .moveTo(x0, py(lim))
      .lineTo(x0 + ancho, py(lim))
      .lineWidth(0.8)
      .dash(4, { space: 3 })
      .strokeColor(COLOR.humo)
      .stroke()
      .undash();
  }
  // Serie: la línea se corta en los huecos.
  doc.lineWidth(1.3).strokeColor(COLOR.tinta).lineJoin("round");
  let hayHuecos = false;
  let tramo: [number, number][] = [];
  const cerrar = () => {
    if (tramo.length === 1) {
      const [x, y] = tramo[0] as [number, number];
      doc.circle(x, y, 1.3).fill(COLOR.tinta);
    } else if (tramo.length > 1) {
      doc.moveTo(...(tramo[0] as [number, number]));
      for (const [x, y] of tramo.slice(1)) doc.lineTo(x, y);
      doc.stroke();
    }
    tramo = [];
  };
  let vistoDato = false;
  p.serie.forEach((v, i) => {
    if (v === null) {
      if (vistoDato && tramo.length > 0) hayHuecos = true;
      cerrar();
      return;
    }
    if (vistoDato && tramo.length === 0) hayHuecos = true;
    vistoDato = true;
    tramo.push([px(i), py(v)]);
  });
  cerrar();
  // Marco y etiquetas del eje X.
  doc.rect(x0, y0, ancho, alto).lineWidth(0.5).strokeColor(COLOR.linea).stroke();
  const conHora = hasta.getTime() - desde.getTime() <= 2 * 86_400_000;
  const medio = new Date((desde.getTime() + hasta.getTime()) / 2);
  doc.font("Helvetica").fontSize(8).fillColor(COLOR.humo);
  doc.text(fechaMx(desde, conHora), x0, y0 + alto + 5, {
    width: 110,
    align: "left",
    lineBreak: false,
  });
  doc.text(fechaMx(medio, conHora), x0 + ancho / 2 - 55, y0 + alto + 5, {
    width: 110,
    align: "center",
    lineBreak: false,
  });
  doc.text(fechaMx(hasta, conHora), x0 + ancho - 110, y0 + alto + 5, {
    width: 110,
    align: "right",
    lineBreak: false,
  });
  doc.y = y0 + alto + 20;
  const leyenda = [
    norma?.texto
      ? `Franja verde agua y líneas discontinuas: límites ${norma.origen} (${norma.texto}).`
      : null,
    hayHuecos ? TEXTO_HUECOS_GRAFICA : null,
  ].filter((l): l is string => l !== null);
  for (const l of leyenda) texto(doc, l, { tam: 8.5, color: COLOR.humo });
}

/* ---- Pie de página ---- */

function pies(doc: Doc, c: ContenidoReporte, meta: MetaReporte): void {
  const rango = doc.bufferedPageRange();
  const huella = meta.hash.replace(/^sha256:/, "").slice(0, 12);
  const pie = pieReporte({ marca: c.marca, id: meta.id, hash: huella, generado: meta.generado });
  for (let i = rango.start; i < rango.start + rango.count; i++) {
    doc.switchToPage(i);
    // Escribir bajo el margen inferior haría que pdfkit abra otra página.
    const margenInferior = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc
      .moveTo(MARGEN, PAGINA.alto - 54)
      .lineTo(MARGEN + ANCHO, PAGINA.alto - 54)
      .lineWidth(0.5)
      .strokeColor(COLOR.linea)
      .stroke();
    doc
      .font("Helvetica")
      .fontSize(7)
      .fillColor(COLOR.humo)
      .text(pie, MARGEN, PAGINA.alto - 48, { width: ANCHO - 70, lineGap: 1 });
    doc.text(
      `Página ${i - rango.start + 1} de ${rango.count}`,
      MARGEN + ANCHO - 70,
      PAGINA.alto - 48,
      {
        width: 70,
        align: "right",
        lineBreak: false,
      },
    );
    doc.page.margins.bottom = margenInferior;
  }
}
