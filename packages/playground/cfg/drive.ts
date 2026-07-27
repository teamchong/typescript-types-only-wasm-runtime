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
// `$Zero` and `$InitialMemory` are aliases the compiler emits; the checker
// prints them back and the host can paste them straight into the next chunk
const STATE = /^(?:[[\],\s]|\$Zero|\$InitialMemory|"[01]{32}")+$/;

export const degraded = (
  tag: string,
  state: string,
  live: string,
  value: string,
): string | undefined => {
  if (tag !== '"s"' && tag !== '"r"') return `result tag is ${tag.slice(0, 40)}`;
  if (!STATE.test(state)) {
    const junk = state.match(/any|unknown|\bstring\b|""|\||\$(?!Zero\b|InitialMemory\b)\w+|\.\.\./);
    return `state contains ${junk ? junk[0] : "something unexpected"}`;
  }
  if (tag === '"s"') {
    for (const part of splitTop(live.slice(1, live.lastIndexOf("]")))) {
      if (part.length && !WORD.test(part)) return `live value is not a word: ${part.slice(0, 40)}`;
    }
  } else if (value !== '"void"' && !WORD.test(value)) {
    return `return value is not a word: ${value.slice(0, 40)}`;
  }
  return undefined;
};

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
  } = {},
): Promise<RunResult> => {
  let fuel = options.fuel ?? 64;
  const minFuel = 4;
  const max = options.max ?? 10000;
  const moduleText = readFileSync(modulePath, "utf8")
    // the chunk file inlines the module, so its imports must resolve from here
    .replace(/^export type/gm, "type");
  // one '1' per unit of work; taking a prefix off a string is free, unlike
  // re-slicing a tuple on every hop
  const fuelType = (n: number) => `'${"1".repeat(n)}'`;

  let call = `$${entry}<$FUEL, ${options.memory ?? "$InitialMemory"}${args.length ? ", " + args.join(", ") : ""}>`;
  let memory = options.memory ?? "$InitialMemory";
  let chunks = 0;
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
export type $Tag = $Result extends [infer T, ...unknown[]] ? T : 'bad'
export type $Block = $Result extends ['s', infer B, ...unknown[]] ? B : 'bad'
export type $Live = $Result extends ['s', unknown, unknown, ...infer L] ? L : []
export type $Value = $Result extends ['r', unknown, infer V] ? V : 'void'
export type $Mem =
  $Result extends ['s', unknown, infer M, ...unknown[]] ? M
  : $Result extends ['r', infer M, ...unknown[]] ? M
  : never
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
    try {
      tag = await read("$Tag");
      state = await read("$Mem");
      live = tag === '"s"' ? await read("$Live") : "[]";
      value = tag === '"r"' ? await read("$Value") : '"void"';
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

    const bad = degraded(tag, state, live, value);
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
    if (tag === '"r"') {
      value_ = value === '"void"' ? undefined : value.replace(/"/g, "");
      break;
    }
    const block = (await read("$Block")).replace(/"/g, "");
    const liveValues = splitTop(live.slice(1, live.lastIndexOf("]"))).filter((v) => v.length > 0).map(toSource);
    // a snapshot is a plain trie; blocks run on buffered memory, so resuming
    // one puts the empty write buffer back around it
    const wrapped = moduleText.includes("type $Buf<") ? `$Buf<${memory}>` : memory;
    call = `$b${block}<$FUEL, ${wrapped}${liveValues.length ? ", " + liveValues.join(", ") : ""}>`;
    if (!options.quiet) {
      process.stdout.write(`\r  chunk ${chunks}: suspended in b${block}, state ${memory.length} chars   `);
    }
  }
  if (!options.session) env.close();
  if (!options.quiet) process.stdout.write("\n");
  return { value: value_, memory, chunks, backoffs, fuel, evalMs, totalMs: performance.now() - t0, failed };
};

if (import.meta.url === `file://${process.argv[1]}`) {
  const positional: string[] = [];
  const options: { fuel?: number; max?: number } = {};
  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];
    if (arg === "--fuel") options.fuel = Number(process.argv[++i]);
    else if (arg === "--max") options.max = Number(process.argv[++i]);
    else positional.push(arg);
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
