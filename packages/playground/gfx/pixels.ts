// Turning the type checker's memory into pixels.
//
// The framebuffer is one byte of palette index per pixel, sitting in the wasm
// memory that comes back from each evaluation. Two ways to look at it:
//
//   * the terminal, using half-block characters so one character cell shows two
//     pixels in 24-bit colour
//   * a PNG, encoded here with node's zlib, so frames can be kept and replayed
import { deflateSync } from "node:zlib";

export const PALETTE: [number, number, number][] = [
  [12, 14, 24], // 0 background
  [42, 52, 78], // 1 court
  [255, 236, 128], // 2 ball
  [96, 220, 255], // 3 left paddle
  [255, 120, 160], // 4 right paddle
  [180, 255, 190], // 5 score
];

export interface Frame {
  width: number;
  height: number;
  /// palette index per pixel
  pixels: Uint8Array;
}

export const readFrame = (
  words: Map<number, number>,
  base: number,
  width: number,
  height: number,
): Frame => {
  const pixels = new Uint8Array(width * height);
  for (let i = 0; i < pixels.length; i++) {
    const address = base + i;
    pixels[i] = ((words.get(address >>> 2) ?? 0) >>> ((address & 3) * 8)) & 0xff;
  }
  return { width, height, pixels };
};

/// Two rows per line: the upper half-block is the foreground, the lower is the
/// background, so a terminal cell carries two pixels.
export const toTerminal = (frame: Frame, scale = 1): string => {
  const { width, height, pixels } = frame;
  const colour = (index: number) => PALETTE[index] ?? PALETTE[0];
  let out = "";
  for (let y = 0; y < height; y += 2) {
    for (let x = 0; x < width; x++) {
      const [tr, tg, tb] = colour(pixels[y * width + x]);
      const [br, bg, bb] = colour(pixels[Math.min(y + 1, height - 1) * width + x]);
      out += `\u001b[38;2;${tr};${tg};${tb}m\u001b[48;2;${br};${bg};${bb}m` + "▀".repeat(scale);
    }
    out += "\u001b[0m\n";
  }
  return out;
};

/// A colourless preview, for logs and for terminals without truecolour.
export const toAscii = (frame: Frame): string => {
  const glyphs = [" ", ":", "@", "#", "#", "+"];
  const { width, height, pixels } = frame;
  let out = "";
  for (let y = 0; y < height; y += 2) {
    for (let x = 0; x < width; x++) {
      const top = pixels[y * width + x];
      const bottom = pixels[Math.min(y + 1, height - 1) * width + x];
      out += glyphs[top || bottom] ?? "?";
    }
    out += "\n";
  }
  return out;
};

const crcTable = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

const crc32 = (bytes: Uint8Array) => {
  let c = -1;
  for (const byte of bytes) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};

const chunk = (type: string, data: Uint8Array) => {
  const out = new Uint8Array(data.length + 12);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(data.length + 8, crc32(out.subarray(4, data.length + 8)));
  return out;
};

/// A plain truecolour PNG, scaled up so the pixels are visible.
export const toPng = (frame: Frame, scale = 8): Uint8Array => {
  const width = frame.width * scale;
  const height = frame.height * scale;
  const raw = new Uint8Array(height * (width * 3 + 1));
  let offset = 0;
  for (let y = 0; y < height; y++) {
    raw[offset++] = 0; // no filter
    const sourceRow = (y / scale) | 0;
    for (let x = 0; x < width; x++) {
      const [r, g, b] = PALETTE[frame.pixels[sourceRow * frame.width + ((x / scale) | 0)]] ?? PALETTE[0];
      raw[offset++] = r;
      raw[offset++] = g;
      raw[offset++] = b;
    }
  }
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header[8] = 8; // bit depth
  header[9] = 2; // truecolour
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", new Uint8Array(deflateSync(raw))),
    chunk("IEND", new Uint8Array(0)),
  ];
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const png = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    png.set(part, at);
    at += part.length;
  }
  return png;
};
