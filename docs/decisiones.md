# Decisiones de implementación

Decisiones menores tomadas durante la construcción. Las contradicciones entre documentos que cambian el diseño se consultan antes.

## H0

- **pnpm 11.21** (instalado) fijado con `packageManager` (corepack). El plan decía 10.x; se usa la versión instalada por acuerdo.
- **Node 24** en `.nvmrc`, `engines` e imágenes (el documento de arquitectura decía 22; manda el plan).
- **Quién escribe `ts.lecturas`:** el documento de datos asigna el `INSERT` a `ingest` (tabla de consultas críticas). Se corrige: `ingest` valida, agrupa y encola; el `worker` hace el `INSERT` (flujo MQTT → cola → worker → Postgres del plan y requisito de `PUBACK` tras encolar).
- **Versiones fuera de la última mayor** por compatibilidad con el stack del plan: TypeScript 5.9 (no 7), Zod 3.25 con `fastify-type-provider-zod` 4.x (las 5+ piden Zod 4), pino 9, BullMQ 5.
- `ioredis` se usa como cliente de Valkey; es la dependencia que ya trae BullMQ, no una nueva pieza del stack.
