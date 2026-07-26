import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createEnv, evaluateType } from "../evaluate/ts";
const __dirname = dirname(fileURLToPath(import.meta.url));
const file = join(__dirname, "probe-gen.ts");

// Simulate chunked execution: `chunks` separate evaluations of `steps` each,
// each one resuming from the previous chunk's result (like a host-driven loop).
const src = (steps: number, start: string) => {
  const rows = Array.from({ length: 16 }, (_, i) => `  '${i.toString(16)}': '${((i + 1) % 16).toString(16)}'`);
  let s = `'${start}'`;
  for (let i = 0; i < steps; i++) s = `IncT[${s}]`;
  return `type IncT = {\n${rows.join(",\n")}\n}\nexport type BenchResult = ${s}`;
};

const steps = Number(process.argv[2]);
const chunks = Number(process.argv[3]);
const reuseEnv = process.argv[4] === "reuse";

let state = "0";
let evalMs = 0;
let overheadMs = 0;
const t0 = performance.now();
let env = reuseEnv ? createEnv(file) : null;
writeFileSync(file, src(steps, state));
for (let c = 0; c < chunks; c++) {
  const o0 = performance.now();
  writeFileSync(file, src(steps, state));
  if (!reuseEnv) env = createEnv(file);
  else env!.createFile(file, src(steps, state));
  const program = env!.languageService.getProgram();
  if (!program) throw new Error("no program");
  overheadMs += performance.now() - o0;
  const e0 = performance.now();
  const { typeString } = await evaluateType(env!, file, program, undefined, "BenchResult", true);
  evalMs += performance.now() - e0;
  state = typeString.replaceAll('"', "");
  if (!reuseEnv) env!.close();
}
if (reuseEnv) env!.close();
const total = performance.now() - t0;
const totalSteps = steps * chunks;
console.log(
  `${reuseEnv ? "reused env" : "fresh env"}: ${chunks} chunks x ${steps} steps = ${totalSteps} steps in ${(total / 1000).toFixed(2)}s` +
  ` -> ${Math.round(totalSteps / (total / 1000))} steps/sec sustained (eval ${(evalMs / 1000).toFixed(2)}s, setup ${(overheadMs / 1000).toFixed(2)}s), final=${state}`,
);
