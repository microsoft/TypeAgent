/**
 * The rule compiler: compiles the rule expressions in a project's
 * interface files into a TypeScript module (rules.gen.ts), so that checks
 * evaluate the design's own statements rather than restating them, and so
 * that tsc checks every expression against the interfaces and their
 * vocabulary.
 *
 * How: reads the rules with design.ts's parser. For each @requires,
 * @ensures, @invariant and @initially rule with an expression, in the
 * compiled files, it writes three functions with `this` typed as the
 * interface and the member's parameters in scope by name:
 * - pre: the arguments of each old(e) in the expression, evaluated before
 *   the call;
 * - at: the second argument of each atEvent(i, e), evaluated at each event
 *   the call emits;
 * - post: the expression, with old(e) and atEvent(i, e) replaced by those
 *   values. A rule written as an arrow function returns the function.
 * It also writes each interface's ancestors and members, for ruleCheck.ts
 * to find the rules that apply to a call.
 * Imports: design.ts, node:fs, node:path, node:url
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { parseDesign, type Interface } from "./design.ts";

/** What to compile. Paths are relative to dir, and the output is written there too. */
export interface RuleGenOptions {
  readonly dir: string;
  /** Every interface file of the design, for the interfaces' shapes. */
  readonly interfaces: readonly string[];
  /** The interface files whose rules are compiled. */
  readonly compiled: readonly string[];
  /** The design files that declare types a rule expression may name. */
  readonly typeFiles: readonly string[];
  /** The command that regenerates the output, for its header. */
  readonly regenerate: string;
}

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
function exportedTypes(dir: string, typeFiles: readonly string[]): Map<string, string> {
  const found = new Map<string, string>();
  for (const file of typeFiles) {
    for (const m of readFileSync(join(dir, file), "utf8").matchAll(/^export (?:interface|type) (\w+)/gm)) found.set(m[1], file);
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

/** Splits text at each occurrence of sep outside brackets and strings. */
function splitTop(text: string, sep: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"' || c === "'" || c === "`") i = text.indexOf(c, i + 1);
    else if ("([{".includes(c)) depth++;
    else if (")]}".includes(c)) depth--;
    else if (depth === 0 && text.startsWith(sep, i)) {
      parts.push(text.slice(start, i));
      start = i + sep.length;
      i += sep.length - 1;
    }
  }
  parts.push(text.slice(start));
  return parts.map((p) => p.trim());
}

/** The one comparison <, <=, > or >= at depth 0 in text, as [left, operator, right], or undefined. */
function comparison(text: string): [string, string, string] | undefined {
  let depth = 0;
  let found: [string, string, string] | undefined;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"' || c === "'" || c === "`") i = text.indexOf(c, i + 1);
    else if ("([{".includes(c)) depth++;
    else if (")]}".includes(c)) depth--;
    else if (depth === 0 && (c === "<" || c === ">") && text[i - 1] !== "=" && text[i - 1] !== c && text[i + 1] !== c) {
      if (found) return undefined;
      const op = text[i + 1] === "=" ? `${c}=` : c;
      found = [text.slice(0, i).trim(), op, text.slice(i + op.length).trim()];
      i += op.length - 1;
    }
  }
  return found;
}

/**
 * The bounds a @requires expression puts on its parameters: for each
 * conjunct at the top level comparing a parameter with an expression that
 * doesn't mention it, such as 0 <= index or index < this.length, the
 * lowest and highest values as expressions. A strict bound is taken as
 * one past, for integers: index < this.length gives this.length - 1.
 */
export function boundsOf(expression: string, params: readonly string[]): Map<string, { lo: string[]; hi: string[] }> {
  const bounds = new Map<string, { lo: string[]; hi: string[] }>();
  const mentions = (text: string, p: string) => new RegExp(`\\b${p}\\b`).test(text);
  // Read every comparison as x <op> other, flipping it when the parameter is on the right.
  const flip: Record<string, string> = { "<": ">", "<=": ">=", ">": "<", ">=": "<=" };
  for (const conjunct of splitTop(expression.replace(/\s+/g, " "), "&&")) {
    const c = comparison(conjunct);
    if (!c) continue;
    const [left, op, right] = c;
    const p = params.find((q) => left === q && !mentions(right, q)) ?? params.find((q) => right === q && !mentions(left, q));
    if (!p) continue;
    const [o, other] = left === p ? [op, right] : [flip[op], left];
    const b = bounds.get(p) ?? { lo: [], hi: [] };
    if (o === ">=") b.lo.push(other);
    else if (o === ">") b.lo.push(`(${other}) + 1`);
    else if (o === "<=") b.hi.push(other);
    else b.hi.push(`(${other}) - 1`);
    bounds.set(p, b);
  }
  return bounds;
}

