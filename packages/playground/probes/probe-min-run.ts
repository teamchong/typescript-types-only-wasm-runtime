import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createEnv, evaluateType } from "../evaluate/ts";
const __dirname = dirname(fileURLToPath(import.meta.url));
const file = join(__dirname, "probe-gen.ts");
const base = `type Set<P, A extends string, V extends string> = { [K in keyof P]: K extends A ? V : P[K] }
type Get<P, A extends string> = A extends keyof P ? P[A] : 'zzz'
type S0 = { a: 'x'; b: 'y' }
`;
const variants: Record<string, string> = {
  inline: `${base}export type BenchResult = Get<Set<S0, 'a', 'q'>, 'a'>`,
  viaAlias: `${base}type S1 = Set<S0, 'a', 'q'>
export type BenchResult = Get<S1, 'a'>`,
  aliasChain3: `${base}type S1 = Set<S0, 'a', 'q'>
type S2 = Set<S1, 'b', 'r'>
type S3 = Set<S2, 'a', 's'>
export type BenchResult = Get<S3, 'a'>`,
  readTwice: `${base}type S1 = Set<S0, 'a', 'q'>
export type BenchResult = [Get<S1, 'a'>, Get<S1, 'b'>]`,
};
for (const [name, src] of Object.entries(variants)) {
  const env = createEnv(file);
  env.createFile(file, src);
  try {
    const { typeString } = await evaluateType(env, file, env.languageService.getProgram()!, undefined, "BenchResult", true);
    console.log(`${name.padEnd(12)} -> ${typeString}`);
  } catch (e) {
    console.log(`${name.padEnd(12)} -> FAILED ${(e as Error).message.split(": ").pop()?.slice(0, 60)}`);
  } finally { env.close(); }
}
