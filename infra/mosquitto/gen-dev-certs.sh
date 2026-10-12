#!/bin/sh
# Genera, solo para desarrollo, una CA propia y un certificado de servidor para Mosquitto.
#   /out/server/{fullchain.pem,privkey.pem}  -> volumen del broker (la llave nunca sale de ahí)
#   /out/ca/ca.crt                                  -> carpeta del host (infra/certs) para el simulador
# Idempotente: si ya existen, no hace nada. Nunca se usa en staging ni producción (ahí los emite Caddy).
set -eu

SERVER=/out/server
CA=/out/ca
mkdir -p "$SERVER" "$CA"

if [ -f "$SERVER/fullchain.pem" ] && [ -f "$SERVER/privkey.pem" ] && [ -f "$CA/ca.crt" ]; then
  echo "dev-certs: ya existen"
  exit 0
fi

WORK=$(mktemp -d)
cd "$WORK"

openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -days 3650 \
  -keyout ca.key -out ca.pem -subj "/CN=Lympha Dev CA" >/dev/null 2>&1

openssl req -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes \
  -keyout privkey.pem -out server.csr -subj "/CN=mosquitto" >/dev/null 2>&1

cat > ext.cnf <<EXT
subjectAltName = DNS:localhost, DNS:mosquitto, DNS:mqtt.lympha.test, IP:127.0.0.1
basicConstraints = CA:FALSE
keyUsage = digitalSignature
extendedKeyUsage = serverAuth
EXT

openssl x509 -req -in server.csr -CA ca.pem -CAkey ca.key -CAcreateserial -days 825 \
  -extfile ext.cnf -out server.pem >/dev/null 2>&1

cat server.pem ca.pem > fullchain.pem

install -m 0644 fullchain.pem "$SERVER/fullchain.pem"
install -m 0644 ca.pem "$CA/ca.crt"
# 1883 es el uid de "mosquitto" en la imagen oficial
install -m 0600 -o 1883 -g 1883 privkey.pem "$SERVER/privkey.pem"

rm -rf "$WORK"
echo "dev-certs: generados"
