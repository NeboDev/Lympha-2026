#!/usr/bin/env bash
# Prueba de carga local (criterio de salida de H1): N nodos simulados durante un tiempo, con reinicios forzados
# (SIGKILL) de ingest y worker, y conciliación final entre lo publicado (con PUBACK) y lo guardado.
#
#   bash infra/test/carga-local.sh [--nodos 100] [--duracion 5m] [--intervalo 10]
#
#   --duracion  segundos, o con sufijo m/h (30s, 5m, 1h). Por defecto 5m. Con 1h es la prueba completa de H1.
#   --nodos     nodos simulados (los crea la fábrica en modo --dev). Por defecto 100.
#   --intervalo segundos entre lecturas de cada nodo. Por defecto 10.
#
# Calendario de reinicios forzados, en proporción a la duración: 20 % ingest · 40 % worker · 60 % ingest y worker
# a la vez · 80 % ingest. Requiere el stack de desarrollo arriba:
#   docker compose -f infra/compose/base.yml -f infra/compose/dev.yml up -d
# Informe: infra/test/resultados/carga-<fecha>.md (se versiona). Registros crudos: infra/test/salida-carga/ (no).
set -uo pipefail

NODOS=100 DURACION=300 INTERVALO=10
convertir() { # 30s | 5m | 1h | 300 -> segundos
  case "$1" in
    *h) echo $((${1%h} * 3600)) ;;
    *m) echo $((${1%m} * 60)) ;;
    *s) echo "${1%s}" ;;
    *) echo "$1" ;;
  esac
}
while [[ $# -gt 0 ]]; do
  case "$1" in
    --nodos) NODOS="$2"; shift 2 ;;
    --duracion) DURACION="$(convertir "$2")"; shift 2 ;;
    --intervalo) INTERVALO="$2"; shift 2 ;;
    *) echo "argumento desconocido: $1 (uso: --nodos N --duracion 5m --intervalo 10)" >&2; exit 2 ;;
  esac
done
[[ "$NODOS" =~ ^[0-9]+$ && "$DURACION" =~ ^[0-9]+$ && "$INTERVALO" =~ ^[0-9]+$ ]] || { echo "valores no numéricos" >&2; exit 2; }
LECTURAS=$((DURACION / INTERVALO))
(( LECTURAS >= 5 )) || { echo "la duración debe alcanzar al menos 5 lecturas por nodo" >&2; exit 2; }

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$RAIZ"
CRUDOS="$RAIZ/infra/test/salida-carga"
RESULTADOS="$RAIZ/infra/test/resultados"
mkdir -p "$CRUDOS" "$RESULTADOS"
FECHA="$(date -u +%Y%m%dT%H%M%SZ)"
INFORME="$RESULTADOS/carga-$FECHA.md"
BITACORA="$CRUDOS/bitacora-$FECHA.txt"
: > "$BITACORA"

C="docker compose -f infra/compose/base.yml -f infra/compose/dev.yml"
psql_() { docker exec lympha-postgres-1 psql -U postgres -d lympha -Atc "$1"; }
log() { printf '%s %s\n' "$(date -u +%FT%TZ)" "$*" | tee -a "$BITACORA"; }
metrica() { # metrica <servicio> <prefijo>: última línea que empieza con el prefijo
  docker exec "lympha-$1-1" node -e "fetch('http://127.0.0.1:9100/metrics').then(r=>r.text()).then(t=>{const l=t.split('\n').filter(x=>x.startsWith('$2'));console.log(l.join(' | ')||'-')}).catch(()=>console.log('sin respuesta'))" 2>/dev/null | tail -1
}
valor() { awk '{print $NF}' <<<"$1"; }
mb() { awk -v b="$1" 'BEGIN{ if (b+0>0) printf "%.0f", b/1048576; else print "?" }'; }
matar() { # matar <servicio...>: SIGKILL, 8 s caído, y se levanta de nuevo
  log "SIGKILL: $*"
  for s in "$@"; do docker kill -s KILL "lympha-$s-1" >/dev/null; done
  sleep 8
  $C up -d "$@" >/dev/null 2>&1
  log "levantado: $*"
  EVENTOS+=("t+$((SECONDS - T0)) s: SIGKILL de $*")
}

