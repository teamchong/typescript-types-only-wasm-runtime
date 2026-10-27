// The screen the checker painted, read out of a checkpoint with no Node APIs:
// render-frame.ts does the same for PNGs but pulls in zlib and Buffer.
import { decodeTrie } from "../../cfg/trie";

const WIDTH = 320;
const HEIGHT = 200;
/// the first frame's screen, before any `entry` call has returned its own
const SCREEN = 393480;
const PALETTE_SIGNATURE = [0, 0, 0, 31, 23, 11, 23, 15, 7, 75, 75, 75];

export interface Shape {
  bits: number;
  digitBits: number;
  initial: string;
}

/// The trie shape and `$InitialMemory` come off the module, as in render-frame.ts:
/// a stale copy decodes into garbage rather than failing.
export const moduleShape = (moduleText: string): Shape => {
  const fanout = (moduleText.match(/^(?:export )?type \$Kid\d+</gm) ?? []).length;
  const slice = /type \$Slice<A extends string> =[\s\S]*?\n\s*\?\s*`([^`]*)`/.exec(moduleText);
  const initial = /export type \$InitialMemory\s*=\s*([\s\S]*?)\n\n/.exec(moduleText);
  if (!fanout || !slice || !initial) throw new Error("module has no $Kid/$Slice/$InitialMemory");
  return {
    bits: (slice[1]!.match(/\$\{/g) ?? []).length,
    digitBits: Math.log2(fanout),
    initial: initial[1]!.trim(),
  };
};

let palette: number | undefined;

/// RGBA pixels for a canvas. `result` is the binary string `entry` returned:
/// each call allocates its own screen, so that is where this frame was drawn.
export const rgbaFrom = (shape: Shape, memory: string, result?: string) => {
  const words = decodeTrie(memory, shape.bits, shape.digitBits, shape.initial);
  const byteAt = (a: number) => ((words.get(a >>> 2) ?? 0) >>> ((a & 3) * 8)) & 0xff;
  const matches = (base: number) => PALETTE_SIGNATURE.every((b, i) => byteAt(base + i) === b);
  if (palette === undefined || !matches(palette)) {
    let limit = 0;
    for (const w of words.keys()) if (w > limit) limit = w;
    palette = undefined;
    for (let base = 0; base < limit * 4; base++) if (matches(base)) { palette = base; break; }
    if (palette === undefined) throw new Error("no PLAYPAL in memory");
  }
  const screen = result ? Number.parseInt(result.replace(/[^01]/g, ""), 2) : SCREEN;
  const rgba = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
  for (let i = 0; i < WIDTH * HEIGHT; i++) {
    const p = palette + byteAt(screen + i) * 3;
    rgba[i * 4] = byteAt(p);
    rgba[i * 4 + 1] = byteAt(p + 1);
    rgba[i * 4 + 2] = byteAt(p + 2);
    rgba[i * 4 + 3] = 255;
  }
  return rgba;
};
