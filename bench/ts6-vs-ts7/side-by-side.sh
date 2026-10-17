#!/bin/sh
# Join two recordings into one video in real time: at second s of the video
# each half shows the newest frame its checker had finished s seconds into its
# run, so playback speed is the checkers' real relative speed. Runs on
# frames.jsonl wall clocks only.
#
# A frame is one `entry` call; it ends where frames.jsonl says `done`, or
# where `entry` (chunks into the current call) drops, for a return the
# stream's 1s poll missed. Each half shows only finished frames: the screens
# saved mid-call are half-drawn, and showing them made the picture move while
# the frame counter stood still. Numbers are drawn with Pillow because
# Homebrew's ffmpeg has no drawtext.
#
# Usage: ./side-by-side.sh [out=ts6-vs-ts7.mp4] [speedup=10]
set -e
cd "$(dirname "$0")"
OUT=${1:-ts6-vs-ts7.mp4}; SPEED=${2:-10}; W=$(pwd)/.work
TS6V=$(node -p 'require("typescript-6/package.json").version')
# major.minor only: the 7.1 build is a dev snapshot, but it is shown as 7.1
TS7V=$(node -p 'require("typescript/package.json").version.split(".").slice(0, 2).join(".")')
rm -rf "$W/sbs"; mkdir -p "$W/sbs"
python3 - "$W" "$SPEED" "TS6 $TS6V (tsc, JS)" "TS7 $TS7V (tsgo)" <<'PY'
import json, sys, datetime as dt
from PIL import Image, ImageDraw, ImageFont

w, speed = sys.argv[1], float(sys.argv[2])
names = {"ts6": sys.argv[3], "ts7": sys.argv[4]}
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

runs = {ts: load(ts) for ts in ("ts6", "ts7")}
# the video ends when the faster checker (TS7) finishes the script; TS6 is
# recorded for at least as long and shows how far it got by then
length = runs["ts7"][0][-1]["t"]

def half(ts, s):
    rows, ends = runs[ts]
    done = [e for e in ends if e[0] <= s]
    # before the first frame finishes, the resumed checkpoint's screen
    chunk = done[-1][1] if done else rows[0]["chunk"]
    img = Image.open(f"{w}/rec-{ts}/{chunk:06d}.png").convert("RGB").resize((960, 600), Image.NEAREST)
    n = len(done)
    t_last = done[-1][0] if done else 0.0
    took = f"{t_last - (done[-2][0] if n > 1 else 0.0):.0f}s" if done else "-"
    # a frame takes minutes, so fps would read 0.00x; seconds per frame instead
    avg = f"{t_last / n:.0f} s/frame avg" if done else "- s/frame avg"
    lines = [
        names[ts],
        f"frame {n}   took {took}   {avg}",
        f"drawing frame {n + 1}: {s - t_last:.0f}s so far",
        f"t {int(s) // 3600}:{int(s) // 60 % 60:02d}:{int(s) % 60:02d}   {speed:g}x",
    ]
    d = ImageDraw.Draw(img)
    box = d.multiline_textbbox((10, 10), "\n".join(lines), font=font, spacing=4)
    d.rectangle((box[0] - 6, box[1] - 6, box[2] + 6, box[3] + 6), fill=(0, 0, 0))
    d.multiline_text((10, 10), "\n".join(lines), font=font, fill=(255, 255, 255), spacing=4)
    return img

# 5 images per video second, each a step of speed/5 run seconds
n = int(length / speed * 5)
for i in range(n + 1):
    s = i * speed / 5
    out = Image.new("RGB", (1920, 600))
    out.paste(half("ts6", s), (0, 0))
    out.paste(half("ts7", s), (960, 0))
    out.save(f"{w}/sbs/{i:06d}.png")
print(f"{n / 5:.0f}", file=open(f"{w}/sbs/count", "w"))
PY
ffmpeg -y -loglevel error -framerate 5 -i "$W/sbs/%06d.png" -vf fps=30 -pix_fmt yuv420p "$OUT"
echo "$OUT: $(cat "$W/sbs/count")s"
