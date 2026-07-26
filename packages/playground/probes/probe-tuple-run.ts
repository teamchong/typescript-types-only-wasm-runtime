import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createEnv, evaluateType } from "../evaluate/ts";
const __dirname = dirname(fileURLToPath(import.meta.url));
const bin = (n: number) => (n >>> 0).toString(2).padStart(32, "0");

// does a tuple of string literals print structurally (i.e. round-trip through the host)?
const slots = 64;
const page = (vals: string[]) => `[${vals.map(v => `'${v}'`).join(", ")}]`;
const src = (vals: string[], writes: Array<[number, string]>) => {
  let expr = "P0";
  for (const [i, v] of writes) expr = `SetIdx<${expr}, ${i}, '${v}'>`;
  return `type SetIdx<P extends readonly string[], I extends number, V extends string> =
  { [K in keyof P]: K extends \`\${I}\` ? V : P[K] }
type P0 = ${page(vals)}
export type BenchResult = ${expr}`;
};

const file = join(__dirname, "probe-gen.ts");
let vals = Array.from({ length: slots }, () => bin(0));
const writes: Array<[number, string]> = [[3, bin(7)], [10, bin(99)], [3, bin(8)]];
writeFileSync(file, src(vals, writes));
const env = createEnv(file);
const { typeString } = await evaluateType(env, file, env.languageService.getProgram()!, undefined, "BenchResult", true);
env.close();
const parsed = typeString.match(/"[01]{32}"/g)?.map(s => s.replaceAll('"', "")) ?? [];
console.log(`printed ${typeString.length} chars, parsed ${parsed.length} slots`);
console.log(`  slot3  = ${parsed[3] ? parseInt(parsed[3], 2) : "?"} (expect 8)`);
console.log(`  slot10 = ${parsed[10] ? parseInt(parsed[10], 2) : "?"} (expect 99)`);
console.log(`  slot0  = ${parsed[0] ? parseInt(parsed[0], 2) : "?"} (expect 0)`);
console.log(`  round-trips: ${parsed.length === slots ? "YES" : "NO"}`);
