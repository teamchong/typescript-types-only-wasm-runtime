// watch gfx chunk by chunk: where does the pipeline rendering stall?
import { run } from "./drive";
const result = await run("packages/playground/gfx/gfx.cfg.ts", process.env.ENTRY ?? "frame", [`'${"0".repeat(32)}'`], {
  fuel: Number(process.env.FUEL ?? 200),
  max: Number(process.env.MAX ?? 8),
  quiet: false,
});
console.log("chunks", result.chunks, "failed", result.failed?.slice(0, 300));
