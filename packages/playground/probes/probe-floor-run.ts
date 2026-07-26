// What does an evaluation cost before it does anything?
//
// A frame hands ~30kB of memory text to the checker and gets ~30kB back. If
// that round trip is most of a frame, making the program do less work stops
// helping - which is what the last change looked like.
import { join } from "node:path";
import { createSession, run } from "../cfg/drive";

const module = join(process.cwd(), "packages/playground/gfx/gfx.cfg.ts");
const bin = (n: number) => (n >>> 0).toString(2).padStart(32, "0");
const session = createSession();

let memory = "$InitialMemory";
for (let i = 0; i < 3; i++) {
  const result = await run(module, "frame", [`'${bin(0)}'`], { fuel: 4000, memory, quiet: true, session });
  memory = result.memory;
}
console.log(`state is ${(memory.length / 1024).toFixed(1)}kB of type text\n`);

const time = async (entry: string, args: string[], label: string) => {
  const runs: number[] = [];
  for (let i = 0; i < 5; i++) {
    const started = performance.now();
    const result = await run(module, entry, args, { fuel: 4000, memory, quiet: true, session });
    runs.push(performance.now() - started);
    if (result.failed) return console.log(`${label}: failed ${result.failed.slice(0, 60)}`);
  }
  runs.sort((a, b) => a - b);
  console.log(`${label.padEnd(34)} ${runs[0].toFixed(0).padStart(4)}ms`);
};

// score1 reads one field and returns: the same state in and out, no drawing
await time("score1", [], "an evaluation that does nothing");
await time("frame", [`'${bin(0)}'`], "a frame (102 units of work)");
process.exit(0);
