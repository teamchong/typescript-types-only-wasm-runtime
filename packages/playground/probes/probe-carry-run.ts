import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createEnv, evaluateType } from "../evaluate/ts";
const __dirname = dirname(fileURLToPath(import.meta.url));
const bin = (n: number) => (n >>> 0).toString(2).padStart(32, "0");

const slots = Number(process.argv[2] ?? 64);
const writesPerChunk = Number(process.argv[3] ?? 50);
const chunks = Number(process.argv[4] ?? 30);

const helpers = `import type { Convert } from 'ts-type-math'
export type Set<P, A extends string, V extends string> = { [K in keyof P]: K extends A ? V : P[K] }
export type Get<P, A extends string> = A extends keyof P ? P[A] : '${bin(0)}'
export type Num<V> = Convert.WasmValue.ToTSNumber<V & string, 'i32'>
export type S0 = {
${Array.from({ length: slots }, (_, i) => `  '${bin(i * 4)}': '${bin(0)}';`).join("\n")}
}`;

const env = createEnv(join(__dirname, "carry-helpers.ts"));
env.createFile(join(__dirname, "carry-helpers.ts"), helpers);

let evalMs = 0;
const t0 = performance.now();
let prevModule = "./carry-helpers";
let prevName = "S0";
const paths: string[] = [];
for (let c = 0; c < chunks; c++) {
  // each chunk writes `writesPerChunk` slots, cycling, storing (chunk+1) as the value
  let expr = prevName;
  for (let w = 0; w < writesPerChunk; w++) expr = `Set<${expr}, '${bin(((c * writesPerChunk + w) % slots) * 4)}', '${bin(c + 1)}'>`;
  const path = join(__dirname, `carry-${c}.ts`);
  const probeAddr = bin(((c * writesPerChunk) % slots) * 4);
  env.createFile(path, `import type { Set, Get, Num } from './carry-helpers'
import type { ${prevName} } from '${prevModule}'
export type S${c + 1} = ${expr}
export type BenchResult = Num<Get<S${c + 1}, '${probeAddr}'>>`);
  const e0 = performance.now();
  const { typeString } = await evaluateType(env, path, env.languageService.getProgram()!, undefined, "BenchResult", true);
  evalMs += performance.now() - e0;
  if (typeString !== String(c + 1)) { console.log(`chunk ${c}: WRONG got ${typeString} want ${c + 1}`); break; }
  if (c % 10 === 0 || c === chunks - 1) console.log(`  chunk ${c}: ok, ${(c + 1) * writesPerChunk} writes deep`);
  prevModule = `./carry-${c}`;
  prevName = `S${c + 1}`;
  paths.push(path);
}
const ms = performance.now() - t0;
console.log(`carry: ${chunks} chunks x ${writesPerChunk} writes = ${chunks * writesPerChunk} writes in ${(ms / 1000).toFixed(2)}s -> ${Math.round(chunks * writesPerChunk / (ms / 1000))} writes/sec (eval ${(evalMs / 1000).toFixed(2)}s)`);
env.close();
