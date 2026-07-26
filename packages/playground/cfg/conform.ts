// Compile every wasm module we have with the CFG compiler, run each exported
// function at type level, and compare against the same call made by the real
// engine. Anything the compiler cannot handle is reported as unsupported rather
// than quietly passing.
//
//   node --import tsx/esm conform.ts [glob-ish path fragment]
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createSession, run } from "./drive";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "../../..");
const filter = process.argv[2];
const fuel = Number(process.env.FUEL ?? 2000);
const bin = (n: number) => (n >>> 0).toString(2).padStart(32, "0");
const asI32 = (bits: string) => (parseInt(bits, 2) | 0);

const dirs = [
  join(root, "packages/conformance-tests/from-c"),
  join(root, "packages/conformance-tests/from-wat"),
  join(root, "packages/conformance-tests/from-wat-single"),
];
const modules = dirs
  .filter(existsSync)
  .flatMap((dir) => readdirSync(dir).filter((f) => f.endsWith(".wasm")).map((f) => join(dir, f)))
  .filter((f) => !filter || f.includes(filter));

const session = createSession();
let ok = 0;
let mismatched = 0;
let unsupported = 0;

// arguments to try for exported functions, chosen to exercise both signs
const sampleArgs = [0, 1, 7, -3, 42];

for (const wasmPath of modules) {
  const name = basename(wasmPath);
  let compiled: string;
  try {
    execFileSync(join(root, "target/debug/doom_but_typescript_types"), ["--aot-cfg", wasmPath], {
      stdio: "pipe",
    });
    compiled = wasmPath.replace(/\.wasm$/, ".cfg.ts");
    if (!existsSync(compiled)) throw new Error("no output");
  } catch (error) {
    const message = String((error as { stderr?: Buffer }).stderr ?? (error as Error).message)
      .split("\n")
      .find((l) => l.includes("failed")) ?? "compile failed";
    console.log(`${name.padEnd(28)} unsupported: ${message.replace("aot-cfg failed: ", "").slice(0, 80)}`);
    unsupported++;
    continue;
  }

  // the reference run
  const bytes = readFileSync(wasmPath);
  let instance: WebAssembly.Instance;
  try {
    const memory = new WebAssembly.Memory({ initial: 2 });
    instance = (await WebAssembly.instantiate(bytes, { env: { memory } })).instance;
  } catch (error) {
    console.log(`${name.padEnd(28)} skipped: engine could not instantiate (${(error as Error).message.slice(0, 40)})`);
    continue;
  }

  const source = readFileSync(compiled, "utf8");
  const entries = [...source.matchAll(/^export type \$([A-Za-z_][\w]*)<\$F extends string/gm)].map((m) => m[1]);
  let checked = 0;
  let failures: string[] = [];

  for (const entry of entries) {
    const native = instance.exports[entry];
    if (typeof native !== "function") continue;
    const arity = (source.match(new RegExp(`export type \\$${entry}<[^>]*`))?.[0].match(/\$p\d+/g) ?? []).length;
    const args = sampleArgs.slice(0, arity);
    let expected: number | undefined;
    try {
      expected = (native as (...a: number[]) => number)(...args) | 0;
    } catch {
      continue; // traps natively; not a useful comparison
    }
    const result = await run(compiled, entry, args.map((a) => `'${bin(a)}'`), {
      fuel,
      quiet: true,
      session,
      max: 400,
    });
    checked++;
    if (result.failed) failures.push(`${entry}(${args}) failed: ${result.failed.slice(0, 60)}`);
    else if (result.value === undefined) {
      if (expected !== 0 && expected !== undefined) failures.push(`${entry}(${args}) returned nothing, want ${expected}`);
    } else if (asI32(result.value) !== expected) {
      failures.push(`${entry}(${args}) = ${asI32(result.value)}, want ${expected}`);
    }
  }

  if (!checked) {
    console.log(`${name.padEnd(28)} no comparable exports`);
  } else if (failures.length === 0) {
    console.log(`${name.padEnd(28)} ok (${checked} export${checked === 1 ? "" : "s"} match the engine)`);
    ok++;
  } else {
    console.log(`${name.padEnd(28)} MISMATCH: ${failures[0]}`);
    mismatched++;
  }
}

console.log(`\n${ok} modules match the engine, ${mismatched} mismatched, ${unsupported} unsupported`);
