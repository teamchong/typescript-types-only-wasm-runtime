import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeBuilderFlags } from "typescript/unstable/sync";
import { isTypeAliasDeclaration } from "typescript/unstable/ast/is";
import { createEnv } from "../evaluate/ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const file = join(__dirname, "probe-gen.ts");
const env = createEnv(file);
env.createFile(file, `import type { Set } from './probe-helpers'
export type BenchResult = Set<{ a: '1' }, 'b', '2'>`);
const program = env.languageService.getProgram()!;
const sf: any = program.getSourceFile(file);
const alias: any = sf.statements.find((s: any) => isTypeAliasDeclaration(s) && s.name.text === "BenchResult");
const checker: any = program.getTypeChecker();
const type = checker.getTypeFromTypeNode(alias.type);
console.log("aliasSymbol:", type.aliasSymbol?.name ?? "(none)", "| flags:", type.flags, "| objectFlags:", type.objectFlags);
for (const name of ["None", "NoTruncation", "InTypeAlias", "InObjectTypeLiteral", "UseStructuralFallback", "NoTypeReduction", "MultilineObjectLiterals", "UseAliasDefinedOutsideCurrentScope"]) {
  const flag = (NodeBuilderFlags as any)[name];
  try {
    console.log(`${name.padEnd(32)} -> ${checker.typeToString(type, undefined, flag | NodeBuilderFlags.NoTruncation)}`);
  } catch (e) { console.log(`${name.padEnd(32)} -> threw ${(e as Error).message.slice(0, 50)}`); }
}
// does asking for the properties directly work?
try {
  const props = checker.getPropertiesOfType(type).map((p: any) => `${p.name}: ${checker.typeToString(checker.getTypeOfSymbol(p))}`);
  console.log("getPropertiesOfType ->", props.join("; "));
} catch (e) { console.log("getPropertiesOfType threw", (e as Error).message.slice(0, 60)); }
env.close();
