import { describe, expect, it } from "vitest";
import { interpretarReclamo } from "./codigo-qr.ts";

const NODO = "0192f3a7-0000-7000-8000-0000000d0014";

describe("interpretarReclamo", () => {
  it("lee el enlace del QR", () => {
    expect(interpretarReclamo(`lympha://reclamar?n=${NODO}&c=ABCD-EFGH-JKMN`)).toEqual({
      nodoId: NODO,
      codigo: "ABCDEFGHJKMN",
    });
  });

  it("lee un identificador y un código sueltos, con cualquier separador y en minúsculas", () => {
    const esperado = { nodoId: NODO, codigo: "ABCDEFGHJKMN" };
    expect(interpretarReclamo(`${NODO} ABCD EFGH JKMN`)).toEqual(esperado);
    expect(interpretarReclamo(`${NODO}\nabcd-efgh-jkmn`)).toEqual(esperado);
    expect(interpretarReclamo(`  ${NODO.toUpperCase()}, abcdefghjkmn `)).toEqual(esperado);
  });

  it("rechaza lo que no trae un identificador y un código completos", () => {
    expect(interpretarReclamo("")).toBeNull();
    expect(interpretarReclamo("hola")).toBeNull();
    expect(interpretarReclamo(NODO)).toBeNull(); // sin código
    expect(interpretarReclamo("ABCD-EFGH-JKMN")).toBeNull(); // sin identificador
    expect(interpretarReclamo(`${NODO} ABCD-EFGH`)).toBeNull(); // código corto
    expect(interpretarReclamo(`lympha://reclamar?n=${NODO}`)).toBeNull();
  });

  it("rechaza un código con caracteres ambiguos (0, O, 1, I, L)", () => {
    expect(interpretarReclamo(`${NODO} ABCD-EFGH-JKM0`)).toBeNull();
    expect(interpretarReclamo(`${NODO} ABCD-EFGH-JKMI`)).toBeNull();
  });
});
