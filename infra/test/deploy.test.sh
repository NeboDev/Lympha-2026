#!/usr/bin/env bash
# Pruebas de infra/deploy.sh con docker, sops, flock y curl simulados: verifican el orden del
# despliegue, el registro de versiones, el rollback automático y manual, y el rechazo de secretos
# con formato peligroso. No toca Docker ni la red reales.
#   bash infra/test/deploy.test.sh
set -uo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY="$AQUI/../deploy.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

FALLAS=0
ok() { echo "  ok   - $1"; }
mal() { echo "  FALLA - $1"; FALLAS=$((FALLAS + 1)); }
afirma() { # afirma "<descripción>" <comando...>
  local d="$1"; shift
  if "$@"; then ok "$d"; else mal "$d"; fi
}

# --- simulacros -----------------------------------------------------------------------------------
mkdir -p "$TMP/bin" "$TMP/raiz/keys" "$TMP/raiz/infra/secrets" "$TMP/raiz/infra/compose"
touch "$TMP/raiz/keys/staging.age" "$TMP/raiz/keys/production.age"
touch "$TMP/raiz/infra/secrets/staging.enc.env" "$TMP/raiz/infra/secrets/production.enc.env"
echo "IMAGE_REPO=ghcr.io/prueba/lympha-server" > "$TMP/raiz/deploy.conf"
LOG="$TMP/llamadas.log"

cat > "$TMP/bin/docker" <<'EOF'
#!/usr/bin/env bash
echo "docker $* | IMAGE=${LYMPHA_IMAGE:-}" >> "$LOG"
case "$*" in
  *"run --rm migrate"*) [[ "${FALLA_MIGRACION:-}" == "1" ]] && exit 1 ;;
  *"ps --status running --services"*) echo postgres ;;
  "image inspect"*) echo "ghcr.io/prueba/lympha-server@sha256:digest-de-prueba" ;;
esac
exit 0
EOF
cat > "$TMP/bin/sops" <<'EOF'
#!/usr/bin/env bash
cat <<VARS
POSTGRES_USER=postgres
PW_BACKUP=pw-respaldo
${SECRETO_EXTRA:-}
VARS
EOF
printf '#!/usr/bin/env bash\nexit 0\n' > "$TMP/bin/flock"
cat > "$TMP/smoke-simulado.sh" <<'EOF'
#!/usr/bin/env bash
echo "humo version=$LYMPHA_VERSION" >> "$LOG"
[[ "$LYMPHA_VERSION" == "${SHA_MALO:-}" ]] && exit 1
exit 0
EOF
chmod +x "$TMP/bin/"* "$TMP/smoke-simulado.sh"

correr() { # correr <entorno> <accion>; la salida va a $TMP/salida.log
  PATH="$TMP/bin:$PATH" LOG="$LOG" LYMPHA_ROOT="$TMP/raiz" LYMPHA_REPO_DIR="$TMP/raiz" \
    LYMPHA_SMOKE="$TMP/smoke-simulado.sh" bash "$DEPLOY" "$@" >"$TMP/salida.log" 2>&1
}
limpiar_estado() { rm -rf "$TMP/raiz/releases" "$TMP/raiz/backups"; : > "$LOG"; }
actual() { cut -d' ' -f1 "$TMP/raiz/releases/$1/current" 2>/dev/null; }
previa() { cut -d' ' -f1 "$TMP/raiz/releases/$1/previous" 2>/dev/null; }
linea_de() { grep -n -- "$1" "$LOG" | head -1 | cut -d: -f1; }

A=aaaaaaa; B=bbbbbbb; C=ccccccc; D=ddddddd

