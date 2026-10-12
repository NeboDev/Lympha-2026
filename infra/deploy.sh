#!/usr/bin/env bash
# Despliegue de Lympha en un servidor (staging o producción). Corre EN el servidor, como el usuario
# `deploy`, desde el checkout de este repositorio (/srv/lympha); lo invoca el workflow de GitHub por SSH.
#
#   infra/deploy.sh <staging|production> <sha>       despliega la imagen de ese commit
#   infra/deploy.sh <staging|production> rollback    vuelve a la versión anterior
#
# Qué hace (plan de implementación, "Pipeline de CI/CD"):
#   1. descifra los secretos con SOPS directamente al entorno del proceso (nunca a disco);
#   2. en producción, respalda Postgres antes de migrar;
#   3. migra con el rol lympha_owner (job de una sola ejecución) y aplica la base de Dynamic Security;
#   4. actualiza los procesos de uno en uno: worker y notifier, luego ingest, al final api;
#   5. corre las pruebas de humo y, si fallan, regresa solo a la versión anterior.
#
# El rollback cambia la imagen de los procesos; NO toca las migraciones (expand/contract: toda migración
# es compatible con la versión anterior del código).
#
# Configuración del servidor en $LYMPHA_ROOT/deploy.conf (la escribe infra/bootstrap/setup.sh):
#   IMAGE_REPO=ghcr.io/<dueño>/lympha-server      # repositorio de la imagen
#   DATA_DIR=/srv/lympha/data
# La llave age de cada entorno vive en $LYMPHA_ROOT/keys/<entorno>.age (permisos 600) y nunca sale de ahí.
set -euo pipefail

ENTORNO="${1:-}"
ACCION="${2:-}"
if [[ ! "$ENTORNO" =~ ^(staging|production)$ ]] || [[ -z "$ACCION" ]]; then
  echo "uso: $0 <staging|production> <sha|rollback>" >&2
  exit 2
fi

RAIZ="${LYMPHA_ROOT:-/srv/lympha}"
# shellcheck source=/dev/null
[[ -f "$RAIZ/deploy.conf" ]] && source "$RAIZ/deploy.conf"
: "${IMAGE_REPO:?falta IMAGE_REPO en $RAIZ/deploy.conf}"
DATA_DIR="${DATA_DIR:-$RAIZ/data}"
REPO="${LYMPHA_REPO_DIR:-$RAIZ}"
PROYECTO="lympha-$ENTORNO"
RELEASES="$RAIZ/releases/$ENTORNO"
BACKUPS="$RAIZ/backups/$ENTORNO"
SMOKE="${LYMPHA_SMOKE:-$REPO/infra/smoke.sh}"
PROCESOS_ORDEN=("worker notifier" "ingest" "api")

mkdir -p "$RELEASES" "$BACKUPS"

log() { printf '%s [deploy:%s] %s\n' "$(date -u +%FT%TZ)" "$ENTORNO" "$*"; }
die() { log "ERROR: $*" >&2; exit 1; }

# --- un solo despliegue a la vez ---------------------------------------------------------------
exec 9>"$RAIZ/releases/.lock"
flock -n 9 || die "hay otro despliegue en curso"

