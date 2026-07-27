// Host driver for a CFG-compiled module.
//
// The compiled module is pure types: every basic block is a type, and a block
// that runs out of fuel returns ['s', '<fn>_<block>', <memory>, ...live values]
// instead of recursing further. This driver evaluates one chunk, reads the
// suspend tuple, and re-enters the named block with fresh fuel - so a run of
// any length is a sequence of bounded type evaluations.
//
// Usage: tsx drive.ts <module.cfg.ts> <entry> [args...] [--fuel N] [--max N]
import { basename, dirname, join } from "node:path";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createEnv, evaluateType } from "../evaluate/ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const bin = (n: number) => (n >>> 0).toString(2).padStart(32, "0");

/// split a printed tuple body on its top-level commas
export const splitTop = (text: string): string[] => {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  let quote = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === '"') quote = false;
      continue;
    }
    if (c === '"') quote = true;
    else if (c === "[") depth++;
    else if (c === "]") depth--;
    else if (c === "," && depth === 0) {
      parts.push(text.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(text.slice(start).trim());
  return parts;
};

/// a printed type ("..." / [..]) turned back into source we can paste
const toSource = (printed: string) => printed.replace(/"/g, "'");

/// Did the checker actually finish, or did it hand back an approximation?
///
/// Running past a limit does not reliably raise an error. The checker can
/// return `errorType`, which prints as `any`; it can leave a conditional
/// deferred and print that type's *constraint*, the union of the branches it
/// never chose; and the printer elides parts of large types as `any` even when
/// the type itself is fine. Any of those pasted into the next chunk corrupts
/// the run silently, so every piece is checked against exactly what the
/// compiler is supposed to emit: nested tuples, the `$Zero` alias for untouched
/// subtrees, and 32-character binary literals.
const WORD = /^"[01]{32}"$/;
// a block name as the compiler spells it: function index, then block index
const BLOCK = /^"?\d+_\d+"?$/;
// `$Zero` and `$InitialMemory` are aliases the compiler emits; the checker
// prints them back and the host can paste them straight into the next chunk
const STATE = /^(?:[[\],\s]|\$Zero|\$InitialMemory|"[01]{32}")+$/;

export const degraded = (
  tag: string,
  state: string,
  live: string,
  value: string,
  globals = "[]",
): string | undefined => {
  if (tag !== '"s"' && tag !== '"r"') return `result tag is ${tag.slice(0, 40)}`;
  if (!STATE.test(state)) {
    const junk = state.match(/any|unknown|\bstring\b|""|\||\$(?!Zero\b|InitialMemory\b)\w+|\.\.\./);
    return `state contains ${junk ? junk[0] : "something unexpected"}`;
  }
  if (tag === '"s"') {
    // the frames are pasted back verbatim, so every part of every one of them
    // has to be exactly what the compiler emits: a block name, then words
    const body = live.slice(live.indexOf("[") + 1, live.lastIndexOf("]"));
    for (const part of splitTop(body)) {
      if (!part.length) continue;
      if (!part.startsWith("[")) return `frame is not a tuple: ${part.slice(0, 40)}`;
      const inner = splitTop(part.slice(part.indexOf("[") + 1, part.lastIndexOf("]")));
      const [name, wants, ...values] = inner.filter((piece) => piece.length > 0);
      if (!BLOCK.test(name ?? "")) return `frame block is not a name: ${String(name).slice(0, 40)}`;
      if (!/^"?[01]"?$/.test(wants ?? "")) return `frame marker is not a flag: ${String(wants).slice(0, 40)}`;
      for (const one of values) {
        if (!WORD.test(one)) return `live value is not a word: ${one.slice(0, 40)}`;
      }
    }
  } else if (value !== '"void"' && !WORD.test(value)) {
    return `return value is not a word: ${value.slice(0, 40)}`;
  }
  // globals travel with every chunk in both directions
  for (const one of splitTop(globals.slice(1, globals.lastIndexOf("]")))) {
    if (one.length && !WORD.test(one)) return `global is not a word: ${one.slice(0, 40)}`;
  }
  return undefined;
};

/// A saved call: the block to come back to, whether a returned value belongs on
/// its stack, and then the values it takes - the locals it reads and the stack
/// it left behind, already in parameter order.
export type Frame = { block: string; wantsValue: boolean; saved: string[] };

/// The printed frame list, turned back into source we can paste. The compiler
/// emits `[['50_105', '000...1'], ['51_2']]`, innermost first.
export const parseFrames = (printed: string): Frame[] => {
  const body = printed.slice(printed.indexOf("[") + 1, printed.lastIndexOf("]"));
  return splitTop(body)
    .filter((part) => part.length > 0)
    .map((part) => {
      const inner = part.slice(part.indexOf("[") + 1, part.lastIndexOf("]"));
      const pieces = splitTop(inner).filter((piece) => piece.length > 0);
      return {
        block: pieces[0].replace(/"/g, ""),
        wantsValue: pieces[1].replace(/"/g, "") === "1",
        saved: pieces.slice(2).map(toSource),
      };
    });
};

/// The call that re-enters a frame: its block, the frames still below it, the
/// memory and globals it inherits, and - when a call is returning into it - the
/// value that call produced, which belongs on the top of its stack.
///
/// `$Exit` wraps it because this is a result the host reads: a return keeps its
/// write buffer inside the types, and only what gets printed has to be flushed.
const printFrame = (f: Frame) =>
  `['${f.block}', '${f.wantsValue ? 1 : 0}'${f.saved.length ? ", " + f.saved.join(", ") : ""}]`;

export const enter = (
  frame: Frame,
  below: Frame[],
  memory: string,
  globals: string[],
  value?: string,
): string => {
  // the value only goes on when the frame asked for one: a void call leaves the
  // stack as it was, and the blocks after it were compiled for that stack
  const returned = frame.wantsValue && value !== undefined ? [value] : [];
  const rest = `[${below.map(printFrame).join(", ")}]`;
  const args = [`$FUEL`, rest, `$Buf<${memory}>`, ...globals, ...frame.saved, ...returned];
  return `$Exit<$b${frame.block}<${args.join(", ")}>>`;
};

/// Did the printer give up part way through?
const TRUNCATED = /\bany\b/;

/// Read the memory, splitting it into branches only if the printer truncated.
///
/// One read is the normal case and costs one evaluation. When the state grows
/// past what the printer will emit, the same subtree is asked for a branch at a
/// time and stitched back together here - the pieces are the checker's own
/// output, so the result is the same text it would have printed if it could.
export const readState = async (
  read: (name: string) => Promise<string>,
  fanout: number,
  // Once a memory has grown past what the printer will emit it does not shrink
  // back, and asking for the whole thing again costs a full print - the most
  // expensive read in the chunk - to learn what we already know. So the caller
  // remembers, and after the first truncation we go straight to the branches.
  splitAlready = false,
): Promise<{ state: string; split: boolean }> => {
  if (!splitAlready) {
    const whole = await read("$Out_Mem");
    if (!TRUNCATED.test(whole) || fanout === 0) return { state: whole, split: false };
  }
  const branches: string[] = [];
  for (let i = 0; i < fanout; i++) {
    const branch = await read(`$Out_Mem_${i}`);
    if (!TRUNCATED.test(branch)) {
      branches.push(branch);
      continue;
    }
    const inner: string[] = [];
    for (let j = 0; j < fanout; j++) {
      inner.push(await read(`$Out_Mem_${i}_${j}`));
    }
    branches.push(`[${inner.join(", ")}]`);
  }
  return { state: `[${branches.join(", ")}]`, split: true };
};

/// Everything needed to pick a run up again: where it was, what it was holding,
/// and how much of it has already been paid for.
export interface Checkpoint {
  call: string;
  memory: string;
  frames: Frame[];
  globals: string[];
  chunks: number;
  evalMs: number;
  split: boolean;
}

export interface RunResult {
  value?: string;
  memory: string;
  chunks: number;
  backoffs: number;
  fuel: number;
  evalMs: number;
  totalMs: number;
  failed?: string;
}

/// One compiler instance, reused across chunks and frames: creating it costs
/// more than a chunk evaluation does.
export type Session = { env: ReturnType<typeof createEnv>; path: string };

export const createSession = (): Session => {
  const path = join(__dirname, `chunk-${process.pid}.ts`);
  return { env: createEnv(path), path };
};

export const run = async (
  modulePath: string,
  entry: string,
  args: string[],
  options: {
    fuel?: number;
    max?: number;
    quiet?: boolean;
    memory?: string;
    session?: Session;
    /// pick up where a previous run left off
    resume?: Checkpoint;
    /// where to write the checkpoint, and how often
    save?: string;
    every?: number;
  } = {},
): Promise<RunResult> => {
  let fuel = options.fuel ?? 64;
  const minFuel = 4;
  const max = options.max ?? 10000;
  const moduleText = readFileSync(modulePath, "utf8")
    // the chunk file inlines the module, so its imports must resolve from here
    .replace(/^export type/gm, "type");
  const fanout = (moduleText.match(/^type \$Kid\d+</gm) ?? []).length;
  // Readers for the memory a branch at a time, two levels down. They cost
  // nothing until one is asked for: a type alias is only instantiated when
  // something reads it, and the whole point is that almost always only the
  // root is read.
  const splitReaders = (() => {
    const lines: string[] = [];
    for (let i = 0; i < fanout; i++) {
      lines.push(`export type $Out_Mem_${i} = $Kid${i}<$Out_Mem>`);
      for (let j = 0; j < fanout; j++) {
        lines.push(`export type $Out_Mem_${i}_${j} = $Kid${j}<$Out_Mem_${i}>`);
      }
    }
    return lines.join("\n");
  })();
  // one '1' per unit of work; taking a prefix off a string is free, unlike
  // re-slicing a tuple on every hop
  const fuelType = (n: number) => `'${"1".repeat(n)}'`;

  let call = `$${entry}<$FUEL, ${options.memory ?? "$InitialMemory"}${args.length ? ", " + args.join(", ") : ""}>`;
  let memory = options.memory ?? "$InitialMemory";
  let chunks = 0;
  let carried = 0;
  // the frames below the block currently running, innermost first: what the
  // host has to hand back to when a call returns after a suspension
  let frames: Frame[] = [];
  // has the memory already outgrown the printer once?
  let split = false;
  if (options.resume) {
    call = options.resume.call;
    memory = options.resume.memory;
    frames = options.resume.frames;
    split = options.resume.split;
    carried = options.resume.chunks;
  }
  let backoffs = 0;
  let evalMs = 0;
  let value_: string | undefined;
  let failed: string | undefined;
  const t0 = performance.now();
  const session = options.session ?? createSession();
  const { env, path } = session;

  while (chunks < max) {
    // The state is printed as its own top-level type, never nested inside the
    // result tuple. Measured reason: the printer elides deeply nested parts as
    // `any` once they sit a couple of levels down inside a bigger type, and
    // that `any` pasted back into the next chunk corrupts memory silently. The
    // *type* is correct either way - only the printout was lossy.
    const file = `${moduleText}
type $FUEL = ${fuelType(fuel)}
type $Result = ${call}
export type $Out_Tag = $Tag<$Result>
export type $Out_Frames = $Frames<$Result>
export type $Out_Globals = $GlobalsOf<$Result>
export type $Out_Value = $ValueOf<$Result>
export type $Out_Mem = $MemOf<$Result>
${splitReaders}
`;
    env.createFile(path, file);
    // A chunk dumped to disk can be re-checked by tsc standalone, which reports
    // Instantiations - a deterministic cost number, unlike wall time.
    if (process.env.DUMP_CHUNKS) {
      writeFileSync(`${process.env.DUMP_CHUNKS}/chunk-${String(chunks).padStart(4, "0")}.ts`, file);
    }
    const e0 = performance.now();
    const read = async (name: string) => {
      const t = performance.now();
      const out = (
        await evaluateType(env, path, env.languageService.getProgram()!, undefined, name, true)
      ).typeString.trim();
      if (process.env.TIME_READS) process.stderr.write(`    read ${name}: ${(performance.now() - t).toFixed(0)}ms\n`);
      return out;
    };
    let tag: string;
    let state: string;
    let live: string;
    let value: string;
    let globals: string;
    try {
      tag = await read("$Out_Tag");
      const read_ = await readState(read, fanout, split);
      state = read_.state;
      split = read_.split;
      // the frames double as the live-value list for the checks below: every
      // value inside them has to be a word, whichever frame it belongs to
      live = tag === '"s"' ? await read("$Out_Frames") : "[]";
      globals = await read("$Out_Globals");
      value = tag === '"r"' ? await read("$Out_Value") : '"void"';
    } catch (error) {
      const message = (error as Error).message.split("\n")[0];
      // TS2589 is the checker refusing outright, rather than quietly handing
      // back an approximation: same remedy, less fuel.
      if (/excessively deep/.test(message) && fuel > minFuel) {
        backoffs++;
        fuel = Math.max(minFuel, Math.floor(fuel / 2));
        if (!options.quiet) process.stdout.write(`\r  chunk ${chunks}: too deep; fuel -> ${fuel}    \n`);
        continue;
      }
      failed = `chunk ${chunks}: ${message}`;
      break;
    }
    evalMs += performance.now() - e0;
    chunks++;

    const bad = degraded(tag, state, live, value, globals);
    if (bad) {
      // too much work for one evaluation: give the same block less fuel so it
      // suspends earlier. This is the checker's real limit, measured.
      if (fuel > minFuel) {
        backoffs++;
        fuel = Math.max(minFuel, Math.floor(fuel / 2));
        if (!options.quiet) process.stdout.write(`\r  chunk ${chunks}: ${bad}; fuel -> ${fuel}    \n`);
        continue;
      }
      failed = `chunk ${chunks} at fuel ${fuel}: ${bad}`;
      writeFileSync(join(__dirname, "failing-chunk.ts"), file);
      writeFileSync(join(__dirname, "failing-output.txt"), `tag ${tag}\nvalue ${value}\nlive ${live}\nstate ${state}`);
      break;
    }

    memory = toSource(state);
    const globalValues = splitTop(globals.slice(1, globals.lastIndexOf("]")))
      .filter((v) => v.length > 0)
      .map(toSource);

    const checkpoint = (next: string) => {
      if (!options.save) return;
      if (chunks % (options.every ?? 100) !== 0) return;
      const point: Checkpoint = {
        call: next,
        memory,
        frames,
        globals: globalValues,
        chunks: carried + chunks,
        evalMs,
        split,
      };
      writeFileSync(options.save, JSON.stringify(point));
    };

    if (tag === '"r"') {
      // A return with frames still pending is a call coming back after
      // something inside it suspended: the caller's inline match is long gone,
      // so the host is what pops the frame and carries on. This is the only
      // reason a return costs a round trip, and it only happens on the way out
      // of a suspension.
      if (frames.length === 0) {
        value_ = value === '"void"' ? undefined : value.replace(/"/g, "");
        break;
      }
      const [resume, ...rest] = frames;
      frames = rest;
      call = enter(resume, rest, memory, globalValues, toSource(value));
      checkpoint(call);
      if (!options.quiet) {
        process.stdout.write(`\r  chunk ${chunks}: returned into ${resume.block}, ${rest.length} frames left   `);
      }
      continue;
    }

    // suspended: the innermost frame is where to pick up, the rest is the
    // stack it has to return through
    const parsed = parseFrames(live);
    if (parsed.length === 0) {
      failed = `chunk ${chunks}: suspended with no frame to resume`;
      break;
    }
    const [innermost, ...outer] = parsed;
    frames = outer;
    call = enter(innermost, outer, memory, globalValues);
    checkpoint(call);
    if (!options.quiet) {
      process.stdout.write(`\r  chunk ${chunks}: suspended in ${innermost.block}, ${outer.length} frames, state ${memory.length} chars   `);
    }
  }
  if (!options.session) env.close();
  if (!options.quiet) process.stdout.write("\n");
  return { value: value_, memory, chunks: carried + chunks, backoffs, fuel, evalMs, totalMs: performance.now() - t0, failed };
};

if (import.meta.url === `file://${process.argv[1]}`) {
  const positional: string[] = [];
  const options: {
    fuel?: number;
    max?: number;
    save?: string;
    every?: number;
    resume?: Checkpoint;
  } = {};
  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];
    if (arg === "--fuel") options.fuel = Number(process.argv[++i]);
    else if (arg === "--max") options.max = Number(process.argv[++i]);
    else if (arg === "--save") options.save = process.argv[++i];
    else if (arg === "--every") options.every = Number(process.argv[++i]);
    else if (arg === "--resume") {
      const from = process.argv[++i];
      options.resume = JSON.parse(readFileSync(from, "utf8")) as Checkpoint;
    } else positional.push(arg);
  }
  const [modulePath, entry, ...rest] = positional;
  const args = rest.map((a) => (/^-?\d+$/.test(a) ? `'${bin(Number(a))}'` : a));
  const result = await run(modulePath, entry, args, options);
  if (result.failed) console.log(`FAILED ${result.failed}`);
  console.log(
    `${basename(modulePath)} ${entry}: ${result.chunks} chunks in ${(result.totalMs / 1000).toFixed(2)}s` +
      (result.value === undefined ? "" : ` -> ${result.value} (${parseInt(result.value, 2) | 0})`),
  );
}
