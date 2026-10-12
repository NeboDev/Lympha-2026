#!/usr/bin/env bash
# Copia el certificado de mqtt.<dominio> (emitido y renovado por Caddy) al directorio que monta
# Mosquitto y, si cambió, le envía SIGHUP para que lo recargue sin cortar a los nodos.
# Lo corre un temporizador de systemd cada hora (instalado por setup.sh).
#
# Variables: MQTT_DOMAIN (obligatoria; de /srv/lympha/cert-sync.env), LYMPHA_ENV (para el nombre del proyecto),
#            LYMPHA_DATA (por defecto /srv/lympha/data).
set -euo pipefail

: "${MQTT_DOMAIN:?falta MQTT_DOMAIN en /srv/lympha/cert-sync.env}"
DATA="${LYMPHA_DATA:-/srv/lympha/data}"
PROYECTO="lympha-${LYMPHA_ENV:-production}"

# Caddy guarda los certificados de Let's Encrypt aquí (dentro de su directorio /data).
ORIGEN="$DATA/caddy/caddy/certificates/acme-v02.api.letsencrypt.org-directory/$MQTT_DOMAIN"
DESTINO="$DATA/mosquitto-certs"

if [[ ! -f "$ORIGEN/$MQTT_DOMAIN.crt" || ! -f "$ORIGEN/$MQTT_DOMAIN.key" ]]; then
  echo "cert-sync: Caddy aún no emitió el certificado de $MQTT_DOMAIN" >&2
  exit 0
fi

cambio=0
copiar() { # copiar <origen> <destino> <modo>
  if ! cmp -s "$1" "$2" 2>/dev/null; then
    install -m "$3" -o 1883 -g 1883 "$1" "$2"
    cambio=1
  fi
}
copiar "$ORIGEN/$MQTT_DOMAIN.crt" "$DESTINO/fullchain.pem" 0644
copiar "$ORIGEN/$MQTT_DOMAIN.key" "$DESTINO/privkey.pem" 0600

if [[ "$cambio" -eq 1 ]]; then
  contenedor="$(docker ps --filter "label=com.docker.compose.project=$PROYECTO" \
    --filter "label=com.docker.compose.service=mosquitto" --format '{{.ID}}' | head -1)"
  if [[ -n "$contenedor" ]]; then
    docker kill --signal=HUP "$contenedor" >/dev/null
    echo "cert-sync: certificado actualizado y Mosquitto recargado"
  else
    echo "cert-sync: certificado actualizado (Mosquitto no está corriendo)"
  fi
fi
