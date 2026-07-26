// Probe: fuel-bounded chunks with the trie memory, materialised between chunks.
//
// Measured fact this is built on: one type evaluation can only thread ~100
// state transitions before TS2589 ("excessively deep"), no matter how memory is
// represented - intersections, Omit, mapped rewrites and the trie all die
// between 96 and 240 stores. So the state has to come back to the host every
// ~80 stores and go back in as a *concrete* literal.
//
// The trie is what makes that affordable: it prints as a plain nested tuple of
// string literals, which is valid TypeScript we can paste straight back in.
//
// End-to-end number here is what sets the frame rate: pong-tiny needs roughly
// 1000 byte-stores for its first frame and ~120 for a steady frame.
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createEnv, evaluateType } from "../evaluate/ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const bin = (n: number) => (n >>> 0).toString(2).padStart(32, "0");

const total = Number(process.argv[2] ?? 960);
const fuel = Number(process.argv[3] ?? 80);   // stores per evaluation
const bits = Number(process.argv[4] ?? 12);   // word-address bits in the trie
const ZERO = bin(0);
const skip = 32 - 2 - bits;

const prelude = `import type { Wasm, WasmValue, Convert } from 'ts-type-math'

type $Zero = '${ZERO}'
type $Node = string | [unknown, unknown]
type $State = { memory: $Node }

type $ByteOffset<A extends WasmValue> = Wasm.I32And<A, '${bin(3)}'>

type $Slice<A extends string> =
  A extends \`${Array.from({ length: skip }, (_, i) => `\${infer _h${i}}`).join("")}${Array.from({ length: bits }, (_, i) => `\${infer b${i}}`).join("")}\${infer _l0}\${infer _l1}\`
    ? \`${Array.from({ length: bits }, (_, i) => `\${b${i}}`).join("")}\`
    : never

type $Get<T, B extends string> =
  B extends \`\${infer Bit}\${infer Rest}\`
    ? T extends [infer L, infer R]
      ? Bit extends '0' ? $Get<L, Rest> : $Get<R, Rest>
      : $Zero
    : T extends string ? T : $Zero

type $Put<T, B extends string, V extends string> =
  B extends \`\${infer Bit}\${infer Rest}\`
    ? T extends [infer L, infer R]
      ? Bit extends '0' ? [$Put<L, Rest, V>, R] : [L, $Put<R, Rest, V>]
      : Bit extends '0' ? [$Put<$Zero, Rest, V>, $Zero] : [$Zero, $Put<$Zero, Rest, V>]
    : V

type $ReadMem<S extends $State, A extends WasmValue> = $Get<S['memory'], $Slice<A>> & string
type $WriteMem<S extends $State, A extends WasmValue, V extends WasmValue> = { memory: $Put<S['memory'], $Slice<A>, V> }

type $Byte8Mask<Offset extends WasmValue> = Wasm.I32Shl<'00000000000000000000000011111111', Wasm.I32Shl<Offset, '${bin(3)}'>>
type $Not8Mask<Offset extends WasmValue> = Wasm.I32Xor<$Byte8Mask<Offset>, '11111111111111111111111111111111'>

type $Store8<S extends $State, Addr extends WasmValue, Val extends WasmValue> =
  $WriteMem<S, Addr, Wasm.I32Or<
    Wasm.I32And<$ReadMem<S, Addr>, $Not8Mask<$ByteOffset<Addr>>>,
    Wasm.I32Shl<Wasm.I32And<Val, '00000000000000000000000011111111'>, Wasm.I32Shl<$ByteOffset<Addr>, '${bin(3)}'>>
  >>

type $Byte<S extends $State, A extends WasmValue> =
  Wasm.I32And<Wasm.I32ShrU<$ReadMem<S, A>, Wasm.I32Shl<$ByteOffset<A>, '${bin(3)}'>>, '00000000000000000000000011111111'>
`;

const start = 52;
let p0 = start;
let memory = "$Zero";
let evalMs = 0;
let printMs = 0;
let printedChars = 0;
let chunks = 0;
let env: ReturnType<typeof createEnv> | undefined;
const t0 = performance.now();
let failed: string | undefined;

while (p0 < start + total) {
  const stop = Math.min(p0 + fuel, start + total);
  // one basic block, in tail position, bounded by this chunk's exit test
  const file = `${prelude}
type $M = ${memory}

type $clear<$S extends $State, $p0 extends WasmValue> =
  $Store8<$S, Wasm.I32Add<$p0, '${bin(8192)}'>, '${bin(32)}'> extends infer $S1 extends $State
    ? Wasm.I32Add<$p0, '${bin(1)}'> extends infer $p1 extends WasmValue
      ? Wasm.I32Neq<$p1, '${bin(stop)}'> extends '${ZERO}'
        ? [$S1['memory'], $p1]
        : $clear<$S1, $p1>
      : never
    : never

export type BenchResult = $clear<{ memory: $M }, '${bin(p0)}'>
`;
  const path = join(__dirname, `chunked-trie-${process.pid}-${chunks}.ts`);
  if (!env) env = createEnv(path);
  env.createFile(path, file);
  const e0 = performance.now();
  let out: string;
  try {
    out = (await evaluateType(env, path, env.languageService.getProgram()!, undefined, "BenchResult", true)).typeString;
  } catch (error) {
    failed = `chunk ${chunks} at p0=${p0}: ${(error as Error).message.split("\n")[0]}`;
    break;
  }
  evalMs += performance.now() - e0;
  env.deleteFile(path);

  // BenchResult prints as [<trie>, "<counter>"]; split it back into host state
  const p1 = performance.now();
  const text = out.trim();
  const lastComma = text.lastIndexOf(",");
  const trie = text.slice(1, lastComma).trim();
  const counter = text.slice(lastComma + 1, text.lastIndexOf("]")).trim().replace(/"/g, "");
  printedChars = trie.length;
  printMs += performance.now() - p1;
  if (!/^\[|^"/.test(trie)) { failed = `chunk ${chunks}: state did not print structurally: ${trie.slice(0, 120)}`; break; }
  memory = trie.replace(/"/g, "'");
  p0 = parseInt(counter, 2) || Number(counter);
  if (!Number.isFinite(p0)) { failed = `chunk ${chunks}: could not read counter from ${counter}`; break; }
  chunks++;
}
const ms = performance.now() - t0;

if (failed) console.log(`FAILED ${failed}`);
console.log(
  `chunked trie(${bits}b) fuel ${fuel}: ${p0 - start}/${total} stores in ${(ms / 1000).toFixed(2)}s ` +
  `-> ${Math.round((p0 - start) / (ms / 1000))} stores/sec over ${chunks} chunks ` +
  `(eval ${(evalMs / 1000).toFixed(2)}s, state text ${printedChars} chars)`,
);

// verify the last chunk's memory really holds the blanks
if (!failed && env) {
  const path = join(__dirname, `chunked-verify-${process.pid}.ts`);
  const addrs = [8192 + start, 8192 + start + Math.floor(total / 2), 8192 + start + total - 1];
  env.createFile(path, `${prelude}
type $M = ${memory}
export type BenchResult = \`${addrs.map(a => `\${Convert.WasmValue.ToTSNumber<$Byte<{ memory: $M }, '${bin(a)}'>, 'i32'>}`).join("|")}\`
`);
  const { typeString } = await evaluateType(env, path, env.languageService.getProgram()!, undefined, "BenchResult", true);
  console.log(`  bytes written: ${typeString} ${typeString === '"32|32|32"' ? "OK" : "WRONG want \"32|32|32\""}`);
}
env?.close();
void basename;
