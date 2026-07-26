// A minimal animated GIF encoder, so a run of the game can be looked at
// without running anything.
//
// Palette images are exactly what the framebuffer already is - one byte of
// palette index per pixel - so this is the natural format: no colour
// conversion, and LZW over 6 symbols compresses the flat areas to almost
// nothing. No dependencies; GIF89a with a Netscape looping block.
import type { Frame } from "./pixels";
import { PALETTE } from "./pixels";

class Bits {
  private bytes: number[] = [];
  private current = 0;
  private width = 0;

  push(code: number, size: number) {
    this.current |= code << this.width;
    this.width += size;
    while (this.width >= 8) {
      this.bytes.push(this.current & 0xff);
      this.current >>= 8;
      this.width -= 8;
    }
  }

  finish() {
    if (this.width > 0) this.bytes.push(this.current & 0xff);
    return this.bytes;
  }
}

/// GIF's variable-width LZW, with the clear and end codes it requires
const compress = (pixels: Uint8Array, minimumCodeSize: number) => {
  const clear = 1 << minimumCodeSize;
  const end = clear + 1;
  let table = new Map<string, number>();
  let next = end + 1;
  let size = minimumCodeSize + 1;
  const bits = new Bits();
  bits.push(clear, size);

  let previous = "";
  for (const pixel of pixels) {
    const key = previous === "" ? String(pixel) : `${previous},${pixel}`;
    if (previous !== "" && table.has(key)) {
      previous = key;
      continue;
    }
    if (previous !== "") {
      bits.push(table.get(previous) ?? Number(previous), size);
      table.set(key, next++);
      if (next > 1 << size) {
        size++;
        if (size > 12) {
          bits.push(clear, 12);
          table = new Map();
          next = end + 1;
          size = minimumCodeSize + 1;
        }
      }
    }
    previous = String(pixel);
  }
  if (previous !== "") bits.push(table.get(previous) ?? Number(previous), size);
  bits.push(end, size);
  return bits.finish();
};

const scaleUp = (frame: Frame, scale: number) => {
  const width = frame.width * scale;
  const height = frame.height * scale;
  const pixels = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      pixels[y * width + x] = frame.pixels[((y / scale) | 0) * frame.width + ((x / scale) | 0)];
    }
  }
  return { width, height, pixels };
};

/// `delay` is in hundredths of a second, as GIF counts them
export const toGif = (frames: Frame[], scale = 6, delay = 6): Uint8Array => {
  if (frames.length === 0) throw new Error("no frames");
  const first = scaleUp(frames[0], scale);
  const out: number[] = [];
  const byte = (value: number) => out.push(value & 0xff);
  const short = (value: number) => {
    byte(value);
    byte(value >> 8);
  };
  const string = (text: string) => {
    for (const character of text) byte(character.charCodeAt(0));
  };
  /// data has to go out in sub-blocks of at most 255 bytes
  const blocks = (bytes: number[]) => {
    for (let at = 0; at < bytes.length; at += 255) {
      const slice = bytes.slice(at, at + 255);
      byte(slice.length);
      for (const value of slice) byte(value);
    }
    byte(0);
  };

  string("GIF89a");
  short(first.width);
  short(first.height);
  const depth = Math.max(1, Math.ceil(Math.log2(Math.max(PALETTE.length, 2))));
  byte(0xf0 | (depth - 1)); // global palette, 2^depth entries
  byte(0); // background colour
  byte(0); // pixel aspect ratio
  for (let i = 0; i < 1 << depth; i++) {
    const [r, g, b] = PALETTE[i] ?? [0, 0, 0];
    byte(r);
    byte(g);
    byte(b);
  }

  // loop forever
  byte(0x21);
  byte(0xff);
  byte(11);
  string("NETSCAPE2.0");
  byte(3);
  byte(1);
  short(0);
  byte(0);

  for (const source of frames) {
    const frame = scaleUp(source, scale);
    byte(0x21); // graphic control
    byte(0xf9);
    byte(4);
    byte(0);
    short(delay);
    byte(0);
    byte(0);
    byte(0x2c); // image descriptor
    short(0);
    short(0);
    short(frame.width);
    short(frame.height);
    byte(0);
    const minimumCodeSize = Math.max(2, depth);
    byte(minimumCodeSize);
    blocks(compress(frame.pixels, minimumCodeSize));
  }
  byte(0x3b);
  return new Uint8Array(out);
};
