#!/bin/bash
set -euo pipefail
RUN_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$RUN_DIR"
PID=$(cat logs/generate.pid)
echo "[chain] waiting for generate pid=$PID"
while kill -0 "$PID" 2>/dev/null; do sleep 30; done
echo "[chain] generate exited"
if ! rg -q '"rows": 1000' logs/generate.log && ! rg -q '1000/1000 \(100' logs/generate.log; then
  echo "[chain] generate did not complete successfully" >&2
  tail -80 logs/generate.log >&2
  exit 1
fi
echo "[chain] starting fairness audit"
stdbuf -oL -eL node fairness-audit.mjs > logs/fairness-audit.log 2>&1 || {
  echo "[chain] fairness audit failed" >&2
  tail -40 logs/fairness-audit.log >&2
  exit 1
}
echo "[chain] starting approve-and-eval"
export TB_HIGH_CONCURRENCY="${TB_HIGH_CONCURRENCY:-10}"
export TB_MODEL_CONCURRENCY="${TB_MODEL_CONCURRENCY:-3}"
stdbuf -oL -eL node approve-and-eval.mjs > logs/eval.log 2>&1
echo "[chain] eval done"
tail -30 logs/eval.log
