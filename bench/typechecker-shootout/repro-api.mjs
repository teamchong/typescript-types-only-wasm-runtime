// Minimal repro of the only thing blocking a checker from driving the game.
//
// The driver (packages/playground/evaluate/ts.ts) does exactly this per chunk:
//   updateSnapshot({openProjects, openFiles}) -> getProject -> project.checker
//   -> getTypeFromTypeNode(alias.type) -> typeToString(.., NoTruncation)
// It never reads diagnostics; the resolved type text IS the computed result.
//
// Usage: node repro-api.mjs <path-to-checker-binary>
//        node repro-api.mjs            # uses tsgo from node_modules (control)
import { API, NodeBuilderFlags } from "typescript/unstable/sync";
import { isTypeAliasDeclaration } from "typescript/unstable/ast/is";
import { createVirtualFileSystem } from "typescript/unstable/fs";
import { writeFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const bin = process.argv[2];
const dir = mkdtempSync(join(tmpdir(), "repro-api-"));
const tsconfig = join(dir, "tsconfig.json");
const file = join(dir, "index.ts");
writeFileSync(file, `type Count<F extends string, A extends unknown[]> =
  F extends \`1\${infer R}\` ? Count<R, [...A, 1]> : A['length'];
export type Answer = Count<'11111', []>;
`);
writeFileSync(tsconfig, JSON.stringify({
  compilerOptions: { noEmit: true, strict: false, types: [] }, files: ["index.ts"],
}));

const files = createVirtualFileSystem({});
const api = new API({ cwd: dir, ...(bin ? { tsserverPath: bin } : {}), fs: {
  readFile: (p) => { const c = files.readFile?.(p); return c === null ? undefined : c; },
  fileExists: (p) => (files.fileExists?.(p) ? true : undefined),
} });

console.log(`checker: ${bin ?? "(bundled tsgo)"}`);
try {
  // The client API changed: <=20260822 takes updateSnapshot(params);
  // >=20260929 requires createSnapshot(params) first. Support both.
  const params = { openProjects: [tsconfig], openFiles: [file] };
  const snapshot = typeof api.createSnapshot === "function"
    ? api.createSnapshot(params)
    : api.updateSnapshot(params);
  console.log(`${typeof api.createSnapshot === "function" ? "createSnapshot" : "updateSnapshot"}: ok`);
  const project = snapshot.getProject(tsconfig) ?? snapshot.getDefaultProjectForFile(file) ?? snapshot.getProjects()[0];
  console.log("getProject:", project ? "ok" : "MISSING");
  const sf = project.program.getSourceFile(file);
  console.log("getSourceFile:", sf ? "ok" : "MISSING");
  const alias = sf.statements.find((s) => isTypeAliasDeclaration(s) && s.name.text === "Answer");
  const type = project.checker.getTypeFromTypeNode(alias.type);
  console.log("getTypeFromTypeNode: ok");
  const text = project.checker.typeToString(type, undefined, NodeBuilderFlags.NoTruncation);
  console.log(`typeToString: ${text}   <- must be 5`);
  console.log(text === "5" ? "RESULT: PASS (can drive the game)" : `RESULT: WRONG ANSWER (${text})`);
} catch (e) {
  console.log(`RESULT: FAIL -> ${e.message}`);
  process.exitCode = 1;
}
