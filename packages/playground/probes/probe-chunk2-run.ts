import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createEnv, evaluateType } from "../evaluate/ts";
const __dirname = dirname(fileURLToPath(import.meta.url));

const steps = Number(process.argv[2] ?? 1000);
const chunks = Number(process.argv[3] ?? 20);
const strategy = process.argv[4] ?? "newpath"; // newpath | freshenv

const rows = Array.from({ length: 16 }, (_, i) => `  '${i.toString(16)}': '${((i + 1) % 16).toString(16)}'`);
const src = (start: string) => {
  let s = `'${start}'`;
  for (let i = 0; i < steps; i++) s = `IncT[${s}]`;
  return `type IncT = {\n${rows.join(",\n")}\n}\nexport type BenchResult = ${s}`;
};

let state = "0";
let evalMs = 0, setupMs = 0;
const t0 = performance.now();
let env = createEnv(join(__dirname, "chunk-0.ts"));
let prevPath: string | null = null;
for (let c = 0; c < chunks; c++) {
  const path = join(__dirname, `chunk-${c}.ts`);
  const s0 = performance.now();
  if (strategy === "freshenv") { env.close(); env = createEnv(path); }
  env.createFile(path, src(state));
  const program = env.languageService.getProgram()!;
  setupMs += performance.now() - s0;
  const e0 = performance.now();
  const { typeString } = await evaluateType(env, path, program, undefined, "BenchResult", true);
  evalMs += performance.now() - e0;
  state = typeString.replaceAll('"', "");
  if (prevPath) env.deleteFile(prevPath);
  prevPath = path;
}
env.close();
const ms = performance.now() - t0;
const expected = ((steps * chunks) % 16).toString(16);
console.log(`${strategy}: ${chunks} x ${steps} = ${steps * chunks} steps in ${(ms / 1000).toFixed(2)}s -> ${Math.round(steps * chunks / (ms / 1000))} steps/sec` +
  ` (eval ${(evalMs / 1000).toFixed(2)}s, setup ${(setupMs / 1000).toFixed(2)}s) final=${state} expected=${expected} ${state === expected ? "OK" : "*** WRONG ***"}`);
