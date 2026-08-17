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
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createEnv, evaluateType } from "../evaluate/ts";

/// A kill between open and close leaves a truncated checkpoint behind, and the
/// play script reads a file that does not end in `}` as a dead run and starts
/// over: every run this session died that way, each time throwing away frames
/// that took 20 minutes each. rename() is atomic, so a reader gets the whole
/// old checkpoint or the whole new one, never a prefix.
const saveCheckpoint = (path: string, text: string): void => {
  writeFileSync(`${path}.writing`, text);
  renameSync(`${path}.writing`, path);
};

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

/// A word, `u` for a subtree nothing has written, a `$name` the compiler prints
/// as an alias, or a branch. A one element tuple is a leaf standing for every
/// word below it, which is how a whole subtree of one value stays one token.
type Trie = string | Trie[];
const ABSENT = "u";
const ZERO_WORD = "0".repeat(32);

/// `prev` is what the alias `$IN` stands for. A chunk is called as
/// `$entry<$FUEL, $IN, ...>`, so every subtree the chunk did not write prints
/// back as `$IN` rather than as its contents. Resolving it to the trie the host
/// already holds keeps the state small; pasting the name back would make the
/// next state file define `$IN` in terms of itself.
const parseTrie = (src: string, prev: Trie = ABSENT, aliases: Map<string, string> = new Map()): Trie => {
  let at = 0;
  const skip = () => {
    while (at < src.length && (src[at] === "," || /\s/.test(src[at]!))) at++;
  };
  const node = (): Trie => {
    skip();
    if (src[at] === "[") {
      at++;
      const kids: Trie[] = [];
      for (;;) {
        skip();
        if (src[at] === "]") {
          at++;
          break;
        }
        kids.push(node());
      }
      return kids.length === 1 ? kids[0]! : kids;
    }
    if (src[at] === "'" || src[at] === '"') {
      const quote = src[at++];
      const start = at;
      while (at < src.length && src[at] !== quote) at++;
      return src.slice(start, at++);
    }
    const start = at;
    while (at < src.length && !/[\s,\]]/.test(src[at]!)) at++;
    const token = src.slice(start, at);
    if (token === "$IN") return prev;
    const alias = aliases.get(token);
    if (alias !== undefined) return alias;
    return token === "$Zero" ? ZERO_WORD : token === "$Absent" ? ABSENT : token;
  };
  return node();
};

const printTrie = (node: Trie): string =>
  Array.isArray(node)
    ? `[${node.map(printTrie).join(", ")}]`
    : node === ABSENT
      ? "$Absent"
      : node.startsWith("$")
        ? node
        : node === ZERO_WORD
          ? // The module already declares `$Zero = ['<32 zeros>']`, so this is the
            // same leaf spelled in 5 characters instead of 35, and the parser
            // above already reads it back as the word. A zero stored over a
            // nonzero initial word cannot become $Absent - $Fetch would read the
            // module's data back through it - so this is what those words cost.
            // Measured on doom at frame 2, chunk 1270: 21539 of 77343 stored
            // words are that zero.
            "$Zero"
          : `['${node}']`;

/// The state text is 82% word literals - measured on doom at frame 2: 63627 of
/// them, 2.23MB of the 2.73MB - and a word costs 35 characters every chunk
/// however often it repeats. The checker re-parses the whole state on each
/// chunk, so the repeats are what to attack: 10012 of those words are the
/// all-ones word alone. Declaring the common ones as aliases in the state file
/// makes each use 3 characters. 64 is where the measured curve flattens: top-8
/// saves 15% of the text, top-64 saves 25%, top-4096 saves 50%. The extra
/// declarations are cheaper than the text they remove: at doom's frame-5 state
/// (7.3MB), raising the cap from 64 to 4096 cut the emitted state from 5.54MB to
/// 2.75MB and the chunk from 371ms to 243ms, of which tsgo's resolve went 260ms
/// -> 138ms. Past 4096 the text keeps shrinking (2.29MB at 20000) but the time
/// does not (242ms), so the win is the repeated literals, not the node count.
///
/// Before: [['11111111111111111111111111111111'], ['11111111111111111111111111111111']]
/// After:  type $A0 = ['11111111111111111111111111111111']
///         [$A0, $A0]
const ALIAS_TOP = 4096;

const aliasWordsOf = (node: Trie): string[] => {
  const seen = new Map<string, number>();
  const count = (n: Trie): void => {
    if (Array.isArray(n)) {
      for (const kid of n) count(kid);
      return;
    }
    if (n === ABSENT || n.startsWith("$")) return;
    seen.set(n, (seen.get(n) ?? 0) + 1);
  };
  count(node);
  return [...seen]
    .filter(([, hits]) => hits > 1)
    .sort((left, right) => right[1] - left[1])
    .slice(0, ALIAS_TOP)
    .map(([word]) => word);
};

const printAliased = (node: Trie, names: Map<string, string>): string =>
  Array.isArray(node)
    ? `[${node.map((kid) => printAliased(kid, names)).join(", ")}]`
    : node === ABSENT
      ? "$Absent"
      : node.startsWith("$")
        ? node
        : (names.get(node) ?? (node === ZERO_WORD ? "$Zero" : `['${node}']`));

/// A store that writes a word back at the value the module already holds leaves
/// a word in the state that reads exactly like reading through to
/// $InitialMemory would. Dropping it costs the next chunk nothing and the state
/// is 93% words: measured on doom at chunk 765, 37423 words down to 20048.
/// The host reads the memory two levels down and $Kid<M> is a tuple match, so
/// it gives never for a leaf. The top two levels stay branches - 72 nodes, and
/// a leaf that lands there gets split back out into its eight copies.
const SPLIT_DEPTH = 2;


/// Writes one word, splitting any leaf that stands for a whole subtree on the
/// way down. `prune` puts back whatever this leaves collapsible.
const setWord = (node: Trie, word: number, value: string, fanout: number, levels: number): Trie => {
  if (levels === 0) return value;
  const bits = Math.log2(fanout);
  const index = (word >>> ((levels - 1) * bits)) & (fanout - 1);
  const kids: Trie[] = Array.isArray(node) ? node.slice() : Array.from({ length: fanout }, () => node);
  kids[index] = setWord(kids[index]!, word, value, fanout, levels - 1);
  return kids;
};


/// The chunk hands back its overlay, not the whole of memory: every word it
/// wrote, and `u` everywhere it did not. Folding that into the trie the host
/// already holds is a native walk over what changed, which is what makes a
/// store in the types cost 385 instantiations instead of 3661.
const mergeOverlay = (base: Trie, overlay: Trie): Trie => {
  if (overlay === ABSENT) return base;
  if (!Array.isArray(overlay)) return overlay;
  return overlay.map((child, index) =>
    mergeOverlay(Array.isArray(base) ? base[index]! : base, child),
  );
};

/// Reads one word out of the state, falling through `$Absent` to the module's
/// own initial data the way the checker's own loads do.
const getWord = (node: Trie, base: Trie, word: number, fanout: number, levels: number): string => {
  if (levels === 0) return node === ABSENT ? (typeof base === "string" ? base : ZERO_WORD) : (node as string);
  const bits = Math.log2(fanout);
  const index = (word >>> ((levels - 1) * bits)) & (fanout - 1);
  return getWord(
    Array.isArray(node) ? node[index]! : node,
    Array.isArray(base) ? base[index]! : base,
    word,
    fanout,
    levels - 1,
  );
};

