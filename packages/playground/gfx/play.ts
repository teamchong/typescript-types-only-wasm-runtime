// Pixel pong, drawn by the type checker.
//
//   pnpm gfx              # play it in the terminal, w/s to move, q to quit
//   FRAMES=60 PNG=1 pnpm gfx   # also write frames/ and an index.html to replay
//
// Every frame is one type evaluation. This file only ferries state: it hands
// the previous frame's memory back in as a type argument, and turns the bytes
// that come out into colours.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createSession, run } from "../cfg/drive";
import { decodeTrie } from "../cfg/trie";
import { toGif } from "./gif";
import type { Frame } from "./pixels";
import { readFrame, toAscii, toPng, toTerminal } from "./pixels";

const __dirname = dirname(fileURLToPath(import.meta.url));
const bin = (n: number) => (n >>> 0).toString(2).padStart(32, "0");

const modulePath = join(__dirname, "gfx.cfg.ts");
const maxFrames = Number(process.env.FRAMES ?? Infinity);
const width = Number(process.env.WIDTH ?? 64);
const height = Number(process.env.HEIGHT ?? 48);
const bits = Number(process.env.BITS ?? 15);
const digitBits = Number(process.env.DIGIT ?? 3);
const writePng = process.env.PNG === "1";
const writeGif = process.env.GIF;
const scripted = process.env.BUTTONS?.split(",").map(Number);

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
const framesDir = join(__dirname, "frames");
if (writePng) mkdirSync(framesDir, { recursive: true });

let memory = "$InitialMemory";
let fuel = Number(process.env.FUEL ?? 4000);
let frame = 0;
let evaluations = 0;
const pngs: string[] = [];
const captured: Frame[] = [];
const started = performance.now();

if (process.env.ASCII !== "1") process.stdout.write("\u001b[2J\u001b[?25l");
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
      process.stdout.write(`\u001b[${height / 2 + 5}H\nstopped: ${result.failed}\n`);
      break;
    }
    memory = result.memory;
    fuel = result.fuel;
    frame++;
    evaluations += result.chunks;

    const words = decodeTrie(memory, bits, digitBits);
    const picture = readFrame(words, parseInt(result.value ?? "0", 2), width, height);
    const fps = 1000 / result.totalMs;

    let out = (process.env.ASCII === "1" ? "\n" : "\u001b[H") + "  pixel pong, every frame computed by the TypeScript type checker\n\n";
    out += process.env.ASCII === "1" ? toAscii(picture) : toTerminal(picture);
    out += `\n  frame ${frame}   ${fps.toFixed(1)} fps   ${result.chunks} evaluation${result.chunks === 1 ? "" : "s"}` +
      `   ${width}x${height} pixels   state ${(memory.length / 1024).toFixed(1)}kB\n`;
    out += `  w/s to move, q to quit${process.stdin.isTTY ? "" : "   (no tty: scripted input)"}   \n`;
    process.stdout.write(out);

    if (writeGif) captured.push(picture);
    if (writePng) {
      const name = `frame-${String(frame).padStart(4, "0")}.png`;
      writeFileSync(join(framesDir, name), toPng(picture));
      pngs.push(name);
    }
  }
} finally {
  process.stdout.write("\u001b[?25h");
  if (process.stdin.isTTY) process.stdin.setRawMode(false);
  const elapsed = (performance.now() - started) / 1000;
  if (writePng && pngs.length) {
    // a tiny player, so the frames can be watched without any tooling
    writeFileSync(
      join(framesDir, "index.html"),
      `<!doctype html><meta charset="utf8">
<title>pixel pong, computed by the TypeScript type checker</title>
<style>
  body { background:#0c0e18; color:#c8d0e0; font:14px ui-monospace,monospace; text-align:center; margin:3rem }
  img { image-rendering:pixelated; width:min(90vw,768px); border:1px solid #2a344e }
</style>
<h1>pixel pong</h1>
<p>${pngs.length} frames, each one type evaluation of ${width}x${height} pixels</p>
<img id="screen">
<script>
  const frames = ${JSON.stringify(pngs)};
  let i = 0;
  const screen = document.getElementById('screen');
  setInterval(() => { screen.src = frames[i++ % frames.length] }, 1000 / 8);
</script>`,
    );
    console.log(`\nwrote ${pngs.length} frames to ${framesDir} (open index.html to replay)`);
  }
  if (writeGif && captured.length) {
    const path = writeGif.endsWith(".gif") ? writeGif : join(framesDir, "pong.gif");
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, toGif(captured, Number(process.env.SCALE ?? 6)));
    console.log(`\nwrote ${captured.length} frames to ${path}`);
  }
  console.log(
    `${frame} frames in ${elapsed.toFixed(1)}s - ${(frame / elapsed).toFixed(1)} fps, ` +
      `${(evaluations / Math.max(frame, 1)).toFixed(2)} evaluations per frame`,
  );
  process.exit(0);
}
