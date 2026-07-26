import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createEnv, evaluateType } from "../evaluate/ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const tmpl = readFileSync(join(__dirname, "probe.ts"), "utf8");
const file = join(__dirname, "probe-gen.ts");
const bin = (n: number) => (n >>> 0).toString(2).padStart(32, "0");

for (const n of process.argv.slice(2).map(Number)) {
  writeFileSync(file, tmpl.replace("__N__", bin(n)));
  const env = createEnv(file);
  try {
    const program = env.languageService.getProgram();
    if (!program) throw new Error("no program");
    const start = performance.now();
    const { typeString } = await evaluateType(env, file, program, undefined, "BenchResult", true);
    const ms = performance.now() - start;
    console.log(`iterations=${n} -> ${typeString} in ${(ms / 1000).toFixed(3)}s (${(n / (ms / 1000)).toFixed(0)} iters/sec)`);
  } catch (e) {
    console.log(`iterations=${n} -> FAILED: ${(e as Error).message.split("\n")[0]}`);
  } finally { env.close(); }
}
