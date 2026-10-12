#!/usr/bin/env bash
# Prepara un servidor Debian/Ubuntu nuevo para recibir despliegues de Lympha. Idempotente: se puede
# correr otra vez sin romper nada. Como root:
#
#   sudo ./setup.sh --entorno staging|production \
#        --llave-ssh /ruta/a/clave-deploy.pub \
#        --repo git@github.com:<dueño>/lympha.git \
#        --imagen ghcr.io/<dueño>/lympha-server \
#        [--ssh-desde 203.0.113.7/32]   # IP fija o red de Tailscale; sin esto el 22 queda cerrado
#        [--volumen /dev/sdb]           # volumen de datos (se formatea SOLO si está vacío)
#
# Pasos (plan de implementación, "Preparación de un servidor nuevo"):
#   1. usuario `deploy` con llave SSH; sin contraseña ni login de root por SSH;
#   2. firewall (22 solo desde --ssh-desde, 80, 443, 8883) y actualizaciones automáticas de seguridad;
#   3. Docker Engine + Compose y SOPS (+ age);
#   4. volumen de datos montado en /srv/lympha/data;
#   5. clona el repositorio en /srv/lympha y deja todo listo para que el pipeline despliegue.
#
# Después, a mano (secretos que no deben pasar por este script): copiar la llave age del entorno a
# /srv/lympha/keys/<entorno>.age (600) y hacer `docker login ghcr.io` como `deploy` con un token de solo lectura.
#
# Nota: este script NO se ha ejecutado todavía contra un servidor real (aún no existe uno). Revisarlo en
# un VPS desechable antes de usarlo en producción.
set -euo pipefail

SOPS_VERSION="v3.13.3"
SOPS_SHA256_AMD64="e5bec3346a873ae91d871550f3e698c1aad962aff462a080e40f25fde17fef6b"
SOPS_SHA256_ARM64="53b0abacd38ef1b12a66d6c100956691b9cefce018d91f81e73ddf7438b94d77"

ENTORNO="" LLAVE_SSH="" REPO="" IMAGEN="" SSH_DESDE="" VOLUMEN=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --entorno) ENTORNO="$2"; shift 2 ;;
    --llave-ssh) LLAVE_SSH="$2"; shift 2 ;;
    --repo) REPO="$2"; shift 2 ;;
    --imagen) IMAGEN="$2"; shift 2 ;;
    --ssh-desde) SSH_DESDE="$2"; shift 2 ;;
    --volumen) VOLUMEN="$2"; shift 2 ;;
    *) echo "argumento desconocido: $1" >&2; exit 2 ;;
  esac
done

[[ $EUID -eq 0 ]] || { echo "ejecuta como root (sudo)" >&2; exit 1; }
[[ "$ENTORNO" =~ ^(staging|production)$ ]] || { echo "--entorno debe ser staging o production" >&2; exit 2; }
[[ -f "$LLAVE_SSH" ]] || { echo "--llave-ssh: no existe el archivo" >&2; exit 2; }
[[ -n "$REPO" && -n "$IMAGEN" ]] || { echo "faltan --repo y --imagen" >&2; exit 2; }

log() { printf '[setup] %s\n' "$*"; }
export DEBIAN_FRONTEND=noninteractive

# --- 1. usuario deploy y SSH ------------------------------------------------------------------------
log "usuario deploy y SSH"
if ! id deploy >/dev/null 2>&1; then
  adduser --disabled-password --gecos "" deploy
fi
install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
touch /home/deploy/.ssh/authorized_keys
chmod 600 /home/deploy/.ssh/authorized_keys
chown deploy:deploy /home/deploy/.ssh/authorized_keys
grep -qxF "$(cat "$LLAVE_SSH")" /home/deploy/.ssh/authorized_keys || cat "$LLAVE_SSH" >> /home/deploy/.ssh/authorized_keys

install -d -m 755 /etc/ssh/sshd_config.d
cat > /etc/ssh/sshd_config.d/10-lympha.conf <<'EOF'
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
PubkeyAuthentication yes
AllowUsers deploy
EOF
sshd -t && systemctl reload ssh 2>/dev/null || systemctl reload sshd 2>/dev/null || true

# --- 2. firewall y actualizaciones automáticas -------------------------------------------------------
log "firewall y actualizaciones automáticas"
apt-get update -qq
apt-get install -y -qq ufw unattended-upgrades ca-certificates curl gnupg git age openssl >/dev/null
ufw --force reset >/dev/null
ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
if [[ -n "$SSH_DESDE" ]]; then
  ufw allow from "$SSH_DESDE" to any port 22 proto tcp >/dev/null
else
  log "AVISO: sin --ssh-desde el puerto 22 queda CERRADO; asegúrate de tener otra vía de acceso (Tailscale, consola del proveedor)"
fi
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw allow 8883/tcp >/dev/null
# 5432, 6379 y 1883 no se abren nunca: viven en la red interna de Docker.
ufw --force enable >/dev/null
dpkg-reconfigure -f noninteractive unattended-upgrades >/dev/null 2>&1 || true

