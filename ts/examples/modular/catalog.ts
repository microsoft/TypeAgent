/**
 * Catalog is a script: it shows humans which interfaces exist, how they
 * relate, and how well each rule is checked.
 *
 * How: parses the interface files, collecting each interface's doc,
 * members, extends and uses edges, and rules. The parser knows only the
 * conventions those files follow (a doc comment, export interface, members
 * ending in ";"), because TypeScript 7's package has no JavaScript parser.
 * Runs the test files once to learn which rule IDs have a test of that
 * name, and counts the kept adversaries for each rule. Writes catalog.md (a
 * Mermaid diagram and rule tables) and catalog.html (an interactive map
 * built from catalog.template.html).
 * Run: npm run catalog. Takes about as long as the tests. summary.ts
 * imports build() for the one-page PDF.
 * Imports: node:child_process, node:fs
 */

import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";

const sources = ["events.ts", "geometry.ts", "color.ts", "shape.ts", "window.ts", "view.ts", "shapeView.ts", "pointer.ts", "ui.ts", "chrome.ts", "app.ts"];
const tags = ["requires", "ensures", "invariant", "unchecked"] as const;
type Tag = (typeof tags)[number];

/** tested: a test has the rule's ID. caller: a @requires, which the caller keeps. */
type Status = "tested" | "untested" | "unchecked" | "caller";

interface Rule {
  id: string;
  tag: Tag;
  slug: string;
  headline: string;
  expression: string | null;
  status: Status;
  adversaries: number;
}

interface Member {
  name: string;
  signature: string;
  doc: string;
}

export interface Interface {
  name: string;
  file: string;
  /** The type parameters and the extends clause (without "extends"), as written. */
  typeParams: string;
  extendsClause: string;
  doc: string;
  members: Member[];
  extends: string[];
  uses: string[];
  rules: Rule[];
}

type ParsedRule = Omit<Rule, "id" | "status" | "adversaries">;

/** A doc comment's prose and its rules. Rule expressions are the indented lines after a rule. */
function parseDoc(raw: string | undefined): { doc: string; rules: ParsedRule[] } {
  if (!raw) return { doc: "", rules: [] };
  const lines = raw.split(/\r?\n/)
    .map((l) => l.replace(/^\s*\/\*\*\s?/, "").replace(/\s*\*\/\s*$/, "").replace(/^\s*\* ?/, ""));
  const prose: string[] = [];
  const rules: ParsedRule[] = [];
  let inTags = false;
  for (const line of lines) {
    const m = /^@(\w+)\s+(\S+)\s+(.*)$/.exec(line);
    if (m && (tags as readonly string[]).includes(m[1])) {
      rules.push({ tag: m[1] as Tag, slug: m[2], headline: m[3].trim(), expression: null });
      inTags = true;
    } else if (line.startsWith("@")) {
      inTags = true;
    } else if (inTags && line.startsWith("  ") && rules.length > 0) {
      const last = rules[rules.length - 1];
      last.expression = (last.expression ? last.expression + "\n" : "") + line.trimEnd();
    } else if (!inTags) {
      prose.push(line);
    }
  }
  const doc = prose.join("\n").trim().split(/\n\s*\n/).map((p) => p.replace(/\s*\n\s*/g, " ")).join("\n\n");
  return { doc, rules };
}

interface Declaration {
  name: string;
  file: string;
  doc: string | undefined;
  typeParams: string;
  extendsClause: string;
  extends: string[];
  members: { doc: string | undefined; text: string }[];
}

/** The index just past the brace that closes the one at open, skipping comments and strings. */
function closeBrace(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (c === "/" && text[i + 1] === "*") i = text.indexOf("*/", i + 2) + 1;
    else if (c === "/" && text[i + 1] === "/") i = text.indexOf("\n", i);
    else if (c === '"' || c === "'" || c === "`") i = text.indexOf(c, i + 1);
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return i + 1;
  }
  throw new Error("unbalanced braces");
}

