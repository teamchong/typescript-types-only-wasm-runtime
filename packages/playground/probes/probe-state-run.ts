// The state tuple carries both 32-character words and memory tries, so its type
// has to be `unknown[]` and every read needs an intersection to be usable:
//
//   $S[3] & WasmValue      instead of      $S[3]
//
// Does that cost? Compared against a homogeneous `WasmValue[]` state, and
// against a store into a trie read back out of the tuple.
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createEnv, evaluateType } from "../evaluate/ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const file = join(__dirname, "probe-gen.ts");
const one = `${"0".repeat(31)}1`;
const zero = "0".repeat(32);

const typed = (n: number) => {
  let expression = `['${zero}']`;
  for (let i = 0; i < n; i++) expression = `$step<${expression}>`;
  return `type $step<$S extends WasmValue[]> = [...$S, Wasm.I32Add<$S[0], '${one}'>]
export type BenchResult = Convert.WasmValue.ToTSNumber<${expression}[0], 'i32'>`;
};

const untyped = (n: number) => {
  let expression = `['${zero}']`;
  for (let i = 0; i < n; i++) expression = `$step<${expression}>`;
  return `type $step<$S extends unknown[]> = [...$S, Wasm.I32Add<$S[0] & WasmValue, '${one}'>]
export type BenchResult = Convert.WasmValue.ToTSNumber<${expression}[0] & WasmValue, 'i32'>`;
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
    return `${elapsed.toFixed(0)}ms${typeString === "any" || typeString.includes("rror") ? ` BAD(${typeString.slice(0, 10)})` : ""}`;
  } finally {
    env.close();
  }
};

console.log("steps   WasmValue[] state   unknown[] state with intersections");
for (const n of (process.env.DEPTHS ?? "16,32,64").split(",").map(Number)) {
  console.log(`${String(n).padStart(5)}   ${(await time(typed(n))).padStart(17)}   ${(await time(untyped(n))).padStart(33)}`);
}
