// How should a block carry its state?
//
// Every jump between blocks is one type instantiation, and the measurement that
// started this: a loop carrying 2 live locals runs at 155µs an iteration, the
// same loop carrying 20 runs at 1763µs. Arguments are not free. So: is it
// cheaper to pass one tuple and index into it?
//
//   spread:  Loop<$F, $l0, $l1, ... $l19>        - one argument per local
//   tuple:   Loop<$F, [$l0, $l1, ... $l19]>      - one argument, rebuilt per write
//
// The tuple has to be rebuilt whenever a local is written, so the comparison is
// run at several write counts per iteration.
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createEnv, evaluateType } from "../evaluate/ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const file = join(__dirname, "probe-gen.ts");
const iterations = Number(process.env.N ?? 100);

const fuel = "1".repeat(iterations);
const zero = "0".repeat(32);

/// n locals passed as n separate type arguments, `writes` of them updated per iteration
const spread = (n: number, writes: number) => {
  const params = Array.from({ length: n }, (_, i) => `$l${i} extends string`).join(", ");
  const args = Array.from({ length: n }, (_, i) => (i < writes ? `\`\${$l${i}}\`` : `$l${i}`)).join(", ");
  const initial = Array.from({ length: n }, () => `'${zero}'`).join(", ");
  return `export type Loop<$F extends string, ${params}> =
  $F extends \`1\${infer $R}\` ? Loop<$R, ${args}> : $l0
export type BenchResult = Loop<'${fuel}', ${initial}>`;
};

/// the same locals in one tuple, rebuilt when any of them is written
const tuple = (n: number, writes: number) => {
  const elements = Array.from({ length: n }, (_, i) => (i < writes ? `\`\${$L[${i}]}\`` : `$L[${i}]`)).join(", ");
  const initial = Array.from({ length: n }, () => `'${zero}'`).join(", ");
  const next = writes === 0 ? "$L" : `[${elements}]`;
  return `export type Loop<$F extends string, $L extends string[]> =
  $F extends \`1\${infer $R}\` ? Loop<$R, ${next}> : $L[0]
export type BenchResult = Loop<'${fuel}', [${initial}]>`;
};

const time = async (source: string) => {
  writeFileSync(file, source);
  const env = createEnv(file);
  try {
    const program = env.languageService.getProgram();
    if (!program) throw new Error("no program");
    const started = performance.now();
    const { typeString } = await evaluateType(env, file, program, undefined, "BenchResult", true);
    const elapsed = performance.now() - started;
    if (typeString.includes("error") || typeString === "any") throw new Error(`bad result ${typeString}`);
    return (elapsed / iterations) * 1000;
  } finally {
    env.close();
  }
};

/// the same pass-through loop, but doing one real i32 add per iteration -
/// what a compiled block actually looks like
const withWork = (n: number) => {
  const params = Array.from({ length: n }, (_, i) => `$l${i} extends WasmValue`).join(", ");
  const args = Array.from({ length: n }, (_, i) => `$l${i}`).join(", ");
  const initial = Array.from({ length: n }, () => `'${zero}'`).join(", ");
  return `import type { Wasm, WasmValue, Convert } from 'ts-type-math'
export type Loop<$F extends string, ${params}> =
  $F extends \`1\${infer $R}\`
  ? Wasm.I32Add<$l0, '${"0".repeat(31)}1'> extends infer $t0 extends WasmValue
    ? Loop<$R, $t0, ${args.split(", ").slice(1).join(", ")}>
    : never
  : $l0
export type BenchResult = Convert.WasmValue.ToTSNumber<Loop<'${fuel}', ${initial}>, 'i32'>`;
};

console.log(`${iterations} iterations, µs per iteration\n`);
console.log("locals   pass-through   with one i32 add");
for (const locals of [2, 8, 20]) {
  const plain = await time(spread(locals, 0));
  const work = await time(withWork(locals));
  console.log(`${String(locals).padStart(6)}   ${plain.toFixed(0).padStart(12)}   ${work.toFixed(0).padStart(16)}`);
}

console.log("locals  writes   spread    tuple");
for (const locals of [4, 12, 20]) {
  for (const writes of [0, 1, 3]) {
    const a = await time(spread(locals, writes));
    const b = await time(tuple(locals, writes));
    const winner = b < a ? `tuple ${(a / b).toFixed(1)}x` : `spread ${(b / a).toFixed(1)}x`;
    console.log(
      `${String(locals).padStart(6)}  ${String(writes).padStart(6)}  ${a.toFixed(0).padStart(7)}  ${b.toFixed(0).padStart(7)}   ${winner}`,
    );
  }
}
