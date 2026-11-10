/**
 * Catalog is a script: it shows humans which interfaces exist, how they
 * relate, and how well each rule is checked.
 *
 * How: parses the interface files, collecting each interface's doc,
 * members, extends and uses edges, and rules. The parser knows only the
 * conventions those files follow (a doc comment, export interface, members
 * ending in ";"), because TypeScript 7's package has no JavaScript parser.
 * Runs the test files once to learn which rule IDs have a test of that
 * name, reads bench.ts for the IDs of the @budget rules it measures, and
 * counts the kept adversaries for each rule. Writes catalog.md (a
 * Mermaid diagram and rule tables) and catalog.html (an interactive map
 * built from catalog.template.html).
 * Run: npm run catalog. Takes about as long as the tests. summary.ts
 * imports build() for the one-page PDF.
 * Imports: node:child_process, node:fs
 */

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";

const sources = ["events.ts", "geometry.ts", "color.ts", "shape.ts", "frames.ts", "view.ts", "shapeView.ts", "layout.ts"];
const tags = ["requires", "ensures", "invariant", "valid", "abstract", "budget", "deferred"] as const;
type Tag = (typeof tags)[number];
/** The scripts that measure @budget rules, each labeling a measurement with the rule's ID. */
const benches = ["bench.ts"];

/**
 * tested: a test has the rule's ID. caller: a @requires, which the caller
 * keeps. abstract: an @abstract rule, which each interface that extends its
 * own refines with a tested rule (refinedBy). budget: a @budget rule, which
 * a bench script measures and reports rather than tests (measuredBy; empty
 * until the phase 2 task that adds the measurement runs). deferred: a
 * @deferred rule, checked once a feature exists, as its when and how say.
 * untested: no test has the rule's ID; the catalog refuses to write while
 * any rule is untested, so the pages never show it.
 */
type Status = "tested" | "untested" | "abstract" | "budget" | "deferred" | "caller";
type Shown = Exclude<Status, "untested">;

interface Rule {
  id: string;
  tag: Tag;
  slug: string;
  headline: string;
  expression: string | null;
  /** For a @deferred rule: what must exist before it can be checked, and how it will be checked then. */
  when: string | null;
  how: string | null;
  status: Status;
  adversaries: number;
  /** For an @abstract rule, the IDs of the rules that refine it. */
  refinedBy: string[];
  /** For a @budget rule, the bench scripts that name its ID. */
  measuredBy: string[];
}

/** An @refines line: the abstract rule's ID, and the slug of the refining rule in the same doc. */
interface Refinement {
  abstract: string;
  by: string;
}

interface Member {
  name: string;
  signature: string;
  doc: string;
}

export interface Interface {
  name: string;
  file: string;
  /** True for a file's header rules rather than an interface: no members or edges. */
  module: boolean;
  /** The type parameters and the extends clause (without "extends"), as written. */
  typeParams: string;
  extendsClause: string;
  doc: string;
  members: Member[];
  extends: string[];
  uses: string[];
  rules: Rule[];
  /** The abstract rules this interface refines, with the IDs of its refining rules. */
  refines: Refinement[];
}

type ParsedRule = Omit<Rule, "id" | "status" | "adversaries" | "refinedBy" | "measuredBy">;

/**
 * A doc comment's prose, its rules and its @refines lines. Rule expressions
 * are the indented lines after a rule, except lines starting "when:" or
 * "how:", which give a @deferred rule's plan.
 */
