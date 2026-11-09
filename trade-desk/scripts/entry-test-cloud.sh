#!/usr/bin/env bash
# Runs scripts/entry-test.ts in Cloud Build on a finished backtest run's saved candles (gs://.../backtest/<run>/),
# so the 81 MB of candles never come to the phone.
#   bash scripts/entry-test-cloud.sh <dir with coins.json> <run name> ages    pool ages, 4 builds at once (~40 min),
#                                                                             saved in gs://.../backtest/<run>/ages/
#   bash scripts/entry-test-cloud.sh <dir with coins.json> <run name>         the test, using the saved ages;
#                                                                             results in gs://.../backtest/<run>/entry-test/
#   bash scripts/entry-test-cloud.sh <dir with coins.json> <run name> quick   the test without ages (entry-test-quick/)
set -euo pipefail
cd "$(dirname "$0")/.."
DIR=$1; RUN=$2; MODE=${3:-}; COSTX=${4:-}   # 4th argument: cost per side (e.g. 0.022), results in entry-test-cost<x>/
PULL=${5:-}                                 # 5th argument: 1 = write off silent PumpSwap pools too, results in ...-pull/
B=gs://x300-506418_cloudbuild/backtest
PKG=$(mktemp -d)
npx esbuild scripts/entry-test.ts --bundle --platform=node --format=cjs --external:pg-native --outfile="$PKG/entry-test.cjs" --log-level=warning
cp "$DIR/coins.json" "$PKG/coins.json"

if [ "$MODE" = ages ]; then
  printf '%s\n' \
    'steps:' \
    '  - name: node:20' \
    '    entrypoint: bash' \
    '    args: ["-c", "node --no-deprecation entry-test.cjs ages . out ${_SHARD} 4"]' \
    '  - name: gcr.io/cloud-builders/gsutil' \
    '    args: ["-q", "cp", "out/*", "gs://x300-506418_cloudbuild/backtest/${_RUN}/ages/"]' \
    'timeout: 7200s' \
    'options:' \
    '  logging: CLOUD_LOGGING_ONLY' > "$PKG/ages.yaml"
  SRC="$B/src/entry-ages-$RUN.tgz"
  tar czf "$PKG.tgz" -C "$PKG" .
  gcloud storage cp "$PKG.tgz" "$SRC" --quiet
  for i in 0 1 2 3; do timeout 60 gcloud builds submit "$SRC" --config "$PKG/ages.yaml" --substitutions "_RUN=$RUN,_SHARD=$i" --async --format='value(id)'; done
  echo "Ages when done: gcloud storage ls $B/$RUN/ages/"
  exit 0
fi

QUICK=""; OUT=""
if [ "$MODE" = quick ]; then QUICK=1; OUT=-quick; fi
if [ -n "$COSTX" ]; then OUT="$OUT-cost$COSTX"; fi
if [ -n "$PULL" ]; then OUT="$OUT-pull"; fi
printf '%s\n' \
  'steps:' \
  '  - name: gcr.io/cloud-builders/gsutil' \
  '    entrypoint: bash' \
  "    args: [\"-c\", \"mkdir -p /workspace/data && gsutil -m -q cp 'gs://x300-506418_cloudbuild/backtest/\${_RUN}/*-candles-*.json' /workspace/data/ && (gsutil -m -q cp 'gs://x300-506418_cloudbuild/backtest/\${_RUN}/ages/*.json' /workspace/data/ || true)\"]" \
  '  - name: node:20' \
  '    entrypoint: bash' \
  '    args: ["-c", "cp coins.json data/ && SKIP_AGES=${_QUICK} COST=${_COST} PUMPSWAP_PULL=${_PULL} node --no-deprecation --max-old-space-size=6000 entry-test.cjs data out"]' \
  '  - name: gcr.io/cloud-builders/gsutil' \
  '    args: ["-q", "cp", "out/*", "gs://x300-506418_cloudbuild/backtest/${_RUN}/entry-test${_OUT}/"]' \
  'timeout: 7200s' \
  'options:' \
  '  machineType: E2_HIGHCPU_8' \
  '  logging: CLOUD_LOGGING_ONLY' > "$PKG/cloudbuild.yaml"
SRC="$B/src/entry-test-$RUN$OUT.tgz"
tar czf "$PKG.tgz" -C "$PKG" .
gcloud storage cp "$PKG.tgz" "$SRC" --quiet
timeout 60 gcloud builds submit "$SRC" --config "$PKG/cloudbuild.yaml" --substitutions "_RUN=$RUN,_QUICK=$QUICK,_OUT=$OUT,_COST=${COSTX:-0.01},_PULL=$PULL" --async --format='value(id)'
echo "Summary when done: gcloud storage cat $B/$RUN/entry-test$OUT/entry-test.txt"