/** Splits an interface body into members: an optional doc comment, then text up to ";" at depth 0. */
function membersOf(body: string): Declaration["members"] {
  const out: Declaration["members"] = [];
  let doc: string | undefined;
  let i = 0;
  while (i < body.length) {
    while (i < body.length && /\s/.test(body[i])) i++;
    if (i >= body.length) break;
    if (body.startsWith("/**", i)) {
      const end = body.indexOf("*/", i) + 2;
      doc = body.slice(i, end);
      i = end;
      continue;
    }
    if (body.startsWith("//", i)) {
      i = body.indexOf("\n", i);
      if (i < 0) break;
      continue;
    }
    let depth = 0;
    let j = i;
    for (; j < body.length; j++) {
      const c = body[j];
      if ("({[<".includes(c)) depth++;
      else if (")}]".includes(c) || (c === ">" && body[j - 1] !== "=")) depth--;
      else if (c === ";" && depth === 0) break;
    }
    out.push({ doc, text: body.slice(i, j).trim() });
    doc = undefined;
    i = j + 1;
  }
  return out;
}

/** Splits text at commas outside angle brackets and braces. */
function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "<" || c === "{" || c === "[" || c === "(") depth++;
    else if (c === ">" || c === "}" || c === "]" || c === ")") depth--;
    else if (c === "," && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts.map((p) => p.trim()).filter(Boolean);
}

/**
 * The index of the interface body's opening brace: the first "{" outside
 * angle brackets, so that an extends clause such as Emitter<{ change: [] }>
 * isn't mistaken for the body.
 */
function bodyStart(text: string, from: number): number {
  let depth = 0;
  for (let i = from; i < text.length; i++) {
    const c = text[i];
    if (c === "<") depth++;
    else if (c === ">" && text[i - 1] !== "=") depth--;
    else if (c === "{" && depth === 0) return i;
  }
  throw new Error(`no interface body after offset ${from}`);
}

function interfacesIn(file: string): Declaration[] {
  const text = readFileSync(file, "utf8");
  const found: Declaration[] = [];
  const re = /(\/\*\*(?:(?!\*\/)[\s\S])*\*\/)?\s*export interface (\w+)/g;
  for (const m of text.matchAll(re)) {
    const open = bodyStart(text, m.index + m[0].length);
    const head = text.slice(m.index + m[0].length, open);
    // head is "<type params> extends A, B<...> " with either part optional.
    const at = /\bextends\b/.exec(head.replace(/<(?:[^<>]|<[^<>]*>)*>/, (t) => " ".repeat(t.length)));
    const typeParams = (at ? head.slice(0, at.index) : head).trim();
    const extendsClause = at ? head.slice(at.index + "extends".length).trim() : "";
    const close = closeBrace(text, open);
    found.push({
      name: m[2],
      file,
      doc: m[1],
      typeParams,
      extendsClause,
      extends: splitTopLevel(extendsClause).map((t) => t.replace(/<[\s\S]*$/, "").trim()),
      members: membersOf(text.slice(open + 1, close - 1)),
    });
  }
  return found;
}

/** The known interface names a piece of type text mentions. */
function mentions(text: string, known: Set<string>): string[] {
  return [...new Set(text.match(/\b[A-Z]\w*\b/g) ?? [])].filter((n) => known.has(n));
}

/** The names of every test that ran, from TAP output. */
function testNames(): Set<string> {
  const files = [
    ...readdirSync(".").filter((f) => f.endsWith(".test.ts")),
    "adversaries/helpers.check.ts",
  ];
  const run = spawnSync(process.execPath, ["--test", "--test-reporter=tap", ...files], {
    encoding: "utf8", maxBuffer: 256 * 1024 * 1024, env: { ...process.env, FC_SEED: process.env.FC_SEED ?? "1" },
  });
  return new Set([...run.stdout.matchAll(/^\s*(?:not )?ok \d+ - (.+?)\s*$/gm)].map((m) => m[1]));
}

function adversaryCounts(): Map<string, number> {
  const counts = new Map<string, number>();
  for (const f of readdirSync("adversaries").filter((f) => f.endsWith(".adversary.ts"))) {
    const rule = f.slice(0, f.indexOf("--"));
    counts.set(rule, (counts.get(rule) ?? 0) + 1);
  }
  return counts;
}