const prune = (node: Trie, base: Trie, fanout: number, depth = 0): Trie => {
  const kid = (index: number) => (Array.isArray(base) ? base[index]! : base);
  if (depth < SPLIT_DEPTH && !(typeof node === "string" && node !== ABSENT && node.startsWith("$"))) {
    return Array.from({ length: fanout }, (_unused, index) =>
      prune(Array.isArray(node) ? node[index]! : node, kid(index), fanout, depth + 1),
    );
  }
  if (Array.isArray(node)) {
    const kids = node.map((child, index) => prune(child, kid(index), fanout, depth + 1));
    if (kids.every((child) => child === ABSENT)) return ABSENT;
    const first = kids[0]!;
    if (typeof first === "string" && first !== ABSENT && kids.every((child) => child === first)) return first;
    return kids;
  }
  if (node === ABSENT || node.startsWith("$")) return node;
  return !Array.isArray(base) && base === node ? ABSENT : node;
};

/// Doom reads its keys from one word it never writes:
///
///     volatile int ts_input_mask = 0x5A100000;  /* low 20 bits are the keys */
///
/// `entry` loads it, masks off the sentinel, and hands the bits to
/// `ts_post_input`, which turns each changed bit into a D_PostEvent. A word the
/// host writes into the state shadows the module's data, so a keypress is a
/// single `setWord` per chunk - not a patch of the 117MB module text, which is
/// what the sentinel in the high bits was originally there to find.
const INPUT_SENTINEL = "01011010000100000000000000000000";

/// `ts_post_input` keeps the last word it posted, and compares each incoming
/// bit against it: that shadow is the game's acknowledgement, and it is the
/// only signal the host has that a key was actually taken. Measured on the
/// wasm build, one bit set and then cleared:
///
///     word 0..01, ack 0..00   bit written, frame not run yet
///     word 0..01, ack 0..01   frame ran: keydown posted
///     word 0..00, ack 0..01   bit cleared, frame not run yet
///     word 0..00, ack 0..00   frame ran: keyup posted
///
/// So a press is: set the bit, wait for the ack to show it, clear the bit, wait
/// for the ack to drop it. No frame counting, and it survives the host being
/// restarted between frames, which it is - one process is one frame.
const ACK_WORD = 4410172 / 4;

/// View window size, 11 = fullscreen, 3 = smallest; detail 1 is low (columns
/// doubled). The renderer's cost is per pixel drawn, so this is the one knob
/// that scales the whole frame.
const VIEW_BLOCKS = Number(process.env.VIEW_BLOCKS ?? 6);
const VIEW_DETAIL = Number(process.env.VIEW_DETAIL ?? 1);

/// Bit order is the select chain `ts_post_input` walks: bit 0 ESC, 1 ENTER,
/// 2..5 the arrows, 6 use, 7 fire, 8 y, 9 n, 10..16 the weapon digits, 17 run,
/// 18 strafe, 19 map. The names are KeyboardEvent.code, which is what stream.ts
/// writes to <checkpoint>.input.
const INPUT_BITS = [
  "Escape",
  "Enter",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Space",
  "ControlLeft",
  "KeyY",
  "KeyN",
  "Digit1",
  "Digit2",
  "Digit3",
  "Digit4",
  "Digit5",
  "Digit6",
  "Digit7",
  "ShiftLeft",
  "AltLeft",
  "Tab",
];

/// Where that word lives, as a word index, read off the module's own data
/// rather than hardcoded: the address moves whenever doom is rebuilt.
///
/// It has to come out of the trie the host writes into, not out of a regex over
/// the module text. `$InitialMap` prints the same word as a key nested one page
/// deep - `'0..010010': '0101101..'` - so a flat match reads back the index
/// within the page (18) and its key length as the depth (8 bits, which is not
/// even a whole number of trie levels). setWord then wrote the keys into word
/// 18, the game never saw a keypress, and the menu never opened. Walking
/// `$InitialMemory` gives the whole path: word 50962, byte 203848, which is
/// where the native module holds `ts_input_mask`.
const inputWordOf = (base: Trie, fanout: number) => {
  const walk = (node: Trie, word: number, depth: number): { word: number; levels: number } | undefined => {
    if (!Array.isArray(node)) return node === INPUT_SENTINEL ? { word, levels: depth * Math.log2(fanout) } : undefined;
    for (const [index, child] of node.entries()) {
      const found = walk(child, word * node.length + index, depth + 1);
      if (found) return found;
    }
    return undefined;
  };
  return walk(base, 0, 0);
};

const inputMaskWord = (keys: string[]) => {
  let mask = 0;
  for (const [bit, code] of INPUT_BITS.entries()) if (keys.includes(code)) mask |= 1 << bit;
  // The sentinel stays in the high 12 bits: `entry` ands with 0xFFFFF, so they
  // are dead to the game, and keeping them makes a state word recognisable.
  return (INPUT_SENTINEL.slice(0, 32 - INPUT_BITS.length) +
    mask.toString(2).padStart(INPUT_BITS.length, "0"));
};

/// The module's own initial memory, as the host sees it.
const initialMemory = (moduleText: string): Trie => {
  const marker = "type $InitialMemory = ";
  const at = moduleText.indexOf(marker);
  if (at < 0) return ABSENT;
  const end = moduleText.indexOf("\n", at);
  return parseTrie(moduleText.slice(at + marker.length, end < 0 ? undefined : end));
};

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
// `$IN` is the alias the chunk was called with: subtrees it never wrote print
// under that name, and the parser resolves them against the incoming trie.
const TOKEN = `(?:[[\\],\\s]|\\$Zero|\\$Absent|\\$IN|\\$InitialMemory|\\$A\\d+|["']u["']|"[01]{32}"|'[01]{32}')`;
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
/// Fuel per chunk. What ends a chunk is not wall time but the checker giving
/// up: it stops at 4,029,558 instantiations and reports "excessively deep".
/// Measured on doom chunk 24551 by re-checking the dumped chunk standalone at
/// a fixed state, so the numbers are deterministic:
///
///     fuel     1  ->  1.27M instantiations      fuel  1100 -> 3.57M
///     fuel   768  ->  2.90M                     fuel  1280 -> 3.95M  (ok)
///     fuel  1024  ->  3.43M                     fuel  1536 -> gives up
///
/// Those numbers were measured on the flat `Record<string, string>` memory,
/// where instantiation cost scaled with fuel and the checker gave up past
/// 1280. The 64-way trie broke that link: cost now scales with words touched,
/// not words held, and the same in-level state retires 655,360 fuel in
/// ~1.1s/chunk with zero elisions (measured live at chunk ~4800, E1M1).
/// The adaptive ladder below still doubles from 10 and halves on "too deep",
/// so the default is a cap, not a promise: on states the checker cannot
/// afford, it settles lower by itself. 1,310,720 was knocked back to 655,360
/// on the same state, which is where the ceiling sits today.
/// Extra segments per chunk, on top of the first one.
///
/// A chunk used to be one chain of tail instantiations, and the checker's
/// tail-recursion elision quits at 1000 iterations: measured on a doom chunk,
/// 940 and 980 land while 1000, 1020 and 1060 all report TS2589. Cost was never
/// the limit - the marginal cost is 275 instantiations per instruction, so the
/// 5M instantiation budget is worth ~18,000 of them against the ~1000 the cap
/// allowed.
///
/// `$Drive` re-enters each suspend from an argument position, which starts a
/// fresh chain, so instructions per chunk becomes segments x fuel and the 0.45s
/// of fixed cost per chunk (printing, parsing and binding the state) is
/// amortised over all of them.
/// One segment per chunk: the type-level trampoline does not agree with the
/// host's own resume, so it stays off until it does.
///
/// `$Resume` re-enters a suspend from an argument position, which is worth
/// 3x (3,555 units/s at 0 segments against 11,228 at 64), but it executes a
/// different block than `enter()` does from the same suspend. Cold start,
/// identical fuel, identical state size:
///
///   segments  baseline chunk N      trampoline chunk 1
///   2         4_2, 2 frames, 36992  4_4, 2 frames, 36992
///   8         4_2, 2 frames, 36992  4_4, 2 frames, 36992
///   64        4_2, 2 frames, 36992  4_4, 2 frames, 36992
///
/// It diverges on the very first chunk and compounds: by 327,680 fuel the
/// driven run has `main` returning 0 with SP at 60544 instead of 65536, doom
/// bailing out of init. The baseline is still initializing at 382,720 fuel
/// (13_7, 4 frames, 64,982 chars) and goes on to render.
///
/// Measured since: it is not the frames, it is the memory. `$Flush` returns the
/// overlay and drops the base it sat on, because the host is supposed to hold
/// that base. Inside a chunk there is no host, so every segment boundary throws
/// the previous segment's stores away:
///
///   type M2 = $Store32<$Buf<$Absent>, 174672, 393480>   // pending
///   $Load32<M2, 174672>              -> 393480
///   $Load32<$Buf<M2>, 174672>        -> 0    // what $Resume re-enters with
///   $Load32<$Buf<$Flush<M2>>, 174672> -> 393480
///
/// A read falls through a base with `$Fetch`, which expects a trie: `$Get` on a
/// five-slot buffer answers 'u', so the read skips the overlay under it and
/// lands on the module's initial memory. Cold init died on exactly this - main
/// stores the screen it just allocated at 174672, the next segment dropped the
/// store, Z_Init read 0 back as mainzone, and func 13 walked a null block list
/// forever (172821 chunks in 13_7, locals `0 1 -4 0 24` never moving).
///
/// So a chunk is one segment until `$Resume` can thread the base through.
const SEGMENTS = 0;

