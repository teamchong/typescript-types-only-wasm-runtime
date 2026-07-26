// Probe: memory as a sparse binary trie keyed by the address bits.
//
// Why: `Record` intersections poison a word on the second write (never), and
// every O(n) rewrite (Omit / mapped Set) leaves a *lazy* chain behind, so
// reading it back after a few hundred writes exceeds TypeScript's instantiation
// depth. A trie fixes both:
//   * a write returns a concrete tuple, so nothing accumulates lazily
//   * cost is ~2 * depth per write instead of O(memory size)
//   * unwritten subtrees stay the shared zero marker, so it prints small
//
// Shape under test is pong-tiny's screen-clear loop, as basic blocks in tail
// position: 960 i32.store8s, four to a word, each a read-modify-write.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createEnv, evaluateType } from "../evaluate/ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const bin = (n: number) => (n >>> 0).toString(2).padStart(32, "0");

const iterations = Number(process.argv[2] ?? 960);
const bits = Number(process.argv[3] ?? 12); // word-address bits the trie covers

const ZERO = bin(0);
// The trie indexes the word address: drop the two byte-offset bits, keep the
// low `bits` bits of what is left. 2^(bits+2) bytes of addressable memory.
const skip = 32 - 2 - bits;

const prelude = `import type { Wasm, WasmValue, Convert } from 'ts-type-math'

type $Zero = '${ZERO}'
type $Node = string | [unknown, unknown]
type $State = { memory: $Node }

type $AlignAddr<A extends WasmValue> = Wasm.I32And<A, '11111111111111111111111111111100'>
type $ByteOffset<A extends WasmValue> = Wasm.I32And<A, '${bin(3)}'>

// the trie path for an address: skip the high bits, drop the two low bits
type $Path<A extends string> =
  A extends \`\${infer _H extends string}\${infer Rest}\`
    ? _H extends \`\${string}\` ? never : never
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

// address -> trie path: chars ${skip}..30 of the 32-bit binary address
type $Bits<A extends string> = A extends \`${"${infer _S extends string}".replace(/^/, "")}\` ? never : never

type $ReadMem<S extends $State, A extends WasmValue> = $Get<S['memory'], $Slice<A>> & string
type $WriteMem<S extends $State, A extends WasmValue, V extends WasmValue> = {
  memory: $Put<S['memory'], $Slice<A>, V>
}

type $Byte8Mask<Offset extends WasmValue> = Wasm.I32Shl<'00000000000000000000000011111111', Wasm.I32Shl<Offset, '${bin(3)}'>>
type $Not8Mask<Offset extends WasmValue> = Wasm.I32Xor<$Byte8Mask<Offset>, '11111111111111111111111111111111'>

type $Store8<S extends $State, Addr extends WasmValue, Val extends WasmValue> =
  $WriteMem<S, Addr, Wasm.I32Or<
    Wasm.I32And<$ReadMem<S, Addr>, $Not8Mask<$ByteOffset<Addr>>>,
    Wasm.I32Shl<Wasm.I32And<Val, '00000000000000000000000011111111'>, Wasm.I32Shl<$ByteOffset<Addr>, '${bin(3)}'>>
  >>

type $GetState<T> = T extends [infer S, any] ? S : T
type $GetValue<T> = T extends [any, infer V] ? V : never
`;

// $Slice<A> keeps chars [skip, 30) of a 32-char binary address. Written out as
// one template pattern so it costs a single match, not a recursion.
const sliceType = `type $Slice<A extends string> =
  A extends \`${"${infer _}".repeat(skip)}${"${infer B}".repeat(bits)}${"${infer _L}".repeat(2)}\`
    ? \`${Array.from({ length: bits }, (_, i) => `\${B${i}}`).join("")}\`
    : never`;

// the pattern above needs distinct infer names
const slice = `type $Slice<A extends string> =
  A extends \`${Array.from({ length: skip }, (_, i) => `\${infer _h${i}}`).join("")}${Array.from({ length: bits }, (_, i) => `\${infer b${i}}`).join("")}\${infer _l0}\${infer _l1}\`
    ? \`${Array.from({ length: bits }, (_, i) => `\${b${i}}`).join("")}\`
    : never`;
void sliceType;

const start = 52;
const end = start + iterations;

const force = process.env.FORCE === "1";
const loop = force
  ? `type $clear<$S extends $State, $p0 extends WasmValue> =
  $Store8<$S, Wasm.I32Add<$p0, '${bin(8192)}'>, '${bin(32)}'> extends infer $S1 extends $State
    ? $ReadMem<$S1, Wasm.I32Add<$p0, '${bin(8192)}'>> extends infer _W extends string
      ? Wasm.I32Add<$p0, '${bin(1)}'> extends infer $p1 extends WasmValue
        ? Wasm.I32Neq<$p1, '${bin(end)}'> extends '${ZERO}'
          ? [$S1, $p1]
          : $clear<$S1, $p1>
        : never
      : never
    : never`
  : `type $clear<$S extends $State, $p0 extends WasmValue> =
  $Store8<$S, Wasm.I32Add<$p0, '${bin(8192)}'>, '${bin(32)}'> extends infer $S1 extends $State
    ? Wasm.I32Add<$p0, '${bin(1)}'> extends infer $p1 extends WasmValue
      ? Wasm.I32Neq<$p1, '${bin(end)}'> extends '${ZERO}'
        ? [$S1, $p1]
        : $clear<$S1, $p1>
      : never
    : never`;

const probeAddrs = [8192 + start, 8192 + start + Math.floor(iterations / 2), 8192 + end - 1];

const file = `${prelude.replace(/type \$Path<[\s\S]*?: never\n\n/, "").replace(/type \$Bits<[\s\S]*?: never\n\n/, "")}
${slice}

${loop}

type $Run = $clear<{ memory: $Zero }, '${bin(start)}'>
type $Byte<S extends $State, A extends WasmValue> =
  Wasm.I32And<Wasm.I32ShrU<$ReadMem<S, A>, Wasm.I32Shl<$ByteOffset<A>, '${bin(3)}'>>, '${bin(255)}'>
export type BenchResult = $GetState<$Run> extends infer S extends $State
  ? \`\${Convert.WasmValue.ToTSNumber<$GetValue<$Run> & string, 'i32'>}${probeAddrs.map(a => `|\${Convert.WasmValue.ToTSNumber<$Byte<S, '${bin(a)}'>, 'i32'>}`).join("")}\`
  : 'no state'
`;

const path = join(__dirname, `trie-probe-${process.pid}.ts`);
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
  `trie(${bits} bits${force ? ", forced" : ""}) ${iterations} byte-writes in ${(ms / 1000).toFixed(2)}s ` +
  `-> ${Math.round(iterations / (ms / 1000))} writes/sec  ${got === want ? "OK" : `WRONG got ${got} want ${want}`}`,
);
env.close();
