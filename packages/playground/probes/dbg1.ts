import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createEnv, evaluateType } from "../evaluate/ts";
const __dirname = dirname(fileURLToPath(import.meta.url));
const path = join(__dirname, "dbg-probe.ts");
const env = createEnv(path);
env.createFile(path, `import type { Wasm, WasmValue, Convert } from 'ts-type-math'
type A = Wasm.I32Add<'00000000000000000000000000000001', '00000000000000000000000000000010'>
export type BenchResult = \`\${Convert.WasmValue.ToTSNumber<A, 'i32'>}\`
`);
const out = await evaluateType(env, path, env.languageService.getProgram()!, undefined, "BenchResult", true);
console.log("got:", out.typeString);
env.close();
