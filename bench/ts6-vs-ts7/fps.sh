#!/bin/sh
# Doom throughput, TS6 against TS7, same seed, same chunk count, same fuel.
#
# Each rep runs both checkers back to back, alternating which goes first, so
# drift (thermals, background load) lands on both. Chunk 1 is reported apart:
# it carries parsing the 107MB module declaration and, for TS7, starting tsgo.
# warm units/s = wasm instructions per second from chunk 2 on.
#
# Usage: ./fps.sh [reps=3] [chunks=8]
#   FUEL=24576           fuel for both checkers (driver default)
#   FUEL6=... FUEL7=...  per-checker override, for "each at its best fuel"
#   SEED=e1m1.json.gz    in game on E1M1, Doom's default view size
set -e
cd "$(dirname "$0")"
REPS=${1:-3}; N=${2:-8}
FUEL=${FUEL:-24576}; FUEL6=${FUEL6:-$FUEL}; FUEL7=${FUEL7:-$FUEL}
MODULE=${MODULE:-doom/doom-keys.cfg.ts}
PG=$(cd ../../packages/playground && pwd)
W=$(pwd)/.work; mkdir -p "$W"
gzip -dc "${SEED:-e1m1.json.gz}" > "$W/seed.json"

run() { # checker fuel -> one result row
  cp "$W/seed.json" "$W/run-$1.json"
  log="$W/run-$1.log"
  (cd "$PG" && TS_CHECKER=$1 node --stack-size=16384 --max-old-space-size=16384 --import tsx/esm \
     ./cfg/drive.ts "./$MODULE" entry --resume "$W/run-$1.json" --save "$W/run-$1.json" --every 1 --max "$N" --fuel "$2") \
     2>&1 | tr '\r' '\n' > "$log" || true
  python3 - "$1" "$2" "$N" "$log" <<'PY'
import re, sys
checker, fuel, n, log = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), open(sys.argv[4]).read()
end = re.search(r"(\d+) chunks in ([\d.]+)s \((\d+) fuel units", log)
# per accepted chunk: its fuel and the running s/chunk average the driver prints
rows = [(int(f), float(t)) for f, t in re.findall(r"chunk \d+: suspended in .*?fuel (\d+), ([\d.]+)s/chunk", log)]
if not end or len(rows) < 2:
    err = re.search(r"(Error: .*|RangeError.*|FATAL.*)", log)
    print(f"{checker:5} {fuel:6} FAILED  {err.group(1)[:90] if err else 'under 2 chunks, see ' + sys.argv[4]}")
    sys.exit()
total, t1 = float(end.group(2)), rows[0][1]
warm_units = sum(f for f, _ in rows[1:])
note = "" if all(f == fuel for f, _ in rows) else "  fuel changed: " + ",".join(str(f) for f, _ in rows)
if "-> " in log.split("fuel units")[-1]: note += "  frame returned"
print(f"{checker:5} {fuel:6} {t1:8.2f} {(total - t1) / len(rows[1:]):10.2f} {warm_units / (total - t1):10.0f} {total:8.2f}{note}")
PY
}

echo "reps=$REPS chunks=$N module=$MODULE  ts6=$(node -p 'require("typescript-6/package.json").version')  ts7=$(node -p 'require("typescript/package.json").version')"
printf '%-5s %6s %8s %10s %10s %8s\n' TS fuel chunk1_s warm_s/chk warm_u/s total_s
for r in $(seq 1 "$REPS"); do
  if [ -n "$ONLY" ]; then run "$ONLY" "$FUEL"; elif [ $((r % 2)) -eq 1 ]; then run ts7 "$FUEL7"; run ts6 "$FUEL6"; else run ts6 "$FUEL6"; run ts7 "$FUEL7"; fi
done
