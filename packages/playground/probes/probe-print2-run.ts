import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createEnv, evaluateType } from "../evaluate/ts";
const __dirname = dirname(fileURLToPath(import.meta.url));
const file = join(__dirname, "probe-gen.ts");
const variants: Record<string, string> = {
  importedMapped: `import type { Set } from './probe-helpers'
export type BenchResult = Set<{ a: '1' }, 'b', '2'>`,
  importedForce: `import type { Set, Force } from './probe-helpers'
export type BenchResult = Force<Set<{ a: '1' }, 'b', '2'>>`,
  importedNested: `import type { Set } from './probe-helpers'
export type BenchResult = Set<Set<Set<{ a: '1' }, 'b', '2'>, 'c', '3'>, 'd', '4'>`,
};
for (const [name, src] of Object.entries(variants)) {
  const env = createEnv(file);
  env.createFile(file, src);
  try {
    const { typeString } = await evaluateType(env, file, env.languageService.getProgram()!, undefined, "BenchResult", true);
    console.log(`${name.padEnd(15)} -> ${typeString.slice(0, 90)}`);
  } catch (e) {
    console.log(`${name.padEnd(15)} -> FAILED ${(e as Error).message.split(": ").pop()?.slice(0, 50)}`);
  } finally { env.close(); }
}
