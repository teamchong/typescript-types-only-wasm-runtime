// Watch a running checkpoint and push each new screen to a browser.
//
// The driver writes its checkpoint after every chunk. Each one carries the
// whole of doom's memory, so the screen can be decoded from it without the
// wasm engine - the same read render-frame.ts does, on a timer instead of once.
// Frames go out over a websocket as PNGs, which needs no dependency: the
// handshake is a sha1 of one header, and a binary frame is two bytes plus the
// payload.
//
// Usage: node --import tsx stream.ts <checkpoint.json> [port]
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Socket } from "node:net";
import { encodePng, frameFrom, initialMemoryLiteral } from "./render-frame";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WIDTH = 320;
const HEIGHT = 200;

const checkpointPath = process.argv[2];
const port = Number(process.argv[3] ?? 8787);
if (!checkpointPath) throw new Error("usage: stream.ts <checkpoint.json> [port]");

const page = `<!doctype html>
<title>doom, by the type checker</title>
<style>
  body { background: #111; color: #ccc; font: 13px ui-monospace, monospace;
         display: flex; flex-direction: column; align-items: center; gap: 8px; margin: 24px }
  canvas { width: ${WIDTH * 3}px; height: ${HEIGHT * 3}px; image-rendering: pixelated;
           background: #000 }
</style>
<canvas id=screen width=${WIDTH} height=${HEIGHT}></canvas>
<div id=status>waiting for the checker</div>
<script>
  const ctx = document.getElementById("screen").getContext("2d");
  const status = document.getElementById("status");
  const ws = new WebSocket("ws://" + location.host);
  ws.binaryType = "blob";
  let painted = 0;
  ws.onmessage = async (e) => {
    if (typeof e.data === "string") { status.textContent = e.data; return; }
    const bitmap = await createImageBitmap(e.data);
    ctx.drawImage(bitmap, 0, 0);
    painted++;
  };
  ws.onclose = () => { status.textContent = "disconnected"; };
</script>`;

/// binary frame, server to client: no mask, three length encodings
const wsFrame = (payload: Buffer, opcode = 0x2) => {
  const length = payload.length;
  let header: Buffer;
  if (length < 126) {
    header = Buffer.from([0x80 | opcode, length]);
  } else if (length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }
  return Buffer.concat([header, payload]);
};

const clients = new Set<Socket>();
const initial = initialMemoryLiteral(join(__dirname, "doom.cfg.ts"));

const server = createServer((_req, res) => {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(page);
});

server.on("upgrade", (req, socket: Socket) => {
  const key = req.headers["sec-websocket-key"];
  if (!key) return socket.destroy();
  const accept = createHash("sha1")
    .update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
    .digest("base64");
  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\n" +
      "Upgrade: websocket\r\nConnection: Upgrade\r\n" +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
  );
  clients.add(socket);
  // client frames are masked and we want none of them, but reading has to be
  // drained or the socket stalls
  socket.on("data", () => {});
  socket.on("close", () => clients.delete(socket));
  socket.on("error", () => clients.delete(socket));
  if (last) socket.write(wsFrame(last));
  if (lastStatus) socket.write(wsFrame(Buffer.from(lastStatus), 0x1));
});

let last: Buffer | undefined;
let lastStatus = "";
let lastChunk = -1;
let lastAt = 0;
/// A frame took 3224 chunks to render, measured end to end. Chunk count is set
/// by where the program suspends - calls and block edges - so it barely moves
/// with the fuel setting: 3293 chunks at fuel 1024, 3224 at 16384.
const CHUNKS_PER_FRAME = 3224;
/// chunks a second, smoothed: a single chunk's time swings with how much of the
/// state it touches
let rate = 0;
/// The checkpoint counts the time the checker spent, not the time the run took:
/// the host spends the rest printing and re-parsing the state. Watching both
/// clocks tick gives the share without hardcoding it, and evalMs / share is
/// then the wall time of the whole run, including the part before we attached.
/// Seeded from two full frames - 680s of checker in 1103s, 648s in 1134s - so a
/// checkpoint that has stopped moving still reports, and refined from there.
let share = 0.6;
let lastEvalMs = 0;

const poll = () => {
  let checkpoint: { memory: string; chunks: number; evalMs: number };
  try {
    // the driver rewrites this file while we read it
    checkpoint = JSON.parse(readFileSync(checkpointPath, "utf8"));
  } catch {
    return;
  }
  if (checkpoint.chunks === lastChunk) return;
  const now = performance.now();
  if (lastAt) {
    const sample = ((checkpoint.chunks - lastChunk) / (now - lastAt)) * 1000;
    rate = rate ? rate * 0.8 + sample * 0.2 : sample;
    const evalShare = (checkpoint.evalMs - lastEvalMs) / (now - lastAt);
    if (evalShare > 0 && evalShare <= 1) {
      share = share ? share * 0.8 + evalShare * 0.2 : evalShare;
    }
  }
  lastAt = now;
  lastEvalMs = checkpoint.evalMs;
  lastChunk = checkpoint.chunks;
  const started = performance.now();
  const { rgb, painted } = frameFrom(checkpoint.memory, initial);
  last = encodePng(rgb, WIDTH, HEIGHT);
  const percent = ((painted / (WIDTH * HEIGHT)) * 100).toFixed(1);
  // wall time of the run so far, including whatever ran before we attached
  const wall = share ? checkpoint.evalMs / share : 0;
  const fps = wall ? checkpoint.chunks / CHUNKS_PER_FRAME / (wall / 1000) : 0;
  lastStatus = !fps
    ? `chunk ${checkpoint.chunks} - measuring`
    : `${fps.toFixed(5)} fps (1 frame ~ ${(1 / fps / 60).toFixed(1)} min) - ` +
      `${rate.toFixed(1)} chunks/s, chunk ${checkpoint.chunks} of ~${CHUNKS_PER_FRAME} - ` +
      `${painted}/${WIDTH * HEIGHT} pixels (${percent}%)`;
  for (const socket of clients) {
    socket.write(wsFrame(last));
    socket.write(wsFrame(Buffer.from(lastStatus), 0x1));
  }
};

setInterval(poll, 1000);
server.listen(port, () => console.log(`http://localhost:${port}`));
