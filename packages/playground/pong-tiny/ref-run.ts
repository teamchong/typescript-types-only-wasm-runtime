// Reference run under the real wasm engine: proves the game plays, and measures
// how many memory bytes actually change per frame (the work the type checker
// will have to reproduce).
import { readFile } from "node:fs/promises";

const W = 40, H = 24;
const memory = new WebAssembly.Memory({ initial: 17 });
const bytes = await readFile(new URL("./pong-tiny.wasm", import.meta.url));
const { instance } = await WebAssembly.instantiate(bytes, { env: { memory } });
const frame = instance.exports.frame as (b: number) => number;

const view = new Uint8Array(memory.buffer);
const render = (ptr: number) => {
  const screen = view.subarray(ptr, ptr + W * H);
  const rows: string[] = [];
  for (let y = 0; y < H; y++)
    rows.push(String.fromCharCode(...screen.subarray(y * W, y * W + W)));
  return rows.join("\n");
};

const inputs = [
  ...Array(8).fill(2), ...Array(6).fill(0), ...Array(10).fill(1),
  ...Array(12).fill(0), ...Array(10).fill(2), ...Array(60).fill(0),
];

let prev = new Uint8Array(view.slice(0, 1 << 20));
let changed: number[] = [];
let lastFrame = "";
for (let i = 0; i < inputs.length; i++) {
  const ptr = frame(inputs[i]);
  const now = view.slice(0, 1 << 20);
  let diff = 0;
  for (let b = 0; b < now.length; b++) if (now[b] !== prev[b]) diff++;
  changed.push(diff);
  prev = new Uint8Array(now);
  lastFrame = render(ptr);
  if (process.env.ANIMATE) {
    process.stdout.write("\x1b[H\x1b[2J" + lastFrame + `\nframe ${i + 1}\n`);
    await new Promise((r) => setTimeout(r, 60));
  }
}
console.log(lastFrame);
console.log(`\nscore ${(instance.exports.score1 as () => number)()} - ${(instance.exports.score2 as () => number)()}`);
const after = changed.slice(1);
console.log(`bytes changed per frame: min ${Math.min(...after)}, max ${Math.max(...after)}, mean ${(after.reduce((a, b) => a + b, 0) / after.length).toFixed(1)}`);