declare -a EVENTOS=() MUESTRAS=()
MIN_CONECTADOS=999999
muestra() {
  local t=$((SECONDS - T0))
  local guardadas conectados irss wrss
  guardadas="$(psql_ "select count(*) from ts.lecturas where nodo_id in (select id from app.nodos where lote_id='$LOTE') and recibido_en >= '$INICIO_DB'::timestamptz")"
  conectados="$(psql_ "select count(*) filter (where conectado) from app.estado_nodo where nodo_id in (select id from app.nodos where lote_id='$LOTE')")"
  irss="$(valor "$(metrica ingest process_resident_memory_bytes)")"
  wrss="$(valor "$(metrica worker process_resident_memory_bytes)")"
  MUESTRAS+=("| $t | $guardadas | $conectados | $(mb "$irss") | $(mb "$wrss") |")
  if [[ "${1:-}" != "final" ]] && (( conectados < MIN_CONECTADOS )); then MIN_CONECTADOS=$conectados; fi
  log "muestra t+${t}s: guardadas=$guardadas conectados=$conectados rss ingest=$(mb "$irss")MB worker=$(mb "$wrss")MB"
}

log "== carga local: $NODOS nodos, $LECTURAS lecturas cada $INTERVALO s ($DURACION s) =="
curl -fsS http://127.0.0.1:3000/health > /dev/null || { log "ERROR: el stack no responde en :3000"; exit 1; }
VERSION="$(git rev-parse --short HEAD 2>/dev/null || echo desconocida)"

log "fabricando el lote"
pnpm -s factory lote --cantidad "$NODOS" --version-hw sim --dev > "$CRUDOS/fabrica-$FECHA.txt" 2>&1 || { cat "$CRUDOS/fabrica-$FECHA.txt"; exit 1; }
LOTE="$(grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' "$CRUDOS/fabrica-$FECHA.txt" | head -1)"
IDENTIDADES="$RAIZ/tools/factory/lotes/$LOTE/identidades.json"
INICIO_DB="$(psql_ "select now()")"
log "lote $LOTE · inicio $INICIO_DB"

pnpm -s simulator --identidades "$IDENTIDADES" --nodos "$NODOS" --intervalo "$INTERVALO" --lecturas "$LECTURAS" > "$CRUDOS/simulador-$FECHA.log" 2>&1 &
SIM=$!
T0=$SECONDS

