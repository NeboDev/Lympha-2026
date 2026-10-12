#!/bin/sh
# Genera la configuración de Valkey desde la plantilla y arranca el servidor.
set -eu

for v in VALKEY_PW_API VALKEY_PW_INGEST VALKEY_PW_WORKER; do
  eval "valor=\${$v:-}"
  if [ -z "$valor" ]; then
    echo "valkey: falta la variable $v" >&2
    exit 1
  fi
done

sed \
  -e "s|\${VALKEY_PW_API}|$VALKEY_PW_API|g" \
  -e "s|\${VALKEY_PW_INGEST}|$VALKEY_PW_INGEST|g" \
  -e "s|\${VALKEY_PW_WORKER}|$VALKEY_PW_WORKER|g" \
  /etc/valkey/valkey.conf.tpl > /tmp/valkey.conf
chmod 600 /tmp/valkey.conf

exec valkey-server /tmp/valkey.conf
