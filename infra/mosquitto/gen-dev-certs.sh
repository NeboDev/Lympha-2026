#!/bin/sh
# CA propia de Lympha para entornos locales (Compose de desarrollo y VM de staging local) y certificado de
# servidor de Mosquitto firmado por ella. Nunca se usa en staging real ni en producción (ahí los emite Caddy).
#
#   /out/ca/ca.crt       CA pública: va en el simulador, en el cliente MQTT de pruebas y, en H5, en la partición
#                        de los nodos de prueba (el firmware verifica el broker contra esta CA)
#   /out/ca/ca.key       llave privada de la CA (0600): sirve para volver a firmar el certificado del broker
#                        cuando cambia su dirección, SIN cambiar la CA ya grabada en los nodos
#   /out/server/{fullchain.pem,privkey.pem}   lo que lee el broker (volumen; la llave del servidor no sale de ahí)
#
# Variables:
#   CERT_SANS   nombres extra del certificado del servidor, separados por comas: "IP:192.168.1.50,DNS:mqtt.casa.test".
#               Un nodo de prueba que conecte por la IP de tu equipo o de la VM necesita ese nombre en el certificado.
#
# Idempotente: la CA solo se crea si falta (o si falta su llave); el certificado del servidor se vuelve a emitir solo si
# cambió CERT_SANS o le quedan menos de 30 días. Uso desde el host: `pnpm certs` (ver README, "CA propia").
set -eu

SERVER=/out/server
CA=/out/ca
mkdir -p "$SERVER" "$CA"

SANS_BASE="DNS:localhost,DNS:mosquitto,DNS:mqtt.lympha.test,IP:127.0.0.1"
SANS="$SANS_BASE"
if [ -n "${CERT_SANS:-}" ]; then SANS="$SANS,$CERT_SANS"; fi

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

CA_NUEVA=0
if [ ! -f "$CA/ca.crt" ] || [ ! -f "$CA/ca.key" ]; then
  # Sin la llave no se puede firmar: se crea una CA nueva (los nodos grabados con la anterior no la reconocerían).
  if [ -f "$CA/ca.crt" ]; then echo "dev-certs: AVISO: ca.crt sin ca.key; se crea una CA nueva"; fi
  openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -days 3650 \
    -keyout "$WORK/ca.key" -out "$WORK/ca.crt" -subj "/CN=Lympha Dev CA" \
    -addext "basicConstraints=critical,CA:TRUE,pathlen:0" -addext "keyUsage=critical,keyCertSign,cRLSign" >/dev/null 2>&1
  install -m 0644 "$WORK/ca.crt" "$CA/ca.crt"
  install -m 0600 "$WORK/ca.key" "$CA/ca.key"
  CA_NUEVA=1
  echo "dev-certs: CA nueva en $CA"
fi

vigente=0
if [ "$CA_NUEVA" = 0 ] && [ -f "$SERVER/fullchain.pem" ] && [ -f "$SERVER/privkey.pem" ] && [ -f "$SERVER/sans.txt" ] \
   && [ "$(cat "$SERVER/sans.txt")" = "$SANS" ] \
   && openssl x509 -in "$SERVER/fullchain.pem" -noout -checkend $((30 * 24 * 3600)) >/dev/null 2>&1; then
  vigente=1
fi
if [ "$vigente" = 1 ]; then
  echo "dev-certs: el certificado del servidor sigue vigente ($SANS)"
  exit 0
fi

openssl req -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes \
  -keyout "$WORK/privkey.pem" -out "$WORK/server.csr" -subj "/CN=mosquitto" >/dev/null 2>&1

cat > "$WORK/ext.cnf" <<EXT
subjectAltName = $SANS
basicConstraints = CA:FALSE
keyUsage = digitalSignature
extendedKeyUsage = serverAuth
EXT

openssl x509 -req -in "$WORK/server.csr" -CA "$CA/ca.crt" -CAkey "$CA/ca.key" -CAcreateserial \
  -CAserial "$WORK/ca.srl" -days 825 -extfile "$WORK/ext.cnf" -out "$WORK/server.pem" >/dev/null 2>&1

cat "$WORK/server.pem" "$CA/ca.crt" > "$WORK/fullchain.pem"

install -m 0644 "$WORK/fullchain.pem" "$SERVER/fullchain.pem"
# 1883 es el uid de "mosquitto" en la imagen oficial
install -m 0600 -o 1883 -g 1883 "$WORK/privkey.pem" "$SERVER/privkey.pem"
printf '%s' "$SANS" > "$SERVER/sans.txt"

echo "dev-certs: certificado del servidor emitido para $SANS"
echo "dev-certs: avisa al broker si ya está corriendo:  docker compose -f infra/compose/base.yml -f infra/compose/dev.yml kill -s HUP mosquitto"