function parseDoc(raw: string | undefined): { doc: string; rules: ParsedRule[]; refines: Refinement[] } {
  if (!raw) return { doc: "", rules: [], refines: [] };
  const lines = raw.split(/\r?\n/)
    .map((l) => l.replace(/^\s*\/\*\*\s?/, "").replace(/\s*\*\/\s*$/, "").replace(/^\s*\* ?/, ""));
  const prose: string[] = [];
  const rules: ParsedRule[] = [];
  const refines: Refinement[] = [];
  let inTags = false;
  for (const line of lines) {
    const r = /^@refines\s+(\S+)\s+(\S+)\s*$/.exec(line);
    const m = /^@(\w+)\s+(\S+)\s+(.*)$/.exec(line);
    if (r) {
      refines.push({ abstract: r[1], by: r[2] });
      inTags = true;
    } else if (m && (tags as readonly string[]).includes(m[1])) {
      rules.push({ tag: m[1] as Tag, slug: m[2], headline: m[3].trim(), expression: null, when: null, how: null });
      inTags = true;
    } else if (line.startsWith("@")) {
      inTags = true;
    } else if (inTags && line.startsWith("  ") && rules.length > 0) {
      const last = rules[rules.length - 1];
      const plan = /^\s+(when|how):\s*(.*)$/.exec(line);
      if (plan) last[plan[1] as "when" | "how"] = plan[2].trim();
      else last.expression = (last.expression ? last.expression + "\n" : "") + line.trimEnd();
    } else if (!inTags) {
      prose.push(line);
    }
  }
  const doc = prose.join("\n").trim().split(/\n\s*\n/).map((p) => p.replace(/\s*\n\s*/g, " ")).join("\n\n");
  return { doc, rules, refines };
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
 * angle brackets, so that an extends clause such as EventEmitter<{ change: [] }>
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

/** A type alias declared in an interface file, with its definition as one line. */
export interface TypeAlias { name: string; file: string; doc: string; text: string }

function aliasesIn(file: string): TypeAlias[] {
  const text = readFileSync(file, "utf8");
  const re = /(\/\*\*(?:(?!\*\/)[\s\S])*\*\/)?\s*export type (\w+)/g;
  return [...text.matchAll(re)].map((m) => {
    const start = m.index + m[0].length;
    let depth = 0;
    let j = start;
    for (; j < text.length; j++) {
      const c = text[j];
      if ("({[<".includes(c)) depth++;
      else if (")}]".includes(c) || (c === ">" && text[j - 1] !== "=")) depth--;
      else if (c === ";" && depth === 0) break;
    }
    const definition = `type ${m[2]}${text.slice(start, j)}`.replace(/\s+/g, " ").replace(/= \| /, "= ").trim();
    return { name: m[2], file, doc: parseDoc(m[1]).doc, text: definition };
  });
}

/** Every exported type alias in the interface files. */
export function typeAliases(): TypeAlias[] {
  return sources.flatMap(aliasesIn);
}

/** The known interface names a piece of type text mentions. */
function mentions(text: string, known: Set<string>): string[] {
  return [...new Set(text.match(/\b[A-Z]\w*\b/g) ?? [])].filter((n) => known.has(n));
}

/**
 * The names of every test that ran, from TAP output. The run is expected to
 * fail while phase 2 modules are missing, so its exit status says nothing.
 * Throws instead when a package can't be found (node_modules not installed)
 * or no test ran, since every rule would then read as untested.
 */
function testNames(): Set<string> {
  const files = [
    ...readdirSync(".").filter((f) => f.endsWith(".test.ts")),
    "adversaries/helpers.check.ts",
  ];
  const run = spawnSync(process.execPath, ["--test", "--test-reporter=tap", ...files], {
    encoding: "utf8", maxBuffer: 256 * 1024 * 1024, env: { ...process.env, FC_SEED: process.env.FC_SEED ?? "1" },
  });
  const missing = run.stdout.match(/Cannot find package '[^']+'/);
  if (missing) throw new Error(`${missing[0]}; run npm ci first. The catalog was not written.`);
  const names = new Set([...run.stdout.matchAll(/^\s*(?:not )?ok \d+ - (.+?)\s*$/gm)].map((m) => m[1]));
  if (names.size === 0) throw new Error(`No tests ran; the catalog was not written.\n${run.stderr}`);
  return names;
}

function adversaryCounts(): Map<string, number> {
  const counts = new Map<string, number>();
  for (const f of readdirSync("adversaries").filter((f) => f.endsWith(".adversary.ts"))) {
    const rule = f.slice(0, f.indexOf("--"));
    counts.set(rule, (counts.get(rule) ?? 0) + 1);
  }
  return counts;
}

/**
 * Every interface in the sources, and an entry with module set for each file
 * whose header has rules. Rule status comes from tests, which by default are
 * run to find out.
 */
export function build(tests: Set<string> = testNames()): Interface[] {
  const decls = sources.flatMap(interfacesIn);
  const known = new Set(decls.map((d) => d.name));
  const adversaries = adversaryCounts();
  const benchText = new Map(benches.filter(existsSync).map((f) => [f, readFileSync(f, "utf8")]));
  const rule = (prefix: string, r: ParsedRule): Rule => {
    const id = `${prefix}.${r.slug}`;
    // A @deferred rule with a test reads as tested, which planProblems reports.
    const status: Status = r.tag === "requires" ? "caller"
      : r.tag === "abstract" ? "abstract" : r.tag === "budget" ? "budget"
      : tests.has(id) ? "tested" : r.tag === "deferred" ? "deferred" : "untested";
    const measuredBy = r.tag === "budget" ? [...benchText].filter(([, text]) => text.includes(id)).map(([f]) => f) : [];
    return { ...r, id, status, adversaries: adversaries.get(id) ?? 0, refinedBy: [], measuredBy };
  };
  // A file's header rules have IDs that start with the file's name (rules.ts).
  const modules: Interface[] = sources.flatMap((file) => {
    const header = parseDoc(/^\s*(\/\*\*[\s\S]*?\*\/)/.exec(readFileSync(file, "utf8"))?.[1]);
    if (header.rules.length === 0) return [];
    const name = file.replace(/\.ts$/, "");
    return [{
      name, file, module: true, typeParams: "", extendsClause: "", doc: header.doc,
      members: [], extends: [], uses: [], rules: header.rules.map((r) => rule(name, r)), refines: [],
    }];
  });
  const all = [...modules, ...decls.map((d): Interface => {
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
      module: false,
      typeParams: d.typeParams,
      extendsClause: d.extendsClause,
      doc: own.doc,
      members,
      extends: d.extends.filter((e) => known.has(e)),
      uses: [...uses].filter((u) => u !== d.name && !d.extends.includes(u)).sort(),
      rules,
      refines: own.refines.map((r) => ({ abstract: r.abstract, by: `${d.name}.${r.by}` })),
    };
  })];
  const abstracts = new Map(all.flatMap((i) => i.rules).filter((r) => r.tag === "abstract").map((r) => [r.id, r]));
  for (const i of all) for (const r of i.refines) abstracts.get(r.abstract)?.refinedBy.push(r.by);
  return all;
}

