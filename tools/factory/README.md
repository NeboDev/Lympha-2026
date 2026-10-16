# Fábrica

El CLI de fábrica vive en `apps/server/src/cli/fabrica.ts` (comparte configuración, base y cliente de Dynamic Security con el servidor).
En este directorio se escriben los lotes: `lotes/<loteId>/` (ignorado por git, salvo este README).

## Herramientas

El grabado usa `esptool` y `esp-idf-nvs-partition-gen` (Python), instaladas en un entorno local que no se versiona:

```bash
python -m venv tools/factory/.venv
tools/factory/.venv/Scripts/python -m pip install esptool esp-idf-nvs-partition-gen   # en Linux/macOS: .venv/bin/python
```

`LYMPHA_PYTHON` apunta a otro intérprete si hace falta.

## Procedimiento de un lote

```bash
pnpm factory lote --cantidad 5 --version-hw v1                         # registra en Postgres y Dynamic Security; escribe identidades.json
pnpm factory imagenes <loteId> --broker-url mqtts://192.168.1.50:8883  # imagen cifrada de la partición identity, una por nodo
pnpm factory etiquetas <loteId>                                        # etiqueta SVG de 80 × 40 mm con dos QR
pnpm factory grabar <loteId> <deviceId> --puerto COM5 \
  --offset-llaves 0x.... --offset-identidad 0x.... [--firmware fw.bin --offset-firmware 0x....]
```

- `--broker-url` es la IP fija de la PC (el certificado del broker debe incluirla: `CERT_SANS=IP:<ip> pnpm certs`). La CA que se graba es `infra/certs/ca.crt` (`--ca` para otra).
- Los offsets salen de `partitions.csv` del firmware (`nvs_keys` e `identity`); no se adivinan.
- `lotes/<loteId>/nvs_keys.bin` es la llave de cifrado de NVS del lote (0600). Sin ella los nodos del lote no pueden leer su identidad: respaldarla donde se respalda `identidades.json`. Con el ESP32 clásico y sin flash encryption, la llave grabada en `nvs_keys` está en claro en la flash, así que el cifrado de NVS solo protege de lecturas casuales hasta que se active flash encryption (producción).
- Las etiquetas contienen el código de reclamo en claro (0600, no se versionan).
- `diagnostico` (autodiagnóstico de sensores, Wi-Fi y broker) aún no existe: depende del firmware y de una placa.
