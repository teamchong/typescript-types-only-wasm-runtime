// Why is a chain of nested infers exponential?
//
// Each link is `Op<...> extends infer $t extends WasmValue ? rest : never`.
// Two things there could make the checker do the work twice per level: the
// constraint on the infer, and the conditional's unused false branch. This
// tries the same chain of i32 adds four ways.
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createEnv, evaluateType } from "../evaluate/ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const file = join(__dirname, "probe-gen.ts");
const one = `${"0".repeat(31)}1`;

type Style = "constrained" | "unconstrained" | "intersected" | "pipeline";

const build = (depth: number, style: Style) => {
  if (style === "pipeline") {
    let expression = `['${"0".repeat(32)}']`;
    for (let i = 0; i < depth; i++) expression = `$step<${expression}>`;
    return `type $step<$S extends WasmValue[]> = [Wasm.I32Add<$S[0], '${one}'>, ...$S]
export type BenchResult = Convert.WasmValue.ToTSNumber<${expression}[0], 'i32'>`;
  }
  const lines: string[] = [];
  for (let i = 0; i < depth; i++) {
    const previous = i === 0 ? `'${"0".repeat(32)}'` : style === "unconstrained" ? `$t${i - 1} & string` : `$t${i - 1}`;
    const binder =
      style === "constrained"
        ? `infer $t${i} extends WasmValue`
        : style === "intersected"
          ? `infer $t${i} extends string`
          : `infer $t${i}`;
    lines.push(`  Wasm.I32Add<${previous}, '${one}'> extends ${binder} ?`);
  }
  const last = style === "unconstrained" ? `$t${depth - 1} & string` : `$t${depth - 1}`;
  return `export type Result =\n${lines.join("\n")} ${last}\n${" : never".repeat(depth)}
export type BenchResult = Convert.WasmValue.ToTSNumber<Result, 'i32'>`;
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
    if (typeString === "any" || typeString.includes("rror")) return `bad(${typeString.slice(0, 12)})`;
    return `${elapsed.toFixed(0)}ms`;
  } finally {
    env.close();
  }
};

console.log("a chain of i32 adds, four ways of naming the intermediate\n");
console.log("depth   infer extends WasmValue   infer extends string   plain infer   pipeline");
for (const depth of (process.env.DEPTHS ?? "8,16,20,24").split(",").map(Number)) {
  const a = await time(build(depth, "constrained"));
  const b = await time(build(depth, "intersected"));
  const c = await time(build(depth, "unconstrained"));
  const d = await time(build(depth, "pipeline"));
  console.log(`${String(depth).padStart(5)}   ${a.padStart(21)}   ${b.padStart(20)}   ${c.padStart(11)}   ${d.padStart(8)}`);
}
