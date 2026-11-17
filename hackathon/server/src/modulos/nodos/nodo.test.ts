import { ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";
import { cargarCatalogo } from "../../plataforma/catalogo.ts";
import { crearDocumentoNodo, mapeoPorDefecto } from "./index.ts";

const catalogo = cargarCatalogo();

describe("mapeoPorDefecto", () => {
  it("toma los pines del parámetro del catálogo y los de la plantilla", () => {
    const m = mapeoPorDefecto(catalogo, ["ph"]);
    expect(m.valores).toEqual({ ph: "v2" });
    expect(m.crudos).toEqual({ ph: "v7" });
    expect([m.estado, m.estable, m.seq]).toEqual(["v4", "v5", "v6"]);
  });

  it("rechaza parámetros que no se pueden medir o no existen", () => {
    expect(() => mapeoPorDefecto(catalogo, ["cloro_libre"])).toThrow(/no se puede medir/);
    expect(() => mapeoPorDefecto(catalogo, ["orp_x"])).toThrow(/desconocido/);
  });
});

describe("crearDocumentoNodo", () => {
  it("arma un nodo sin lecturas, con el token ya cifrado", () => {
    const n = crearDocumentoNodo({
      comunidadId: new ObjectId(),
      nombre: "Tinaco azotea",
      tokenCifrado: "v1:a:b:c",
      host: "blynk.cloud",
      catalogo,
    });
    expect(n.parametros).toEqual(["ph"]);
    expect(n.ultimo).toBeNull();
    expect(n.blynk.token_cifrado).toBe("v1:a:b:c");
    expect(n.blynk.mapeo.seq).toBe("v6");
  });
});
