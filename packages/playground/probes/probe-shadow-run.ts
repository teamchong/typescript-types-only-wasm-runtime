// Probe: a memory representation where a second write to the same word wins.
//
// The AOT prelude currently builds memory as `S['memory'] & Record<Addr, V>`.
// Intersecting two different literal types for the same key gives `never`, so
// the *second* store to any word poisons it - and `$Store8` is a
// read-modify-write, so four byte stores into one word poison it immediately.
// Every frame of a real game writes the same words repeatedly, so this has to
// be fixed before control flow matters at all.
//
// Candidates, all run through pong-tiny's own screen-clear loop shape:
//   intersect  - what we emit today (control, expected to be wrong)
//   omit       - Omit<M, Addr> & Record<Addr, V>          (O(n) per write)
//   thunk      - Record<Addr, () => V>, read via the last overload (O(1))
//   set        - mapped-type rewrite of every key         (O(n) per write)
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { createEnv, evaluateType } from "../evaluate/ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const bin = (n: number) => (n >>> 0).toString(2).padStart(32, "0");

const iterations = Number(process.argv[2] ?? 960);
const modes = (process.argv[3] ?? "intersect,omit,thunk,set").split(",");

// Take the real prelude, then swap out just the memory representation.
const aot = await readFile(join(__dirname, "../pong-tiny/pong-tiny.aot.ts"), "utf8");
const cut = aot.indexOf("type $GetValue<T>");
const preludeFull = aot.slice(0, aot.indexOf("\n", cut) + 1);
// everything except the $State / $ReadMem / $WriteMem definitions
const drop = [
  /type \$State = [^\n]*\n/,
  /type \$ReadMem<[\s\S]*?\n\n/,
  /type \$WriteMem<[\s\S]*?\n}\n/,
];
let preludeRest = preludeFull;
for (const re of drop) preludeRest = preludeRest.replace(re, "");

const ZERO = bin(0);

const reps: Record<string, string> = {
  intersect: `type $State = { memory: Record<string, string> }
type $ReadMem<S extends $State, A extends WasmValue> =
  $AlignAddr<A> extends infer AA extends WasmValue
    ? AA extends keyof S['memory'] ? S['memory'][AA] : '${ZERO}'
    : never
type $WriteMem<S extends $State, A extends WasmValue, V extends WasmValue> = {
  memory: S['memory'] & Record<$AlignAddr<A>, V>
}`,
  omit: `type $State = { memory: Record<string, string> }
type $ReadMem<S extends $State, A extends WasmValue> =
  $AlignAddr<A> extends infer AA extends WasmValue
    ? AA extends keyof S['memory'] ? S['memory'][AA] & string : '${ZERO}'
    : never
type $WriteMem<S extends $State, A extends WasmValue, V extends WasmValue> = {
  memory: Omit<S['memory'], $AlignAddr<A>> & Record<$AlignAddr<A>, V>
}`,
  thunk: `type $State = { memory: Record<string, () => string> }
type $ReadMem<S extends $State, A extends WasmValue> =
  $AlignAddr<A> extends infer AA extends WasmValue
    ? AA extends keyof S['memory']
      ? S['memory'][AA] extends () => infer V ? (V extends WasmValue ? V : '${ZERO}') : '${ZERO}'
      : '${ZERO}'
    : never
type $WriteMem<S extends $State, A extends WasmValue, V extends WasmValue> = {
  memory: S['memory'] & Record<$AlignAddr<A>, () => V>
}`,
  set: `type $State = { memory: Record<string, string> }
type $ReadMem<S extends $State, A extends WasmValue> =
  $AlignAddr<A> extends infer AA extends WasmValue
    ? AA extends keyof S['memory'] ? S['memory'][AA] & string : '${ZERO}'
    : never
type $WriteMem<S extends $State, A extends WasmValue, V extends WasmValue> = {
  memory: { [K in keyof S['memory'] | $AlignAddr<A>]: K extends $AlignAddr<A> ? V : S['memory'][K & keyof S['memory']] }
}`,
};

const start = 52;
const end = start + iterations;

// pong-tiny's screen clear, as one basic block in tail position
const loop = `type $clear<$S extends $State, $p0 extends WasmValue> =
  $Store8<$S, Wasm.I32Add<$p0, '${bin(8192)}'>, '${bin(32)}'> extends infer $S1 extends $State
    ? Wasm.I32Add<$p0, '${bin(1)}'> extends infer $p1 extends WasmValue
      ? Wasm.I32Neq<$p1, '${bin(end)}'> extends '${ZERO}'
        ? [$S1, $p1]
        : $clear<$S1, $p1>
      : never
    : never`;

const probeAddrs = [8192 + start, 8192 + start + Math.floor(iterations / 2), 8192 + end - 1];

for (const mode of modes) {
  const rep = reps[mode];
  if (!rep) throw new Error(`unknown mode ${mode}`);
  const file = `${rep}
${preludeRest}
${loop}

type $Run = $clear<{ memory: {} }, '${bin(start)}'>
type $Byte<S extends $State, A extends WasmValue> =
  Wasm.I32And<Wasm.I32ShrU<$ReadMem<S, A>, Wasm.I32Shl<$ByteOffset<A>, '${bin(3)}'>>, '${bin(255)}'>
type $Out = $GetState<$Run> extends infer S extends $State
  ? \`\${Convert.WasmValue.ToTSNumber<$GetValue<$Run> & string, 'i32'>}${probeAddrs.map(a => `|\${Convert.WasmValue.ToTSNumber<$Byte<S, '${bin(a)}'>, 'i32'>}`).join("")}\`
  : 'no state'
export type BenchResult = $Out
`;
  const path = join(__dirname, `shadow-${mode}-${process.pid}.ts`);
  const env = createEnv(path);
  env.createFile(path, file);
  if (process.env.DUMP) (await import("node:fs")).writeFileSync(path, file);

  const t0 = performance.now();
  let got = "<threw>";
  try {
    const out = await evaluateType(env, path, env.languageService.getProgram()!, undefined, "BenchResult", true);
    got = out.typeString.replace(/\s+/g, " ").trim();
  } catch (error) {
    got = `<threw> ${(error as Error).message.split("\n")[0]}`;
  }
  const ms = performance.now() - t0;
  const want = `"${end}|32|32|32"`;
  console.log(
    `${mode.padEnd(10)} ${iterations} byte-writes in ${(ms / 1000).toFixed(2)}s ` +
    `-> ${Math.round(iterations / (ms / 1000))} writes/sec  ${got === want ? "OK" : `WRONG got ${got} want ${want}`}`,
  );
  env.close();
}
