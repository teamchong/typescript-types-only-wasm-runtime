# Running pong inside the type checker

`pnpm arcade` compiles `pong-tiny.wasm` into TypeScript types and plays it. Each
frame is **one type evaluation**: the host hands the previous frame's memory in
as a type argument, `tsgo` computes the next frame, and the bytes that come back
are drawn as characters. Roughly **4 frames per second**.

```
  pong, running inside the TypeScript type checker
  +----------------------------------------+
  |                    |                   |
  | =                  |                   |
  | =                  |         00      = |
  | =                  |         00      = |
  |                    |                 = |
  +----------------------------------------+
  0 - 0   frame 12   3.7 fps   1 evaluation   state 9.5kB
```

- `pnpm arcade` - play it (`w`/`s` to move, `q` to quit)
- `pnpm arcade:verify` - run the same wasm in V8 and compare every frame byte for byte
- `pnpm arcade:conform` - compile and check every module in `conformance-tests` against the engine
- `pnpm arcade:ceiling` - measure how much work one type evaluation can do

Current state: **64/64 supported modules and every pong frame are identical to the
wasm engine** (`pnpm arcade:conform`), conway included. Unsupported so far: i64,
floats, `call_indirect`, and imported-function calls.

## How it works

`cargo run -- --aot-cfg module.wasm` writes `module.cfg.ts`. Every wasm basic
block becomes a type; `br`, `br_if`, `br_table` and loop back-edges become tail
calls to those types; `if`/`else` join through a shared continuation. Nothing is
"skipped forward N ends" - the control flow graph is real, which is why loops and
nested branches behave.

Each block takes `(fuel, memory, globals, locals, stack)` and returns either

- `['r', memory, value?]` - the function returned, or
- `['s', 'fn_block', memory, ...live values]` - it ran out of fuel

On suspend the host re-enters the named block with fresh fuel, so a run of any
length is a sequence of bounded evaluations. `drive.ts` does that; `trie.ts`
decodes the memory that comes back.

## Three things had to be measured, not guessed

**Memory cannot be an intersection.** `S['memory'] & Record<Addr, Value>` looks
right and is unusable: intersecting two different literals for one address gives
`never`, so the *second* write to a word poisons it - and `i32.store8` is a
read-modify-write, so four byte stores into one word are enough. Memory is a
sparse 8-way trie keyed by address bits instead, which is why a write is
`$Put` and not an intersection.

**The state has to come back as printable text, and the printer gives up before
the checker does.** With a 14-level binary trie the *type* was always correct -
960 stores in one evaluation, every byte verified - but the type *printer* elides
deeply nested parts, printing them as `any`. Pasting that back silently corrupted
memory: a whole subtree of the screen would revert. An 8-way trie is 5 levels
deep, which prints cleanly, and `drive.ts` now validates every chunk against
exactly what the compiler is supposed to emit and refuses anything else.

**Depth is spent on nesting, not on work.** `I32Add<I32Add<..>,..>` inside
`$Store8` inside `$Put` stacks each operator's ~32 levels of bit recursion into
one chain, and ts-type-math raises TS2589 long before a block finishes. The
compiler emits SSA - every intermediate value gets a name - so a block is a flat
sequence of conditionals. After that, one evaluation handles 960 stores.

The speed came from the same observation applied to memory access: a byte store
is not arithmetic, it is *string surgery*. `$Off` reads the low two bits of an
address as the last two characters of its 32-character string, and `$SetByte`
splices eight characters into a word. No shifting, no masking, no adders. That
took pong's first frame from 26 evaluations and 5.5s down to one evaluation at
0.27s.

## Calls

An exported function is compiled *metered*: its blocks charge fuel and can
suspend. Anything it calls is compiled again in an *unmetered* flavour (`$u...`)
that runs to completion inside the caller's evaluation and hands back
`['r', memory, ...globals, value?]`, so a callee's writes to memory and to
globals are not lost. Suspending in the middle of a call would need a call stack
in the state, so for now a callee has to fit in one evaluation - fine for
conway's helpers, not yet enough for something as deep as DOOM.

## Fuel

Fuel is a string of `'1'`s, one per unit of work, and a block charges one per hop
plus one per store. Taking a prefix off a string is free; the obvious
`[any, ...infer Rest]` tuple copies every remaining element on every hop, and at
a few thousand units that alone dominated the frame.

The host starts optimistic and backs off: if a chunk comes back with TS2589, or
prints something that is not a fully concrete state, fuel is halved and the same
block is retried. Whatever fuel survives is reused for the next frame, so the
runtime settles onto the checker's real limit instead of assuming one.