/** The text of the compiled rules module for the project. */
export async function generateRules(options: RuleGenOptions): Promise<string> {
  const { dir, compiled, typeFiles } = options;
  const all = parseDesign(dir, options.interfaces).filter((i) => !i.module);
  const byName = new Map(all.map((i) => [i.name, i]));
  const types = exportedTypes(dir, typeFiles);
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
    const vocab = existsSync(join(dir, vocabFile)) ? new Set(Object.keys(await import(pathToFileURL(join(dir, vocabFile)).href))) : new Set<string>();
    use(typeImports, i.file, i.name);
    for (const r of i.rules) {
      if (!r.expression || !["requires", "ensures", "invariant", "initially"].includes(r.tag)) continue;
      // A rule says true or false in every state; a non-null assertion (x!)
      // would make it crash where its operand is undefined instead.
      if (/[\w)\]]!(?!=)/.test(r.expression)) throw new Error(`${r.id}: a rule expression must be total; replace the non-null assertion (!)`);
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
      const when = r.tag === "requires" && !/\bnested\(/.test(r.expression) ? "entry" : r.tag === "invariant" ? "invariant" : r.tag === "initially" ? "initially" : "return";
      const bounds = when === "entry" && isMethod ? boundsOf(r.expression, params) : new Map<string, { lo: string[]; hi: string[] }>();
      if (bounds.size) {
        const fields = [...bounds].map(([p, b]) => `${p}: [[${b.lo.join(", ")}], [${b.hi.join(", ")}]]`).join(", ");
        fns.push(`// ${r.id}: the bounds it puts on ${[...bounds.keys()].join(", ")}
function bounds${k}${typeParams}(this: ${thisType}, ...args: ${args}): Record<string, readonly [readonly number[], readonly number[]]> {
  ${destructure([...bounds.values()].flatMap((b) => [...b.lo, ...b.hi]).join(" "))}return { ${fields} };
}`);
      }
      entries.push(`  { id: "${r.id}", tag: "${r.tag}", iface: "${i.name}", member: ${member ? `"${member}"` : "null"}, when: "${when}", pre: pre${k}, at: at${k}, post: post${k}${bounds.size ? `, bounds: bounds${k}` : ""} },`);
    }
  }
  const shapes = all.map((i) => `  ${i.name}: { ancestors: ${JSON.stringify(ancestorsOf(i, byName))}, members: ${JSON.stringify(i.members.map((m) => m.name))} },`);
  const importLines = [
    ...[...typeImports].sort().map(([file, names]) => `import type { ${[...names].sort().join(", ")} } from "./${file}";`),
    ...[...imports].sort().map(([file, names]) => `import { ${[...names].sort().join(", ")} } from "./${file}";`),
  ];
  return `// Generated by ruleGen.ts from the rules of ${compiled.join(", ")}. Don't edit by hand:
// run ${options.regenerate}. ruleCheck.ts evaluates these against calls.
/* eslint-disable */

${importLines.join("\n")}

/** When a rule is checked: on entry to a call, on return from it, (an invariant) whenever the object is checked or emits an event, or (initially) before the object's first call. */
export type When = "entry" | "return" | "invariant" | "initially";

/** A compiled rule. Its functions take the object as this. */
export interface CompiledRule {
  readonly id: string;
  readonly tag: "requires" | "ensures" | "invariant" | "initially";
  readonly iface: string;
  /** The member whose doc has the rule, or null for one in the interface's doc. */
  readonly member: string | null;
  readonly when: When;
  readonly pre: Function;
  readonly at: Function;
  readonly post: Function;
  /** For a @requires rule checked on entry: the lowest and highest values it allows each number parameter, as lists to take the max and min of. */
  readonly bounds?: Function;
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
