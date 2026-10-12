#!/usr/bin/env bash
# Pruebas de humo posteriores a un despliegue (plan de implementación, "Pruebas de humo").
#   infra/smoke.sh <staging|production>
#
# Hoy cubre: GET /health de la api con Postgres, Valkey y MQTT conectados, y el handshake TLS del 8883.
# Pendientes (necesitan piezas que aún no existen): una lectura de un nodo de prueba visible por la API
# en menos de 10 s (staging tendrá un simulador permanente, H1) y la respuesta del webhook de Telegram (H3).
set -euo pipefail

ENTORNO="${1:?uso: $0 <staging|production>}"
API_URL="${SMOKE_API_URL:-http://127.0.0.1:3000}"
MQTT_HOST="${SMOKE_MQTT_HOST:-127.0.0.1}"
MQTT_PORT="${SMOKE_MQTT_PORT:-8883}"

fallo() { echo "humo[$ENTORNO]: FALLA - $*" >&2; exit 1; }

# La api puede tardar unos segundos en responder tras reiniciarse.
respuesta=""
for _ in $(seq 1 30); do
  if respuesta="$(curl -fsS --max-time 5 "$API_URL/health" 2>/dev/null)"; then break; fi
  sleep 2
done
[[ -n "$respuesta" ]] || fallo "GET /health no respondió 200 en 60 s"
for componente in postgres valkey mqtt; do
  grep -q "\"$componente\":\"ok\"" <<<"$respuesta" || fallo "/health: $componente no está conectado ($respuesta)"
done
echo "humo[$ENTORNO]: /health ok"

if command -v openssl >/dev/null 2>&1; then
  if openssl s_client -connect "$MQTT_HOST:$MQTT_PORT" -brief </dev/null >/dev/null 2>&1; then
    echo "humo[$ENTORNO]: TLS en $MQTT_PORT ok"
  else
    fallo "el handshake TLS en $MQTT_HOST:$MQTT_PORT falló"
  fi
else
  echo "humo[$ENTORNO]: openssl no disponible; se omite el handshake TLS"
fi

echo "humo[$ENTORNO]: ok"
