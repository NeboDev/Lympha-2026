#!/usr/bin/env bash
# Staging local: una VM de Multipass (Ubuntu 24.04) donde se ensaya el despliegue completo sin VPS: se prepara con el mismo
# infra/bootstrap/setup.sh y se despliega con el mismo infra/deploy.sh, por SSH. Se usa al cierre de cada hito.
#
#   infra/staging-local/vm.sh crear        crea y prepara la VM (setup.sh, secretos, certificados); luego despliega HEAD
#   infra/staging-local/vm.sh desplegar    construye la imagen del commit actual, la carga en la VM y corre deploy.sh
#   infra/staging-local/vm.sh rollback     deploy.sh staging rollback
#   infra/staging-local/vm.sh ip           IP de la VM (la API queda en https://<ip>, MQTT en <ip>:8883)
#   infra/staging-local/vm.sh ssh [cmd]    entra por SSH como `deploy` (la única cuenta que deja setup.sh)
#   infra/staging-local/vm.sh destruir     borra la VM
#
# Requisitos en el equipo: Multipass, Docker, Git, ssh/scp/ssh-keygen. En Windows, corre este script desde Git Bash.
# Variables: LYMPHA_VM (nombre, por defecto lympha-staging), VM_CPUS (2), VM_MEM (4G), VM_DISCO (30G).
#
# Estado: escrito pero NO ejecutado en el equipo de desarrollo (no tenía Multipass instalado); lo que sí está probado
# es deploy.sh con simulacros (infra/test/deploy.test.sh) y la validez de staging-local.yml. Ver docs/decisiones.md.
set -euo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAIZ="$(cd "$AQUI/../.." && pwd)"
VM="${LYMPHA_VM:-lympha-staging}"
ESTADO="$AQUI/.estado"          # llave SSH, known_hosts y certificados del servidor; ignorado por git
LLAVE="$ESTADO/id_deploy"
KNOWN="$ESTADO/known_hosts"

log() { printf '[staging-local] %s\n' "$*"; }
die() { printf '[staging-local] ERROR: %s\n' "$*" >&2; exit 1; }
requiere() { command -v "$1" >/dev/null 2>&1 || die "falta '$1' en el PATH"; }

ip_vm() {
  multipass info "$VM" 2>/dev/null | awk '/^IPv4/{print $2; exit}'
}

ssh_vm() {
  local ip; ip="$(ip_vm)"; [[ -n "$ip" ]] || die "la VM $VM no existe o no tiene IP (¿está iniciada?)"
  ssh -i "$LLAVE" -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile="$KNOWN" \
    -o BatchMode=yes "deploy@$ip" "$@"
}

