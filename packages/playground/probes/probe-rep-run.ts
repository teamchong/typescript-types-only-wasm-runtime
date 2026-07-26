import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createEnv, evaluateType } from "../evaluate/ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const prelude = readFileSync("/tmp/prelude.ts", "utf8");
const file = join(__dirname, "probe-gen.ts");
const bin = (n: number) => (n >>> 0).toString(2).padStart(32, "0");
const ZERO = bin(0);

// A: straight-line intersection stores (no recursion) -- isolates nesting depth
const straight = (n: number) => {
  let s = "$InitialState";
  for (let i = 1; i <= n; i++) s = `$WriteMem<${s}, '${bin(i * 4)}', '${bin(i)}'>`;
  return `${prelude}
type $InitialState = { memory: {} }
export type BenchResult = Convert.WasmValue.ToTSNumber<$ReadMem<${s}, '${bin(4 * Math.max(1, n >> 1))}'>, 'i32'>`;
};

// B: flat mapped-type rebuild of a fixed-size page -- depth stays constant
const paged = (n: number, pageKeys: number) => {
  const keys = Array.from({ length: pageKeys }, (_, i) => `  '${bin(i * 4)}': '${ZERO}';`).join("\n");
  let s = "$P0";
  for (let i = 1; i <= n; i++) s = `$Set<${s}, '${bin((i % pageKeys) * 4)}', '${bin(i)}'>`;
  return `${prelude}
type $P0 = {
${keys}
}
type $Set<P, A extends string, V extends string> = { [K in keyof P]: K extends A ? V : P[K] }
type $Get<P, A extends string> = A extends keyof P ? P[A] : '${ZERO}'
export type BenchResult = Convert.WasmValue.ToTSNumber<$Get<${s}, '${bin(4 * Math.max(1, (n % pageKeys)))}'> & string, 'i32'>`;
};

// C: write-log (tuple prepend) stores + scan read -- O(1) write, O(n) read
const log = (n: number) => {
  let s = "[]";
  for (let i = 1; i <= n; i++) s = `[['${bin(i * 4)}', '${bin(i)}'], ...${s}]`;
  return `${prelude}
type $ReadLog<L, A extends string> =
  L extends [[infer K, infer V], ...infer R]
    ? (K extends A ? V : $ReadLog<R, A>)
    : '${ZERO}'
export type BenchResult = Convert.WasmValue.ToTSNumber<$ReadLog<${s}, '${bin(4 * Math.max(1, n >> 1))}'> & string, 'i32'>`;
};

const modes: Record<string, (n: number) => string> = {
  intersect: straight,
  page64: (n) => paged(n, 64),
  page1024: (n) => paged(n, 1024),
  log: log,
};

const mode = process.argv[2];
for (const n of process.argv.slice(3).map(Number)) {
  writeFileSync(file, modes[mode](n));
  const env = createEnv(file);
  try {
    const program = env.languageService.getProgram();
    if (!program) throw new Error("no program");
    const start = performance.now();
    const { typeString } = await evaluateType(env, file, program, undefined, "BenchResult", true);
    const ms = performance.now() - start;
    console.log(`${mode} writes=${n} -> ${typeString} in ${(ms / 1000).toFixed(3)}s (${(n / (ms / 1000)).toFixed(0)} writes/sec)`);
  } catch (e) {
    console.log(`${mode} writes=${n} -> FAILED: ${(e as Error).message.split(": ").pop()?.slice(0, 60)}`);
  } finally { env.close(); }
}
