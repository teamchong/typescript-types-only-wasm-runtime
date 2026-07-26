// A pipeline is flat when each step reads one slot. Real blocks are not like
// that: an add reads two, and a store rebuilds the tuple around a new memory.
// gfx falls off a cliff between 16 and 24 instructions per block, so one of
// those two shapes is not flat. Which?
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createEnv, evaluateType } from "../evaluate/ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const file = join(__dirname, "probe-gen.ts");
const one = `${"0".repeat(31)}1`;
const zero = "0".repeat(32);
const prelude = `import type { Wasm, WasmValue, Convert } from 'ts-type-math'
type $Node = unknown[]
type $State = [$Node, ...WasmValue[]]
type $Rest<$S extends $State> = $S extends [unknown, ...infer $R extends WasmValue[]] ? $R : never
`;

/// each step appends, reading `reads` of the slots already there
const values = (n: number, reads: number) => {
  const steps: string[] = [];
  for (let i = 0; i < n; i++) {
    const at = 1 + i; // the slot this step's inputs come from
    const arguments_ = Array.from({ length: reads }, (_, r) => `$S[${Math.max(1, at - r)}]`);
    const expression = arguments_.length === 1
      ? `Wasm.I32Add<${arguments_[0]}, '${one}'>`
      : arguments_.slice(1).reduce((acc, a) => `Wasm.I32Add<${acc}, ${a}>`, arguments_[0]!);
    steps.push(`type $p${i}<$S extends $State> = [...$S, ${expression}]`);
  }
  let applied = `[[], '${one}']`;
  for (let i = 0; i < n; i++) applied = `$p${i}<${applied}>`;
  return `${steps.join("\n")}
export type BenchResult = Convert.WasmValue.ToTSNumber<${applied} extends infer $S extends $State ? $S[${n}] : never, 'i32'>`;
};

/// every other step is a store: a new memory in slot 0, values carried past it
const stores = (n: number) => {
  const steps: string[] = [];
  for (let i = 0; i < n; i++) {
    const at = 1 + Math.floor(i / 2);
    steps.push(
      i % 2 === 0
        ? `type $p${i}<$S extends $State> = [...$S, Wasm.I32Add<$S[${at}], '${one}'>]`
        : `type $p${i}<$S extends $State> = [[$S[0], $S[${at}]], ...$Rest<$S>]`,
    );
  }
  let applied = `[[], '${one}']`;
  for (let i = 0; i < n; i++) applied = `$p${i}<${applied}>`;
  return `${steps.join("\n")}
export type BenchResult = Convert.WasmValue.ToTSNumber<${applied} extends infer $S extends $State ? $S[1] : never, 'i32'>`;
};

const time = async (source: string) => {
  writeFileSync(file, prelude + source);
  const env = createEnv(file);
  try {
    const program = env.languageService.getProgram();
    if (!program) throw new Error("no program");
    const started = performance.now();
    const { typeString } = await evaluateType(env, file, program, undefined, "BenchResult", true);
    const elapsed = performance.now() - started;
    return `${elapsed.toFixed(0)}ms${typeString.includes("rror") || typeString === "any" ? " BAD" : ""}`;
  } finally {
    env.close();
  }
};

console.log("steps   1 read/step   2 reads/step   3 reads/step   half are stores");
for (const n of (process.env.DEPTHS ?? "8,16,24,32").split(",").map(Number)) {
  const row = [await time(values(n, 1)), await time(values(n, 2)), await time(values(n, 3)), await time(stores(n))];
  console.log(`${String(n).padStart(5)}   ${row.map((cell) => cell.padStart(12)).join("   ")}`);
}