/** Every interface in the sources. Rule status comes from tests, which by default are run to find out. */
export function build(tests: Set<string> = testNames()): Interface[] {
  const decls = sources.flatMap(interfacesIn);
  const known = new Set(decls.map((d) => d.name));
  const adversaries = adversaryCounts();
  const rule = (prefix: string, r: ParsedRule): Rule => {
    const id = `${prefix}.${r.slug}`;
    const status: Status = r.tag === "unchecked" ? "unchecked" : r.tag === "requires" ? "caller" : tests.has(id) ? "tested" : "untested";
    return { ...r, id, status, adversaries: adversaries.get(id) ?? 0 };
  };
  return decls.map((d) => {
    const own = parseDoc(d.doc);
    const rules = own.rules.map((r) => rule(d.name, r));
    const uses = new Set(mentions(`${d.typeParams} ${d.extendsClause}`, known));
    const members: Member[] = d.members.map((m) => {
      const name = /^(?:readonly\s+)?(?:get\s+|set\s+)?(\w+)/.exec(m.text)?.[1] ?? m.text;
      const parsed = parseDoc(m.doc);
      rules.push(...parsed.rules.map((r) => rule(`${d.name}.${name}`, r)));
      for (const u of mentions(m.text, known)) uses.add(u);
      return { name, signature: m.text.replace(/\s+/g, " "), doc: parsed.doc };
    });
    return {
      name: d.name,
      file: d.file,
      typeParams: d.typeParams,
      extendsClause: d.extendsClause,
      doc: own.doc,
      members,
      extends: d.extends.filter((e) => known.has(e)),
      uses: [...uses].filter((u) => u !== d.name && !d.extends.includes(u)).sort(),
      rules,
    };
  });
}

const statusLabel: Record<Status, string> = {
  tested: "tested", untested: "no test by this ID", unchecked: "@unchecked", caller: "caller's obligation",
};

function markdown(all: Interface[]): string {
  const out: string[] = [
    "# Interface catalog",
    "",
    "Generated by `npm run catalog` from " + sources.map((s) => `\`${s}\``).join(", ") +
      ". Don't edit by hand. `catalog.html` is the interactive version.",
    "",
    "Solid arrows with hollow heads are `extends`; dashed arrows are `uses` (a member or type parameter refers to the other interface).",
    "",
    "```mermaid",
    "classDiagram",
  ];
  for (const i of all) {
    out.push(`  class ${i.name} {`);
    for (const m of i.members) out.push(`    ${m.name}`);
    out.push("  }");
  }
  for (const i of all) {
    for (const e of i.extends) out.push(`  ${e} <|-- ${i.name}`);
    for (const u of i.uses) out.push(`  ${i.name} ..> ${u}`);
  }
  out.push("```", "");
  for (const i of all) {
    out.push(`## ${i.name}`, "", `\`${i.file}\`. ${i.doc.split("\n\n")[0]}`, "");
    if (i.rules.length === 0) {
      out.push("No rules of its own.", "");
      continue;
    }
    out.push("| Rule | Tag | Headline | Status | Adversaries |", "|---|---|---|---|---|");
    for (const r of i.rules) {
      out.push(`| \`${r.id}\` | ${r.tag} | ${r.headline.replace(/\|/g, "\\|")} | ${statusLabel[r.status]} | ${r.adversaries || ""} |`);
    }
    out.push("");
  }
  return out.join("\n");
}

if (import.meta.main) {
  const all = build();
  writeFileSync("catalog.md", markdown(all));
  const template = readFileSync("catalog.template.html", "utf8");
  const data = JSON.stringify({ generated: new Date().toLocaleDateString("en-CA"), interfaces: all }).replace(/</g, "\\u003c");
  writeFileSync("catalog.html", template.replace("/*CATALOG_DATA*/null", data));
  const rules = all.flatMap((i) => i.rules);
  const count = (s: Status) => rules.filter((r) => r.status === s).length;
  console.log(`${all.length} interfaces, ${rules.length} rules: ${count("tested")} tested, ` +
    `${count("untested")} with no test by ID, ${count("unchecked")} unchecked, ${count("caller")} caller obligations`);
}
