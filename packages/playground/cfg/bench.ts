// Per-operation cost, measured the same way the game runs: a wasm loop of N
// iterations, compiled and evaluated in one chunk.
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createSession, run } from "./drive";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "../../..");
const bin = (n: number) => (n >>> 0).toString(2).padStart(32, "0");
const N = Number(process.env.N ?? 200);
const session = createSession();

// hop.wat is the empty loop: everything else is measured against it
const cases = ["hop", "and1", "and5", "add", "add5", "store", "load"];
const timings: Record<string, number> = {};
for (const name of cases) {
  const wasm = join(__dirname, `bench/${name}.wasm`);
  execFileSync(join(root, "target/debug/doom_but_typescript_types"), ["--aot-cfg", wasm], { stdio: "pipe" });
  const module = wasm.replace(/\.wasm$/, ".cfg.ts");
  const result = await run(module, "run", [`'${bin(N)}'`], {
    fuel: N * 6 + 40,
    quiet: true,
    session,
    max: 8,
  });
  if (result.failed) {
    console.log(`${name.padEnd(6)} FAILED ${result.failed.slice(0, 70)}`);
    continue;
  }
  timings[name] = result.evalMs;
  const perOp = result.evalMs / N;
  const net = name === "hop" ? 0 : perOp - timings.hop / N;
  console.log(
    `${name.padEnd(6)} ${(perOp * 1000).toFixed(0).padStart(5)} µs/iteration` +
      (name === "hop" ? "  (empty loop: one hop, one add, one compare)" : `  -> ${(net * 1000).toFixed(0)} µs for the ${name}`) +
      `   ${result.chunks} chunk${result.chunks === 1 ? "" : "s"}`,
  );
}
