/** Identificadores fijos del entorno de desarrollo (`pnpm db:seed` y `factory lote --dev`). Nunca en staging ni producción. */
export const DEV = {
  usuarioId: "0192f3a7-0000-7000-8000-0000000d0001",
  espacioId: "0192f3a7-0000-7000-8000-0000000d0002",
  loteId: "0192f3a7-0000-7000-8000-0000000d0003",
} as const;
