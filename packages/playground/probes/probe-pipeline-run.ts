// Two ways to sequence instructions inside a block.
//
// nested infer (what the compiler emits today):
//   Op<$a> extends infer $t0 extends WasmValue
//   ? Op<$t0> extends infer $t1 extends WasmValue
//   ? ... : never : never
//
// pipeline (state threaded through alias applications):
//   Step<Step<Step<[$a]>>>
//
// The first is exponential past a depth of about 15 - measured, +2 depth is
// roughly 4x the time. If the second is linear, a block can be as long as it
// likes, and the compiler stops needing to cut functions into small pieces.
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createEnv, evaluateType } from "../evaluate/ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const file = join(__dirname, "probe-gen.ts");
const one = `${"0".repeat(31)}1`;
const zero = "0".repeat(32);

const nested = (depth: number) => {
  const lines: string[] = [];
  for (let i = 0; i < depth; i++) {
    const previous = i === 0 ? `'${zero}'` : `$t${i - 1}`;
    lines.push(`  Wasm.I32Add<${previous}, '${one}'> extends infer $t${i} extends WasmValue ?`);
  }
  return `export type Result = \n${lines.join("\n")} $t${depth - 1}\n${" : never".repeat(depth)}
export type BenchResult = Convert.WasmValue.ToTSNumber<Result, 'i32'>`;
};

/// one alias per step, each taking the state tuple and returning the next
const pipeline = (depth: number) => {
  const steps = Array.from(
    { length: depth },
    (_, i) => `type $s${i}<$S extends WasmValue[]> = [Wasm.I32Add<$S[0], '${one}'>, ...$S]`,
  ).join("\n");
  let expression = `['${zero}']`;
  for (let i = 0; i < depth; i++) expression = `$s${i}<${expression}>`;
  return `${steps}
export type BenchResult = Convert.WasmValue.ToTSNumber<${expression}[0], 'i32'>`;
};

/// the same pipeline, but one reusable alias instead of one per step
const uniform = (depth: number) => {
  let expression = `['${zero}']`;
  for (let i = 0; i < depth; i++) expression = `$step<${expression}>`;
  return `type $step<$S extends WasmValue[]> = [Wasm.I32Add<$S[0], '${one}'>, ...$S]
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
    if (typeString === "any" || typeString.includes("rror")) return `bad: ${typeString.slice(0, 30)}`;
    return elapsed;
  } finally {
    env.close();
  }
};

const show = (value: number | string) => (typeof value === "number" ? `${value.toFixed(0)}ms`.padStart(9) : String(value).padStart(9));
console.log("i32 adds in one evaluation, by encoding\n");
console.log("depth   nested infer   pipeline   one alias");
for (const depth of (process.env.DEPTHS ?? "8,16,20,24,32,64,128").split(",").map(Number)) {
  const a = depth <= Number(process.env.MAXNEST ?? 24) ? await time(nested(depth)) : "skipped";
  const b = await time(pipeline(depth));
  const c = await time(uniform(depth));
  console.log(`${String(depth).padStart(5)}   ${show(a)}   ${show(b)}   ${show(c)}`);
}
