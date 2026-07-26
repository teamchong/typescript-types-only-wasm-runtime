// Does a long block cost more than the sum of its instructions?
//
// A compiled block is a chain of nested `infer`s, one per instruction:
//
//   Op<...> extends infer $t0 extends WasmValue
//   ? Op<$t0, ...> extends infer $t1 extends WasmValue
//   ? ...
//
// If that nesting is linear, long blocks are free and fusing blocks together is
// a straight win. If it is superlinear, the compiler should be splitting blocks
// instead. This measures the same number of adds at different chain depths.
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createEnv, evaluateType } from "../evaluate/ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const file = join(__dirname, "probe-gen.ts");
const one = `${"0".repeat(31)}1`;

/// one alias holding a chain of `depth` nested infers
const chain = (depth: number) => {
  const lines: string[] = [];
  for (let i = 0; i < depth; i++) {
    const previous = i === 0 ? "$a" : `$t${i - 1}`;
    lines.push(`${"  ".repeat(i + 1)}Wasm.I32Add<${previous}, '${one}'> extends infer $t${i} extends WasmValue`);
    lines.push(`${"  ".repeat(i + 1)}? `);
  }
  const tail = `$t${depth - 1}` + "\n" + Array.from({ length: depth }, (_, i) => `${"  ".repeat(depth - i)}: never`).join("\n");
  return `export type Chain<$a extends WasmValue> =\n${lines.join("\n")}${tail}`;
};

const time = async (source: string, iterations: number) => {
  writeFileSync(file, `import type { Wasm, WasmValue, Convert } from 'ts-type-math'\n${source}`);
  const env = createEnv(file);
  try {
    const program = env.languageService.getProgram();
    if (!program) throw new Error("no program");
    const started = performance.now();
    const { typeString } = await evaluateType(env, file, program, undefined, "BenchResult", true);
    const elapsed = performance.now() - started;
    if (typeString === "any" || typeString.includes("rror")) throw new Error(typeString.slice(0, 60));
    return { total: elapsed, per: (elapsed / iterations) * 1000 };
  } finally {
    env.close();
  }
};

// one chain at a time: where exactly is the cliff?
console.log("a single chain of nested infers\n");
console.log("depth   chains   total ms   µs per add");
for (const depth of (process.env.DEPTHS ?? "8,12,14,16,18,20,22,24").split(",").map(Number)) {
  const total = depth;
  const chains = 1;
  let expression = `'${"0".repeat(32)}'`;
  for (let i = 0; i < chains; i++) expression = `Chain<${expression}>`;
  const source = `${chain(depth)}\nexport type BenchResult = Convert.WasmValue.ToTSNumber<${expression}, 'i32'>`;
  try {
    const { total: ms, per } = await time(source, total);
    console.log(`${String(depth).padStart(5)}   ${String(chains).padStart(6)}   ${ms.toFixed(0).padStart(8)}   ${per.toFixed(0).padStart(10)}`);
  } catch (error) {
    console.log(`${String(depth).padStart(5)}   ${String(chains).padStart(6)}   failed: ${(error as Error).message}`);
  }
}
