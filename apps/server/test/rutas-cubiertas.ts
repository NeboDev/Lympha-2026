/**
 * Registro de rutas de la API y de la prueba que verifica su aislamiento (RNF-01).
 *
 * `src/main/rutas.test.ts` enumera las rutas realmente registradas y FALLA si alguna no aparece aquí.
 * Al agregar una ruta hay que declararla:
 *   - "publica": no devuelve datos de ningún espacio (p. ej. /health);
 *   - { aislamiento: "<archivo> › <prueba>" }: existe una prueba en la que otro usuario intenta leer,
 *     escribir o suscribirse y recibe 404.
 */
export type Cobertura = "publica" | { aislamiento: string };

export const RUTAS_CUBIERTAS: Record<string, Cobertura> = {
  "GET /health": "publica",
  "GET /dev/nodos/:nodoId/lecturas": {
    aislamiento:
      "test/flujo.test.ts › la API devuelve las lecturas por app.v_lecturas y aísla entre usuarios (404)",
  },
};
