// Which feature of a compiled block makes extra locals expensive?
//
// A hand-written loop carrying 20 locals costs the same as one carrying 2, but
// the compiler's own loop at 22 locals runs 11x slower than at 2. Something in
// the emitted shape - not the arity itself - is doing it. This bisects the
// shape, one feature at a time.
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createEnv, evaluateType } from "../evaluate/ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const file = join(__dirname, "probe-gen.ts");
const iterations = Number(process.env.N ?? 100);
const fuel = "1".repeat(iterations * 2);
const zero = "0".repeat(32);
const one = `${"0".repeat(31)}1`;

interface Shape {
  memory: boolean; // thread a $M extends $Node parameter
  twoBranches: boolean; // a real branch to a second block, as a compare produces
  differentTargets: boolean; // the two branches go to different blocks, as they do in real code
  suspend: boolean; // the ['s', ...] escape hatch in the false branch
  separateAlias: boolean; // recurse into a different alias, not itself
}

const build = (n: number, shape: Shape) => {
  const params = [
    "$F extends string",
    ...(shape.memory ? ["$M extends $Node"] : []),
    ...Array.from({ length: n }, (_, i) => `$l${i} extends WasmValue`),
  ].join(", ");
  const pass = (first: string) =>
    [first, ...(shape.memory ? ["$M"] : []), ...Array.from({ length: n }, (_, i) => (i === 0 ? "$t0" : `$l${i}`))].join(", ");
  const suspend = shape.suspend
    ? `['s', '0', ${shape.memory ? "$M, " : ""}${Array.from({ length: n }, (_, i) => `$l${i}`).join(", ")}]`
    : "'done'";
  const body = (self: string) => `
  $F extends \`1\${infer $F1}\`
  ? Wasm.I32Add<$l0, '${one}'> extends infer $t0 extends WasmValue
    ? ${
      shape.twoBranches
        ? `Wasm.I32LtS<$t0, '${one}'> extends infer $t1 extends WasmValue
      ? $t1 extends '${zero}'
        ? ${shape.differentTargets ? "Other" : self}<${pass("$F1")}>
        : ${self}<${pass("$F1")}>
      : never`
        : `${self}<${pass("$F1")}>`
    }
    : never
  : ${suspend}`;
  const initial = [
    `'${fuel}'`,
    ...(shape.memory ? ["[['00000000000000000000000000000000']]"] : []),
    ...Array.from({ length: n }, () => `'${zero}'`),
  ].join(", ");
  const other = shape.differentTargets
    ? `export type Other<${params}> =\n  $F extends \`1\${infer $F1}\` ? Loop<${pass("$F1")}> : 'done'\n`
    : "";
  const second = shape.separateAlias
    ? `export type Loop2<${params}> =${body("Loop")}\n`
    : "";
  return `import type { Wasm, WasmValue } from 'ts-type-math'
type $Node = unknown[]
export type Loop<${params}> =${body(shape.separateAlias ? "Loop2" : "Loop")}
${second}${other}
export type BenchResult = Loop<${initial}>`;
};

const time = async (source: string) => {
  writeFileSync(file, source);
  const env = createEnv(file);
  try {
    const program = env.languageService.getProgram();
    if (!program) throw new Error("no program");
    const started = performance.now();
    const { typeString } = await evaluateType(env, file, program, undefined, "BenchResult", true);
    const elapsed = performance.now() - started;
    if (typeString === "any" || typeString.includes("rror")) throw new Error(typeString.slice(0, 40));
    return (elapsed / iterations) * 1000;
  } finally {
    env.close();
  }
};

const base: Shape = { memory: false, twoBranches: false, suspend: false, separateAlias: false, differentTargets: false };
const variants: [string, Shape][] = [
  ["plain loop", base],
  ["+ memory param", { ...base, memory: true }],
  ["+ branch, same target", { ...base, twoBranches: true }],
  ["+ branch, other target", { ...base, twoBranches: true, differentTargets: true }],
  ["+ suspend tuple", { ...base, suspend: true }],
  ["+ separate alias", { ...base, separateAlias: true }],
  ["everything (a real block)", { memory: true, twoBranches: true, suspend: true, separateAlias: true, differentTargets: true }],
];

console.log(`µs per iteration, ${iterations} iterations\n`);
console.log("shape                        2 locals   20 locals   arity cost");
for (const [name, shape] of variants) {
  const small = Math.min(await time(build(2, shape)), await time(build(2, shape)));
  const large = Math.min(await time(build(20, shape)), await time(build(20, shape)));
  console.log(
    `${name.padEnd(27)} ${small.toFixed(0).padStart(8)} ${large.toFixed(0).padStart(11)}   ${(large / small).toFixed(1)}x`,
  );
}