const DEFAULT_FUEL = 655360;

/// How long one chunk may take before its fuel counts as over the edge.
///
/// The ceiling above is a cap on instructions, not on time, and the two came
/// apart on doom: a chunk that retires 655,360 fuel in ~1.1s at one state sat
/// for 56 minutes at another. Keys reach the game between chunks, so a chunk
/// that runs for minutes is indistinguishable from a hang at the keyboard.
/// 6s keeps a frame's worth of chunks answering input while leaving room for
/// the 2-4s chunks a busy in-level state costs at fuel 640.
const SLOW_CHUNK_MS = 6000;

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
  /// The run reached a top-level return: `call` is an answer, not a
  /// continuation. Both print as $Exit<..>, so only the driver can tell them
  /// apart, and a resumer that guesses either re-reports an old answer or
  /// throws away a suspended frame.
  done?: boolean;
  call: string;
  memory: string;
  frames: Frame[];
  globals: string[];
  chunks: number;
  /// The address the finished call returned: the screen it drew into.
  result?: string;
  /// The screen the frame *before* this one returned. The renderer draws
  /// `result`, so that buffer has to stay readable; this is the one that is
  /// safe to drop.
  prevResult?: string;
  /// Chunks this `entry` call has done, where `chunks` counts every chunk since
  /// the seed. A frame is one `entry` call, so this is what a reader watches to
  /// see a frame boundary: `chunks` only ever climbs, including across the
  /// re-entry the play loop does for the next frame.
  entryChunks: number;
  evalMs: number;
  split: string[];
  /// The fuel search state, which is a property of the module and not of the
  /// process that found it. Nine evaluations at chunk 0 are spent walking
  /// 655360 down to the edge, and a cold resume that starts at DEFAULT_FUEL
  /// pays them again for an edge the previous run already located. A/B on one
  /// checkpoint, six chunks each, differing only in whether the edge was
  /// saved: 344 units/s with it against 129 without, and the cold run also
  /// overshoots to fuel 1280 where the warm one holds the measured 980.
  fuel?: number;
  /// The lowest fuel known to fail. `Infinity` is not JSON, so an unbounded
  /// cap is written as absent rather than as `null`.
  capFail?: number;
}

