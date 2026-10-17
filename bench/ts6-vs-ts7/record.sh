#!/bin/sh
# Record one checker painting doom, from the checked-in checkpoint.
#
# The driver saves a checkpoint after every chunk; stream.ts decodes the screen
# out of each one and, with RECORD set, keeps a png per changed screen plus
# frames.jsonl with the wall clock of each. The gameplay is hardcoded: KEYS are
# held from the first chunk (the driver writes them into Doom's input word every
# chunk), so both checkers see the same input on the same chunk and compute the
# same frames; only the clock differs.
#
# KEY_SCRIPT=<file> plays a per-frame script instead (see kill.keys.json): the
# driver holds entry i's keys for frame i and exits when the script ends, so the
# recording stops there or at the time limit, whichever is first.
#
# Usage: ./record.sh ts6|ts7 [minutes=20]
#   (FUEL=12288, SEED=e1m1.json.gz, KEYS='"ArrowUp"', KEY_SCRIPT=, SECS=minutes*60)
set -e
cd "$(dirname "$0")"
TS=${1:?ts6 or ts7}; MIN=${2:-20}; SECS=${SECS:-$((MIN * 60))}; FUEL=${FUEL:-12288}; SEED=$(cd "$(dirname "${SEED:-e1m1.json.gz}")" && pwd)/$(basename "${SEED:-e1m1.json.gz}")
PG=$(cd ../../packages/playground && pwd)
W=$(pwd)/.work; REC=$W/rec-$TS; CK=$W/rec-$TS.json
rm -rf "$REC" "$CK" "$CK".*; mkdir -p "$REC"
gzip -dcf "$SEED" > "$CK"
[ -n "$KEY_SCRIPT" ] && KEY_SCRIPT=$(cd "$(dirname "$KEY_SCRIPT")" && pwd)/$(basename "$KEY_SCRIPT")
N="node --stack-size=16384 --max-old-space-size=16384 --import tsx/esm"
cd "$PG"
RECORD="$REC" $N ./doom/stream.ts "$CK" "${PORT:-$((8800 + ${TS#ts}))}" > "$W/rec-$TS.stream.log" 2>&1 & S=$!
trap 'kill $S $D 2>/dev/null' EXIT INT TERM
# stream.ts clears <ck>.input when it starts; the keys go in after that, at a
# rev no page reaches, and before the driver's first read
while [ ! -f "$CK.input" ]; do sleep 0.2; done
echo "{\"rev\":1000000,\"keys\":[${KEYS:-\"ArrowUp\"}]}" > "$CK.input"
TS_CHECKER=$TS KEY_SCRIPT=$KEY_SCRIPT $N ./cfg/drive.ts ./doom/doom-keys.cfg.ts entry --resume "$CK" --save "$CK" --every 1 \
  --fuel "$FUEL" --max 100000000 > "$W/rec-$TS.drive.log" 2>&1 & D=$!
T0=$(date +%s)
while kill -0 $D 2>/dev/null && [ $(($(date +%s) - T0)) -lt "$SECS" ]; do sleep 2; done
echo "$TS: ran $(($(date +%s) - T0))s"
kill $D 2>/dev/null; sleep 2
echo "$TS: $(ls "$REC"/*.png 2>/dev/null | wc -l | tr -d ' ') screens in $REC"
