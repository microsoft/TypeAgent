/**
 * RuleGen is a script: it compiles the rule expressions in the interface
 * files into rules.gen.ts, so that tests evaluate the design's own
 * statements rather than restating them, and so that tsc checks every
 * expression against the interfaces and their vocabulary.
 *
 * How: reads the rules with catalog.ts's parser. For each @requires,
 * @ensures and @invariant rule with an expression, in the files listed in
 * `compiled`, it writes three functions with `this` typed as the
 * interface and the member's parameters in scope by name:
 * - pre: the arguments of each old(e) in the expression, evaluated before
 *   the call;
 * - at: the second argument of each atEvent(i, e), evaluated at each event
 *   the call emits;
 * - post: the expression, with old(e) and atEvent(i, e) replaced by those
 *   values. A rule written as an arrow function returns the function.
 * It also writes each interface's ancestors and members, for ruleCheck.ts
 * to find the rules that apply to a call.
 * Run: node ruleGen.ts to write; node ruleGen.ts --check exits nonzero if
 * rules.gen.ts is out of date (npm run typecheck runs it).
 * Imports: catalog.ts, node:fs
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { build, type Interface } from "./catalog.ts";

/** The interface files whose rules are compiled. The rest follow as their rules get expressions. */
const compiled = ["dataModel.ts", "shapeModel.ts"];
const out = "rules.gen.ts";

/** The design files that declare types a rule expression may name. */
const typeFiles = ["geometry.ts", "color.ts", "shape.ts", "events.ts", "dataModel.ts", "shapeModel.ts", "frames.ts", "view.ts", "shapeView.ts", "layout.ts", "rules.ts"];

/** The index just past the parenthesis that closes the one at open, skipping strings. */
function closeParen(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (c === '"' || c === "'" || c === "`") {
      const end = text.indexOf(c, i + 1);
      if (end < 0) throw new Error(`unclosed string in ${text}`);
      i = end;
    } else if ("([{".includes(c)) depth++;
    else if (")]}".includes(c) && --depth === 0) return i + 1;
  }
  throw new Error(`unbalanced parentheses in ${text}`);
}

/** The index of the first comma at depth 0 in text, or -1. */
function topComma(text: string): number {
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if ("([{".includes(c)) depth++;
    else if (")]}".includes(c)) depth--;
    else if (c === "," && depth === 0) return i;
  }
  return -1;
}

/**
 * Replaces each call name(...) in expr, outermost first, with what
 * replace returns for its argument text; returns the new expression.
 */
function rewriteCalls(expr: string, name: string, replace: (args: string) => string): string {
  const re = new RegExp(`\\b${name}\\(`, "g");
  let result = "";
  let from = 0;
  for (let m = re.exec(expr); m; m = re.exec(expr)) {
    if (m.index < from) continue;
    const open = m.index + name.length;
    const close = closeParen(expr, open);
    result += expr.slice(from, m.index) + replace(expr.slice(open + 1, close - 1).trim());
    from = close;
    re.lastIndex = close;
  }
  return result + expr.slice(from);
}