export interface RunResult {
  value?: string;
  memory: string;
  chunks: number;
  backoffs: number;
  units: number;
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
  // The module and the incoming state go in `.d.ts` files, and `skipLibCheck`
  // means the checker never checks a declaration file: an alias in there is
  // instantiated only where the chunk actually reads it. Inlined into the
  // chunk instead, every one of the module's ~2200 declarations is resolved
  // before the chunk runs a single step. Measured on doom chunk-0000, a chunk
  // with its evaluation stubbed out to a constant:
  //
  //     inlined     2,768,896 instantiations   0.650s
  //     .d.ts       2,002,187 instantiations   0.285s
  //
  // The evaluation itself is 11,461 instantiations, 0.4% of either number.
  // A declaration file with no top-level import or export is global, so the
  // chunk sees every name in it without importing anything - hence rewriting
  // the one import to `import('ts-type-math').X` types.
  //
  // One alias per imported name, not one `import()` per use site. Every
  // `import(...)` in a file is a dynamic import as far as the compiler is
  // concerned, and it rescans the whole file to locate each one
  // (ForEachDynamicImportOrRequireCall -> GetNodeAtPosition, which walks the
  // AST from the root per occurrence). doom's module inlined 92,751 of them,
  // and the program is rebuilt once per chunk. Measured on a gameplay chunk:
  //
  //     per use site   parse 6.322s   check 0.771s   total 7.312s
  //     one alias      parse 0.806s   check 0.993s   total 2.021s
  //
  // The resulting tag, globals and frames are identical.
  const globalModuleText = (() => {
    const found = /^import type \{([^}]*)\} from ['"]ts-type-math['"];?\n/m.exec(moduleText);
    if (!found) return moduleText;
    let text = moduleText.slice(0, found.index) + moduleText.slice(found.index + found[0].length);
    const aliases: string[] = [];
    for (const raw of found[1].split(",")) {
      const name = raw.trim();
      if (!name) continue;
      // A type alias cannot stand in for a namespace, and `import X =
      // import('m').Y` is not legal here, so only the bare uses collapse to an
      // alias; a qualified head (`Wasm.I32Add`) keeps its inline import. Bare
      // uses are 89,140 of doom's 92,751, so the rescan cost goes with them.
      const alias = `$TTM_${name}`;
      let used = false;
      // not `Convert.WasmValue.ToTSNumber`: only the head of a qualified name
      text = text.replace(new RegExp(`(?<![.\\w$])${name}\\b(\\.)?`, "g"), (_m, dot: string | undefined) => {
        if (dot) return `import('ts-type-math').${name}.`;
        used = true;
        return alias;
      });
      if (used) aliases.push(`type ${alias} = import('ts-type-math').${name};`);
    }
    return aliases.join("\n") + "\n" + text;
  })();
  // the emitter writes these with an `export` in front; a pattern that misses
  // them silently reports a flat memory, and the host then reads `$Out_Mem`
  // whole instead of the split readers and never sees a write land
  const fanout = (moduleText.match(/^(?:export )?type \$Kid\d+</gm) ?? []).length;
  const base = initialMemory(moduleText);
  const inputSlot = inputWordOf(base, fanout);
  const inputPath = options.save ? `${options.save}.input` : "";
  let inputRev = -1;
  // Held keys are a level, but a tap is an edge the poll never sees: a chunk is
  // ~1.5s and a keypress is ~100ms, and 0 of 10 measured Enter taps reached the
  // state while a 5s hold did. The page counts keydowns instead, and each count
  // not yet handed to the game is held down here.
  //
  // How long "held down" has to be is not a guess, and it is not a timer
  // either. `entry` reads the word once, in its first instruction, and hands it
  // to `ts_post_input` before `D_OneFrame`; a measured frame is 194 chunks, so
  // a bit that is up for one chunk is read with probability 1/194 - which is
  // what "I pressed Enter and the menu just sat there" was. The game says when
  // it has taken a key (see ACK_WORD), so a press is a handshake:
  //
  //   idle    -> bit set, once a press is owed
  //   sent    -> hold the bit until the ack shows it: that is the keydown
  //   release -> clear the bit until the ack drops it: that is the keyup
  //
  // Measured: with no released frame between two presses the menu reads them as
  // one long press (`Esc Enter Enter Enter` back-to-back leaves gamestate 3,
  // with a released frame it reaches 0), so `release` is not optional.
  let heldKeys: string[] = [];
  // One process is one frame, so the handshake has to outlive it. `seen` used
  // to be per-process, which re-owed every press the page had ever counted on
  // every frame: that is the menu opening and closing on its own.
  const latchPath = options.save ? `${options.save}.latch` : "";
  const latchState: {
    seen?: Record<string, number>;
    phase?: "idle" | "sent" | "release";
    code?: string;
  } = (() => {
    try {
      return JSON.parse(readFileSync(latchPath, "utf8"));
    } catch {
      return {};
    }
  })();
  const pressesSeen: Record<string, number> = latchState.seen ?? {};
  /// `pressCounts` is a counter in the page's server process; `pressesSeen`
  /// outlives it in the latch file. Measured: the server restarted at 13:20:34
  /// with its counter back at zero while the latch still said
  /// `{Enter:2,Escape:3}`, so `count - seen` was negative for every key and no
  /// press was ever owed again - both badges stuck on "queued" forever. A
  /// count below its seen value can only mean the counter restarted, so drop
  /// the stale seen. Within one session counts only rise, so this cannot
  /// re-send a press that already landed.
  /// Persisted, not just held: the reseat has to survive this process. The
  /// latch is only written when a phase changes, so a reseat that fixed the
  /// counters in memory left `{"Enter":1}` on disk for an hour (measured: the
  /// page server restarted at 16:01 with presses `{}` while the latch still
  /// read `Enter:1` at 15:02), and the next driver would load the stale count
  /// and swallow the next Enter.
  const reseatSeen = (counts: Record<string, number>) => {
    let changed = false;
    for (const code of Object.keys(pressesSeen)) {
      if ((counts[code] ?? 0) < pressesSeen[code]!) {
        pressesSeen[code] = 0;
        changed = true;
      }
    }
    if (changed) saveLatch();
  };
  let phase: "idle" | "sent" | "release" = latchState.phase ?? "idle";
  let sending: string | undefined = latchState.code;
  /// `ts_post_input` runs once per `entry` call, so the ack word only moves at
  /// a frame boundary: measured 40 chunks of a 72-chunk frame with the bit
  /// already cleared and ack still holding the keydown. Waiting for the keyup
  /// ack before accepting the next press therefore costs a second whole frame
  /// (~2.5 min measured), and the page has already retired the count by then,
  /// so the player sees the badge clear and the key do nothing. The keyup does
  /// not need an ack: the bit is cleared in the state, so the game posts it on
  /// its own next frame either way. Go idle as soon as the keydown lands and
  /// only hold back a repeat of that same key until its release is seen - a
  /// same-key press written before the keyup is posted is no edge at all. The
  /// ack word itself says which keys those are, so nothing needs to be latched.
  const saveLatch = () => {
    if (process.env.TRACE_LATCH)
      process.stderr.write(`\nLATCH phase=${phase} code=${sending} seen=${JSON.stringify(pressesSeen)} counts=${JSON.stringify(pressCounts)}\n`);
    if (latchPath) writeFileSync(latchPath, JSON.stringify({ seen: pressesSeen, phase, code: sending }));
  };
  let pressCounts: Record<string, number> = {};
  let inputMask = "";
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
  /// Where a finished frame's successor comes from.
///
/// Calling a spent `entry` again traps: doom's init runs sbrk, and sbrk's bump
/// pointer already moved, so memset runs off the end of memory. Native wasm
/// says so directly - "memory access out of bounds", every memory size from 16
/// to 256 pages - and this runtime turns the same fault into a silent spin,
/// because an out-of-range `$Read` answers 0 instead of trapping.
///
/// Zero that one word and re-entry works. Measured natively, six calls:
///
///   frame 1 ptr 393480  hash 4262db231b
///   frame 2 ptr 655624  hash 6f44692aa8
///   frame 3 ptr 852232  hash a2a8ce9d5b   (title screen, static until the demo)
///
/// The picture advances and each call returns the buffer it drew into, so the
/// frame after this one is `entry` again over the same memory with sbrk reset.
/// Restoring the rest of the allocator's words instead traps in func 12: init
/// wants a virgin zone, and the heap it would re-init is still live.
///
/// sbrk is the function that loads and stores one constant address and calls
/// memset, so the address comes out of the module rather than a constant here.
function sbrkWord(moduleText: string) {
  const funcs = new Map<string, string>();
  for (const m of moduleText.matchAll(/type \$b(\d+)_\d+<[^=]*=([\s\S]*?)(?=(?:export )?type \$)/g))
    funcs.set(m[1]!, (funcs.get(m[1]!) ?? "") + m[2]!);
  for (const [, body] of funcs) {
    const loads = new Set([...body.matchAll(/\$Load32<\$M, '([01]{32})'>/g)].map((m) => m[1]!));
    const stores = new Set([...body.matchAll(/\$Store32<\$[mM]\d*, '([01]{32})'/g)].map((m) => m[1]!));
    const both = [...loads].filter((a) => stores.has(a));
    const calls = new Set([...body.matchAll(/\$call(\d+)</g)].map((m) => m[1]!));
    if (both.length === 1 && calls.size === 1) return both[0]!;
  }
  return undefined;
}

  const entryShape =
    /(?:export )?type \$entry<[^=]*=\s*\$Exit<\$b(\d+)_(\d+)<\$F, \[\], \$Buf<\$M>((?:,\s*'[01]+')*)\s*>>/.exec(moduleText);
  const entryFunc = entryShape?.[1] ?? "";

