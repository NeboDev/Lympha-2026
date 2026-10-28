import { describe, expect, it } from "vitest";
import { crc32, crearZip } from "./zip.ts";

describe("zip", () => {
  it("calcula el CRC-32 estándar", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array())).toBe(0);
  });

  it("arma un archivo con cabeceras locales, directorio central y fin de directorio", () => {
    const zip = crearZip([
      { nombre: "etiquetas/a.svg", contenido: "<svg/>" },
      { nombre: "identidades.json", contenido: "ñ{}" },
    ]);
    const v = new DataView(zip.buffer);
    expect(v.getUint32(0, true)).toBe(0x04034b50);
    const fin = zip.length - 22;
    expect(v.getUint32(fin, true)).toBe(0x06054b50);
    expect(v.getUint16(fin + 10, true)).toBe(2); // entradas
    // el directorio central apunta a cada cabecera local
    const inicioCentral = v.getUint32(fin + 16, true);
    expect(v.getUint32(inicioCentral, true)).toBe(0x02014b50);
    expect(v.getUint32(v.getUint32(inicioCentral + 42, true), true)).toBe(0x04034b50);
    // el contenido va sin comprimir y con su CRC
    expect(new TextDecoder().decode(zip)).toContain("<svg/>");
    expect(v.getUint32(14, true)).toBe(crc32(new TextEncoder().encode("<svg/>")));
    // «ñ{}» son 4 bytes en UTF-8
    const segunda = 30 + "etiquetas/a.svg".length + "<svg/>".length;
    expect(v.getUint32(segunda + 18, true)).toBe(4);
  });
});
