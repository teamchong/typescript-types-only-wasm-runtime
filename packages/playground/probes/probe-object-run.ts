// Picking a branch without a conditional type.
//
// A conditional is the shape that goes exponential with nesting. An indexed
// access into an object type picks an arm too:
//
//   cond extends '1' ? Then : Else        vs      { '1': Then, '0': Else }[cond]
//
// Two things have to hold for the second to be usable as control flow:
//
//   1. laziness - indexing must not resolve the arm it does not take. Tested by
//      making the untaken arm ruinously expensive and seeing if it is paid for.
//   2. flatness - a chain of them must not compound the way nested conditionals
//      do.
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createEnv, evaluateType } from "../evaluate/ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const file = join(__dirname, "probe-gen.ts");
const one = `${"0".repeat(31)}1`;
const zero = "0".repeat(32);

/// a 26-deep nested infer chain: ~10s if anything ever resolves it
const expensive = (() => {
  const lines: string[] = [];
  for (let i = 0; i < 26; i++) {
    const previous = i === 0 ? `'${zero}'` : `$t${i - 1}`;
    lines.push(`  Wasm.I32Add<${previous}, '${one}'> extends infer $t${i} extends WasmValue ?`);
  }
  return `type Expensive =\n${lines.join("\n")} $t25\n${" : never".repeat(26)}`;
})();

const cases: Record<string, string> = {
  // does the untaken arm get paid for?
  "conditional, cheap arm taken": `${expensive}
type Pick<C extends string> = C extends '1' ? '${zero}' : Expensive
export type BenchResult = Convert.WasmValue.ToTSNumber<Pick<'1'>, 'i32'>`,

  "object index, cheap arm taken": `${expensive}
type Pick<C extends string> = { '1': '${zero}', '0': Expensive }[C]
export type BenchResult = Convert.WasmValue.ToTSNumber<Pick<'1'>, 'i32'>`,
};

/// N branches in a row, each one adding to the value it picks
const chainedConditional = (n: number) => {
  const lines: string[] = [];
  for (let i = 0; i < n; i++) {
    const previous = i === 0 ? `'${zero}'` : `$t${i - 1}`;
    lines.push(`  (Wasm.I32Add<${previous}, '${one}'> extends infer $s${i} extends WasmValue ? ($s${i} extends '${zero}' ? $s${i} : $s${i}) : never) extends infer $t${i} extends WasmValue ?`);
  }
  return `type Chain =\n${lines.join("\n")} $t${n - 1}\n${" : never".repeat(n)}
export type BenchResult = Convert.WasmValue.ToTSNumber<Chain, 'i32'>`;
};

const chainedObject = (n: number) => {
  // each step: add, then pick a continuation by indexing on a bit of the result
  const steps = Array.from(
    { length: n },
    (_, i) => `type $s${i}<$S extends WasmValue[]> = { '0': [Wasm.I32Add<$S[0], '${one}'>, ...$S], '1': [Wasm.I32Add<$S[0], '${one}'>, ...$S] }[$S[0] extends \`0\${string}\` ? '0' : '1']`,
  ).join("\n");
  let expression = `['${zero}']`;
  for (let i = 0; i < n; i++) expression = `$s${i}<${expression}>`;
  return `${steps}
export type BenchResult = Convert.WasmValue.ToTSNumber<${expression}[0], 'i32'>`;
};

const time = async (source: string) => {
  writeFileSync(file, `import type { Wasm, WasmValue, Convert } from 'ts-type-math'\n${source}`);
  const env = createEnv(file);
  try {
    const program = env.languageService.getProgram();
    if (!program) throw new Error("no program");
    const started = performance.now();
    const { typeString } = await evaluateType(env, file, program, undefined, "BenchResult", true);
    const elapsed = performance.now() - started;
    return `${elapsed.toFixed(0)}ms${typeString === "any" || typeString.includes("rror") ? ` (${typeString.slice(0, 14)})` : ` -> ${typeString.slice(0, 6)}`}`;
  } finally {
    env.close();
  }
};

console.log("1. is the arm you do not index paid for?\n");
for (const [name, source] of Object.entries(cases)) {
  console.log(`   ${name.padEnd(32)} ${await time(source)}`);
}
console.log("\n2. does a chain of branches compound?\n");
console.log("   branches   nested conditional   object index");
for (const n of (process.env.DEPTHS ?? "8,16,20,24").split(",").map(Number)) {
  const a = n <= 20 ? await time(chainedConditional(n)) : "skipped";
  const b = await time(chainedObject(n));
  console.log(`   ${String(n).padStart(8)}   ${a.padStart(18)}   ${b.padStart(12)}`);
}
