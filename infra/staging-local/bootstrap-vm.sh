#!/usr/bin/env bash
# Corre DENTRO de la VM, como root, y lo lanza infra/staging-local/vm.sh (`vm.sh crear`). Hace en una sola pasada todo lo
# que necesita root, porque setup.sh deja SSH solo para `deploy` y `multipass exec` ya no podría entrar después:
#   1. ejecuta infra/bootstrap/setup.sh (el mismo que se usará en un VPS real);
#   2. genera la llave age de staging y los secretos del entorno, y los cifra con SOPS (nada en claro en disco);
#   3. instala los certificados de Mosquitto emitidos por la CA propia (en lugar de los de Caddy/Let's Encrypt);
#   4. deja deploy.conf para desplegar con la imagen cargada por `docker load` y el Compose de la VM.
#
# Entrada: /tmp/lympha-seed/{setup.sh,id_deploy.pub,lympha.bundle,fullchain.pem,privkey.pem} y las variables
#   VM_IP (IP de la VM, será el nombre de la API) y SSH_DESDE (red desde la que se permite SSH).
set -euo pipefail

SEED=/tmp/lympha-seed
: "${VM_IP:?}" "${SSH_DESDE:?}"
log() { printf '[bootstrap-vm] %s\n' "$*"; }

chmod 644 "$SEED/lympha.bundle"
log "setup.sh (igual que en un servidor real)"
bash "$SEED/setup.sh" --entorno staging --llave-ssh "$SEED/id_deploy.pub" \
  --repo "$SEED/lympha.bundle" --imagen lympha-local/lympha-server --ssh-desde "$SSH_DESDE"

RAIZ=/srv/lympha

log "llave age y secretos de staging"
if [[ ! -f "$RAIZ/keys/staging.age" ]]; then
  age-keygen -o "$RAIZ/keys/staging.age" 2>"$SEED/age.pub"
  chmod 600 "$RAIZ/keys/staging.age"
  chown deploy:deploy "$RAIZ/keys/staging.age"
  PUB="$(sed -n 's/^Public key: //p' "$SEED/age.pub")"
  gen() { openssl rand -hex 24; }
  ENV_CLARO="$(mktemp)"
  cat > "$ENV_CLARO" <<EOF
APP_ENV=staging
LOG_LEVEL=info
API_DOMAIN=$VM_IP
MQTT_DOMAIN=mqtt.lympha.test
ACME_EMAIL=dev@lympha.test
POSTGRES_USER=postgres
POSTGRES_PASSWORD=$(gen)
POSTGRES_DB=lympha
PW_OWNER=$(gen)
PW_APP=$(gen)
PW_SYSTEM=$(gen)
PW_BACKUP=$(gen)
VALKEY_PW_API=$(gen)
VALKEY_PW_INGEST=$(gen)
VALKEY_PW_WORKER=$(gen)
MQTT_ADMIN_USER=lympha-admin
MQTT_ADMIN_PASSWORD=$(gen)
MQTT_INGEST_USER=lympha-ingest
MQTT_INGEST_PASSWORD=$(gen)
MQTT_CONTROL_USER=lympha-control
MQTT_CONTROL_PASSWORD=$(gen)
CLAIM_PEPPER=$(gen)
FIREBASE_PROJECT_ID=lympha-dev
PG_SHARED_BUFFERS=512MB
PG_EFFECTIVE_CACHE_SIZE=1GB
PG_MAINTENANCE_WORK_MEM=128MB
PG_MEM_LIMIT=2g
EOF
  mkdir -p "$RAIZ/infra/secrets"
  # El archivo en claro está en /tmp (fuera del repo), así que no aplican los marcadores de .sops.yaml:
  # la llave pública se da explícita.
  sops encrypt --age "$PUB" --input-type dotenv --output-type dotenv "$ENV_CLARO" \
    > "$RAIZ/infra/secrets/staging.enc.env"
  chown -R deploy:deploy "$RAIZ/infra/secrets"
  shred -u "$ENV_CLARO" 2>/dev/null || rm -f "$ENV_CLARO"
else
  log "ya había llave age; se conservan los secretos"
fi

log "certificados de Mosquitto (CA propia)"
install -m 0644 -o 1883 -g 1883 "$SEED/fullchain.pem" "$RAIZ/data/mosquitto-certs/fullchain.pem"
install -m 0600 -o 1883 -g 1883 "$SEED/privkey.pem" "$RAIZ/data/mosquitto-certs/privkey.pem"
# El servicio de renovación copia certificados de Caddy; aquí no aplica.
systemctl disable --now lympha-cert-sync.timer >/dev/null 2>&1 || true

log "deploy.conf"
cat >> "$RAIZ/deploy.conf" <<'EOF'
IMAGE_PULL=0
COMPOSE_EXTRA=infra/compose/staging-local.yml
EOF
chown deploy:deploy "$RAIZ/deploy.conf"

rm -rf "$SEED"
log "listo"
