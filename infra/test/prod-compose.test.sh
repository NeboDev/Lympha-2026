#!/usr/bin/env bash
# Verifica que el Compose de staging/producción es válido y que solo publica lo permitido:
# 80, 443 (Caddy), 8883 (Mosquitto) y 3000 solo en loopback (pruebas de humo). Postgres, Valkey y el
# 1883 jamás se publican (RNF-02, RNF-05).
set -euo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAIZ="$AQUI/../.."

export LYMPHA_IMAGE=ghcr.io/ci/lympha-server:ci APP_ENV=staging API_DOMAIN=a.example.test \
  MQTT_DOMAIN=m.example.test ACME_EMAIL=ci@example.test POSTGRES_USER=p POSTGRES_PASSWORD=x \
  PW_OWNER=x PW_APP=x PW_SYSTEM=x PW_BACKUP=x VALKEY_PW_API=x VALKEY_PW_INGEST=x VALKEY_PW_WORKER=x \
  MQTT_ADMIN_USER=a MQTT_ADMIN_PASSWORD=x MQTT_INGEST_USER=i MQTT_INGEST_PASSWORD=x \
  MQTT_CONTROL_USER=c MQTT_CONTROL_PASSWORD=x CLAIM_PEPPER=x

salida="$(docker compose -p prueba -f "$RAIZ/infra/compose/base.yml" -f "$RAIZ/infra/compose/prod.yml" config)"

publicados="$(grep -E '^\s+published:' <<<"$salida" | tr -d ' "' | sort -u | tr '\n' ' ')"
echo "puertos publicados: $publicados"
if [[ "$publicados" != "published:3000 published:443 published:80 published:8883 " ]]; then
  echo "FALLA: se publica algo distinto de 80, 443, 8883 y 3000" >&2
  exit 1
fi

# El 3000 debe estar atado a loopback.
if ! grep -B3 'published: "3000"' <<<"$salida" | grep -q 'host_ip: 127.0.0.1'; then
  echo "FALLA: el puerto 3000 no está atado a 127.0.0.1" >&2
  exit 1
fi

# Ningún servicio de aplicación debe recibir los secretos de otro (p. ej. la contraseña del dueño de la base).
if awk '/^  (api|ingest|worker|notifier):/{s=$1} /^  [a-z-]+:$/{if($1!~/^(api|ingest|worker|notifier):$/)s=""} s!="" && /PW_OWNER|POSTGRES_PASSWORD|MQTT_ADMIN_PASSWORD/{print s": "$0}' <<<"$salida" | grep -q .; then
  echo "FALLA: un proceso de aplicación recibe un secreto que no le corresponde" >&2
  exit 1
fi

echo "prod.yml: ok"
