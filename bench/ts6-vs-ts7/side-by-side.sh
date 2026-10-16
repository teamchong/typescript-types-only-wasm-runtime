#!/bin/sh
# Join two recordings into one video, each screen held for as long as that
# checker actually took to produce the next one, so playback speed is the
# checkers' real relative speed. Runs on frames.jsonl wall clocks only.
#
# Usage: ./side-by-side.sh [out=ts6-vs-ts7.mp4] [speedup=1]
set -e
cd "$(dirname "$0")"
OUT=${1:-ts6-vs-ts7.mp4}; SPEED=${2:-1}; W=$(pwd)/.work
for TS in ts6 ts7; do
  python3 - "$W/rec-$TS" "$SPEED" > "$W/rec-$TS.concat" <<'PY'
import json, sys, datetime as dt
d, speed = sys.argv[1], float(sys.argv[2])
rows = [json.loads(l) for l in open(f"{d}/frames.jsonl")]
t = [dt.datetime.fromisoformat(r["at"].replace("Z", "+00:00")).timestamp() for r in rows]
for i, r in enumerate(rows):
    hold = (t[i + 1] - t[i]) if i + 1 < len(rows) else 1.0
    print(f"file '{d}/{r['chunk']:06d}.png'\nduration {hold / speed:.3f}")
print(f"file '{d}/{rows[-1]['chunk']:06d}.png'")
PY
done
LEN=$(python3 -c "
import re;f=lambda p:sum(float(x) for x in re.findall(r'duration ([\d.]+)',open(p).read()))
print(min(f('$W/rec-ts6.concat'),f('$W/rec-ts7.concat')))")
# Left is TS6, right is TS7. Labels need an ffmpeg built with freetype
# (drawtext); Homebrew's default ffmpeg has none, so skip them there.
if ffmpeg -hide_banner -filters 2>/dev/null | grep -q " drawtext "; then
  label() { echo ",drawtext=text='$1':x=8:y=8:fontsize=28:fontcolor=white:box=1:boxcolor=black@0.6"; }
else label() { :; }; fi
ffmpeg -y -loglevel error \
  -f concat -safe 0 -i "$W/rec-ts6.concat" -f concat -safe 0 -i "$W/rec-ts7.concat" \
  -filter_complex "[0]fps=30,scale=960:600:flags=neighbor$(label 'TS6 6.0.3 (tsc, JS)')[a];[1]fps=30,scale=960:600:flags=neighbor$(label "TS7 $(node -p 'require("typescript/package.json").version') (tsgo)")[b];[a][b]hstack" \
  -t "$LEN" -pix_fmt yuv420p "$OUT"
echo "$OUT: ${LEN}s"
