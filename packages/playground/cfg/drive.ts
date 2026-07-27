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
// `$Zero`, `$Absent` and `$InitialMemory` are aliases the compiler emits; the
// checker prints them back and the host can paste them straight into the next
// chunk. `"u"` is a subtree the program has never written: it reads through to
// the module's initial memory, so the state only carries what was stored.
// Words that came out of $InitialMemory print with the quotes that file uses,
// so both styles are words. Either one pastes back into the next chunk as is.
const TOKEN = `(?:[[\\],\\s]|\\$Zero|\\$Absent|\\$InitialMemory|["']u["']|"[01]{32}"|'[01]{32}')`;
const STATE = new RegExp(`^${TOKEN}+$`);

/// The first offset the state stops being a state at. This has to walk the same
/// token list the check itself uses: a list that is missing a token the compiler
/// legitimately emits reports the first one of those instead of the thing that
/// actually broke it.
const offence = (state: string): number => {
  const token = new RegExp(TOKEN, "g");
  let at = 0;
  while (at < state.length) {
    token.lastIndex = at;
    const one = token.exec(state);
    if (!one || one.index !== at) return at;
    at = token.lastIndex;
  }
  return at;
};

export const degraded = (
  tag: string,
  state: string,
  live: string,
  value: string,
  globals = "[]",
): string | undefined => {
  if (tag !== '"s"' && tag !== '"r"') return `result tag is ${tag.slice(0, 40)}`;
  if (!STATE.test(state)) {
    const at = offence(state);
    return `state has ${JSON.stringify(state.slice(at, at + 48))} at ${at} of ${state.length}`;
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
  globals: string[],
  value?: string,
): string => {
  // the value only goes on when the frame asked for one: a void call leaves the
  // stack as it was, and the blocks after it were compiled for that stack
  const returned = frame.wantsValue && value !== undefined ? [value] : [];
  const rest = `[${below.map(printFrame).join(", ")}]`;
  const args = [`$FUEL`, rest, `$Buf<$IN>`, ...globals, ...frame.saved, ...returned];
  return `$Exit<$b${frame.block}<${args.join(", ")}>>`;
};

/// Did the printer give up part way through?
/// Fuel per chunk. Evaluation is ~600us per unit and near-linear, so the cost
/// that a chunk cannot amortize is the per-chunk constant: ~100ms to load the
/// module plus ~190ms to print the state, paid whether the chunk ran 64 steps
/// or 4096. Measured on doom chunk-0001, in fuel per wall-clock second:
///
///     512 -> 835    1024 -> 1138    2048 -> 1390    4096 -> 1458
///
/// 8192 is not a choice: it dies with "type instantiation is excessively deep".
/// 4096 is a hair faster than 2048 but per-unit cost has already turned back up
/// there (615us vs 582us) and it sits one doubling from the cliff, where a
/// too-deep chunk throws away a 2.5s evaluation before the backoff halves.
///
/// End to end on doom, running the same 32768 fuel both ways, 2048 wins even
/// though the first chunk is too deep for it and has to back off once:
///
///     1024 x 32 chunks -> 6.78s      2048 x 16 chunks -> 5.01s
const DEFAULT_FUEL = 2048;

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
  // Which readers have already come back truncated. A memory that has outgrown
  // the printer once does not shrink back, and asking again costs a full print -
  // the most expensive read in the chunk - to learn what we already know.
  split: Set<string>,
): Promise<string> => {
  const readOr = async (name: string, children: () => Promise<string>): Promise<string> => {
    if (!split.has(name)) {
      const whole = await read(name);
      if (!TRUNCATED.test(whole)) return whole;
      split.add(name);
    }
    return children();
  };
  if (fanout === 0) return read("$Out_Mem");
  return readOr("$Out_Mem", async () => {
    const branches: string[] = [];
    for (let i = 0; i < fanout; i++) {
      branches.push(
        await readOr(`$Out_Mem_${i}`, async () => {
          const inner: string[] = [];
          for (let j = 0; j < fanout; j++) inner.push(await read(`$Out_Mem_${i}_${j}`));
          return `[${inner.join(", ")}]`;
        }),
      );
    }
    return `[${branches.join(", ")}]`;
  });
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
  split: string[];
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
  let fuel = options.fuel ?? DEFAULT_FUEL;
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

  let call = `$${entry}<$FUEL, $IN${args.length ? ", " + args.join(", ") : ""}>`;
  let memory = options.memory ?? "$Absent";
  let chunks = 0;
  let carried = 0;
  // the frames below the block currently running, innermost first: what the
  // host has to hand back to when a call returns after a suspension
  let frames: Frame[] = [];
  // which memory readers have already outgrown the printer
  let split = new Set<string>(options.resume?.split ?? []);
  // Chunks since the last backoff. A block deep enough to need less fuel is
  // usually a few blocks, not the rest of the run, so the fuel climbs back:
  // staying at half throughput after one awkward block costs more than the
  // occasional retry does.
  let settled = 0;
  if (options.resume) {
    call = options.resume.call;
    memory = options.resume.memory;
    frames = options.resume.frames;
    carried = options.resume.chunks;
  }
  let backoffs = 0;
  let evalMs = 0;
  let value_: string | undefined;
  let failed: string | undefined;
  const t0 = performance.now();
  const session = options.session ?? createSession();
  // The compiler instance is reused across chunks because creating one costs
  // more than a chunk does - but it does not stay fresh forever. After a few
  // thousand chunks it starts handing back `never` for work it did correctly
  // earlier: the same chunk, re-evaluated in a new instance, comes out right.
  // So a failure that survives all the way down to the minimum fuel is treated
  // as the instance being worn out rather than the work being too big.
  let { env, path } = session;
  const recycle = () => {
    env.close();
    const fresh = createSession();
    session.env = fresh.env;
    session.path = fresh.path;
    env = fresh.env;
    path = fresh.path;
  };
  let recycled = 0;
  // Chunks the current compiler has done, and how many the last one managed
  // before it went bad. Wear tracks work, not chunks: in doom's renderer nine
  // chunks is enough, while the memset at the start goes thousands. Waiting to
  // be told costs a wasted evaluation and a run of halvings first, so once one
  // instance has worn out we replace the next one just before the same point.
  let since = 0;
  let lifetime = Infinity;
  // Counted separately from `since`, which any replacement resets: the interval
  // to learn is how long an instance lasts under this phase's work, and a
  // replacement made early on purpose says nothing about that.
  let worked = 0;

  while (chunks < max) {
    // The state is printed as its own top-level type, never nested inside the
    // result tuple. Measured reason: the printer elides deeply nested parts as
    // `any` once they sit a couple of levels down inside a bigger type, and
    // that `any` pasted back into the next chunk corrupts memory silently. The
    // *type* is correct either way - only the printout was lossy.
    const file = `${moduleText}
type $FUEL = ${fuelType(fuel)}
type $IN = ${memory}
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
      state = await readState(read, fanout, split);
      // A chunk that stored nothing hands the memory straight back, and the
      // printer prints it as the alias it came in as rather than expanding it.
      if (state.trim() === "$IN") state = memory;
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
        settled = 0;
        fuel = Math.max(minFuel, Math.floor(fuel / 2));
        if (!options.quiet) process.stdout.write(`\r  chunk ${chunks}: too deep; fuel -> ${fuel}    \n`);
        continue;
      }
      if (recycled !== chunks) {
        recycled = chunks;
        fuel = options.fuel ?? DEFAULT_FUEL;
        lifetime = Math.max(1, worked - 1);
        since = 0;
        worked = 0;
        recycle();
        if (!options.quiet) process.stdout.write(`\r  chunk ${chunks}: worn out; new compiler every ${lifetime}    \n`);
        continue;
      }
      failed = `chunk ${chunks}: ${message}`;
      break;
    }
    evalMs += performance.now() - e0;

    // The chunk counter only advances on a chunk that was accepted. Counting a
    // retry as a chunk moves `chunks` out from under the `recycled !== chunks`
    // guard below, so every retry looks like the first failure of a new chunk:
    // the driver replaces the compiler forever and never reaches the fuel
    // halving. That reads as progress in the log - the chunk numbers climb -
    // while the state stays byte for byte identical.
    const bad = degraded(tag, state, live, value, globals);
    if (bad) {
      // An approximation handed back quietly is not a fuel problem: the same
      // chunk that came back never at fuel 1024 still came back never at fuel
      // 4, then evaluated correctly in a new compiler. So replace the compiler
      // first and only start halving if a fresh one says the same thing.
      if (recycled !== chunks) {
        recycled = chunks;
        lifetime = Math.max(1, worked - 1);
        since = 0;
        worked = 0;
        recycle();
        if (!options.quiet) process.stdout.write(`\r  chunk ${chunks}: ${bad}; new compiler every ${lifetime}    \n`);
        continue;
      }
      if (fuel > minFuel) {
        backoffs++;
        settled = 0;
        fuel = Math.max(minFuel, Math.floor(fuel / 2));
        if (!options.quiet) process.stdout.write(`\r  chunk ${chunks}: ${bad}; fuel -> ${fuel}    \n`);
        continue;
      }
      failed = `chunk ${chunks} at fuel ${fuel}: ${bad}`;
      writeFileSync(join(__dirname, "failing-chunk.ts"), file);
      writeFileSync(join(__dirname, "failing-output.txt"), `tag ${tag}\nvalue ${value}\nlive ${live}\nstate ${state}`);
      break;
    }
    chunks++;
    // A fresh compiler does not make the work smaller, so the fuel that was
    // fitting before still fits. Raising it back to the ceiling here costs a
    // full run of halvings, once per replacement.
    worked++;
    if (++since >= lifetime) {
      recycle();
      since = 0;
    }
    const ceiling = options.fuel ?? DEFAULT_FUEL;
    if (fuel < ceiling && ++settled >= 20) {
      settled = 0;
      fuel = Math.min(ceiling, fuel * 2);
      if (!options.quiet) process.stdout.write(`\r  chunk ${chunks}: settled; fuel -> ${fuel}    \n`);
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
        split: [...split],
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
      call = enter(resume, rest, globalValues, toSource(value));
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
    call = enter(innermost, outer, globalValues);
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
