import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { createEnv, evaluateType } from "../evaluate/ts";
const __dirname = dirname(fileURLToPath(import.meta.url));
const bin = (n: number) => (n >>> 0).toString(2).padStart(32, "0");
const aot = await readFile(join(__dirname, "../pong-tiny/pong-tiny.aot.ts"), "utf8");
const cut = aot.indexOf("type $GetValue<T>");
const prelude = aot.slice(0, aot.indexOf("\n", cut) + 1);
const path = join(__dirname, "dbg-probe2.ts");
const env = createEnv(path);
env.createFile(path, `${prelude}
type $clear<$S extends $State, $p0 extends WasmValue> =
  $Store8<$S, Wasm.I32Add<$p0, '${bin(8192)}'>, '${bin(32)}'> extends infer $S1 extends $State
    ? Wasm.I32Add<$p0, '${bin(1)}'> extends infer $p1 extends WasmValue
      ? Wasm.I32Neq<$p1, '${bin(60)}'> extends '${bin(0)}'
        ? [$S1, $p1]
        : $clear<$S1, $p1>
      : never
    : never
type $Run = $clear<{ memory: {} }, '${bin(52)}'>
export type T1 = \`\${Convert.WasmValue.ToTSNumber<$GetValue<$Run> & string, 'i32'>}\`
export type T2 = \`\${$ReadMem<$GetState<$Run> & $State, '${bin(8192 + 52)}'>}\`

export type T9 = $GetState<$Run> extends infer S extends $State ? \`\${$ReadMem<S, '${bin(8192 + 52)}'>}\` : 'nope'
export type T10 = \`\${$GetState<$Run>['memory']['${bin(8192 + 52)}'] & string}\`
export type T11 = '${bin(8192 + 52)}' extends keyof $GetState<$Run>['memory'] ? 'has' : 'missing'
export type T12 = keyof $GetState<$Run>['memory']
export type T13 = $GetState<$Run>['memory']
export type T4 = $GetState<$Run>
export type T5 = keyof ($GetState<$Run> & $State)['memory']
export type T6 = \`\${$AlignAddr<'${bin(8192 + 52)}'>}\`
export type T7 = $GetState<$Run> extends $State ? 'yes' : 'no'
export type T8 = \`\${($GetState<$Run> & $State)['memory'][$AlignAddr<'${bin(8192 + 52)}'>] & string}\`
export type T3 = \`\${Convert.WasmValue.ToTSNumber<Wasm.I32Add<'${bin(1)}','${bin(2)}'>, 'i32'>}\`
`);
const program = env.languageService.getProgram()!;
for (const name of ["T3", "T1", "T2", "T4", "T5", "T6", "T7", "T8", "T9", "T10", "T11", "T12", "T13"]) {
  try {
    const out = await evaluateType(env, path, program, undefined, name, true);
    console.log(name, "=>", out.typeString);
  } catch (e) { console.log(name, "threw", (e as Error).message.split("\n")[0]); }
}
env.close();