/** The interfaces i extends, directly or through others, nearest first. */
function ancestors(i: Interface, byName: Map<string, Interface>): Interface[] {
  const out: Interface[] = [];
  const visit = (name: string) => {
    const a = byName.get(name);
    if (!a || out.includes(a)) return;
    out.push(a);
    a.extends.forEach(visit);
  };
  i.extends.forEach(visit);
  return out;
}

/**
 * What breaks the @abstract rules' contract: an interface that extends one
 * without refining it, here or in an ancestor; an @refines naming a rule that
 * isn't abstract or isn't inherited; or a refining rule that doesn't exist or
 * has no test.
 */
export function refinementProblems(all: Interface[]): string[] {
  const byName = new Map(all.map((i) => [i.name, i]));
  const problems: string[] = [];
  for (const i of all) {
    const up = ancestors(i, byName);
    for (const a of up) {
      for (const r of a.rules.filter((r) => r.tag === "abstract")) {
        if (![i, ...up].some((j) => j.refines.some((f) => f.abstract === r.id))) problems.push(`${i.name} doesn't refine ${r.id}`);
      }
    }
    for (const f of i.refines) {
      if (!up.some((a) => a.rules.some((r) => r.id === f.abstract && r.tag === "abstract"))) {
        problems.push(`${i.name} refines ${f.abstract}, which isn't an @abstract rule of an interface it extends`);
      }
      const by = i.rules.find((r) => r.id === f.by);
      if (!by) problems.push(`${i.name} refines ${f.abstract} with ${f.by}, which isn't one of its rules`);
      else if (by.status !== "tested") problems.push(`${i.name} refines ${f.abstract} with ${f.by}, which isn't tested`);
    }
  }
  return problems;
}

