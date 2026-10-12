# Decisiones de implementación

Decisiones menores tomadas durante la construcción. Las contradicciones entre documentos que cambian el diseño se consultan antes.

## H0

- **pnpm 11.21** (instalado) fijado con `packageManager` (corepack). El plan decía 10.x; se usa la versión instalada por acuerdo.
- **Node 24** en `.nvmrc`, `engines` e imágenes (el documento de arquitectura decía 22; manda el plan).
- **Quién escribe `ts.lecturas`:** el documento de datos asigna el `INSERT` a `ingest` (tabla de consultas críticas). Se corrige: `ingest` valida, agrupa y encola; el `worker` hace el `INSERT` (flujo MQTT → cola → worker → Postgres del plan y requisito de `PUBACK` tras encolar).
- **Versiones fuera de la última mayor** por compatibilidad con el stack del plan: TypeScript 5.9 (no 7), Zod 3.25 con `fastify-type-provider-zod` 4.x (las 5+ piden Zod 4), pino 9, BullMQ 5.
- `ioredis` se usa como cliente de Valkey; es la dependencia que ya trae BullMQ, no una nueva pieza del stack.
- **Sin paso de build:** Node 24 ejecuta TypeScript con type stripping. Los imports llevan extensión `.ts`, `tsconfig.base.json` activa `allowImportingTsExtensions` y `erasableSyntaxOnly` (sin `enum` ni parámetros-propiedad), y los paquetes del workspace exportan su `src/`. El mismo código corre en desarrollo (`node --watch`), pruebas (Vitest) y producción. Por eso `tsx` (aprobado) no hace falta y no se instala. En la imagen no se usa `pnpm deploy` (Node no quita tipos bajo `node_modules`): se conserva el layout del workspace.
- **Contrato `telemetria`:** `.strict()` (rechaza campos desconocidos); las cinco mediciones son opcionales y admiten `null` (sensor caído, RF-39). Los rangos físicos no se validan en el contrato: un valor fuera de rango es señal de falla y lo evaluará `calidad` (H2).
