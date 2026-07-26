import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createEnv, evaluateType } from "../evaluate/ts";
const __dirname = dirname(fileURLToPath(import.meta.url));
const file = join(__dirname, "probe-gen.ts");
const bin = (n: number) => (n >>> 0).toString(2).padStart(32, "0");

const mode = process.argv[2];                        // print | hybrid
const entries = Number(process.argv[3] ?? 27000);    // live memory slots (doom-sized)
const chunks = Number(process.argv[4] ?? 20);
const writesPerChunk = Number(process.argv[5] ?? 200);
const compactEvery = Number(process.argv[6] ?? 5);

const prelude = `
type Mem = Record<string, string>
type Set<M extends Mem, A extends string, V extends string> = { [K in keyof M | A]: K extends A ? V : (K extends keyof M ? M[K] : '${bin(0)}') }
type Get<M extends Mem, A extends string> = A extends keyof M ? M[A] : '${bin(0)}'
type Expand<T> = T extends infer U ? { [K in keyof U]: U[K] } : never
`;
const initialMemory = (n: number) => Array.from({ length: n }, (_, i) => `  '${bin(i * 4)}': '${bin(i)}';`).join("\n");
const delta = (base: string, i: number) => {
  let body = base;
  for (let w = 0; w < writesPerChunk; w++) body = `Set<${body}, '${bin(((i * writesPerChunk + w) % entries) * 4)}', '${bin(i + 1)}'>`;
  return body;
};

const env = createEnv(file);
let stateText = `{\n${initialMemory(entries)}\n}`;
let src = "";
let base = "S0";
let pending = 0;
let compactions = 0;
let compactMs = 0;
const t0 = performance.now();
for (let i = 0; i < chunks; i++) {
  const forceCompact = mode === "print" || (i + 1) % compactEvery === 0;
  if (mode === "print") { base = "S0"; pending = 0; }
  const expr = delta(base, i);
  const c0 = performance.now();
  if (forceCompact) {
    // materialise: print the state and re-seed the file with a flat literal
    src = `${prelude}\ntype S0 = ${stateText}\nexport type BenchResult = Expand<${expr}>`;
    env.createFile(file, src);
    const { typeString } = await evaluateType(env, file, env.languageService.getProgram()!, undefined, "BenchResult", true);
    stateText = typeString;
    if (i === 0 || i === chunks - 1) console.log(`  chunk ${i}: printed state is ${typeString.length} chars, starts: ${typeString.slice(0, 70)}`);
    base = "S0";
    pending = 0;
    compactions++;
    compactMs += performance.now() - c0;
  } else {
    // keep the delta as an alias, only read back a scalar
    src = `${prelude}\ntype S0 = ${stateText}\ntype D${i} = ${expr}\nexport type BenchResult = Get<D${i}, '${bin(0)}'>`;
    env.createFile(file, src);
    await evaluateType(env, file, env.languageService.getProgram()!, undefined, "BenchResult", true);
    base = `D${i}`;
    pending++;
  }
}
const check = 4 * 7;
env.createFile(file, `${prelude}\ntype S0 = ${stateText}\nexport type BenchResult = Get<S0, '${bin(check)}'>`);
const { typeString: readBack } = await evaluateType(env, file, env.languageService.getProgram()!, undefined, "BenchResult", true);
env.close();
const ms = performance.now() - t0;
console.log(`  read-back of slot 7 after ${chunks} chunks: ${readBack} (state text ${stateText.length} chars)`);
const writes = chunks * writesPerChunk;
console.log(`${mode}: ${writes} writes over ${entries} slots in ${(ms / 1000).toFixed(2)}s -> ${Math.round(writes / (ms / 1000))} writes/sec (${compactions} compactions, ${(compactMs / 1000).toFixed(2)}s in them)`);
