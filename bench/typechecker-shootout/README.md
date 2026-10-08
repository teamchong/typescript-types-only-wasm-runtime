# Type checker shootout: tsrs vs bun check vs tsc-rs vs tsgo vs TypeRunner

Which TypeScript checker runs doom-in-types fastest? Everything here is
runnable, built from each project's **git HEAD**, so you can reproduce the
numbers or fix a candidate that falls short.

**Headline: tsrs is ~1.5x faster than tsgo on a real doom chunk and computes the
same answer — but it cannot drive the game yet.** One API gap stands between it
and a 1.5x fps win; there is a one-command repro below.

## Results (2026-10-08, macOS arm64)

One real doom chunk: the 67MB generated module, the memory state as a literal
type, and one forced resolution. Seed is the checked-in
`doom/first-frame.json.gz`. `tag` is the chunk's computed result, so **all
checkers must agree or one of them is wrong.** Best of 2-3 cold runs.

| Checker | fuel 4096 | fuel 8192 | fuel 24576 (live setting) | tag | vs tsgo |
|---|---|---|---|---|---|
| **tsrs** (git fcb9803) | **0.66s** | **0.62s** | **0.65s** | `s` | **1.5x faster** |
| **tsgo** (git 89d5d5b2) | 1.02s | 1.01s | 0.98s | `s` | baseline |
| **tsc-rs** (npm 0.1.0) | 2.68s | 3.39s | 9.50s | `s` | 2.6x-9.7x slower |
| **bun check** (canary 1.4.3) | 7.06s | 7.53s **TS2589** | 7.74s **TS2589** | — | 7x slower, and gives up |
| **TypeRunner** | — | — | — | — | incompatible |

### Can it drive the game? (the fps question)

The driver reads results out of the type system over the checker's sync API:
`createSnapshot` -> `getProject` -> `getTypeFromTypeNode` -> `typeToString(..,
NoTruncation)` (`packages/playground/evaluate/ts.ts`, selected by `$TSGO_BIN`).
doom's memory comes back as that text, ~1-4MB per chunk, so scraping error
output is not an option: diagnostics truncate.

| Checker | Drives the game | Throughput | Blocker |
|---|---|---|---|
| **tsgo** | **yes** | **5033 units/s** at fuel 24576, warm session | — |
| **tsrs** | no | would be ~1.5x tsgo if fixed | sync API: `api: client error: snapshot 0 not found` |
| **tsc-rs** | no | n/a | same: `api: client error: snapshot 0 not found` |
| **bun check** | no | n/a | no API to resolve and print a type; CLI diagnostics only |
| **TypeRunner** | no | n/a | see `candidates/typerunner/BUILD-NOTES.txt` |

`units/s` is wasm instructions per second executed through the type system,
which is what `packages/playground/cfg/drive.ts` reports. Cold per-chunk times
above are startup-dominated; the game keeps one checker session warm.

**tsrs is the one worth fixing.** It already resolves chunks faster than tsgo
and to the same answers, and its own docs report 906/906 upstream SDK tests
passing, with `getTypeFromTypeNode` and `typeToString` marked *partial*
("not byte-compared end-to-end"). Repro the blocker in one command:

```sh
node repro-api.mjs candidates/tsrs/api-shim.sh   # FAIL: snapshot 0 not found
node repro-api.mjs                               # PASS: prints 5 (tsgo control)
```

Notes from chasing it, so nobody repeats the work:
- tsrs only accepts `--api`; the older sync client spawns `<bin> api ...`.
  `candidates/tsrs/api-shim.sh` translates, so that is not the blocker.
- The client API changed: `<=7.1.0-dev.20260822` is `updateSnapshot(params)`,
  `>=20260929` requires `createSnapshot(params)` first. `repro-api.mjs` handles
  both. This project pins 20260822; tsrs ports microsoft/TypeScript@b85298b6a81f
  (~20260929).
- Paired with the matching 20260929 client, tsrs instead fails
  `panic: jsontext: unexpected EOF`, i.e. the sync/MessagePack path decodes as
  JSON. The async (JSON-RPC) path is untested here.

## Run it

```sh
pnpm install                        # once, at the repo root

./run-all.sh                        # language-feature gate, all candidates
./bench-doom.sh 24576               # time a real doom chunk, per checker
./bench-fps.sh 8                    # game throughput, for checkers that can drive it
./play-with.sh tsgo                 # PLAY, browser UI on :8787
./play-with.sh tsrs --max 5         # ...or headless; shows tsrs's blocker
node repro-api.mjs [checker-bin]    # the minimal API requirement
```

Candidates build themselves from git on first run and cache in their own folder:
tsrs and tsc-rs need `cargo`, tsgo needs `go`. `bun check` uses the canary
release, which is built from `main` (building Bun from source needs Zig + a
WebKit checkout and takes hours). Nothing here touches your save game.

## Language-feature gate

Run before any timing: the features doom's emitted module depends on. All four
working checkers pass; this exists to catch a checker that looks fast because it
skipped the computation.

| Candidate | default type params | tail recursion | template-literal `infer` | variadic tuple + index |
|---|---|---|---|---|
| tsrs | PASS | PASS | PASS | PASS |
| tsgo | PASS | PASS | PASS | PASS |
| tsc-rs | PASS | PASS | PASS | PASS |
| bun check | PASS | PASS | PASS | PASS |
| TypeRunner | n/a | n/a | n/a | n/a |

Each case is a pair of standalone projects: `tests/<case>/ok` asserts the
**correct** value and must report no error; `tests/<case>/bad` asserts a **wrong**
one and must report an error. Both are required to PASS.

- `FAIL(ok!)` rejected valid code
- `FAIL(blind)` accepted the wrong answer, i.e. never evaluated

Three traps this design avoids, each of which gave a wrong reading first:
TypeScript prints a type's **alias name** (`X`), not its expansion, so grepping
error text for a computed value fails; a project checker given a bare file path
checks every sibling as one program ("Duplicate identifier"); and `bun check`'s
success message "No type errors found :)" contains the substring "error".

## Who's who

- **tsrs** = `github.com/maschwenk/tsrs`, npm `@maschwenk/tsrs`. "Rust port of
  the TypeScript 7 type checker." Active (pushed daily), so build from git.
- **tsc-rs** = `github.com/pingdotgg/ts-rust`, npm `tsc-rs`. A *different* Rust
  port of TS7.
- **bun check** exists only in **canary** (>=1.4.3). Stable 1.4.2 has no `check`
  subcommand.
- **tsgo** = `github.com/microsoft/typescript-go` (archived Sept 2026; TS7 work
  continues in microsoft/TypeScript). The npm release is what this project uses.
- **TypeRunner** = `github.com/marcj/TypeRunner`. Incompatible, see its
  BUILD-NOTES.txt.
- **ts-rs** (not included) generates TypeScript definitions *from Rust structs*.
  Not a type checker.

## Adding or fixing a candidate

Drop in `candidates/<name>/adapter.sh`:

- `adapter.sh --probe` prints `AVAILABLE <version>` or `UNAVAILABLE: <reason>`
- `adapter.sh <project-dir>` type-checks that tsconfig project, diagnostics to
  stdout, exit code ignored; strip ANSI if the tool colourises

Then `./run-all.sh <name>` and `./bench-doom.sh 24576`.
