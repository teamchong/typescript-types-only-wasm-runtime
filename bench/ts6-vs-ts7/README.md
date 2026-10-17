# Doom in the type system: TS6 vs TS7

Same Doom, same seed, same driver, two checkers. Doom runs as WebAssembly
evaluated purely by type resolution; the checker that resolves types faster
plays faster.

| | TS6 (`tsc`, JS) | TS7 (`tsgo`) | TS7 vs TS6 |
|---|---|---|---|
| version | 6.0.3 | 7.1.0-dev.20261015.1 | |
| first chunk (parse 107MB module + first resolve) | 492-515s | 16.3-16.9s | **~31x** |
| warm throughput, 3 reps, fuel 12288 | 313-316 units/s | 2332-2427 units/s | **~7.5x** |
| highest fuel it holds | 9216 (drops from 12288, see below) | 24576+ | |
| 20 min of recording, from the same checkpoint | 13 chunks, 15 screens | 120 chunks, 128 screens | |
| reaches the same screen | at 872s | at 58s | **15x** |

`units/s` = wasm instructions executed per second through the type system
(what `packages/playground/cfg/drive.ts` prints), counted from chunk 2 on, wall
time including any retries. Spread is min-max of 3 interleaved reps.

Measured 2026-10-16 on an Apple M4 Pro, 48 GB, macOS (darwin 25.6.0),
Node v22.23.0.

## Video

`./side-by-side.sh` joins the two recordings, holding each screen for as long
as that checker really took to produce the next one. Left is TS6, right is TS7.
Playback speed is their real relative speed.
Each half shows its checker's frames done, fps over the run so far, and how
long the last frame took (frame ends come from `entry`/`done` in frames.jsonl).

## Run it

```sh
pnpm install                      # repo root, once
cd bench/ts6-vs-ts7
./fps.sh 3 10                     # table: 3 interleaved reps, 10 chunks each
FUEL=12288 ./fps.sh 3 10          # the row above
FUEL6=6144 FUEL7=12288 ./fps.sh   # each checker at its own fuel
./record.sh ts7 20                # 20 min recording -> .work/rec-ts7/
./record.sh ts6 20                # run one at a time, never both at once
KEYS='"ArrowUp","ArrowRight"' ./record.sh ts7 20  # other hardcoded input
./side-by-side.sh                 # -> ts6-vs-ts7.mp4 (needs ffmpeg)
```

A full `fps.sh 3 10` takes ~40 min, almost all of it TS6. Outputs land in
`.work/` (gitignored). Every run starts from `e1m1.json.gz`, a checkpoint in
game on E1M1 at Doom's default view size, so nothing is precomputed past it.
`record.sh` holds `KEYS` (default `ArrowUp`, walk forward) from the first
chunk, so both checkers get the same input on the same chunk and play the same
frames; without input the game sits still and the video shows one view.

## How TS6 is driven

TS7 is driven over its sync API (`typescript/unstable/sync`). TS6 has none, so
`TS_CHECKER=ts6` (`packages/playground/evaluate/ts6.ts`) uses the classic
in-process API to do the same thing:

```text
TS7: API.createSnapshot -> project.checker.getTypeFromTypeNode -> typeToString(.., NoTruncation)
TS6: ts.createProgram   -> program.getTypeChecker().getTypeFromTypeNode -> typeToString(.., NoTruncation)
```

Both run under `node --stack-size=16384 --max-old-space-size=16384`. Neither
checker is patched: `patches/` only patches `type-testing`; the
`tsgo-*.patch` files there are not applied to the npm `tsgo`.

## TS6 fuel limit

Fuel is how many wasm instructions one chunk runs before the type suspends. At
higher fuel TS6 hits its instantiation/depth limits and the driver halves fuel
and retries (`fuel changed:` in the table output), then climbs back:

```text
start 24576 -> 12288
start 16384 ->  8192 -> 12288
start 12288 ->  6144 ->  9216
start  8192 ->  4096 ->  6144
start  6144 ->  3072 ->  4608
```

The driver never weakens the computation to fit: a chunk that fails is re-run
from its start with less fuel, and every chunk must land on the same result.
At low fuel TS6 gets much slower per instruction, not faster: starting at 6144
it measured 30-33 units/s, against TS7's 1584-1620 at the same setting (~50x).