# Cada reinicio se ejecuta en el primer ciclo en que ya pasó su hora (un ciclo puede tardar más de 1 s).
PLAN_T=("$((DURACION * 20 / 100))" "$((DURACION * 40 / 100))" "$((DURACION * 60 / 100))" "$((DURACION * 80 / 100))")
PLAN_S=("ingest" "worker" "ingest worker" "ingest")
SIGUIENTE_PLAN=0
CADA=$((DURACION / 8)); (( CADA < 20 )) && CADA=20
siguiente=$CADA
while kill -0 "$SIM" 2>/dev/null; do
  t=$((SECONDS - T0))
  if (( SIGUIENTE_PLAN < ${#PLAN_T[@]} && t >= PLAN_T[SIGUIENTE_PLAN] )); then
    # shellcheck disable=SC2086
    matar ${PLAN_S[SIGUIENTE_PLAN]}
    SIGUIENTE_PLAN=$((SIGUIENTE_PLAN + 1))
  fi
  if (( t >= siguiente )); then muestra; siguiente=$((siguiente + CADA)); fi
  sleep 1
done
wait "$SIM"
REAL=$((SECONDS - T0))
log "simulador terminado ($REAL s)"
sleep 20 # deja que el worker vacíe la cola
muestra final

PUBLICADAS="$(grep -oE '"lecturasPublicadas":[0-9]+' "$CRUDOS/simulador-$FECHA.log" | tail -1 | cut -d: -f2)"
FILTRO="nodo_id in (select id from app.nodos where lote_id='$LOTE') and recibido_en >= '$INICIO_DB'::timestamptz"
GUARDADAS="$(psql_ "select count(*) from ts.lecturas where $FILTRO")"
DISTINTAS="$(psql_ "select count(*) from (select distinct nodo_id, ts from ts.lecturas where $FILTRO) x")"
HUECOS="$(psql_ "select coalesce(sum(esperadas - reales),0) from (select max(seq)-min(seq)+1 as esperadas, count(*) as reales from ts.lecturas where $FILTRO group by nodo_id) x")"
# El simulador se cierra con una desconexión limpia (publica "offline"): al final los nodos deben figurar desconectados.
DESCONECTADOS="$(psql_ "select count(*) filter (where not conectado) from app.estado_nodo where nodo_id in (select id from app.nodos where lote_id='$LOTE')")"
COLA="$($C exec -T valkey sh -c 'valkey-cli --user worker --pass "$VALKEY_PW_WORKER" --no-auth-warning llen bull:lecturas:wait' 2>/dev/null | tr -d '\r')"
ERRORES_SIM="$(grep -c 'no se pudo conectar' "$CRUDOS/simulador-$FECHA.log")"
RECHAZADAS="$(valor "$(metrica ingest lympha_lecturas_rechazadas_total)")"
[[ "$RECHAZADAS" == "-" || -z "$RECHAZADAS" ]] && RECHAZADAS=0
HEALTH="$(curl -fsS http://127.0.0.1:3000/health 2>/dev/null || echo 'sin respuesta')"

if [[ "$PUBLICADAS" == "$GUARDADAS" && "$GUARDADAS" == "$DISTINTAS" && "$HUECOS" == "0" && "$MIN_CONECTADOS" == "$NODOS" && "$DESCONECTADOS" == "$NODOS" ]]; then
  VEREDICTO="OK"
else
  VEREDICTO="FALLA"
fi

{
  echo "# Prueba de carga local — $FECHA"
  echo
  echo "**Veredicto: $VEREDICTO**"
  echo
  echo "- Commit: \`$VERSION\` · $NODOS nodos · una lectura cada $INTERVALO s · $LECTURAS lecturas por nodo · duración $REAL s"
  echo "- Lote de fábrica: \`$LOTE\` (nodos simulados, reclamados en el espacio de desarrollo)"
  echo
  echo "## Conciliación"
  echo
  echo "| Concepto | Valor |"
  echo "| --- | --- |"
  echo "| Lecturas publicadas con PUBACK | $PUBLICADAS |"
  echo "| Lecturas guardadas | $GUARDADAS |"
  echo "| Distintas (nodo, ts) | $DISTINTAS (duplicados: $((GUARDADAS - DISTINTAS))) |"
  echo "| Huecos de \`seq\` | $HUECOS |"
  echo "| Mínimo de nodos conectados durante la corrida | $MIN_CONECTADOS / $NODOS |"
  echo "| Nodos desconectados tras el cierre limpio del simulador | $DESCONECTADOS / $NODOS |"
  echo "| Mensajes rechazados por ingest (desde su último arranque) | ${RECHAZADAS:-?} |"
  echo "| Cola \`lecturas\` pendiente al final | ${COLA:-?} |"
  echo "| Errores de conexión del simulador | $ERRORES_SIM |"
  echo "| \`/health\` al final | \`$HEALTH\` |"
  echo
  echo "## Reinicios forzados"
  echo
  for e in "${EVENTOS[@]}"; do echo "- $e"; done
  echo
  echo "## Muestras"
  echo
  echo "| t (s) | Guardadas | Conectados | RSS ingest (MB) | RSS worker (MB) |"
  echo "| --- | --- | --- | --- | --- |"
  for m in "${MUESTRAS[@]}"; do echo "$m"; done
  echo
  echo "Los contadores de ingest/worker (rechazadas, huecos) se reinician con cada SIGKILL; la conciliación sale de la base."
} > "$INFORME"

log "== resultado: $VEREDICTO =="
log "informe: $INFORME"
[[ "$VEREDICTO" == "OK" ]]
