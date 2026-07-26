import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createEnv, evaluateType } from "../evaluate/ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const file = join(__dirname, "probe-gen.ts");
const bin = (n: number) => (n >>> 0).toString(2).padStart(32, "0");

// straight-line chain of N i32 adds on the current binary-string representation
const binaryAdds = (n: number) => {
  let s = `'${bin(0)}'`;
  for (let i = 0; i < n; i++) s = `Wasm.I32Add<${s}, '${bin(1)}'>`;
  return `import type { Wasm, WasmValue, Convert } from 'ts-type-math'
export type BenchResult = Convert.WasmValue.ToTSNumber<${s}, 'i32'>`;
};

// same chain, but i32 = 8 hex digits and add = generated nibble lookup tables
const hexAdds = (n: number) => {
  const D = "0123456789abcdef".split("");
  const sum: string[] = [];
  const carry: string[] = [];
  for (const c of ["0", "1"]) {
    for (const a of D) {
      const row: string[] = [];
      const crow: string[] = [];
      for (const b of D) {
        const t = parseInt(a, 16) + parseInt(b, 16) + Number(c);
        row.push(`'${b}': '${(t & 15).toString(16)}'`);
        crow.push(`'${b}': '${t > 15 ? "1" : "0"}'`);
      }
      sum.push(`  '${c}${a}': { ${row.join("; ")} }`);
      carry.push(`  '${c}${a}': { ${crow.join("; ")} }`);
    }
  }
  let s = `'00000000'`;
  for (let i = 0; i < n; i++) s = `Add<${s}, '00000001'>`;
  return `type Digit = '0'|'1'|'2'|'3'|'4'|'5'|'6'|'7'|'8'|'9'|'a'|'b'|'c'|'d'|'e'|'f'
type SumT = {
${sum.join(",\n")}
}
type CarryT = {
${carry.join(",\n")}
}
type AddD<C extends '0'|'1', A extends Digit, B extends Digit> = SumT[\`\${C}\${A}\`][B]
type CarryD<C extends '0'|'1', A extends Digit, B extends Digit> = CarryT[\`\${C}\${A}\`][B]
// little work per digit: 8 nibbles, carry threaded right-to-left
type Add<A extends string, B extends string> =
  A extends \`\${infer A0 extends Digit}\${infer A1 extends Digit}\${infer A2 extends Digit}\${infer A3 extends Digit}\${infer A4 extends Digit}\${infer A5 extends Digit}\${infer A6 extends Digit}\${infer A7 extends Digit}\`
    ? B extends \`\${infer B0 extends Digit}\${infer B1 extends Digit}\${infer B2 extends Digit}\${infer B3 extends Digit}\${infer B4 extends Digit}\${infer B5 extends Digit}\${infer B6 extends Digit}\${infer B7 extends Digit}\`
      ? CarryD<'0', A7, B7> extends infer C7 extends '0'|'1'
        ? CarryD<C7, A6, B6> extends infer C6 extends '0'|'1'
          ? CarryD<C6, A5, B5> extends infer C5 extends '0'|'1'
            ? CarryD<C5, A4, B4> extends infer C4 extends '0'|'1'
              ? CarryD<C4, A3, B3> extends infer C3 extends '0'|'1'
                ? CarryD<C3, A2, B2> extends infer C2 extends '0'|'1'
                  ? CarryD<C2, A1, B1> extends infer C1 extends '0'|'1'
                    ? \`\${AddD<C1, A0, B0>}\${AddD<C2, A1, B1>}\${AddD<C3, A2, B2>}\${AddD<C4, A3, B3>}\${AddD<C5, A4, B4>}\${AddD<C6, A5, B5>}\${AddD<C7, A6, B6>}\${AddD<'0', A7, B7>}\`
                    : never : never : never : never : never : never : never
      : never
    : never
export type BenchResult = ${s}
`;
};

const modes: Record<string, (n: number) => string> = { binary: binaryAdds, hex: hexAdds };
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
    console.log(`${mode} adds=${n} -> ${typeString} in ${(ms / 1000).toFixed(3)}s (${(n / (ms / 1000)).toFixed(0)} adds/sec)`);
  } catch (e) {
    console.log(`${mode} adds=${n} -> FAILED: ${(e as Error).message.split(": ").pop()?.slice(0, 70)}`);
  } finally { env.close(); }
}
