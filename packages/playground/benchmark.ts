/**
 * Simple benchmark to measure TypeScript type evaluation performance.
 * Usage: pnpm run benchmark [instructions]
 * Default: 500 instructions
 */
import { createEnv, evaluateType } from "./evaluate/ts";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const startFilePath = join(__dirname, "evaluate/start.ts");

const INSTRUCTIONS = parseInt(process.argv[2] || "500", 10);

console.log("=== TypeScript Types WASM Runtime Benchmark ===");
console.log(`Target: ${INSTRUCTIONS} instructions`);
console.log("");

const env = createEnv(startFilePath);
const program = env.languageService.getProgram();
if (!program) {
  throw new Error("Failed to create TypeScript program");
}

const startTime = performance.now();
let current = 0;
let iterations = 0;

// Warm up
console.log("Warming up...");
await evaluateType(env, startFilePath, program);

console.log("Benchmarking...");
const benchStart = performance.now();

// The evaluation runs instructions in batches, we measure total throughput
const { typeString, current: instructionCount } = await evaluateType(
  env,
  startFilePath,
  program
);

const elapsed = performance.now() - benchStart;
const ips = Math.round(instructionCount / (elapsed / 1000));

console.log("");
console.log("=== Results ===");
console.log(`Instructions executed: ${instructionCount}`);
console.log(`Time: ${Math.round(elapsed)}ms`);
console.log(`IPS (instructions/sec): ${ips}`);
console.log(`Instantiations: ${program.getInstantiationCount()}`);
console.log("");
console.log("Save this baseline, then run again after changes to compare.");
