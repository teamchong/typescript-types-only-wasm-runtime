// Runs Doom in the TypeScript type checker: cfg/drive.ts (bundled as run.browser.js)
// walks doom-keys.cfg.ts chunk by chunk, and every chunk is type-checked by a
// TypeScript checker compiled to WebAssembly: tsrs or tsgo. Nothing here
// executes doom.wasm: each frame is read out of the memory the checker's types
// evaluated to.
//
// in:  { runId, keyScript, checker: "tsrs" | "ts7", meta }   a new run: one held-key list per frame
//      { resume: true }                               continue the run saved in OPFS
// out: { kind: "status", text }                   loading / tsc timings
//      { kind: "progress", index, chunks, ms }     a chunk of frame `index` checked
//      { kind: "frame", index, rgba, chunks, ms }  frame `index` finished
//      { kind: "log", text } | { kind: "end", result } | { kind: "error", text }
import { start, moduleShape, rgbaFrom } from "./run.browser.js";
import * as tsrs from "./tsrs/browser.js";
import * as tsgo from "./tsgo/tsgo.js";

const CHECKERS = {
  tsrs: { label: "tsrs", load: () => tsrs.loadModule(new URL("./tsrs/tsrs.wasm", import.meta.url)), tsc: (args, o) => tsrs.tsc(args, { ...o, stackSizeMb: 1024 }) },
  ts7: { label: "tsgo", load: () => tsgo.loadModule(), tsc: (args, o) => tsgo.tsc(args, o) },
};

const post = (m, transfer) => self.postMessage(m, transfer ?? []);

// The run is saved as it goes, so a reload picks it up where it stopped (the
// page reads the same directory; see restoreRun in index.html):
//   meta.json                { runId, meta, keyScript, checker }, written when the run starts
//   <runId>-frames.rgba      every finished frame, 320x200 RGBA, frame n at n * FRAME_BYTES
//   <runId>-ckpt-0/1.json    { seq, point }: drive.ts's checkpoint, after every chunk
//   end.json                 the run reached the end of its script
// The writes are synchronous, through access handles opened before the run:
// drive.ts keeps this thread busy between chunks, and an async OPFS call made
// from onCheckpoint did not settle until the run ended. Checkpoints alternate
// between two files and the reader takes the higher seq, so a tab closed
// mid-write still leaves the previous one whole. A frame is written before the
// checkpoint that counts it done, so a resume never skips one. The runId keeps
// files the previous run still had open when it was terminated (so clearRun
// could not delete them) out of this run.
const RUN_DIR = "current-run";
const FRAME_BYTES = 320 * 200 * 4;
const runDir = (async () => {
  try {
    const root = await navigator.storage.getDirectory();
    return await root.getDirectoryHandle(RUN_DIR, { create: true });
  } catch {
    return null;
  }
})();

const openHandle = async (name) => {
  const dir = await runDir;
  return dir && (await dir.getFileHandle(name, { create: true })).createSyncAccessHandle();
};

const writeAll = (h, bytes, at = 0) => {
  if (at === 0) h.truncate(bytes.byteLength);
  h.write(bytes, { at });
  h.flush();
};

const writeFile = async (name, text) => {
  const h = await openHandle(name);
  if (!h) return;
  try { writeAll(h, new TextEncoder().encode(text)); } finally { h.close(); }
};

const readText = async (name) => {
  const dir = await runDir;
  try {
    return await (await (await dir.getFileHandle(name)).getFile()).text();
  } catch {
    return null;
  }
};

const readCheckpoint = async (runId) => {
  const saved = [];
  for (const i of [0, 1]) {
    const t = await readText(`${runId}-ckpt-${i}.json`);
    try { if (t) saved.push(JSON.parse(t)); } catch { /* torn write; the other file is whole */ }
  }
  return saved.sort((a, b) => b.seq - a.seq)[0] ?? null;
};

const clearRun = async () => {
  const dir = await runDir;
  if (!dir) return;
  const names = [];
  for await (const name of dir.keys()) names.push(name);
  for (const name of names) await dir.removeEntry(name).catch(() => {});
};