echo "despliegue correcto"
limpiar_estado
correr staging "$A"; afirma "primer despliegue termina bien" test $? -eq 0
afirma "registra la versión actual" test "$(actual staging)" = "$A"
afirma "no hay versión anterior aún" test -z "$(previa staging)"
afirma "registra el digest de la imagen" grep -q "digest-de-prueba" "$TMP/raiz/releases/staging/current"
afirma "migra antes de actualizar procesos" test "$(linea_de 'run --rm migrate')" -lt "$(linea_de 'worker notifier')"
afirma "aplica Dynamic Security después de migrar" test "$(linea_de 'run --rm mqtt-bootstrap')" -gt "$(linea_de 'run --rm migrate')"
afirma "worker/notifier antes que ingest, ingest antes que api" \
  test "$(linea_de 'worker notifier')" -lt "$(linea_de 'no-deps --wait ingest')" -a \
       "$(linea_de 'no-deps --wait ingest')" -lt "$(linea_de 'no-deps --wait api')"
afirma "usa la imagen del SHA pedido" grep -q "IMAGE=ghcr.io/prueba/lympha-server:$A" "$LOG"
afirma "staging no hace respaldo previo" bash -c "! grep -q pg_dump '$LOG'"

echo "segundo despliegue"
: > "$LOG"
correr staging "$B"
afirma "actual = nueva versión" test "$(actual staging)" = "$B"
afirma "anterior = la que estaba activa" test "$(previa staging)" = "$A"

echo "producción respalda antes de migrar"
limpiar_estado
correr production "$A"
afirma "hace pg_dump con el rol de respaldo" grep -q "pg_dump -h 127.0.0.1 -U lympha_backup" "$LOG"
afirma "el respaldo va antes de la migración" test "$(linea_de pg_dump)" -lt "$(linea_de 'run --rm migrate')"

echo "falla la prueba de humo: rollback automático"
limpiar_estado
correr staging "$A"; : > "$LOG"
SHA_MALO="$C" correr staging "$C"; codigo=$?
afirma "el despliegue termina con error" test "$codigo" -ne 0
afirma "la versión registrada no cambia" test "$(actual staging)" = "$A"
afirma "vuelve a levantar la imagen anterior" grep -q "no-deps --wait api | IMAGE=ghcr.io/prueba/lympha-server:$A" "$LOG"
afirma "no revierte migraciones" bash -c "! grep -qi 'down\|revert' '$LOG'"

echo "falla la migración: no se toca ningún proceso"
limpiar_estado
correr staging "$A"; : > "$LOG"
FALLA_MIGRACION=1 correr staging "$D"; codigo=$?
afirma "termina con error" test "$codigo" -ne 0
afirma "no actualiza procesos" bash -c "! grep -q 'no-deps' '$LOG'"
afirma "la versión registrada no cambia" test "$(actual staging)" = "$A"

echo "rollback manual"
limpiar_estado
correr staging "$A"; correr staging "$B"; : > "$LOG"
correr staging rollback; afirma "termina bien" test $? -eq 0
afirma "actual = la anterior" test "$(actual staging)" = "$A"
afirma "anterior = la que se retiró" test "$(previa staging)" = "$B"
afirma "levanta la imagen anterior" grep -q "IMAGE=ghcr.io/prueba/lympha-server:$A" "$LOG"
limpiar_estado
correr staging rollback; afirma "sin historial, el rollback se niega" test $? -ne 0

echo "validaciones"
correr staging; afirma "sin argumentos falla" test $? -ne 0
correr desarrollo "$A"; afirma "entorno desconocido falla" test $? -ne 0
correr staging "no-es-un-sha"; afirma "rechaza un SHA inválido" test $? -ne 0
# shellcheck disable=SC2016 # el $( ) debe llegar literal al script
SECRETO_EXTRA='X=$(touch /tmp/pwn)' correr staging "$A"
afirma "rechaza secretos con formato peligroso" test $? -ne 0
afirma "no ejecutó nada del secreto" test ! -e /tmp/pwn

echo
if [[ "$FALLAS" -eq 0 ]]; then echo "deploy.sh: todas las pruebas pasaron"; else echo "deploy.sh: $FALLAS prueba(s) fallaron"; exit 1; fi