# --- 3. Docker y SOPS ---------------------------------------------------------------------------------
if ! command -v docker >/dev/null 2>&1; then
  log "instalando Docker Engine y Compose desde el repositorio oficial"
  # shellcheck source=/dev/null
  . /etc/os-release
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL "https://download.docker.com/linux/$ID/gpg" -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/$ID $VERSION_CODENAME stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -qq
  apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin >/dev/null
fi
usermod -aG docker deploy
install -d -m 755 /etc/docker
cat > /etc/docker/daemon.json <<'EOF'
{ "log-driver": "json-file", "log-opts": { "max-size": "10m", "max-file": "5" }, "no-new-privileges": true }
EOF
systemctl enable --now docker >/dev/null 2>&1
systemctl restart docker

if ! command -v sops >/dev/null 2>&1 || ! sops --version 2>/dev/null | grep -q "${SOPS_VERSION#v}"; then
  log "instalando SOPS $SOPS_VERSION (verificando SHA-256)"
  arq="$(dpkg --print-architecture)"
  case "$arq" in
    amd64) esperado="$SOPS_SHA256_AMD64" ;;
    arm64) esperado="$SOPS_SHA256_ARM64" ;;
    *) echo "arquitectura no soportada: $arq" >&2; exit 1 ;;
  esac
  tmp="$(mktemp)"
  curl -fsSL "https://github.com/getsops/sops/releases/download/$SOPS_VERSION/sops-$SOPS_VERSION.linux.$arq" -o "$tmp"
  echo "$esperado  $tmp" | sha256sum -c - >/dev/null || { echo "SHA-256 de SOPS no coincide" >&2; rm -f "$tmp"; exit 1; }
  install -m 0755 "$tmp" /usr/local/bin/sops
  rm -f "$tmp"
fi

# --- 4. volumen de datos -------------------------------------------------------------------------------
log "directorios y volumen de datos"
install -d -m 755 -o deploy -g deploy /srv/lympha
install -d -m 700 -o deploy -g deploy /srv/lympha/keys /srv/lympha/backups
install -d -m 755 -o deploy -g deploy /srv/lympha/data
if [[ -n "$VOLUMEN" ]]; then
  if ! mountpoint -q /srv/lympha/data; then
    if [[ -z "$(blkid -o value -s TYPE "$VOLUMEN" 2>/dev/null || true)" ]]; then
      log "formateando $VOLUMEN (estaba vacío)"
      mkfs.ext4 -L lympha-data "$VOLUMEN" >/dev/null
    fi
    grep -q "/srv/lympha/data" /etc/fstab || echo "LABEL=lympha-data /srv/lympha/data ext4 defaults,nofail 0 2" >> /etc/fstab
    mount /srv/lympha/data
  fi
fi
# Postgres (uid 70 en la imagen de Timescale/Alpine), Mosquitto (1883) y Caddy escriben aquí.
install -d -m 700 -o 70 -g 70 /srv/lympha/data/postgres
install -d -m 700 -o 1883 -g 1883 /srv/lympha/data/mosquitto
install -d -m 755 -o 1883 -g 1883 /srv/lympha/data/mosquitto-certs
install -d -m 755 /srv/lympha/data/caddy

# --- 5. repositorio y configuración del servidor ---------------------------------------------------------
log "repositorio y deploy.conf"
if [[ ! -d /srv/lympha/.git ]]; then
  sudo -u deploy git clone --depth 1 "$REPO" /srv/lympha.tmp
  sudo -u deploy bash -c 'shopt -s dotglob && mv /srv/lympha.tmp/* /srv/lympha/ && rmdir /srv/lympha.tmp'
fi
cat > /srv/lympha/deploy.conf <<EOF
IMAGE_REPO=$IMAGEN
DATA_DIR=/srv/lympha/data
EOF
chown deploy:deploy /srv/lympha/deploy.conf

# Renovación de certificados de MQTT: copia los de Caddy a Mosquitto y le envía SIGHUP.
install -m 0755 /srv/lympha/infra/bootstrap/cert-sync.sh /usr/local/bin/lympha-cert-sync
cat > /etc/systemd/system/lympha-cert-sync.service <<EOF
[Unit]
Description=Copia los certificados de mqtt.<dominio> de Caddy a Mosquitto
[Service]
Type=oneshot
Environment=LYMPHA_ENV=$ENTORNO
EnvironmentFile=-/srv/lympha/cert-sync.env
ExecStart=/usr/local/bin/lympha-cert-sync
EOF
cat > /etc/systemd/system/lympha-cert-sync.timer <<'EOF'
[Unit]
Description=Sincroniza certificados de MQTT cada hora
[Timer]
OnBootSec=2min
OnUnitActiveSec=1h
[Install]
WantedBy=timers.target
EOF
systemctl daemon-reload
systemctl enable --now lympha-cert-sync.timer >/dev/null 2>&1 || true

log "listo. Siguiente: copia la llave age a /srv/lympha/keys/$ENTORNO.age (600), crea /srv/lympha/cert-sync.env con MQTT_DOMAIN=..., y 'docker login ghcr.io' como deploy."