/**
 * What breaks the @deferred rules' contract: a deferred rule without both a
 * when: and a how: line, a deferred rule that a test now checks (it should
 * become @ensures), or a plan line on a rule that isn't deferred.
 */
export function planProblems(all: Interface[]): string[] {
  return all.flatMap((i) => i.rules).flatMap((r) => {
    if (r.tag !== "deferred") return r.when || r.how ? [`${r.id} has a when: or how: line but isn't @deferred`] : [];
    const out: string[] = [];
    if (!r.when) out.push(`${r.id} is @deferred without a when: line`);
    if (!r.how) out.push(`${r.id} is @deferred without a how: line`);
    if (r.status === "tested") out.push(`${r.id} is @deferred but a test has its ID; change it to @ensures`);
    return out;
  });
}

/**
 * Tags in the sources' doc comments that the rule language doesn't have.
 * parseDoc skips them, so without this check a misspelled or retired tag
 * would drop its rule from the catalog without a word.
 */
export function tagProblems(): string[] {
  const known = new Set<string>([...tags, "refines", "module"]);
  return sources.flatMap((file) => readFileSync(file, "utf8").split(/\r?\n/).flatMap((line, n) => {
    const m = /^\s*\* @(\w+)/.exec(line);
    return m && !known.has(m[1]) ? [`${file}:${n + 1} uses @${m[1]}, which isn't a tag of the rule language (rules.ts)`] : [];
  }));
}

const statusLabel: Record<Shown, string> = {
  tested: "tested", abstract: "abstract", budget: "budget", deferred: "deferred", caller: "caller's obligation",
};

function statusText(r: Rule): string {
  const label = statusLabel[r.status as Shown];
  if (r.status === "abstract") return `${label}: refined by ${r.refinedBy.map((id) => `\`${id}\``).join(", ")}`;
  if (r.status === "budget") return `${label}: ${r.measuredBy.length ? `measured by ${r.measuredBy.join(", ")}` : "not measured yet"}`;
  if (r.status === "deferred") return `${label}: when ${r.when}`;
  return label;
}

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
      out.push(`| \`${r.id}\` | ${r.tag} | ${r.headline.replace(/\|/g, "\\|")} | ${statusText(r)} | ${r.adversaries || ""} |`);
    }
    out.push("");
  }
  return out.join("\n");
}

if (import.meta.main) {
  const all = build();
  const rules = all.flatMap((i) => i.rules);
  const untested = rules.filter((r) => r.status === "untested").map((r) => r.id);
  if (untested.length > 0) {
    throw new Error(`No test has the ID of ${untested.join(", ")}. Add one, or mark the rule @deferred with when: and how: lines. The catalog was not written.`);
  }
  const problems = [...tagProblems(), ...refinementProblems(all), ...planProblems(all)];
  if (problems.length > 0) throw new Error(`${problems.join("; ")}. The catalog was not written.`);
  writeFileSync("catalog.md", markdown(all));
  const template = readFileSync("catalog.template.html", "utf8");
  const data = JSON.stringify({ generated: new Date().toLocaleDateString("en-CA"), interfaces: all }).replace(/</g, "\\u003c");
  writeFileSync("catalog.html", template.replace("/*CATALOG_DATA*/null", data));
  const count = (s: Status) => rules.filter((r) => r.status === s).length;
  console.log(`${all.filter((i) => !i.module).length} interfaces, ${rules.length} rules: ${count("tested")} tested, ` +
    `${count("abstract")} abstract, ${count("budget")} budgets, ${count("deferred")} deferred, ${count("caller")} caller obligations`);
}
