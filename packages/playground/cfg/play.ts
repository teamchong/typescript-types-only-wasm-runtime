// Play a CFG-compiled game: run entry(), decode the memory the type checker
// handed back, draw it, repeat.
//
// Nothing here interprets wasm. The whole game step is `$frame<...>` - types
// only - and this file just ferries the state between evaluations and turns the
// bytes into characters.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createSession, run } from "./drive";
import { decodeTrie, render } from "./trie";

const __dirname = dirname(fileURLToPath(import.meta.url));
const bin = (n: number) => (n >>> 0).toString(2).padStart(32, "0");

const modulePath = process.argv[2] ?? join(__dirname, "../pong-tiny/pong-tiny.cfg.ts");
const frames = Number(process.env.FRAMES ?? 4);
let fuel = Number(process.env.FUEL ?? 2048);
const bits = Number(process.env.BITS ?? 15);
const digitBits = Number(process.env.DIGIT ?? 3);
const width = Number(process.env.WIDTH ?? 40);
const height = Number(process.env.HEIGHT ?? 24);
const buttons = (process.env.BUTTONS ?? "0").split(",").map(Number);

const session = createSession();
let memory = "$InitialMemory";
let totalChunks = 0;
const t0 = performance.now();

for (let frame = 0; frame < frames; frame++) {
  const press = buttons[frame % buttons.length] ?? 0;
  const result = await run(modulePath, "frame", [`'${bin(press)}'`], {
    fuel,
    memory,
    quiet: true,
    session,
  });
  if (result.failed) {
    console.log(`frame ${frame} FAILED ${result.failed}`);
    break;
  }
  memory = result.memory;
  fuel = result.fuel; // keep whatever the checker turned out to tolerate
  totalChunks += result.chunks;
  const screen = parseInt(result.value ?? "0", 2);
  const words = decodeTrie(memory, bits, digitBits);
  const rows = render(words, screen, width, height);
  const score1 = words.get((8192 + 44) >>> 2) ?? 0;
  const score2 = words.get((8192 + 48) >>> 2) ?? 0;
  console.log(
    `\nframe ${frame + 1}: ${result.chunks} chunks at fuel ${result.fuel}, ${(result.totalMs / 1000).toFixed(2)}s, ` +
      `screen@${screen}, score ${score1}-${score2}`,
  );
  console.log("+" + "-".repeat(width) + "+");
  for (const row of rows) console.log("|" + row + "|");
  console.log("+" + "-".repeat(width) + "+");
}

console.log(
  `\n${frames} frames, ${totalChunks} chunks, ${((performance.now() - t0) / 1000).toFixed(2)}s total ` +
    `(${(totalChunks / frames).toFixed(1)} chunks/frame)`,
);
