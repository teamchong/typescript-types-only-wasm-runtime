// buffered memory vs plain trie: same tag, same live values, same memory
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createEnv, evaluateType } from "../evaluate/ts";
const __dirname = dirname(fileURLToPath(import.meta.url));
const file = join(__dirname, "probe-wc-gen.ts");
const read = async (text: string, name: string) => {
  const env = createEnv(file);
  env.createFile(file, text);
  try {
    return (await evaluateType(env, file, env.languageService.getProgram()!, undefined, name, true)).typeString.trim();
  } catch (e) { return "FAILED " + (e as Error).message.split("\n")[0].slice(0, 70); }
  finally { env.close(); }
};
for (const chunk of ["/tmp/ch/chunk-0000", "/tmp/ch/chunk-0001", "/tmp/chp/chunk-0000", "/tmp/chp/chunk-0001"]) {
  const plain = readFileSync(chunk + ".plain.ts", "utf8");
  const wc = readFileSync(chunk + ".wc.ts", "utf8");
  const results: string[] = [];
  for (const name of ["$Tag", "$Live", "$Value", "$MemFlat"]) {
    const a = await read(plain, name), b = await read(wc, name);
    results.push(`${name} ${a === b ? "ok" : "DIFFERENT"}`);
    if (a !== b) console.log(`  base ${a.slice(0, 120)}\n  wc   ${b.slice(0, 120)}`);
  }
  console.log(`${chunk.split("/").slice(-2).join("/").padEnd(22)} ${results.join("  ")}`);
}
