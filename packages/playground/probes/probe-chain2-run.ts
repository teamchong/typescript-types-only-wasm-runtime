import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createEnv, evaluateType } from "../evaluate/ts";
const __dirname = dirname(fileURLToPath(import.meta.url));
const file = join(__dirname, "probe-gen.ts");
const helpersPath = join(__dirname, "probe-rt-helpers.ts");
const bin = (n: number) => (n >>> 0).toString(2).padStart(32, "0");

const slots = Number(process.argv[2] ?? 2000);
const writes = Number(process.argv[3] ?? 100);
const chunks = Number(process.argv[4] ?? 20);

// homomorphic rebuild over a fixed key set: TypeScript resolves this eagerly
const helpers = `export type Set<P, A extends string, V extends string> = { [K in keyof P]: K extends A ? V : P[K] }
export type Get<P, A extends string> = A extends keyof P ? P[A] : '${bin(0)}'`;

const env = createEnv(file);
// inline the helpers instead of importing them
const literal = `{\n${Array.from({ length: slots }, (_, i) => `  '${bin(i * 4)}': '${bin(i)}';`).join("\n")}\n}`;

let src = `import type { Wasm, WasmValue, Convert } from 'ts-type-math'
type Set<P, A extends string, V extends string> = { [K in keyof P]: K extends A ? V : P[K] }
type Get<P, A extends string> = A extends keyof P ? P[A] : '${bin(0)}'
type S0 = ${literal}
`;
const t0 = performance.now();
let lastMs = 0;
for (let c = 0; c < chunks; c++) {
  let expr = `S${c}`;
  for (let w = 0; w < writes; w++) expr = `Set<${expr}, '${bin(((c * writes + w) % slots) * 4)}', '${bin(c + 1)}'>`;
  src += `type S${c + 1} = ${expr}\n`;
  // read back the value written first in this chunk: proves the chain is live and correct
  const probeAddr = bin(((c * writes) % slots) * 4);
  const c0 = performance.now();
  env.createFile(file, `${src}export type BenchResult = Convert.WasmValue.ToTSNumber<Get<S${c + 1}, '${probeAddr}'> & string, 'i32'>`);
  const { typeString } = await evaluateType(env, file, env.languageService.getProgram()!, undefined, "BenchResult", true);
  lastMs = performance.now() - c0;
  const got = typeString.replaceAll('"', "");
  const want = String(c + 1);
  if (got !== want) { console.log(`chunk ${c}: WRONG ${got} != ${want}`); break; }
  if (c % 5 === 0 || c === chunks - 1) console.log(`  chunk ${c}: ok (${lastMs.toFixed(0)}ms, ${(c + 1) * writes} writes deep)`);
}
const ms = performance.now() - t0;
console.log(`chain: ${chunks} chunks x ${writes} writes over ${slots} slots = ${chunks * writes} nested writes in ${(ms / 1000).toFixed(2)}s -> ${Math.round(chunks * writes / (ms / 1000))} writes/sec`);
env.close();
