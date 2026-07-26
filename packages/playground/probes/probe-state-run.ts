import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createEnv, evaluateType } from "../evaluate/ts";
const __dirname = dirname(fileURLToPath(import.meta.url));
const file = join(__dirname, "probe-gen.ts");
const bin = (n: number) => (n >>> 0).toString(2).padStart(32, "0");

const entries = Number(process.argv[3] ?? 2000);   // live memory slots
const chunks = Number(process.argv[4] ?? 20);      // host round trips
const writesPerChunk = Number(process.argv[5] ?? 200);
const mode = process.argv[2];                       // "print" | "chain"

const initialMemory = (n: number) =>
  Array.from({ length: n }, (_, i) => `  '${bin(i * 4)}': '${bin(i)}';`).join("\n");

const prelude = `
type Mem = Record<string, string>
type Set<M extends Mem, A extends string, V extends string> = { [K in keyof M | A]: K extends A ? V : (K extends keyof M ? M[K] : '${bin(0)}') }
type Get<M extends Mem, A extends string> = A extends keyof M ? M[A] : '${bin(0)}'
`;

// one chunk of straight-line stores applied to a state parameter
const chunkType = (i: number) => {
  let body = "M";
  for (let w = 0; w < writesPerChunk; w++) body = `Set<${body}, '${bin(((i * writesPerChunk + w) % entries) * 4)}', '${bin(i + 1)}'>`;
  return `type Chunk${i}<M extends Mem> = ${body}`;
};

let total = 0;
const t0 = performance.now();

if (mode === "print") {
  // mimic the current design: expand the state to text, write it back, re-check it
  let stateText = `{\n${initialMemory(entries)}\n}`;
  const env = createEnv(file);
  for (let i = 0; i < chunks; i++) {
    writeFileSync(file, `${prelude}\ntype S0 = ${stateText}\n${chunkType(i)}\nexport type BenchResult = Chunk${i}<S0>`);
    env.createFile(file, `${prelude}\ntype S0 = ${stateText}\n${chunkType(i)}\nexport type BenchResult = Chunk${i}<S0>`);
    const program = env.languageService.getProgram()!;
    const { typeString } = await evaluateType(env, file, program, undefined, "BenchResult", true);
    stateText = typeString.replace(/;\s*}$/, ";\n}");
    total += writesPerChunk;
  }
  env.close();
} else {
  // append-only alias chain: never print the state, only read back one scalar
  const env = createEnv(file);
  let src = `${prelude}\ntype S0 = {\n${initialMemory(entries)}\n}\n`;
  for (let i = 0; i < chunks; i++) {
    src += `${chunkType(i)}\ntype S${i + 1} = Chunk${i}<S${i}>\n`;
    const probe = `export type BenchResult = Get<S${i + 1}, '${bin(0)}'>`;
    env.createFile(file, src + probe);
    const program = env.languageService.getProgram()!;
    await evaluateType(env, file, program, undefined, "BenchResult", true);
    total += writesPerChunk;
  }
  env.close();
}

const ms = performance.now() - t0;
console.log(`${mode}: ${chunks} chunks x ${writesPerChunk} writes over ${entries}-slot memory = ${total} writes in ${(ms / 1000).toFixed(2)}s -> ${Math.round(total / (ms / 1000))} writes/sec`);
