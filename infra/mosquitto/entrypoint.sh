#!/bin/sh
# Arranque de Mosquitto: crea dynamic-security.json con el cliente de administración la primera vez.
# Los roles, ACL y clientes internos los aplica después `mqtt-bootstrap` (idempotente) por la API de
# Dynamic Security; Postgres no guarda contraseñas MQTT.
set -eu

DYNSEC=/mosquitto/data/dynamic-security.json

for v in MQTT_ADMIN_USER MQTT_ADMIN_PASSWORD; do
  eval "valor=\${$v:-}"
  if [ -z "$valor" ]; then
    echo "mosquitto: falta la variable $v" >&2
    exit 1
  fi
done

if [ ! -f "$DYNSEC" ]; then
  echo "mosquitto: creando $DYNSEC"
  mosquitto_ctrl dynsec init "$DYNSEC" "$MQTT_ADMIN_USER" "$MQTT_ADMIN_PASSWORD"
fi

chown -R mosquitto:mosquitto /mosquitto/data
chmod 700 /mosquitto/data
chmod 600 "$DYNSEC"

exec mosquitto -c /mosquitto/config/mosquitto.conf
