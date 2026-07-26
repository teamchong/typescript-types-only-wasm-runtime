import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createEnv, evaluateType } from "../evaluate/ts";
const __dirname = dirname(fileURLToPath(import.meta.url));
const file = join(__dirname, "probe-gen.ts");

// cheapest possible unit of work: one indexed-access lookup per step
const lookup = (n: number) => {
  const rows = Array.from({ length: 16 }, (_, i) => `  '${i.toString(16)}': '${((i + 1) % 16).toString(16)}'`);
  let s = `'0'`;
  for (let i = 0; i < n; i++) s = `IncT[${s}]`;
  return `type IncT = {\n${rows.join(",\n")}\n}\nexport type BenchResult = ${s}`;
};
// one conditional-type instantiation per step
const cond = (n: number) => {
  const rows = Array.from({ length: 16 }, (_, i) => `  '${i.toString(16)}': '${((i + 1) % 16).toString(16)}'`);
  let s = `'0'`;
  for (let i = 0; i < n; i++) s = `Inc<${s}>`;
  return `type IncT = {\n${rows.join(",\n")}\n}
type Inc<D> = D extends keyof IncT ? IncT[D] : never
export type BenchResult = ${s}`;
};
const modes: Record<string, (n: number) => string> = { lookup, cond };
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
    console.log(`${mode} steps=${n} -> ${typeString} in ${(ms / 1000).toFixed(3)}s (${Math.round(n / (ms / 1000))} steps/sec)`);
  } catch (e) {
    console.log(`${mode} steps=${n} -> FAILED: ${(e as Error).message.split(": ").pop()?.slice(0, 70)}`);
  } finally { env.close(); }
}
