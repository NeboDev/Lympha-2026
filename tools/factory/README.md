# Fábrica

El CLI de fábrica vive en `apps/server/src/cli/fabrica.ts` (comparte configuración, base y cliente de Dynamic Security con el servidor): `pnpm factory lote --cantidad N`.
En este directorio se escriben los lotes (`lotes/<loteId>/manifiesto.json` e `identidades.json`; este último tiene secretos y no se versiona).
El grabado con `esptool`, la imagen cifrada de la partición `identity` y la etiqueta son de H5.