crear() {
  requiere multipass; requiere git; requiere docker; requiere ssh-keygen
  mkdir -p "$ESTADO"
  if multipass info "$VM" >/dev/null 2>&1; then die "ya existe la VM $VM (usa 'destruir' para empezar de cero)"; fi

  [[ -f "$LLAVE" ]] || ssh-keygen -t ed25519 -N "" -C "lympha-staging-local" -f "$LLAVE" >/dev/null
  log "lanzando la VM $VM (Ubuntu 24.04)"
  multipass launch 24.04 --name "$VM" --cpus "${VM_CPUS:-2}" --memory "${VM_MEM:-4G}" --disk "${VM_DISCO:-30G}"
  local ip; ip="$(ip_vm)"; [[ -n "$ip" ]] || die "la VM no obtuvo IP"
  log "IP: $ip"

  # CA propia (la misma de desarrollo: infra/certs) y certificado del broker con la IP de la VM.
  log "certificados de Mosquitto con la CA propia (SAN IP:$ip)"
  mkdir -p "$RAIZ/infra/certs" "$ESTADO/certs-servidor"
  MSYS_NO_PATHCONV=1 docker run --rm -e "CERT_SANS=IP:$ip" \
    -v "$RAIZ/infra/mosquitto/gen-dev-certs.sh:/gen.sh:ro" \
    -v "$RAIZ/infra/certs:/out/ca" -v "$ESTADO/certs-servidor:/out/server" \
    --entrypoint /bin/sh alpine/openssl /gen.sh

  log "empaquetando el repositorio"
  git -C "$RAIZ" bundle create "$ESTADO/lympha.bundle" --all >/dev/null 2>&1

  log "copiando archivos a la VM"
  multipass exec "$VM" -- mkdir -p /tmp/lympha-seed
  for f in "$RAIZ/infra/bootstrap/setup.sh" "$AQUI/bootstrap-vm.sh" "$LLAVE.pub" "$ESTADO/lympha.bundle" \
           "$ESTADO/certs-servidor/fullchain.pem" "$ESTADO/certs-servidor/privkey.pem"; do
    multipass transfer "$f" "$VM:/tmp/lympha-seed/$(basename "$f")"
  done

  # SSH solo desde la red de la VM (setup.sh cierra el 22 al resto). Se asume una red /16 alrededor de la IP.
  local red; red="$(awk -F. '{print $1"."$2".0.0/16"}' <<<"$ip")"
  log "ejecutando setup.sh dentro de la VM (SSH permitido desde $red)"
  multipass exec "$VM" -- sudo env "VM_IP=$ip" "SSH_DESDE=$red" bash /tmp/lympha-seed/bootstrap-vm.sh

  log "VM lista. Desde ahora solo se entra como 'deploy': $0 ssh"
  desplegar
}

desplegar() {
  requiere docker; requiere git; requiere ssh; requiere scp
  [[ -f "$LLAVE" ]] || die "no hay llave SSH; corre 'crear' primero"
  local ip sha img
  ip="$(ip_vm)"; [[ -n "$ip" ]] || die "la VM $VM no está disponible"
  sha="$(git -C "$RAIZ" rev-parse HEAD)"
  img="lympha-local/lympha-server:$sha"
  if [[ -n "$(git -C "$RAIZ" status --porcelain)" ]]; then
    log "AVISO: hay cambios sin commitear. La imagen se construye con el árbol de trabajo, pero infra/ y deploy.sh se"
    log "       toman del commit $sha; para ensayar un hito completo, commitea antes."
  fi

  log "construyendo la imagen $img"
  docker build -q --target runtime --build-arg "APP_VERSION=$sha" -t "$img" -f "$RAIZ/apps/server/Dockerfile" "$RAIZ" >/dev/null

  log "cargando la imagen en la VM (docker save | docker load)"
  docker save "$img" | ssh_vm "docker load" >/dev/null

  log "enviando el código de infra del commit"
  git -C "$RAIZ" bundle create "$ESTADO/despliegue.bundle" --all >/dev/null 2>&1
  scp -i "$LLAVE" -o IdentitiesOnly=yes -o UserKnownHostsFile="$KNOWN" -o StrictHostKeyChecking=accept-new \
    "$ESTADO/despliegue.bundle" "deploy@$ip:/tmp/despliegue.bundle" >/dev/null

  log "deploy.sh staging $sha (por SSH, como en el pipeline)"
  ssh_vm "set -euo pipefail; cd /srv/lympha && git fetch --quiet /tmp/despliegue.bundle HEAD && git checkout --quiet --detach $sha && ./infra/deploy.sh staging $sha"
  log "despliegue correcto. API: https://$ip/health (certificado de la CA interna de Caddy; usa curl -k)  ·  MQTT: mqtts://$ip:8883 (CA: infra/certs/ca.crt)"
}

case "${1:-}" in
  crear) crear ;;
  desplegar) desplegar ;;
  rollback) ssh_vm "cd /srv/lympha && ./infra/deploy.sh staging rollback" ;;
  ip) ip_vm ;;
  ssh) shift; ssh_vm "$@" ;;
  destruir) multipass delete --purge "$VM" && log "VM $VM eliminada"; rm -rf "$ESTADO" ;;
  *) sed -n '2,13p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 2 ;;
esac
