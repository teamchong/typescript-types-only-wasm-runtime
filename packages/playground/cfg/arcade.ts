// Play pong, where every frame is one TypeScript type evaluation.
//
//   pnpm arcade            # w / s to move, q to quit
//
// The loop here does no game logic. It hands the previous frame's memory to the
// type checker as a type argument, the checker computes the next frame, and the
// bytes that come back are drawn as characters. The `wasm-runtime` process is
// never used: `tsgo` is the CPU.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createSession, run } from "./drive";
import { decodeTrie, render } from "./trie";

const __dirname = dirname(fileURLToPath(import.meta.url));
const bin = (n: number) => (n >>> 0).toString(2).padStart(32, "0");

const modulePath = process.argv[2] ?? join(__dirname, "../pong-tiny/pong-tiny.cfg.ts");
const maxFrames = Number(process.env.FRAMES ?? Infinity);
const width = Number(process.env.WIDTH ?? 40);
const height = Number(process.env.HEIGHT ?? 24);
const bits = Number(process.env.BITS ?? 15);
const digitBits = Number(process.env.DIGIT ?? 3);
const scripted = process.env.BUTTONS?.split(",").map(Number);

// latest key wins; nothing blocks the frame loop
let pressed = 0;
let quit = false;
if (process.stdin.isTTY) {
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (key: string) => {
    if (key === "w" || key === "\u001b[A") pressed = 1;
    else if (key === "s" || key === "\u001b[B") pressed = 2;
    else if (key === "q" || key === "\u0003") quit = true;
  });
}

const session = createSession();
let memory = "$InitialMemory";
let fuel = Number(process.env.FUEL ?? 1500);
let frame = 0;
let slowest = 0;
const started = performance.now();

process.stdout.write("\u001b[2J\u001b[?25l"); // clear, hide cursor
try {
  while (!quit && frame < maxFrames) {
    const button = scripted ? (scripted[frame % scripted.length] ?? 0) : pressed;
    pressed = 0;

    const result = await run(modulePath, "frame", [`'${bin(button)}'`], {
      fuel,
      memory,
      quiet: true,
      session,
    });
    if (result.failed) {
      process.stdout.write(`\u001b[${height + 4}H\nstopped: ${result.failed}\n`);
      break;
    }
    memory = result.memory;
    fuel = result.fuel;
    frame++;
    slowest = Math.max(slowest, result.totalMs);

    const words = decodeTrie(memory, bits, digitBits);
    const screen = parseInt(result.value ?? "0", 2);
    const rows = render(words, screen, width, height);
    const score1 = words.get((8192 + 44) >>> 2) ?? 0;
    const score2 = words.get((8192 + 48) >>> 2) ?? 0;
    const fps = 1000 / result.totalMs;

    // draw in place, so it reads as an animation rather than a log
    let out = "\u001b[H";
    out += `  pong, running inside the TypeScript type checker\n`;
    out += `  +${"-".repeat(width)}+\n`;
    for (const row of rows) out += `  |${row}|\n`;
    out += `  +${"-".repeat(width)}+\n`;
    out += `  ${score1} - ${score2}   frame ${frame}   ${fps.toFixed(1)} fps   ` +
      `${result.chunks} evaluation${result.chunks === 1 ? "" : "s"}   state ${(memory.length / 1024).toFixed(1)}kB\n`;
    out += `  w/s to move, q to quit${process.stdin.isTTY ? "" : "   (no tty: scripted input)"}      \n`;
    process.stdout.write(out);
  }
} finally {
  process.stdout.write("\u001b[?25h"); // show cursor
  if (process.stdin.isTTY) process.stdin.setRawMode(false);
  const elapsed = (performance.now() - started) / 1000;
  console.log(
    `\n${frame} frames in ${elapsed.toFixed(1)}s - ${(frame / elapsed).toFixed(1)} fps average, ` +
      `slowest frame ${(slowest / 1000).toFixed(2)}s`,
  );
  process.exit(0);
}
