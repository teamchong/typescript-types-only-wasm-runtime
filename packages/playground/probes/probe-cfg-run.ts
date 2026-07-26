// Probe: can TypeScript 7 run a WASM loop compiled as *basic blocks in tail
// position* inside a single type instantiation?
//
// This is the exact shape the CFG compiler wants to emit for pong-tiny's
// screen-clear loop:
//
//   (local.set $p0 (i32.const 52))
//   (loop $L2
//     (i32.store8 (i32.add (local.get $p0) (i32.const 8192)) (i32.const 32))
//     (br_if $L2 (i32.ne (local.tee $p0 (i32.add (local.get $p0) (i32.const 1)))
//                        (i32.const 1012))))
//
// Two questions, both fatal if the answer is no:
//   1. how many back-edges can one type evaluation take (tail-call budget)?
//   2. what does threading `$Store8` state through them cost per iteration?
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { createEnv, evaluateType, reportErrors } from "../evaluate/ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const bin = (n: number) => (n >>> 0).toString(2).padStart(32, "0");

const iterations = Number(process.argv[2] ?? 960);
const style = process.argv[3] ?? "infer"; // "infer" | "repeat"

// Reuse the real generated prelude ($State/$Store8/$ReadMem/...) verbatim, so
// the probe measures the same helpers the compiler actually emits.
const aot = await readFile(join(__dirname, "../pong-tiny/pong-tiny.aot.ts"), "utf8");
const cut = aot.indexOf("type $GetValue<T>");
if (cut < 0) throw new Error("could not find the end of the prelude");
const prelude = aot.slice(0, aot.indexOf("\n", cut) + 1);

const start = 52;
const end = start + iterations;

// One basic block: store, increment, test, either loop or fall out.
const body = style === "infer"
  ? `type $clear<$S extends $State, $p0 extends WasmValue> =
  $Store8<$S, Wasm.I32Add<$p0, '${bin(8192)}'>, '${bin(32)}'> extends infer $S1 extends $State
    ? Wasm.I32Add<$p0, '${bin(1)}'> extends infer $p1 extends WasmValue
      ? Wasm.I32Neq<$p1, '${bin(end)}'> extends '${bin(0)}'
        ? [$S1, $p1]
        : $clear<$S1, $p1>
      : never
    : never`
  : `type $clear<$S extends $State, $p0 extends WasmValue> =
  Wasm.I32Neq<Wasm.I32Add<$p0, '${bin(1)}'>, '${bin(end)}'> extends '${bin(0)}'
    ? [$Store8<$S, Wasm.I32Add<$p0, '${bin(8192)}'>, '${bin(32)}'>, Wasm.I32Add<$p0, '${bin(1)}'>]
    : $clear<$Store8<$S, Wasm.I32Add<$p0, '${bin(8192)}'>, '${bin(32)}'>, Wasm.I32Add<$p0, '${bin(1)}'>>`;

// Read back the first, a middle and the last byte the loop should have written.
// 8192 + 52 is byte 0 of the cleared region; each is ' ' (32) when it worked.
const probeAddrs = [8192 + start, 8192 + start + Math.floor(iterations / 2), 8192 + end - 1];

const file = `${prelude}
${body}

type $Run = $clear<{ memory: {} }, '${bin(start)}'>
type $Mem = $GetState<$Run>
type $Byte<A extends WasmValue> =
  Wasm.I32And<Wasm.I32ShrU<$ReadMem<$Mem & $State, A>, Wasm.I32Shl<$ByteOffset<A>, '${bin(3)}'>>, '${bin(255)}'>

export type BenchResult = \`\${Convert.WasmValue.ToTSNumber<$GetValue<$Run> & string, 'i32'>}${probeAddrs.map(a => `|\${Convert.WasmValue.ToTSNumber<$Byte<'${bin(a)}'>, 'i32'>}`).join("")}\`
`;

const path = join(__dirname, "cfg-probe.ts");
if (process.env.DUMP) { const { writeFileSync } = await import("node:fs"); writeFileSync(path, file); }
const env = createEnv(path);
env.createFile(path, file);

if (process.env.DIAG) reportErrors(env.languageService.getProgram()!);
const t0 = performance.now();
let typeString = "<threw>";
try {
  const out = await evaluateType(env, path, env.languageService.getProgram()!, undefined, "BenchResult", true);
  typeString = out.typeString;
} catch (error) {
  typeString = `<threw> ${(error as Error).message.split("\n")[0]}`;
}
const ms = performance.now() - t0;

const want = `"${end}|32|32|32"`;
const got = typeString.replace(/\s+/g, " ").trim();
console.log(`iterations ${iterations} style ${style}: ${(ms / 1000).toFixed(2)}s -> ${Math.round(iterations / (ms / 1000))} iters/sec`);
console.log(`  got  ${got}`);
console.log(`  want ${want}  ${got === want ? "OK" : "MISMATCH"}`);
env.close();
