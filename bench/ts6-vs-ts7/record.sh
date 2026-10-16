#!/bin/sh
# Record one checker painting doom, from the checked-in checkpoint.
#
# The driver saves a checkpoint after every chunk; stream.ts decodes the screen
# out of each one and, with RECORD set, keeps a png per changed screen plus
# frames.jsonl with the wall clock of each. Both checkers start from the same
# seed with no input, so they compute the same frames; only the clock differs.
#
# Usage: ./record.sh ts6|ts7 [minutes=20]     (FUEL=12288, SEED=e1m1.json.gz)
set -e
cd "$(dirname "$0")"
TS=${1:?ts6 or ts7}; MIN=${2:-20}; FUEL=${FUEL:-12288}; SEED=$(cd "$(dirname "${SEED:-e1m1.json.gz}")" && pwd)/$(basename "${SEED:-e1m1.json.gz}")
PG=$(cd ../../packages/playground && pwd)
W=$(pwd)/.work; REC=$W/rec-$TS; CK=$W/rec-$TS.json
rm -rf "$REC" "$CK" "$CK".*; mkdir -p "$REC"
gzip -dc "$SEED" > "$CK"
N="node --stack-size=16384 --max-old-space-size=16384 --import tsx/esm"
cd "$PG"
RECORD="$REC" $N ./doom/stream.ts "$CK" "${PORT:-$((8800 + ${TS#ts}))}" > "$W/rec-$TS.stream.log" 2>&1 & S=$!
trap 'kill $S $D 2>/dev/null' EXIT INT TERM
TS_CHECKER=$TS $N ./cfg/drive.ts ./doom/doom-keys.cfg.ts entry --resume "$CK" --save "$CK" --every 1 \
  --fuel "$FUEL" --max 100000000 > "$W/rec-$TS.drive.log" 2>&1 & D=$!
sleep $((MIN * 60))
kill $D 2>/dev/null; sleep 2
echo "$TS: $(ls "$REC"/*.png 2>/dev/null | wc -l | tr -d ' ') screens in $REC"