// Set up by openStore before the run; null when OPFS is unavailable.
let store = null;
const openStore = async (runId) => {
  try {
    const [frames, ckpt0, ckpt1] = await Promise.all([
      openHandle(`${runId}-frames.rgba`),
      openHandle(`${runId}-ckpt-0.json`),
      openHandle(`${runId}-ckpt-1.json`),
    ]);
    store = frames && { frames, ckpts: [ckpt0, ckpt1] };
  } catch (e) {
    post({ kind: "log", text: `progress will not survive a reload: ${e}` });
  }
};
const saveCheckpoint = (seq, point) => {
  if (store) writeAll(store.ckpts[seq % 2], new TextEncoder().encode(`{"seq":${seq},"point":${JSON.stringify(point)}}`));
};
const saveFrame = (n, rgba) => {
  if (store) writeAll(store.frames, rgba, n * FRAME_BYTES);
};

// A .gz is stored gzipped, not served with Content-Encoding, so inflate it here.
const text = async (url, label) => {
  post({ kind: "status", text: `fetching ${label}` });
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  if (url.endsWith(".gz")) return new Response(r.body.pipeThrough(new DecompressionStream("gzip"))).text();
  return r.text();
};

let assets;
const load = async () => {
  assets ??= (async () => {
    const [moduleText, lib, resume] = await Promise.all([
      text("data/doom-keys.cfg.ts.gz", "doom-keys.cfg.ts (Doom as TypeScript types)"),
      text("data/lib.json", "ts-type-math"),
      text("data/menu-boot.json", "skill-menu checkpoint"),
    ]);
    return { moduleText, libFiles: JSON.parse(lib), resume: JSON.parse(resume), shape: moduleShape(moduleText) };
  })();
  return assets;
};

self.onmessage = async ({ data }) => {
  try {
    let { keyScript, checker: checkerName, runId } = data;
    let resume = null;
    let seq = 0;
    if (data.resume) {
      const saved = JSON.parse((await readText("meta.json")) ?? "null");
      if (!saved) throw new Error("no saved run to resume");
      ({ runId, keyScript, checker: checkerName } = saved);
      const ckpt = await readCheckpoint(runId);
      if (ckpt) ({ seq, point: resume } = ckpt);
    } else {
      await clearRun();
      await writeFile("meta.json", JSON.stringify({ runId, meta: data.meta, keyScript, checker: checkerName }));
    }
    await openStore(runId);
    const checker = CHECKERS[checkerName] ?? CHECKERS.tsrs;
    const a = await load();
    post({ kind: "status", text: `fetching ${checker.label}` });
    await checker.load();
    post({ kind: "status", text: resume ? `resuming at frame ${(resume.scriptFrame ?? 0) + 1}` : "type-checking chunk 1" });
    const t0 = performance.now();
    let index = resume ? (resume.scriptFrame ?? 0) + (resume.done ? 1 : 0) : 0;
    const result = await start({
      tsc: checker.tsc,
      moduleText: a.moduleText,
      libFiles: a.libFiles,
      keyScript,
      resume: resume ?? a.resume,
      fuel: 12288,
      onCheckpoint: (p, path) => {
        if (path.endsWith(".final")) return;
        const ms = performance.now() - t0;
        // mid-frame the screen is in a buffer `entry` has not returned yet
        if (p.scriptFrame !== undefined) index = p.scriptFrame;
        if (!p.done) {
          saveCheckpoint(++seq, p);
          return post({ kind: "progress", index, chunks: p.entryChunks, ms });
        }
        const rgba = rgbaFrom(a.shape, p.memory, p.result);
        saveFrame(index, rgba);
        saveCheckpoint(++seq, p);
        post({ kind: "frame", index, rgba, chunks: p.entryChunks, ms }, [rgba.buffer]);
        index++;
      },
      onLog: (t) => post({ kind: "log", text: t }),
      onCheck: (ms, n) => post({ kind: "status", text: `tsc ${ms.toFixed(0)} ms, ${n} probes` }),
    });
    // A failed run is not finished: leave end.json out so a reload retries from the checkpoint.
    if (!result.failed) await writeFile("end.json", "{}");
    post({ kind: "end", result: { chunks: result.chunks, failed: result.failed, ms: performance.now() - t0 } });
  } catch (e) {
    post({ kind: "error", text: String(e?.stack ?? e) });
  }
};
