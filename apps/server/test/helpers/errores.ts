/** Drizzle envuelve los errores de Postgres ("Failed query: ..."); el motivo real está en `cause`. */
export function mensajeCompleto(error: unknown): string {
  const partes: string[] = [];
  let actual: unknown = error;
  while (actual instanceof Error) {
    partes.push(actual.message);
    actual = actual.cause;
  }
  return partes.join(" | ");
}

export async function falla(promesa: Promise<unknown>): Promise<string> {
  try {
    await promesa;
  } catch (error) {
    return mensajeCompleto(error);
  }
  throw new Error("se esperaba que la operación fallara");
}
