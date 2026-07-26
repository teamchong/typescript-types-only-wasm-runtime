import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createEnv, evaluateType } from "../evaluate/ts";
const __dirname = dirname(fileURLToPath(import.meta.url));
const file = join(__dirname, "probe-gen.ts");

const variants: Record<string, string> = {
  literal: `export type BenchResult = { a: '1'; b: '2' }`,
  mapped: `type Set<M, A extends string, V> = { [K in keyof M | A]: K extends A ? V : (K extends keyof M ? M[K] : '0') }
export type BenchResult = Set<{ a: '1' }, 'b', '2'>`,
  inferId: `type Set<M, A extends string, V> = { [K in keyof M | A]: K extends A ? V : (K extends keyof M ? M[K] : '0') }
type Id<T> = T extends infer U ? U : never
export type BenchResult = Id<Set<{ a: '1' }, 'b', '2'>>`,
  indexed: `type Set<M, A extends string, V> = { [K in keyof M | A]: K extends A ? V : (K extends keyof M ? M[K] : '0') }
export type BenchResult = { s: Set<{ a: '1' }, 'b', '2'> }['s']`,
  amp: `type Set<M, A extends string, V> = { [K in keyof M | A]: K extends A ? V : (K extends keyof M ? M[K] : '0') }
export type BenchResult = Set<{ a: '1' }, 'b', '2'> & {}`,
  condWrap: `type Set<M, A extends string, V> = { [K in keyof M | A]: K extends A ? V : (K extends keyof M ? M[K] : '0') }
type Force<T> = T extends object ? { [K in keyof T]: T[K] } : never
export type BenchResult = Force<Set<{ a: '1' }, 'b', '2'>>`,
};

for (const [name, src] of Object.entries(variants)) {
  const env = createEnv(file);
  env.createFile(file, src);
  try {
    const { typeString } = await evaluateType(env, file, env.languageService.getProgram()!, undefined, "BenchResult", true);
    console.log(`${name.padEnd(10)} -> ${typeString}`);
  } catch (e) {
    console.log(`${name.padEnd(10)} -> FAILED ${(e as Error).message.split(": ").pop()?.slice(0, 50)}`);
  } finally { env.close(); }
}