/** Splits a parameter list at commas outside brackets. */
function splitParams(inside: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < inside.length; i++) {
    const c = inside[i];
    if ("([{<".includes(c)) depth++;
    else if (")]}".includes(c) || (c === ">" && inside[i - 1] !== "=")) depth--;
    else if (c === "," && depth === 0) {
      parts.push(inside.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(inside.slice(start));
  return parts.map((p) => p.trim()).filter(Boolean);
}

/** The parameter names in a member's signature, such as ["id", "shape", "below"] for add(id: ShapeId, shape: S, below?: ShapeId): void. */
function paramNames(signature: string): string[] {
  const open = signature.indexOf("(");
  if (open < 0) return [];
  const inside = signature.slice(open + 1, closeParen(signature, open) - 1);
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < inside.length; i++) {
    const c = inside[i];
    if ("([{<".includes(c)) depth++;
    else if (")]}".includes(c) || (c === ">" && inside[i - 1] !== "=")) depth--;
    else if (c === "," && depth === 0) {
      parts.push(inside.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(inside.slice(start));
  return parts.map((p) => /^\s*(?:\.\.\.)?(\w+)/.exec(p)?.[1]).filter((p): p is string => p !== undefined);
}

/** Exported type names, by the design file that declares them. */
function exportedTypes(): Map<string, string> {
  const found = new Map<string, string>();
  for (const file of typeFiles) {
    for (const m of readFileSync(file, "utf8").matchAll(/^export (?:interface|type) (\w+)/gm)) found.set(m[1], file);
  }
  return found;
}

function ancestorsOf(i: Interface, byName: Map<string, Interface>): string[] {
  const out: string[] = [];
  const visit = (name: string) => {
    const a = byName.get(name);
    if (!a || out.includes(name)) return;
    out.push(name);
    a.extends.forEach(visit);
  };
  visit(i.name);
  return out;
}

async function generate(): Promise<string> {
  const all = build(new Set()).filter((i) => !i.module);
  const byName = new Map(all.map((i) => [i.name, i]));
  const types = exportedTypes();
  const imports = new Map<string, Set<string>>();
  const typeImports = new Map<string, Set<string>>();
  const imported = new Set<string>();
  const use = (map: Map<string, Set<string>>, file: string, name: string) => {
    if (imported.has(name)) return;
    imported.add(name);
    map.set(file, (map.get(file) ?? new Set()).add(name));
  };
  const fns: string[] = [];
  const entries: string[] = [];
  let n = 0;
  for (const i of all.filter((i) => compiled.includes(i.file))) {
    const vocabFile = i.file.replace(/\.ts$/, ".vocab.ts");
    const vocab = existsSync(vocabFile) ? new Set(Object.keys(await import(`./${vocabFile}`))) : new Set<string>();
    use(typeImports, i.file, i.name);
    for (const r of i.rules) {
      if (!r.expression || !["requires", "ensures", "invariant"].includes(r.tag)) continue;
      const parts = r.id.split(".");
      const member = parts.length === 3 ? parts[1] : null;
      const signature = member ? i.members.find((m) => m.name === member)?.signature : undefined;
      if (member && !signature) throw new Error(`${r.id}: ${i.name} has no member ${member}`);
      const params = signature ? paramNames(signature) : [];
      const isMethod = signature !== undefined && /^\w+\s*[<(]/.test(signature);
      const expr = r.expression.split("\n").map((l) => l.trim()).join("\n    ");
      const olds: string[] = [];
      const ats: string[] = [];
      let body = rewriteCalls(expr, "old", (e) => `__old[${olds.push(e) - 1}]`);
      body = rewriteCalls(body, "atEvent", (args) => {
        const comma = topComma(args);
        if (comma < 0) throw new Error(`${r.id}: atEvent needs two arguments`);
        return `__at[${args.slice(0, comma).trim()}]?.[${ats.push(args.slice(comma + 1).trim()) - 1}]`;
      });
      for (const word of new Set(`${r.expression} ${i.typeParams}`.match(/\b[A-Za-z_]\w*\b/g) ?? [])) {
        if (vocab.has(word)) use(imports, vocabFile, word);
        else if (types.has(word) && /^[A-Z]/.test(word)) use(typeImports, types.get(word)!, word);
      }
      // A generic interface's rules are generic functions over its type parameters.
      const typeParams = i.typeParams;
      const typeArgs = typeParams ? `<${splitParams(typeParams.slice(1, -1)).map((t) => t.split(" ")[0]).join(", ")}>` : "";
      const thisType = `${i.name}${typeArgs}`;
      const args = isMethod ? `Parameters<${thisType}["${member}"]>` : "unknown[]";
      const resultType = isMethod ? `ReturnType<${thisType}["${member}"]>` : member ? `${thisType}["${member}"]` : "unknown";
      const used = (text: string) => params.map((p) => (new RegExp(`\\b${p}\\b`).test(text) ? p : "")).join(", ").replace(/(, )+$/, "");
      const destructure = (text: string) => (isMethod && used(text).replace(/[, ]/g, "") !== "" ? `const [${used(text)}] = args;\n  ` : "");
      const k = n++;
      const preText = olds.join(", ");
      const atText = ats.join(", ");
      fns.push(`// ${r.id}: ${r.headline}
function pre${k}${typeParams}(this: ${thisType}, ...args: ${args}) {
  ${destructure(preText)}return [${preText}] as const;
}
function at${k}${typeParams}(this: ${thisType}, ...args: ${args}) {
  ${destructure(atText)}return [${atText}] as const;
}
function post${k}${typeParams}(this: ${thisType}, __old: ReturnType<typeof pre${k}${typeArgs}>, __at: readonly ReturnType<typeof at${k}${typeArgs}>[], result: ${resultType}, ...args: ${args}) {
  ${destructure(body)}return ${body};
}`);
      const when = r.tag === "requires" && !/\bnested\(/.test(r.expression) ? "entry" : r.tag === "invariant" ? "invariant" : "return";
      entries.push(`  { id: "${r.id}", tag: "${r.tag}", iface: "${i.name}", member: ${member ? `"${member}"` : "null"}, when: "${when}", pre: pre${k}, at: at${k}, post: post${k} },`);
    }
  }
  const shapes = all.map((i) => `  ${i.name}: { ancestors: ${JSON.stringify(ancestorsOf(i, byName))}, members: ${JSON.stringify(i.members.map((m) => m.name))} },`);
  const importLines = [
    ...[...typeImports].sort().map(([file, names]) => `import type { ${[...names].sort().join(", ")} } from "./${file}";`),
    ...[...imports].sort().map(([file, names]) => `import { ${[...names].sort().join(", ")} } from "./${file}";`),
  ];
  return `// Generated by ruleGen.ts from the rules of ${compiled.join(", ")}. Don't edit by hand:
// run node ruleGen.ts. ruleCheck.ts evaluates these against calls.
/* eslint-disable */

${importLines.join("\n")}

/** When a rule is checked: on entry to a call, on return from it, or (an invariant) whenever the object is checked or emits an event. */
export type When = "entry" | "return" | "invariant";

/** A compiled rule. Its functions take the object as this. */
export interface CompiledRule {
  readonly id: string;
  readonly tag: "requires" | "ensures" | "invariant";
  readonly iface: string;
  /** The member whose doc has the rule, or null for one in the interface's doc. */
  readonly member: string | null;
  readonly when: When;
  readonly pre: Function;
  readonly at: Function;
  readonly post: Function;
}

${fns.join("\n\n")}

export const compiledRules: readonly CompiledRule[] = [
${entries.join("\n")}
];

/** Each interface's ancestors (itself first) and own members. */
export const interfaceShapes: Record<string, { readonly ancestors: readonly string[]; readonly members: readonly string[] }> = {
${shapes.join("\n")}
};
`;
}

if (import.meta.main) {
  const text = await generate();
  if (process.argv.includes("--check")) {
    if (!existsSync(out) || readFileSync(out, "utf8") !== text) {
      console.error(`${out} is out of date: run node ruleGen.ts`);
      process.exit(1);
    }
  } else {
    writeFileSync(out, text);
    console.log(`wrote ${out}`);
  }
}