  const fuelType = (n: number) => `'${"1".repeat(n)}'`;
  // A block whose fuel check asks for a leading `0` is a frame boundary: an
  // ordinary all-ones string cannot match it, so control arriving there suspends
  // and its record reports the loop head's locals. Resuming it needs the one
  // fuel string that gets past the check.
  const boundaryBlocks = new Set(
    [...moduleText.matchAll(/type \$b(\d+_\d+)<[^=]*=\s*\$F extends `0/g)].map((m) => m[1]!),
  );
  const fuelFor = (call: string, n: number) => {
    const at = /\$b(\d+_\d+)</.exec(call)?.[1];
    return at && boundaryBlocks.has(at) ? `'0${"1".repeat(Math.max(n - 1, 0))}'` : fuelType(n);
  };

  let call = `$${entry}<$FUEL, $IN${args.length ? ", " + args.join(", ") : ""}>`;
  // `$Absent` is not an empty address space: a read falls through it to the
  // module's own data. Measured against the module's accessors:
  //
  //   $Load32<$Buf<$Absent>, 65536>   -> 8       (the bucket size table)
  //   $Load32<$Buf<$Absent>, 173636>  -> 76800
  //
  // So a cold run starts here, and `prune` collapsing a subtree back to
  // `$Absent` is how the state stays small rather than a loss.
  let memory = options.memory ?? "$Absent";
  let memoryTrie: Trie = parseTrie(memory);
  // the table the current chunk's state file declares, to read its result back
  let aliasBack = new Map<string, string>();
  let chunks = 0;
  let carried = 0;
  let lastGlobals: string[] = [];
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
    // A checkpoint saved after the run finished holds a terminal call, $Exit<..>.
    // Resuming that re-reports the same answer without running anything, so the
    // frame never advances. Start a fresh call instead: doom keeps the whole
    // game in linear memory, so resumed memory plus a new `entry` is the next
    // frame. Only a suspended call is worth picking up where it left off.
    if (!options.resume.done) {
      call = options.resume.call;
      frames = options.resume.frames;
    } else {
      // $entry bakes the module-initial globals into its own call, so calling it
      // again rewinds the stack pointer while memory keeps a heap grown past it:
      // A fresh call, with sbrk reset so init can run again (see sbrkWord).
      // The globals are $entry's own baked ones, not the ones the last return
      // left: native re-entry is a fresh call, and that is what animates.
      const shape =
        // `moduleText` has already had its `export ` prefixes stripped
        /(?:export )?type \$entry<[^=]*=\s*\$Exit<\$b(\d+_\d+)<\$F, \[\], \$Buf<\$M>((?:,\s*'[01]+')*)\s*>>/.exec(
          moduleText,
        );
      if (!shape) throw new Error("cannot find $entry's call in the module: nothing to restart");
      const baked = shape[2]!.match(/'[01]+'/g) ?? [];
      // ...except the page count, which is not part of a call. It is the last
      // global (`memory.size` answers it), an instance only ever grows it, and
      // doom writes what it implies into its own heap bookkeeping: 174508 holds
      // `memory.size << 16 - 393216`. Frame 2 read that back as a heap it had
      // and a `memory.size` it did not:
      //
      //   174508 = 524288   -> 14 pages when the frame before stored it
      //   $entry's baked g1 = 6
      //
      // so sbrk asked to grow by (524288 - what 6 pages hold) >> 16 = 28277
      // pages, over the trie's 1024, took the refused-grow path and landed on
      // `unreachable` - which is `never`, and reads back as `result tag is
      // never` at every fuel: FAILED chunk 0 at fuel 4 after 4589 chunks and
      // two landed frames (393480, then 655624).
      const carried = options.resume.globals ?? [];
      const pages = baked.length - 1;
      if (carried[pages] !== undefined) baked[pages] = carried[pages]!;
      const sbrk = sbrkWord(moduleText);
      if (!sbrk) throw new Error("cannot find sbrk's bump pointer in the module: re-entry would trap in init");
      const zero = `'${"0".repeat(32)}'`;
      call =
        `$Exit<$b${shape[1]}<$FUEL, [], $Store32<$Buf<$IN>, '${sbrk}', ${zero}>` +
        `${baked.map((g) => `, ${g}`).join("")}>>`;
    }
    // a state saved before the split levels were kept can hold a leaf up top
    memoryTrie = prune(parseTrie(options.resume.memory), base, fanout);
    memory = printTrie(memoryTrie);
    carried = options.resume.chunks;
  }
  // An explicit --fuel is an instruction and outranks the saved edge; the
  // checkpoint only speaks when the caller did not.
  if (options.fuel === undefined && options.resume?.fuel !== undefined) {
    fuel = options.resume.fuel;
  }
  let backoffs = 0;
  // The fuel that lands is a cliff, not a slope: measured on one real chunk in
  // the session, 640/720/800/960 all come back with a tag and cost the same
  // (852/814/799/803ms), 1120 and 1280 come back never. Cost per chunk barely
  // moves with fuel, so the instructions covered per chunk is set by how close
  // the fuel sits to that edge, and doubling past it wastes a whole evaluation.
  // The cap is not inherited across a restart. It is one chunk's verdict, and
  // the chunk it failed on is long gone: the live checkpoint carried
  // capFail 240 and so ran at fuel 210, while the same state re-probed from
  // scratch holds 960 (measured on 3 chunks each: 107 units/s at 210,
  // 233 at 480, 497 at 960, and only then the cliff - 42 at 1920). Re-deriving
  // costs one slow chunk per restart; keeping a stale cap cost 4.6x forever.
  let capFail = Infinity;
  // The fuel we are resuming at already landed for the run that saved it, so
  // it is a floor to back off to, not an unknown to re-derive.
  let lastGood = options.fuel === undefined && options.resume?.fuel !== undefined
    ? options.resume.fuel
    : 0;
  let units = 0;
  let evalMs = 0;
  let trieMs = 0;
  let trieParseMs = 0;
  let triePruneMs = 0;
  let triePrintMs = 0;
  let fileMs = 0;
  let saveMs = 0;
  let recycles = 0;
  const why: Record<string, number> = {};
  const lifetimes: number[] = [];
  let recycleMs = 0;
  let degMs = 0;
  let globMs = 0;
  // Every millisecond of the loop lands in exactly one bucket: `mark` closes
  // the span since the previous mark, and the first mark of an iteration
  // closes the tail of the one before it, including the `continue` paths.
  const spans: Record<string, number> = {};
  let last = performance.now();
  const mark = (name: string) => {
    const now = performance.now();
    spans[name] = (spans[name] ?? 0) + (now - last);
    last = now;
  };
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
  // Doom renders the view window, not the screen: R_ExecuteSetViewSize sizes it
  // from `setblocks`, and every pixel loop below it costs per pixel. Measured on
  // the native module, 3000 frames, blocks/detail against ms/frame:
  //
  //   11/0 0.105 (1.00x)  9/1 0.084 (1.25x)  7/1 0.062 (1.69x)
  //   6/1 ~0.055 (~1.9x)  5/1 0.038 (2.76x)  3/1 0.033 (3.14x)
  //
  // The same instructions run in the type runtime, so the ratio carries. These
  // are the three words the menu's own size handler writes; `setsizeneeded` is
  // consumed by the next D_Display and the window then stays where it is put.
  if (inputSlot && process.env.VIEW_SIZE) {
    const levels = inputSlot.levels / Math.log2(fanout);
    const bits = (n: number) => n.toString(2).padStart(32, "0");
    for (const [word, value] of [
      [4463604 / 4, VIEW_BLOCKS],
      [4463608 / 4, VIEW_DETAIL],
      [4463600 / 4, 1], // setsizeneeded
    ] as const) {
      memoryTrie = setWord(memoryTrie, word, bits(value), fanout, levels);
    }
    memoryTrie = prune(memoryTrie, base, fanout);
    memory = printTrie(memoryTrie);
    if (process.env.VIEW_PROBE)
      for (const w of [4463600 / 4, 4463604 / 4, 4463608 / 4])
        process.stderr.write(`VIEW word=${w} val=${getWord(memoryTrie, base, w, fanout, levels)}\n`);
  }
  if (inputSlot && process.env.ACK_ZERO) {
    const levels = inputSlot.levels / Math.log2(fanout);
    memoryTrie = prune(
      setWord(memoryTrie, ACK_WORD, "0".repeat(32), fanout, levels),
      base,
      fanout,
    );
    memory = printTrie(memoryTrie);
    process.stderr.write(`ACKZERO ${getWord(memoryTrie, base, ACK_WORD, fanout, levels)}\n`);
  }
  const modulePathDts = join(__dirname, `module-${process.pid}.d.ts`);
  const statePathDts = join(__dirname, `state-${process.pid}.d.ts`);
  // The module text never changes, so it is written once per compiler instance.
  env.createFile(modulePathDts, globalModuleText);
  const recycle = (reason: string) => {
    const c0 = performance.now();
    env.close();
    const fresh = createSession();
    session.env = fresh.env;
    session.path = fresh.path;
    env = fresh.env;
    path = fresh.path;
    env.createFile(modulePathDts, globalModuleText);
    recycles++;
    why[reason] = (why[reason] ?? 0) + 1;
    recycleMs += performance.now() - c0;
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
    mark("tail");
    // Keys, if the browser sent any since the last chunk. Writing the word
    // every chunk (rather than once a frame) is what makes a tap land: a press
    // and its release can both arrive inside one frame's worth of chunks.
    if (inputSlot && inputPath) {
      try {
        const sent = JSON.parse(readFileSync(inputPath, "utf8")) as {
          rev: number;
          keys: string[];
          presses?: Record<string, number>;
        };
        if (sent.rev !== inputRev) {
          inputRev = sent.rev;
          heldKeys = sent.keys ?? [];
          pressCounts = sent.presses ?? {};
          reseatSeen(pressCounts);
        }
        // What the game says it last took, read out of the state the same way
        // the module would read it.
        const ack = parseInt(
          getWord(memoryTrie, base, ACK_WORD, fanout, inputSlot.levels / Math.log2(fanout)),
          2,
        );
        const bitOf = (code: string) => 1 << INPUT_BITS.indexOf(code);
        if (process.env.TRACE_LATCH)
          process.stderr.write(
            `\nACK chunk=${chunks} ack=${ack.toString(2)} word=${getWord(memoryTrie, base, inputSlot.word, fanout, inputSlot.levels / Math.log2(fanout))} phase=${phase} code=${sending} counts=${JSON.stringify(pressCounts)} seen=${JSON.stringify(pressesSeen)}\n`,
          );
        /// A key whose ack bit is still high is one the game has posted a
        /// keydown for and not yet a keyup. Writing that bit again is not an
        /// edge, so the press would vanish; and a bit left high from before
        /// this run - the stale live state carried `Enter` high - would read
        /// as an instant landing for a press the game never saw. Both cases
        /// are the same rule: only send a key whose ack bit is low.
        const nextPress = () =>
          Object.keys(pressCounts).find(
            (code) =>
              INPUT_BITS.includes(code) &&
              pressCounts[code]! - (pressesSeen[code] ?? 0) > 0 &&
              (ack & bitOf(code)) === 0,
          );
        // The server keeps only the newest intent. If another key arrives
        // before the game acknowledges this keydown, replace it now instead
        // of making the player wait a whole frame for an obsolete press. Once
        // ack is high the keydown landed and its release must still complete.
        const replacement = nextPress();
        if (
          phase === "sent" &&
          sending &&
          replacement &&
          replacement !== sending &&
          (ack & bitOf(sending)) === 0
        ) {
          phase = "idle";
          sending = undefined;
          saveLatch();
        }
        if (phase === "idle") {
          sending = nextPress();
          if (sending) {
            phase = "sent";
            saveLatch();
          }
        } else if (phase === "sent" && sending && (ack & bitOf(sending)) !== 0) {
          // keydown landed: the press is spent. Clearing the bit here is the
          // keyup; the game posts it next frame with no further help.
          pressesSeen[sending] = (pressesSeen[sending] ?? 0) + 1;
          phase = "idle";
          sending = undefined;
          saveLatch();
        } else if (phase === "release" && sending) {
          // a latch written by the older two-ack machine
          pressesSeen[sending] = (pressesSeen[sending] ?? 0) + 1;
          phase = "idle";
          sending = undefined;
          saveLatch();
        }
        const latched = phase === "sent" && sending ? [sending] : [];
        const mask = inputMaskWord([...heldKeys, ...latched]);
        if (mask !== inputMask) {
          inputMask = mask;
          memoryTrie = prune(
            setWord(memoryTrie, inputSlot.word, mask, fanout, inputSlot.levels / Math.log2(fanout)),
            base,
            fanout,
          );
          memory = printTrie(memoryTrie);
        }
      } catch {
        // no input file yet, or a half-written one: the game just sees no keys
      }
    }
    // The state is printed as its own top-level type, never nested inside the
    // result tuple. Measured reason: the printer elides deeply nested parts as
    // `any` once they sit a couple of levels down inside a bigger type, and
    // that `any` pasted back into the next chunk corrupts memory silently. The
    // *type* is correct either way - only the printout was lossy.
    const f0 = performance.now();
    const aliasWords = aliasWordsOf(memoryTrie);
    const aliasNames = new Map(aliasWords.map((word, index) => [word, `$A${index}`]));
    aliasBack = new Map(aliasWords.map((word, index) => [`$A${index}`, word]));
    mark("alias");
    const stateText = `${aliasWords
      .map((word, index) => `type $A${index} = ['${word}']`)
      .join("\n")}\ntype $IN = ${printAliased(memoryTrie, aliasNames)}\n`;
    mark("print");
    env.createFile(statePathDts, stateText);
    const file = `type $FUEL = ${fuelType(fuel)}
type $OUTER = ${fuelType(SEGMENTS)}
type $Result = $Drive<$OUTER, $FUEL, ${call}>
export type $Out_Tag = $Tag<$Result>
export type $Out_Frames = $Frames<$Result>
export type $Out_Globals = $GlobalsOf<$Result>
export type $Out_Value = $ValueOf<$Result>
export type $Out_Mem = $MemOf<$Result>
${splitReaders}
`;
    env.createFile(path, file);
    fileMs += performance.now() - f0;
    mark("file");
    // A chunk dumped to disk can be re-checked by tsc standalone, which reports
    // Instantiations - a deterministic cost number, unlike wall time.
    if (process.env.DUMP_CHUNKS) {
      const stem = `${process.env.DUMP_CHUNKS}/chunk-${String(chunks).padStart(4, "0")}`;
      // the module and state live in sibling declaration files now, so a dump
      // is only re-checkable standalone if all three land next to each other
      writeFileSync(`${stem}.ts`, file);
      writeFileSync(`${stem}.state.d.ts`, stateText);
      writeFileSync(`${process.env.DUMP_CHUNKS}/module.d.ts`, globalModuleText);
    }
    const e0 = performance.now();
    // One program per chunk, not one per read. `getProgram()` re-synchronises
    // the language service against the file system, and this chunk asks for 77
    // types: the state file gets re-parsed and re-bound 76 times for nothing.
    const p0 = performance.now();
    const chunkProgram = env.languageService.getProgram()!;
    const syncMs = performance.now() - p0;
    if (process.env.TIME_READS) process.stderr.write(`    getProgram: ${syncMs.toFixed(0)}ms\n`);
    // Where the forcing read actually goes: resolving the type, or printing it.
    if (process.env.TIME_SPLIT) {
      const sf = chunkProgram.getSourceFile(path)!;
      const alias = [...sf.statements].find(
        (n) => (n as { name?: { text?: string } }).name?.text === "$Out_Tag",
      ) as unknown as { type: Parameters<ReturnType<typeof chunkProgram.getTypeChecker>["getTypeFromTypeNode"]>[0] };
      const checker = chunkProgram.getTypeChecker();
      const a0 = performance.now();
      const resolved = checker.getTypeFromTypeNode(alias.type);
      const a1 = performance.now();
      checker.typeToString(resolved, undefined, 1 << 0);
      const a2 = performance.now();
      process.stderr.write(`    $Out_Tag resolve ${(a1 - a0).toFixed(0)}ms print ${(a2 - a1).toFixed(0)}ms\n`);
    }
    const read = async (name: string) => {
      const t = performance.now();
      const out = (
        await evaluateType(env, path, chunkProgram, undefined, name, true)
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
        capFail = Math.min(capFail, fuel);
        // Strictly below the fuel that just failed, or the run livelocks: a
        // chunk that lands at 1280 sets lastGood there, and a later chunk that
        // fails at 1280 asks for 1280 again forever (seen at chunk 186).
        fuel = lastGood > 0 && lastGood < fuel
          ? lastGood
          : Math.max(minFuel, Math.floor(fuel / 2));
        if (lastGood >= fuel) lastGood = 0;
        if (!options.quiet) process.stdout.write(`\r  chunk ${chunks}: too deep; fuel -> ${fuel}    \n`);
        mark("retry");
        continue;
      }
      if (recycled !== chunks) {
        recycled = chunks;
        fuel = options.fuel ?? DEFAULT_FUEL;
        lifetime = Math.max(1, worked - 1);
        since = 0;
        worked = 0;
        recycle("worn");
        if (!options.quiet) process.stdout.write(`\r  chunk ${chunks}: worn out; new compiler every ${lifetime}    \n`);
        mark("retry");
        continue;
      }
      failed = `chunk ${chunks}: ${message}`;
      break;
    }
    const chunkMs = performance.now() - e0;
    evalMs += chunkMs;
    mark("eval");

    // The ladder below climbs on success and only backs off when a chunk
    // *fails*. A chunk that merely takes forever never fails, so the climb can
    // walk into a fuel where one evaluation runs for an hour: measured live,
    // the checkpoint at 18:34 carried fuel 640, the ladder doubled from there,
    // and the compiler then sat on one chunk for 56 minutes at 99% CPU. Keys
    // are only posted between chunks, so the game stops answering the keyboard.
    // The same state runs 2.5s/chunk at fuel 640.
    //
    // Time is the thing that matters here, so bound it: a chunk slower than
    // this marks its fuel as over the edge, the same as a failure would.
    //
    // Only fuel that has not landed yet can be blamed for the time. Most of a
    // chunk is not the fuel: at fuel 157-315 the same state still costs
    // 4.3-4.5s a chunk, while at 960 it costs 1.9-2.9s. Charging that floor to
    // the fuel makes the guard cut a fuel that was never the cost, and each cut
    // buys fewer instructions for the same 4.4s - the live session walked
    // itself down to 157 and 49 units/s that way. `lastGood` is the last fuel
    // that produced an accepted chunk, so `fuel > lastGood` is true only on the
    // first chunk after a climb - the one that can actually run for an hour.
    if (chunkMs > SLOW_CHUNK_MS && fuel > minFuel && fuel > lastGood) {
      capFail = Math.min(capFail, fuel);
      fuel = Math.max(minFuel, Math.floor(fuel / 2));
      settled = 0;
      if (!options.quiet) {
        process.stdout.write(
          `\r  chunk ${chunks}: slow (${(chunkMs / 1000).toFixed(1)}s); fuel -> ${fuel}    \n`,
        );
      }
    }

    // The chunk counter only advances on a chunk that was accepted. Counting a
    // retry as a chunk moves `chunks` out from under the `recycled !== chunks`
    // guard below, so every retry looks like the first failure of a new chunk:
    // the driver replaces the compiler forever and never reaches the fuel
    // halving. That reads as progress in the log - the chunk numbers climb -
    // while the state stays byte for byte identical.
    const d0 = performance.now();
    const bad = degraded(tag, state, live, value, globals);
    if (process.env.DUMP_BAD && bad) {
      process.stderr.write(`\n[DUMP_BAD] ${bad}\n  tag=${tag}\n  live=${live.slice(0, 4000)}\n  state=${state.slice(0, 400)}\n`);
    }
    degMs += performance.now() - d0;
    mark("degraded");
    if (bad) {
      // A bare `any` is the checker having hit its own instantiation budget on
      // a block that is too big to resolve at all - the compile-time caps, not
      // anything about this run. It is deterministic: every retry below (fresh
      // compiler, then fuel halving all the way to minFuel) reproduces it, so
      // the ladder just turns one wrong answer into a long one. arith120 at
      // PIPELINE_CAP=64 walked fuel 20000 -> 4 reporting a fuel problem the
      // whole way. Say what it is and stop.
      if (/\bany\b/.test(bad)) {
        failed = `chunk ${chunks}: ${bad}
  the checker gave up on a block rather than running out of fuel - a block is
  too large to resolve, so lower DEPTH_CAP or PIPELINE_CAP and recompile.
  (a bare \`tsc\` on the generated module reports this as TS2589.)`;
        writeFileSync(join(__dirname, "failing-chunk.ts"), file);
        writeFileSync(join(__dirname, "failing-output.txt"), `tag ${tag}\nvalue ${value}\nlive ${live}\nstate ${state}`);
        break;
      }
      // An approximation handed back quietly is not a fuel problem: the same
      // chunk that came back never at fuel 1024 still came back never at fuel
      // 4, then evaluated correctly in a new compiler. So replace the compiler
      // first and only start halving if a fresh one says the same thing.
      if (recycled !== chunks) {
        recycled = chunks;
        lifetime = Math.max(1, worked - 1);
        since = 0;
        worked = 0;
        recycle("bad");
        if (!options.quiet) process.stdout.write(`\r  chunk ${chunks}: ${bad}; new compiler every ${lifetime}    \n`);
        mark("retry");
        continue;
      }
      if (fuel > minFuel) {
        backoffs++;
        settled = 0;
        capFail = Math.min(capFail, fuel);
        // Strictly below the fuel that just failed, or the run livelocks: a
        // chunk that lands at 1280 sets lastGood there, and a later chunk that
        // fails at 1280 asks for 1280 again forever (seen at chunk 186).
        fuel = lastGood > 0 && lastGood < fuel
          ? lastGood
          : Math.max(minFuel, Math.floor(fuel / 2));
        if (lastGood >= fuel) lastGood = 0;
        if (!options.quiet) process.stdout.write(`\r  chunk ${chunks}: ${bad}; fuel -> ${fuel}    \n`);
        mark("retry");
        continue;
      }
      failed = `chunk ${chunks} at fuel ${fuel}: ${bad}`;
      writeFileSync(join(__dirname, "failing-chunk.ts"), file);
      writeFileSync(join(__dirname, "failing-output.txt"), `tag ${tag}\nvalue ${value}\nlive ${live}\nstate ${state}`);
      break;
    }
    chunks++;
    lastGood = fuel;
    units += fuel;
    // A fresh compiler does not make the work smaller, so the fuel that was
    // fitting before still fits. Raising it back to the ceiling here costs a
    // full run of halvings, once per replacement.
    worked++;
    if (++since >= lifetime) {
      lifetimes.push(lifetime);
      recycle("wear");
      since = 0;
      // A compiler that used up its whole allowance without ever handing back
      // an approximation says the allowance is too small, and nothing else
      // ever raises it: one bad chunk early in the run used to pin `lifetime`
      // at 2 for good, paying a 700ms replacement every second chunk. Climb
      // the same way the fuel does, and let the next bad chunk set it back.
      lifetime = lifetime * 2;
    }
    const ceiling = options.fuel ?? DEFAULT_FUEL;
    if (fuel < ceiling && ++settled >= 5) {
      settled = 0;
      // Doubling is only right while nothing has failed yet. Once a fuel is
      // known to be over the edge, the useful next try is between the two:
      // doubling from 640 asks for 1280, which fails and costs the chunk,
      // where the midpoint 960 lands and covers 1.5x the instructions for the
      // same 0.68s (1086 -> 1625 units/s over 25 chunks).
      const next = capFail === Infinity
        ? fuel * 2
        : Math.floor((fuel + Math.min(capFail, ceiling + 1)) / 2);
      // Stop once the edge is bracketed closely. Every probe that fails costs a
      // whole chunk, and re-probing 1120 then 1040 every five chunks cost more
      // than sitting at 960 won: 1154 units/s against 1625 pinned at 960.
      const converged = capFail !== Infinity && (capFail - fuel) / fuel < 0.15;
      if (next > fuel && next < capFail && !converged) {
        fuel = Math.min(ceiling, next);
        if (!options.quiet) process.stdout.write(`\r  chunk ${chunks}: settled; fuel -> ${fuel}    \n`);
      }
    }

    const r0 = performance.now();
    const parsedTrie = mergeOverlay(memoryTrie, parseTrie(state, ABSENT, aliasBack));
    const r1 = performance.now();
    const prunedTrie = prune(parsedTrie, base, fanout);
    const r2 = performance.now();
    memoryTrie = prunedTrie;
    memory = printTrie(prunedTrie);
    const r3 = performance.now();
    trieParseMs += r1 - r0;
    triePruneMs += r2 - r1;
    triePrintMs += r3 - r2;
    trieMs += r3 - r0;
    mark("trie");
    const g0 = performance.now();
    const globalValues = splitTop(globals.slice(1, globals.lastIndexOf("]")))
      .filter((v) => v.length > 0)
      .map(toSource);
    lastGlobals = globalValues;
    globMs += performance.now() - g0;
    mark("globals");

    // Chunk count is the only progress bar there is - at half a second a chunk
    // the frame is half an hour, and printing the chunk without the rate hides
    // that - but the frame's length is not a constant. This line used to divide
    // by 3224 and the frame it was describing ran past 3595 chunks without
    // returning, so the bar read `frame 821/3224, ETA 16m` while the real
    // remainder was unknown. The length comes from a frame that actually landed:
    // the stream writes one next to the checkpoint when `entry` returns.
    const framePath = options.save ? `${options.save}.frame` : "";
    let frameChunks = 0;
    try {
      frameChunks = JSON.parse(readFileSync(framePath, "utf8")).frameChunks ?? 0;
    } catch {
      // no frame has landed yet: report the rate and no total
    }
    const eta = () => {
      const spc = (performance.now() - t0) / 1000 / Math.max(chunks, 1);
      const left = frameChunks - chunks;
      if (!frameChunks) return `${spc.toFixed(2)}s/chunk, frame chunk ${chunks}, length unknown until it lands`;
      return (
        `${spc.toFixed(2)}s/chunk` +
        (left > 0 ? `, frame ${chunks}/${frameChunks}, ETA ${((left * spc) / 60).toFixed(0)}m` : `, frame past the last one's ${frameChunks}`)
      );
    };

    const checkpoint = (next: string, done = false) => {
      if (!options.save) return;
      // the last state of a frame is worth saving whatever the interval says
      if (!done && chunks % (options.every ?? 100) !== 0) return;
      const point: Checkpoint = {
        done,
        call: next,
        memory,
        frames,
        globals: globalValues,
        chunks: carried + chunks,
        entryChunks: chunks,
        evalMs,
        split: [...split],
        fuel,
        capFail: capFail === Infinity ? undefined : capFail,
        // each `entry` call allocates its own screen and returns it, so a fixed
        // address reads the frame before this one
        result: done ? value_ : options.resume?.result,
        prevResult: done ? options.resume?.result : options.resume?.prevResult,
      };
      const s0 = performance.now();
      saveCheckpoint(options.save, JSON.stringify(point));
      saveMs += performance.now() - s0;
    };

    if (tag === '"r"') {
      // A return with frames still pending is a call coming back after
      // something inside it suspended: the caller's inline match is long gone,
      // so the host is what pops the frame and carries on. This is the only
      // reason a return costs a round trip, and it only happens on the way out
      // of a suspension.
      if (frames.length === 0) {
        value_ = value === '"void"' ? undefined : value.replace(/"/g, "");
        checkpoint(call, true);
        break;
      }
      const [resume, ...rest] = frames;
      frames = rest;
      call = enter(resume, rest, globalValues, toSource(value));
      checkpoint(call);
      mark("frames");
      if (!options.quiet) {
        process.stdout.write(
          `\r  chunk ${chunks}: returned into ${resume.block}, ${rest.length} frames left, ${eta()}   `,
        );
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
    // A back edge in the entry's own function is the start of the next frame:
    // record it while the locals are in hand, because once `entry` returns they
    // are gone and re-calling `entry` re-runs init (see backEdgeReentry).
    frames = outer;
    call = enter(innermost, outer, globalValues);
    checkpoint(call);
    mark("frames");
    if (!options.quiet) {
      process.stdout.write(
        `\r  chunk ${chunks}: suspended in ${innermost.block}, ${outer.length} frames, ` +
          `state ${memory.length} chars, ${eta()}   `,
      );
    }
  }
  // The `every` modulo means the last state a run reaches is usually not the
  // one on disk, and a return breaks out before the next multiple: re-entering
  // the entry point needs the memory as it stood *after* the call came back,
  // because a snapshot from the middle of one catches the heap mid-mutation and
  // a walk over a half-linked list follows a garbage pointer.
  if (options.save && value_ !== undefined) {
    const point: Checkpoint = {
      call: `$${entry}<$FUEL, $IN>`,
      memory,
      frames: [],
      // wasm globals persist across exported calls, but `$entry` bakes in their
      // module-initial values, so a second call silently rewinds them. Record
      // what they actually were at the return to make that visible.
      globals: [...lastGlobals],
      chunks: 0,
      entryChunks: 0,
      evalMs,
      split: [...split],
    };
    saveCheckpoint(`${options.save}.final`, JSON.stringify(point));
  }
  if (!options.session) env.close();
  if (!options.quiet) process.stdout.write("\n");
  if (process.env.TIME_READS) {
    const totalMs = performance.now() - t0;
    process.stderr.write(
      `  split: ` +
        Object.entries(spans)
          .sort((a, b) => b[1] - a[1])
          .map(([name, ms]) => `${name} ${ms.toFixed(0)}ms`)
          .join(" ") +
        ` | trie parse ${trieParseMs.toFixed(0)}ms prune ${triePruneMs.toFixed(0)}ms print ${triePrintMs.toFixed(0)}ms` +
        ` | save ${saveMs.toFixed(0)}ms` +
        ` | recycle ${recycleMs.toFixed(0)}ms in ${recycles} ${JSON.stringify(why)}` +
        ` lifetimes ${JSON.stringify(lifetimes)} of ${totalMs.toFixed(0)}ms\n`,
    );
  }
  return { value: value_, memory, chunks: carried + chunks, backoffs, units, fuel, evalMs, totalMs: performance.now() - t0, failed };
};

if (import.meta.url === `file://${process.argv[1]}`) {
  const positional: string[] = [];
  const options: {
    fuel?: number;
    max?: number;
    save?: string;
    every?: number;
    quiet?: boolean;
    resume?: Checkpoint;
  } = {};
  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];
    if (arg === "--fuel") options.fuel = Number(process.argv[++i]);
    else if (arg === "--max") options.max = Number(process.argv[++i]);
    else if (arg === "--save") options.save = process.argv[++i];
    else if (arg === "--every") options.every = Number(process.argv[++i]);
    else if (arg === "--quiet") options.quiet = true;
    else if (arg === "--resume") {
      const from = process.argv[++i];
      options.resume = JSON.parse(readFileSync(from, "utf8")) as Checkpoint;
    } else if (arg.startsWith("--")) {
      // An unknown flag used to fall through to `positional` and be spliced
      // into the generated type as an argument to `$entry`, so the failure
      // surfaced ~650KB into a generated file as
      //   chunk-5952.ts:655449: '>' expected
      // pointing at `$entry<$FUEL, $IN, --quiet>`. Name the flag instead.
      console.error(`unknown flag ${arg}`);
      process.exit(2);
    } else positional.push(arg);
  }
  const [modulePath, entry, ...rest] = positional;
  const args = rest.map((a) => (/^-?\d+$/.test(a) ? `'${bin(Number(a))}'` : a));
  const result = await run(modulePath, entry, args, options);
  // exit nonzero: a caller in a per-frame loop reads a zero exit as "that frame
  // is done, start the next one" and re-resumes the same wedged state forever.
  // Measured: the 2.3MB frame-3 state failed at chunk 0 and the play loop
  // reran it four times a minute until it was killed.
  if (result.failed) {
    console.log(`FAILED ${result.failed}`);
    process.exitCode = 1;
  }
  console.log(
    `${basename(modulePath)} ${entry}: ${result.chunks} chunks in ${(result.totalMs / 1000).toFixed(2)}s` +
      ` (${result.units} fuel units, ${(result.units / (result.totalMs / 1000)).toFixed(0)} units/s, fuel ${result.fuel})` +
      (result.value === undefined ? "" : ` -> ${result.value} (${parseInt(result.value, 2) | 0})`),
  );
}
