// Is the per-chunk cost dominated by work that has nothing to do with running
// the program? Same chunk, same evaluation path as the driver, three variants:
// the real one, one whose $Result executes nothing, and one with the module's
// blocks deleted. Wall time here is noisy, so each is run three times and the
// fastest is reported.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createEnv, evaluateType } from "../evaluate/ts";
const __dirname = dirname(fileURLToPath(import.meta.url));
const file = join(__dirname, "probe-fixed-gen.ts");
const src = readFileSync("/tmp/ch/chunk-0001.ts", "utf8");
const norun = readFileSync("/tmp/ch/v-norun.ts", "utf8");
const variants: Record<string, string> = { real: src, norun };
for (const [name, text] of Object.entries(variants)) {
  const times: number[] = [];
  let out = "";
  for (let i = 0; i < 3; i++) {
    const env = createEnv(file);
    env.createFile(file, text);
    const t = performance.now();
    try {
      out = (await evaluateType(env, file, env.languageService.getProgram()!, undefined, "$Tag", true)).typeString;
    } catch (e) { out = "FAILED " + (e as Error).message.slice(0, 40); }
    times.push(performance.now() - t);
    env.close();
  }
  console.log(`${name.padEnd(6)} ${Math.min(...times).toFixed(0)}ms  (runs ${times.map((t) => t.toFixed(0)).join("/")})  ${out}`);
}
