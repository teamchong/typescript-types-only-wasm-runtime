import { readFile } from "node:fs/promises";
const memory = new WebAssembly.Memory({ initial: 17 });
const bytes = await readFile(new URL("./pong-tiny.wasm", import.meta.url));
const { instance } = await WebAssembly.instantiate(bytes, { env: { memory } });
const frame = instance.exports.frame as (b: number) => number;
const view = new Uint8Array(memory.buffer);
for (let i = 0; i < 6; i++) {
  const before = view.slice(0, 1 << 20);
  const ptr = frame(i === 0 ? 0 : 2);
  const now = view.slice(0, 1 << 20);
  let diff = 0, firstAt = -1;
  for (let b = 0; b < now.length; b++) if (now[b] !== before[b]) { diff++; if (firstAt < 0) firstAt = b; }
  const dv = new DataView(memory.buffer);
  // state struct starts at the static data base; find it via the screen ptr
  console.log(`frame ${i}: ptr=${ptr} changed=${diff} firstDiffAt=${firstAt} statePtr≈${ptr - 48}`,
    "ball=", dv.getInt32(ptr - 44, true), dv.getInt32(ptr - 40, true));
}
