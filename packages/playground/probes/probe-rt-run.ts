import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isTypeAliasDeclaration } from "typescript/unstable/ast/is";
import { createEnv } from "../evaluate/ts";
const __dirname = dirname(fileURLToPath(import.meta.url));
const file = join(__dirname, "probe-gen.ts");
const bin = (n: number) => (n >>> 0).toString(2).padStart(32, "0");

const slots = Number(process.argv[2] ?? 2000);        // live memory slots in the page object
const writes = Number(process.argv[3] ?? 200);        // writes in this chunk
const chunks = Number(process.argv[4] ?? 10);

// NOTE: no Record<string,string> constraint anywhere -- that collapses keys into an index signature
const helpers = `export type Set<M, A extends string, V extends string> = { [K in keyof M | A]: K extends A ? V : (K extends keyof M ? M[K] : '${bin(0)}') }`;
const env = createEnv(file);
const helpersPath = join(__dirname, "probe-rt-helpers.ts");
env.createFile(helpersPath, helpers);

let state = new Map<string, string>();
for (let i = 0; i < slots; i++) state.set(bin(i * 4), bin(i));

let materialiseMs = 0, evalMs = 0;
const t0 = performance.now();
for (let c = 0; c < chunks; c++) {
  const literal = `{\n${[...state].map(([k, v]) => `  '${k}': '${v}';`).join("\n")}\n}`;
  let expr = "S0";
  for (let w = 0; w < writes; w++) expr = `Set<${expr}, '${bin(((c * writes + w) % slots) * 4)}', '${bin(c + 1)}'>`;
  env.createFile(file, `import type { Set } from './probe-rt-helpers'\ntype S0 = ${literal}\nexport type BenchResult = ${expr}`);
  const e0 = performance.now();
  const program = env.languageService.getProgram()!;
  const sf: any = program.getSourceFile(file);
  const alias: any = sf.statements.find((s: any) => isTypeAliasDeclaration(s) && s.name.text === "BenchResult");
  const checker: any = program.getTypeChecker();
  const type = checker.getTypeFromTypeNode(alias.type);
  evalMs += performance.now() - e0;
  const m0 = performance.now();
  const props = checker.getPropertiesOfType(type);
  const next = new Map<string, string>();
  for (const p of props) {
    const t = checker.getTypeOfSymbol(p);
    next.set(p.name, checker.typeToString(t).replaceAll(/['"]/g, ""));
  }
  materialiseMs += performance.now() - m0;
  if (next.size === 0) throw new Error("state did not materialise");
  state = next;
}
const ms = performance.now() - t0;
// correctness: slot 3 was written in chunk 0 (write index 3) and never again if writes*chunks < slots
const spot = state.get(bin(3 * 4));
console.log(`${chunks} chunks x ${writes} writes over ${slots} slots: ${(ms / 1000).toFixed(2)}s -> ${Math.round(chunks * writes / (ms / 1000))} writes/sec`);
console.log(`  eval ${(evalMs / 1000).toFixed(2)}s, materialise ${(materialiseMs / 1000).toFixed(2)}s, slots recovered=${state.size}, slot3=${spot} (expect ${bin(1)})`);
env.close();
