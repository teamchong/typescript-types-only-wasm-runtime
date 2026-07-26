import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createEnv, evaluateType } from "../evaluate/ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const prelude = readFileSync("/tmp/prelude.ts", "utf8");
const file = join(__dirname, "probe-gen.ts");
const bin = (n: number) => (n >>> 0).toString(2).padStart(32, "0");

// N sequential 4-byte-aligned stores threaded through state, then read one back
const src = (n: number) => `${prelude}
type $InitialState = { memory: {} }
type ZERO = '${bin(0)}'
type Fill<S extends $State, N extends WasmValue> =
  N extends ZERO ? S
  : Fill<$Store32<S, Wasm.I32Shl<N, '${bin(2)}'>, N>, Wasm.I32Sub<N, '${bin(1)}'>>
type Done = Fill<$InitialState, '${bin(n)}'>
export type BenchResult = Convert.WasmValue.ToTSNumber<$LoadI32<Done, '${bin(4 * Math.max(1, Math.floor(n / 2)))}'>, 'i32'>
`;

for (const n of process.argv.slice(2).map(Number)) {
  writeFileSync(file, src(n));
  const env = createEnv(file);
  try {
    const program = env.languageService.getProgram();
    if (!program) throw new Error("no program");
    const start = performance.now();
    const { typeString } = await evaluateType(env, file, program, undefined, "BenchResult", true);
    const ms = performance.now() - start;
    console.log(`stores=${n} -> read ${typeString} (expect ${Math.max(1, Math.floor(n / 2))}) in ${(ms / 1000).toFixed(3)}s (${(n / (ms / 1000)).toFixed(0)} stores/sec)`);
  } catch (e) {
    console.log(`stores=${n} -> FAILED:\n${(e as Error).message}`.slice(0, 1200));
  } finally { env.close(); }
}