# --- secretos: SOPS -> variables de entorno de este proceso ------------------------------------
cargar_secretos() {
  local archivo="$REPO/infra/secrets/$ENTORNO.enc.env"
  local llave="$RAIZ/keys/$ENTORNO.age"
  [[ -f "$archivo" ]] || die "no existe $archivo"
  [[ -f "$llave" ]] || die "no existe la llave age $llave"
  local linea
  while IFS= read -r linea; do
    [[ -z "$linea" || "$linea" == \#* ]] && continue
    # Solo VARIABLE=valor con caracteres seguros: el valor se exporta, nunca se evalúa como shell.
    [[ "$linea" =~ ^[A-Z][A-Z0-9_]*=[A-Za-z0-9._:/@+=,-]*$ ]] || die "línea de secretos con formato no permitido"
    export "${linea?}"
  done < <(SOPS_AGE_KEY_FILE="$llave" sops decrypt --input-type dotenv --output-type dotenv "$archivo")
}

compose() {
  docker compose -p "$PROYECTO" -f "$REPO/infra/compose/base.yml" -f "$REPO/infra/compose/prod.yml" "$@"
}

actual() { [[ -f "$RELEASES/current" ]] && cat "$RELEASES/current" || true; }
anterior() { [[ -f "$RELEASES/previous" ]] && cat "$RELEASES/previous" || true; }

# Cada registro es "<sha> <digest>".
imagen_de() { echo "$IMAGE_REPO:$1"; }

esperar_datos() {
  log "arrancando Postgres, Valkey, Mosquitto y Caddy"
  compose up -d --wait postgres valkey mosquitto
  compose up -d caddy
}

respaldar() {
  if [[ "$ENTORNO" != "production" ]]; then return 0; fi
  if ! compose ps --status running --services | grep -qx postgres; then
    log "primer despliegue: no hay base que respaldar"
    return 0
  fi
  local destino
  destino="$BACKUPS/pre-$1-$(date -u +%Y%m%dT%H%M%SZ).dump"
  log "respaldo previo a la migración -> $destino"
  compose exec -T -e PGPASSWORD="$PW_BACKUP" postgres \
    pg_dump -h 127.0.0.1 -U lympha_backup -Fc lympha > "$destino" || die "el respaldo falló; no se migra"
  chmod 600 "$destino"
  # El envío a almacenamiento de objetos (S3) y los respaldos físicos con pgBackRest llegan en H6.
}

migrar() {
  log "migrando"
  compose run --rm migrate || die "la migración falló; los procesos siguen en la versión anterior"
  log "aplicando Dynamic Security"
  compose run --rm mqtt-bootstrap || die "mqtt-bootstrap falló"
}

actualizar_procesos() {
  local grupo
  for grupo in "${PROCESOS_ORDEN[@]}"; do
    log "actualizando: $grupo"
    # shellcheck disable=SC2086 # $grupo contiene uno o dos nombres de servicio
    compose up -d --no-deps --wait $grupo || return 1
  done
}

humo() {
  log "pruebas de humo"
  "$SMOKE" "$ENTORNO"
}

registrar() {
  local sha="$1"
  local digest
  digest="$(docker image inspect --format '{{index .RepoDigests 0}}' "$(imagen_de "$sha")" 2>/dev/null || echo sin-digest)"
  local viejo
  viejo="$(actual)"
  [[ -n "$viejo" ]] && printf '%s\n' "$viejo" > "$RELEASES/previous"
  printf '%s %s\n' "$sha" "$digest" > "$RELEASES/current"
}

desplegar() {
  local sha="$1"
  local previo_sha=""
  previo_sha="$(actual | cut -d' ' -f1)"
  export LYMPHA_VERSION="$sha"
  export LYMPHA_IMAGE
  LYMPHA_IMAGE="$(imagen_de "$sha")"

  log "descargando $LYMPHA_IMAGE"
  docker pull "$LYMPHA_IMAGE" >/dev/null || die "no se pudo descargar la imagen"

  esperar_datos
  respaldar "$sha"
  migrar

  if actualizar_procesos && humo; then
    registrar "$sha"
    log "despliegue correcto: $sha"
    docker image prune -f >/dev/null || true
    return 0
  fi

  log "FALLÓ el despliegue de $sha"
  if [[ -n "$previo_sha" ]]; then
    log "regresando a $previo_sha (sin tocar las migraciones)"
    export LYMPHA_VERSION="$previo_sha"
    LYMPHA_IMAGE="$(imagen_de "$previo_sha")"
    if actualizar_procesos && humo; then
      log "rollback automático correcto; la versión activa sigue siendo $previo_sha"
    else
      log "EL ROLLBACK TAMBIÉN FALLÓ: intervención manual necesaria" >&2
    fi
  else
    log "no hay versión anterior a la cual regresar" >&2
  fi
  exit 1
}

rollback() {
  local previa
  previa="$(anterior)"
  [[ -n "$previa" ]] || die "no hay una versión anterior registrada"
  local sha="${previa%% *}"
  export LYMPHA_VERSION="$sha"
  export LYMPHA_IMAGE
  LYMPHA_IMAGE="$(imagen_de "$sha")"
  log "rollback a $sha"
  docker pull "$LYMPHA_IMAGE" >/dev/null 2>&1 || log "no se pudo descargar; se usa la copia local"
  actualizar_procesos || die "no se pudieron reiniciar los procesos"
  humo || die "las pruebas de humo fallaron tras el rollback"
  # intercambia: lo que estaba activo pasa a ser "anterior", para poder volver a avanzar
  local activa
  activa="$(actual)"
  printf '%s\n' "$previa" > "$RELEASES/current"
  [[ -n "$activa" ]] && printf '%s\n' "$activa" > "$RELEASES/previous"
  log "rollback correcto: $sha"
}

cargar_secretos
case "$ACCION" in
  rollback) rollback ;;
  *)
    [[ "$ACCION" =~ ^[0-9a-f]{7,40}$ ]] || die "se esperaba un SHA de commit en minúsculas o 'rollback'"
    desplegar "$ACCION"
    ;;
esac
