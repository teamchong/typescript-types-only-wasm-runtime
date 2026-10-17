#!/bin/sh
# Turn recordings into one video in real time: at second s of the video each
# panel shows the newest frame its checker had finished s seconds into its run,
# so playback speed is the checker's real speed (and, with several, their real
# relative speed). Runs on frames.jsonl wall clocks only.
#
# A frame is one `entry` call; it ends where frames.jsonl says `done`, or
# where `entry` (chunks into the current call) drops, for a return the
# stream's 1s poll missed. Each half shows only finished frames: the screens
# saved mid-call are half-drawn, and showing them made the picture move while
# the frame counter stood still. Numbers are drawn with Pillow because
# Homebrew's ffmpeg has no drawtext.
#
# KEY_SCRIPT=<file> (the one record.sh played) adds a line with the keys held
# for the frame on screen.
#
# Usage: ./side-by-side.sh [out=ts7.mp4] [speedup=10] [checkers=ts7]
#   e.g. ./side-by-side.sh ts6-ts7.mp4 10 "ts6 ts7"
set -e
cd "$(dirname "$0")"
OUT=${1:-ts7.mp4}; SPEED=${2:-10}; CHECKERS=${3:-ts7}; W=$(pwd)/.work
TS6V=$(node -p 'require("typescript-6/package.json").version')
# major.minor only: the 7.1 build is a dev snapshot, but it is shown as 7.1
TS7V=$(node -p 'require("typescript/package.json").version.split(".").slice(0, 2).join(".")')
rm -rf "$W/sbs"; mkdir -p "$W/sbs"
# tsrs and tsc-rs are playground dependencies, not root ones
V() { node -p "require(require.resolve('$1/package.json', { paths: ['../../packages/playground'] })).version"; }
python3 - "$W" "$SPEED" "TS6 $TS6V (tsc, JS)" "TS7 $TS7V (tsgo)" "$CHECKERS" "$KEY_SCRIPT" \
  "tsrs $(V tsrs)" "tsc-rs $(V tsc-rs)" <<'PY'
import json, sys, datetime as dt
from PIL import Image, ImageDraw, ImageFont

w, speed = sys.argv[1], float(sys.argv[2])
names = {"ts6": sys.argv[3], "ts7": sys.argv[4], "tsrs": sys.argv[7], "tsc-rs": sys.argv[8]}
checkers = sys.argv[5].split()
keys = json.load(open(sys.argv[6])) if sys.argv[6] else None
ARROWS = {"ArrowUp": "up", "ArrowDown": "down", "ArrowLeft": "left", "ArrowRight": "right",
          "ShiftLeft": "run", "Space": "use", "ControlLeft": "fire"}
font = ImageFont.truetype("/System/Library/Fonts/Menlo.ttc", 22)

def load(ts):
    rows = [json.loads(l) for l in open(f"{w}/rec-{ts}/frames.jsonl")]
    for r in rows:
        r["t"] = dt.datetime.fromisoformat(r["at"].replace("Z", "+00:00")).timestamp()
    t0 = rows[0]["t"]
    # (time the frame finished, chunk whose screen is the finished frame)
    ends, prev = [], None
    for i, r in enumerate(rows):
        r["t"] -= t0
        e = r.get("entry")
        if r.get("done"):
            ends.append((r["t"], r["chunk"]))
        elif e is not None and prev is not None and e < prev and not rows[i - 1].get("done"):
            # r is already the next call's first chunk; the frame is the one before
            ends.append((r["t"], rows[i - 1]["chunk"]))
        if e is not None: prev = e
    return rows, ends

runs = {ts: load(ts) for ts in checkers}
# the video ends when the fastest checker's recording ends; the others are
# recorded for at least as long and show how far they got by then
length = min(rows[-1]["t"] for rows, _ in runs.values())

def half(ts, s):
    rows, ends = runs[ts]
    done = [e for e in ends if e[0] <= s]
    # before the first frame finishes, the resumed checkpoint's screen
    chunk = done[-1][1] if done else rows[0]["chunk"]
    img = Image.open(f"{w}/rec-{ts}/{chunk:06d}.png").convert("RGB").resize((960, 600), Image.NEAREST)
    n = len(done)
    t_last = done[-1][0] if done else 0.0
    took = f"{t_last - (done[-2][0] if n > 1 else 0.0):.0f}s" if done else "-"
    # frames finished / wall seconds to the last one; 3 significant digits
    # because a frame takes minutes and fixed decimals would round it to 0.00
    avg = f"{n / t_last:.3g} fps ({t_last / n:.0f} s/frame)" if done else "- fps"
    lines = [
        names[ts],
        f"frame {n}   took {took}",
        avg,
        f"drawing frame {n + 1}: {s - t_last:.0f}s so far",
        f"t {int(s) // 3600}:{int(s) // 60 % 60:02d}:{int(s) % 60:02d}   {speed:g}x",
    ]
    if keys is not None:
        # the screen on show is frame n - 1, drawn with that entry's keys held
        held = keys[n - 1] if 0 < n <= len(keys) else []
        lines.append("keys " + (" ".join(ARROWS.get(k, k) for k in held) or "-"))
    d = ImageDraw.Draw(img)
    box = d.multiline_textbbox((10, 10), "\n".join(lines), font=font, spacing=4)
    d.rectangle((box[0] - 6, box[1] - 6, box[2] + 6, box[3] + 6), fill=(0, 0, 0))
    d.multiline_text((10, 10), "\n".join(lines), font=font, fill=(255, 255, 255), spacing=4)
    return img

# 5 images per video second, each a step of speed/5 run seconds
n = int(length / speed * 5)
for i in range(n + 1):
    s = i * speed / 5
    out = Image.new("RGB", (960 * len(checkers), 600))
    for j, ts in enumerate(checkers):
        out.paste(half(ts, s), (960 * j, 0))
    out.save(f"{w}/sbs/{i:06d}.png")
print(f"{n / 5:.0f}", file=open(f"{w}/sbs/count", "w"))
PY
ffmpeg -y -loglevel error -framerate 5 -i "$W/sbs/%06d.png" -vf fps=30 -pix_fmt yuv420p "$OUT"
echo "$OUT: $(cat "$W/sbs/count")s"
