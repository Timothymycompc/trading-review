#!/usr/bin/env bash
# Runs scripts/backtest.ts in Cloud Build, one build per shard, all at once (each build has its own
# GeckoTerminal allowance). Results land in gs://x300-506418_cloudbuild/backtest/<run>/shardN.json.
#   bash scripts/backtest-cloud.sh <dir with shard0..shardN/coins.json> <run name>
set -euo pipefail
cd "$(dirname "$0")/.."
DIR=$1; RUN=$2
npx esbuild scripts/backtest.ts --bundle --platform=node --format=cjs --external:pg-native --outfile="$DIR/backtest.cjs" --log-level=warning
cat > "$DIR/cloudbuild.yaml" <<'EOF'
steps:
  - name: node:20
    entrypoint: bash
    env: ["BACKTEST_SAVE_TO=gs://x300-506418_cloudbuild/backtest/${_RUN}/${_SHARD}.json"]
    args: ["-c", "node --no-deprecation backtest.cjs fetch ${_SHARD}"]
timeout: 86400s
options:
  logging: CLOUD_LOGGING_ONLY
EOF
# Upload the package once (a phone upload per build hangs), then start every build from that copy.
SRC="gs://x300-506418_cloudbuild/backtest/src/$RUN.tgz"
tar czf "$DIR.tgz" -C "$DIR" --exclude='*.tgz' .
gcloud storage cp "$DIR.tgz" "$SRC" --quiet
for d in "$DIR"/shard*; do
  s=$(basename "$d")
  timeout 60 gcloud builds submit "$SRC" --config "$DIR/cloudbuild.yaml" --substitutions "_SHARD=$s,_RUN=$RUN" --async --format='value(id)' 2>&1 | tail -1 | sed "s/^/$s /"
done
