import { describe, expect, it } from "vitest";
import { leerRuta } from "./ruta.ts";

describe("leerRuta", () => {
  it("lee la pantalla del hash y vuelve a «agua» con cualquier otra cosa", () => {
    expect(leerRuta("#/reportes")).toBe("reportes");
    expect(leerRuta("#/comunidad")).toBe("comunidad");
    expect(leerRuta("#/agua")).toBe("agua");
    expect(leerRuta("#reportes")).toBe("reportes");
    expect(leerRuta("#/reportes?x=1")).toBe("reportes");
    expect(leerRuta("")).toBe("agua");
    expect(leerRuta("#/no-existe")).toBe("agua");
    expect(leerRuta("#/reportes/../../etc")).toBe("reportes");
  });
});
