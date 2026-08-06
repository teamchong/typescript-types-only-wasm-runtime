import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createSession, run } from "./drive";
const root = "/Users/stevenchongcloudflare.com/repos/typescript-types-only-wasm-runtime";
const dir = root + "/packages/playground/cfg/bench/";
const bin = (n: number) => (n >>> 0).toString(2).padStart(32, "0");
const N = Number(process.env.N ?? 200);
const perIter: Record<string, number> = { storechain: 40, storechain8: 24, storechain32: 72, hop: 6, add: 10, and1: 10, and5: 26, load: 11, store: 11, storeword: 13, store32: 11 };
const names = (process.env.CASES ?? "storechain").split(",");
const caps = (process.env.CAPS ?? "6,12").split(",");
const median = (xs: number[]) => xs.slice().sort((a, b) => a - b)[xs.length >> 1];
const out: Record<string, Record<string, string>> = {};
for (const cap of caps) {
  for (const name of names) {
    execFileSync(root + "/target/debug/doom_but_typescript_types", ["--aot-cfg", dir + name + ".wasm"], { stdio: "pipe", env: { ...process.env, DEPTH_CAP: cap } });
    const text = readFileSync(dir + name + ".cfg.ts", "utf8");
    const blocks = (text.match(/^export type \$b/gm) ?? []).length;
    const session = createSession();
    const at = async (n: number) => await run(dir + name + ".cfg.ts", "run", [`'${bin(n)}'`], { fuel: n * perIter[name] + 60, quiet: true, session, max: 12 });
    const pairs: Array<[number, number]> = [];
    let chunks = 0, bad: unknown;
    for (let r = 0; r < Number(process.env.REPS ?? 3); r++) {
      const lo = await at(N), hi = await at(N * 2);
      bad = lo.failed ?? hi.failed;
      if (bad) break;
      chunks = hi.chunks;
      pairs.push([lo.evalMs, hi.evalMs]);
    }
    session.env.close();
    out[name] ??= {};
    if (bad) { out[name][cap] = "FAIL"; console.log(`cap ${cap} ${name} FAILED ${String(bad).slice(0,50)}`); continue; }
    const slope = median(pairs.map(([lo, hi]) => (hi - lo) / N)) * 1000;
    out[name][cap] = slope.toFixed(0);
    console.log(`cap ${cap.padStart(2)} ${name.padEnd(10)} ${slope.toFixed(0).padStart(6)} µs/iter  ${blocks} blocks  ${chunks} chunks`);
  }
}
console.log("\ncase       " + caps.map(c => ("d" + c).padStart(7)).join(""));
for (const n of names) console.log(n.padEnd(11) + caps.map(c => (out[n]?.[c] ?? "-").padStart(7)).join(""));
process.exit(0);
