// Fuel is charged one per hop and one per store, so the least fuel that still
// finishes a frame is exactly the frame's hop+store count.
import { join } from "node:path";
import { createSession, run } from "/Users/stevenchongcloudflare.com/repos/typescript-types-only-wasm-runtime/packages/playground/cfg/drive";
const module = "/Users/stevenchongcloudflare.com/repos/typescript-types-only-wasm-runtime/packages/playground/gfx/gfx.cfg.ts";
const bin = (n: number) => (n >>> 0).toString(2).padStart(32, "0");
const session = createSession();
let memory = "$InitialMemory";
for (let i = 0; i < 3; i++) {
  const r = await run(module, "frame", [`'${bin(0)}'`], { fuel: 4000, memory, quiet: true, session });
  memory = r.memory;
}
const fits = async (fuel: number) => {
  const r = await run(module, "frame", [`'${bin(0)}'`], { fuel, memory, quiet: true, session, max: 1 });
  return !r.failed && r.value !== undefined && r.chunks === 1;
};
let low = 1, high = 4000;
while (low < high) {
  const mid = (low + high) >> 1;
  if (await fits(mid)) high = mid; else low = mid + 1;
}
console.log(`a steady frame needs ${low} fuel = ${low} hops+stores`);
process.exit(0);
