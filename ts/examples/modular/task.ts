/**
 * task is a script: it turns sections of impl-specs.md into generation
 * tasks whose information flow is enforced, not only stated.
 *
 * How: A section with an Imports field is a task. `make` builds a workspace
 * outside the repo holding only what the task may read: the type-import
 * closure of its imports, its test wiring and that wiring's closure, and
 * TASK.md (the shared rules plus its section). Every file but the outputs
 * is read-only and hashed. It also writes, beside the workspace, a policy
 * for a headless agent: file tools only, writes only to the outputs and
 * REPORT.md, reads only in the workspace, and Bash only for npm test,
 * npm run typecheck and npm run check. `check` verifies a workspace
 * against the hashes kept outside it: inputs unchanged, no other files,
 * outputs linted (imports, forbidden escapes, header Imports field),
 * compiled without Node or the DOM unless the task binds them, and tested.
 * `collect` checks, then copies the outputs into the repo and records them
 * in tasks.json. `lint` applies the same output checks to every collected
 * task in the repo. For phase 3, <n>.2 is a second independent run whose
 * output is collected into alternates/, and <n>.d a workspace with both
 * runs as a/ and b/ in random order, where check runs the agent's tests as
 * A, as B and as the reference adapter (<file>.ref.ts) and requires each
 * to pass on exactly one of A and B.
 * Run: node task.ts list | make <n> | run <n> [--model <m>] | check <n> | collect <n> | review-check <n> | review <n> | lint | costs
 * Imports: node:fs, node:path, node:crypto, node:child_process, node:os
 */

import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, posix, relative, resolve } from "node:path";
import { createHash, randomInt } from "node:crypto";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";

/** The blueprint's interface files, and platform subsets: imported with import type only. */
export const interfaceFiles = ["events.ts", "geometry.ts", "color.ts", "shape.ts", "dataModel.ts", "shapeModel.ts", "frames.ts", "view.ts", "shapeView.ts", "layout.ts", "canvas.ts", "dom.ts"];

/** Commands a task's agent may run: a task that writes bench.ts may also run it. */
function commandsOf(task: Task): string[] {
  if (task.variant === "d") return ["npm run typecheck", "npm run check"];
  const commands = ["npm test", "npm run typecheck", "npm run check"];
  return task.outputs.some((o) => o.file === "bench.ts") ? [...commands, "npm run bench"] : commands;
}

/** What an output may not contain: each is a way around the compile-time restrictions. */
const forbidden: [RegExp, string][] = [
  [/\bany\b/, "any (it switches off type checking)"],
  [/\bglobalThis\b/, "globalThis (it reaches the platform without types)"],
  [/\beval\b/, "eval"],
  [/\bFunction\b/, "Function (it compiles code at run time)"],
  [/\brequire\b/, "require"],
  [/\bimport\s*\(/, "dynamic import()"],
  [/\bimport\.meta\b/, "import.meta"],
  [/\bdeclare\b/, "declare (it invents platform types)"],
];

// ---- Tasks ----------------------------------------------------------------

interface Output { file: string; headerOnly: boolean }

interface Task {
  n: number;
  title: string;
  section: string;
  outputs: Output[];
  /** The files the outputs may import. */
  imports: string[];
  binds: ("node" | "dom")[];
  /** The task's test wiring: <output>.test.ts for each full output, when it exists. */
  tests: string[];
  /** Files the task must not read. */
  hidden: string[];
  /** Why the task may not run yet, from its Held field; the human removes the field to release it. */
  held?: string;
  /**
   * Which job a command is for: the task's own run (8), a second
   * independent run (8.2), or phase 3's distinguishing of the two (8.d).
   */
  variant: Variant;
}

type Variant = 1 | 2 | "d";

const repo = dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const tasksDir = resolve(process.env.TASKS_DIR ?? join(repo, "..", "modular-tasks"));
const read = (file: string) => readFileSync(file, "utf8");
const sha = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");
const tsFiles = (text: string) => [...new Set([...text.matchAll(/`([\w.]+\.ts)`/g)].map((m) => m[1]))];

function field(section: string, name: string): string | undefined {
  return new RegExp(`^- \\*\\*${name}:\\*\\*(.*(?:\\n  .*)*)`, "m").exec(section)?.[1];
}

function parseTasks(specs = read(join(repo, "impl-specs.md")), root = repo): Task[] {
  const tasks: Task[] = [];
  for (const part of specs.split(/^(?=## )/m)) {
    const head = /^## (\d+)\. (.*)\n/.exec(part);
    const imports = field(part, "Imports");
    if (!head || imports === undefined) continue;
    const outputsField = field(part, "Outputs");
    const outputs: Output[] = outputsField
      ? [...outputsField.matchAll(/`([\w.]+\.ts)`( \(header only\))?/g)].map((m) => ({ file: m[1], headerOnly: !!m[2] }))
      : tsFiles(head[2]).slice(0, 1).map((file) => ({ file, headerOnly: false }));
    const binds = (field(part, "Binds") ?? "").split(/[\s,]+/).filter((b): b is "node" | "dom" => b === "node" || b === "dom");
    const tests = outputs.filter((o) => !o.headerOnly).map((o) => o.file.replace(/\.ts$/, ".test.ts"))
      .filter((t) => existsSync(join(root, t)));
    const hidden = [...(field(part, "Hidden") ?? "").matchAll(/`([\w./]+\.ts)`/g)].map((m) => m[1]);
    const held = field(part, "Held")?.trim();
    tasks.push({ n: Number(head[1]), title: head[2], section: part.trimEnd(), outputs, imports: tsFiles(imports), binds, tests, hidden, held, variant: 1 });
  }
  return tasks;
}

/** A task by number or output file; 8.2 is its second run, 8.d its distinguishing. */
function findTask(arg: string | undefined): Task {
  const [, n, v] = /^(.+?)(?:\.(2|d))?$/.exec(arg ?? "") ?? [];
  const task = parseTasks().find((t) => String(t.n) === n || t.outputs[0]?.file === arg);
  if (!task) throw new Error(`no task ${arg}; run node task.ts list`);
  return { ...task, variant: v === "2" ? 2 : v === "d" ? "d" : 1 };
}

/** The task's key in tasks.json and in report names: 8, 8.2 or 8.d. */
const keyOf = (task: Task) => (task.variant === 1 ? `${task.n}` : `${task.n}.${task.variant}`);

/** The relative .ts files a file imports, as repo paths. */
function importsOf(root: string, file: string): string[] {
  const path = join(root, file);
  if (!existsSync(path)) return [];
  return [...read(path).matchAll(/(?:from|import)\s+"(\.{1,2}\/[^"]+\.ts)"/g)]
    .map((m) => posix.normalize(posix.join(posix.dirname(file), m[1])));
}

/** Every file reachable from starts by imports, stopping at (and leaving out) the excluded ones. */
function closure(root: string, starts: string[], exclude: Set<string>): string[] {
  const seen = new Set<string>();
  const visit = (f: string) => {
    if (seen.has(f) || exclude.has(f) || !existsSync(join(root, f))) return;
    seen.add(f);
    importsOf(root, f).forEach(visit);
  };
  starts.forEach(visit);
  return [...seen].sort();
}

/** What a task's agent reads: its imports' closure, its tests' closure, and rules.ts. */
function readsOf(task: Task): string[] {
  const outputs = new Set(task.outputs.map((o) => o.file));
  return closure(repo, [...task.imports, ...task.tests, "rules.ts"], outputs);
}

// ---- State ----------------------------------------------------------------

/** What `claude -p --output-format json` reports for one run. Costs are at API list prices. */
type Usage = {
  total_cost_usd?: number;
  usage?: { input_tokens?: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number; output_tokens?: number };
  modelUsage?: Record<string, { costUSD?: number }>;
  num_turns?: number;
  duration_ms?: number;
};
/** One attempt that stopped with questions. */
type Stop = { stopped: string; report: string; usage?: Usage };
/** One phase 2b review that sent the task back for another attempt, with that attempt's usage. */
type Requeue = { requeued: string; review: string; usage?: Usage };
type State = Record<string, {
  collected?: string; outputs?: Record<string, string>; report?: string; usage?: Usage; stops?: Stop[];
  /** When phase 2b accepted the collected outputs, and its record. */
  reviewed?: string; review?: string; requeues?: Requeue[];
  /** Phase 3: which run each label was, and each distinguishing test's results. */
  labels?: Labels; results?: TestResult[];
}>;
type Labels = { a: string; b: string };
type TestResult = { name: string; a: boolean; b: boolean; ref: boolean };
/** Collected and accepted by phase 2b: only then do tasks that read its outputs run. */
const isDone = (state: State, key: string | number) => Boolean(state[key]?.collected && state[key]?.reviewed);
/** Collected, and waiting for phase 2b. */
const awaitsReview = (state: State, key: string | number) => Boolean(state[key]?.collected && !state[key]?.reviewed);
const statePath = join(repo, "tasks.json");
const loadState = (): State => (existsSync(statePath) ? JSON.parse(read(statePath)) : {});

/**
 * Pending tasks in waves: a task waits for any pending task whose outputs it
 * reads. Held tasks, and tasks waiting for phase 2b, don't run in a wave, so
 * tasks that read their outputs wait too.
 */
function waves(tasks: Task[], state: State): { waves: Task[][]; waiting: Task[] } {
  const held = tasks.filter((t) => (t.held !== undefined || awaitsReview(state, t.n)) && !isDone(state, t.n));
  let pending = tasks.filter((t) => t.held === undefined && !awaitsReview(state, t.n) && !isDone(state, t.n));
  const result: Task[][] = [];
  const outputsOf = (ts: Task[]) => new Set(ts.flatMap((t) => t.outputs.map((o) => o.file)));
  while (pending.length > 0) {
    const ready = pending.filter((t) => {
      const others = outputsOf([...held, ...pending.filter((o) => o !== t)]);
      const needs = closure(repo, [...t.imports, ...t.tests], new Set(t.outputs.map((o) => o.file)));
      return ![...t.imports, ...needs].some((f) => others.has(f));
    });
    if (ready.length === 0) break;
    result.push(ready);
    pending = pending.filter((t) => !ready.includes(t));
  }
  if (pending.length > 0 && held.length === 0) throw new Error(`tasks depend on each other: ${pending.map((t) => t.n).join(", ")}`);
  return { waves: result, waiting: pending };
}

// ---- Lint -----------------------------------------------------------------

/** src with comments and string contents blanked, so that only code is searched. */
function codeOnly(src: string): string {
  let out = "";
  const braces: number[] = []; // open-brace depth inside each template ${...}
  let i = 0;
  const skipTemplate = () => {
    // From just after a backtick or a closing }, to the next ${ or closing backtick.
    while (i < src.length) {
      if (src[i] === "\\") { i += 2; continue; }
      if (src[i] === "`") { i++; out += "`"; return; }
      if (src[i] === "$" && src[i + 1] === "{") { i += 2; out += "${"; braces.push(0); return; }
      out += src[i] === "\n" ? "\n" : " ";
      i++;
    }
  };
  while (i < src.length) {
    const c = src[i];
    if (c === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") i++;
    } else if (c === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      out += src.slice(i, end < 0 ? src.length : end + 2).replace(/[^\n]/g, " ");
      i = end < 0 ? src.length : end + 2;
    } else if (c === '"' || c === "'") {
      i++;
      while (i < src.length && src[i] !== c && src[i] !== "\n") i += src[i] === "\\" ? 2 : 1;
      i++;
      out += c + c;
    } else if (c === "`") {
      i++;
      out += "`";
      skipTemplate();
    } else if (c === "}" && braces.length > 0 && braces[braces.length - 1] === 0) {
      braces.pop();
      i++;
      out += "}";
      skipTemplate();
    } else {
      if (braces.length > 0 && c === "{") braces[braces.length - 1]++;
      if (braces.length > 0 && c === "}") braces[braces.length - 1]--;
      out += c;
      i++;
    }
  }
  return out;
}

/** The leading /** ... *\/ comment, and the rest. */
function splitHeader(src: string): [string, string] {
  const m = /^\s*\/\*\*[\s\S]*?\*\//.exec(src);
  return m ? [m[0], src.slice(m[0].length)] : ["", src];
}

interface LintRules { allowed: string[]; binds: string[]; packages?: string[] }

/** Problems with one output's source, under its task's rules. */
export function lintSource(file: string, src: string, rules: LintRules): string[] {
  const problems: string[] = [];
  const say = (p: string) => problems.push(`${file}: ${p}`);
  if (/^\s*\/\/\/\s*</m.test(src)) say("has a triple-slash directive");
  const code = codeOnly(src);
  for (const [re, what] of forbidden) if (re.test(code)) say(`uses ${what}`);

  const used: string[] = [];
  const statements = [...src.matchAll(/^[ \t]*(import|export)\s+(type\s+)?([^;]*?)\bfrom\s*"([^"]+)"/gm)];
  const bare = [...src.matchAll(/^[ \t]*import\s+"([^"]+)"/gm)];
  if ((code.match(/\bfrom\s*""/g) ?? []).length !== statements.length) say("has an import or export this lint can't read; use one plain import per statement");
  for (const m of bare) say(`imports ${m[1]} for its side effects`);
  for (const [, , typeOnly, names, spec] of statements) {
    if (spec.startsWith("node:")) {
      if (!rules.binds.includes("node")) say(`imports ${spec}; this task doesn't bind Node`);
      used.push(spec);
      continue;
    }
    if (rules.packages?.includes(spec)) { used.push(spec); continue; }
    const target = /^\.\/([\w.]+\.ts)$/.exec(spec)?.[1];
    if (!target) { say(`imports ${spec}; only ./<file>.ts imports are allowed`); continue; }
    used.push(target);
    if (!rules.allowed.includes(target)) say(`imports ${target}, which its task doesn't list`);
    const allTypes = /^\{[^}]*\}$/.test(names.trim()) && names.trim().slice(1, -1).split(",").every((n) => /^\s*type\s/.test(n) || n.trim() === "");
    if (interfaceFiles.includes(target) && !typeOnly && !allTypes) say(`imports ${target} without import type`);
  }

  const [header] = splitHeader(src);
  // The field, with its continuation lines: those indented past the field names.
  const declared = /^\s*\*\s*Imports:(.*(?:\n\s*\*\s{2,}\S.*)*)/m.exec(header)?.[1];
  if (declared === undefined) say("has no Imports field in its header");
  else {
    const listed = new Set([...declared.matchAll(/(node:[\w/]+|[\w.]+\.ts)/g)].map((m) => m[1]));
    for (const p of rules.packages ?? []) if (declared.includes(p)) listed.add(p);
    const actual = new Set(used);
    const missing = [...actual].filter((u) => !listed.has(u));
    const extra = [...listed].filter((l) => !actual.has(l));
    if (missing.length || extra.length) {
      say(`header Imports doesn't match its imports${missing.length ? `; missing ${missing.join(", ")}` : ""}${extra.length ? `; lists ${extra.join(", ")} but doesn't import them` : ""}`);
    }
  }
  return problems;
}

// ---- Compiling ------------------------------------------------------------

function tsconfigFor(files: string[], binds: string[], typeRoots?: string[]): object {
  return {
    compilerOptions: {
      ...(typeRoots ? { typeRoots } : {}),
      strict: true, noEmit: true, target: "es2022", module: "nodenext",
      allowImportingTsExtensions: true, erasableSyntaxOnly: true,
      lib: ["es2022", ...(binds.includes("dom") ? ["dom"] : [])],
      types: binds.includes("node") ? ["node"] : [],
    },
    files,
  };
}

function run(cmd: string, cwd: string): { ok: boolean; output: string } {
  const r = spawnSync(cmd, { cwd, shell: true, encoding: "utf8" });
  return { ok: r.status === 0, output: `${r.stdout ?? ""}${r.stderr ?? ""}`.trim() };
}

// ---- Workspaces -----------------------------------------------------------

interface Manifest {
  task: number;
  outputs: Output[];
  allowed: string[];
  binds: string[];
  tests: string[];
  /** Read-only files and their hashes. */
  inputs: Record<string, string>;
  /** For header-only outputs: the hash of everything after the header. */
  bodies: Record<string, string>;
  /** Phase 3: the implementation file the test imports, and, in the copy kept outside only, which run is A and which B. */
  subject?: string;
  labels?: Labels;
}

const suffixes = { 1: "", 2: "-run-2", d: "-distinguish" };
const workspaceOf = (task: Task) => join(tasksDir, `task-${task.n}-${task.outputs[0].file.replace(/\.ts$/, "")}${suffixes[task.variant]}`);
/** Where a second run's output is collected: beside the repo's parts, not in place of them. */
const alternateOf = (file: string) => `alternates/${file.replace(/\.ts$/, ".run-2.ts")}`;
/** The reference adapter phase 3 runs a distinguishing test against: exactly the task's exports. */
const refOf = (file: string) => file.replace(/\.ts$/, ".ref.ts");
const manifestOf = (task: Task) => `${workspaceOf(task)}.manifest.json`;
const bodyHash = (src: string) => createHash("sha256").update(splitHeader(src)[1]).digest("hex");

function taskText(task: Task, reads: string[]): string {
  const specs = read(join(repo, "impl-specs.md"));
  const shared = /^## Rules for every implementation\n[\s\S]*?(?=^## )/m.exec(specs)?.[0].trimEnd() ?? "";
  const outputs = task.outputs.map((o) => `\`${o.file}\`${o.headerOnly ? " (its header comment only)" : ""}`).join(", ");
  return `# Task ${task.n}: ${task.title.replace(/`/g, "")}

This folder holds everything you need for this task, and everything you
may read. The restrictions below are enforced, not only asked for.

- **Write:** ${outputs}, and your report in \`REPORT.md\`. Every other file
  is read-only and is checked unchanged afterward.
- **Your outputs may import only:** ${task.imports.map((f) => `\`${f}\``).join(", ")}${task.binds.includes("node") ? ", and Node built-ins (`node:*`)" : ""}.
- **Compiled with:** the ES2022 library${task.binds.length ? ` and the ${task.binds.join(" and ")} types` : " only, so no Node or browser APIs"}.
- **Not allowed in your outputs:** ${forbidden.map(([, w]) => w.split(" (")[0]).join(", ")}, and triple-slash directives.
- **Commands:** ${commandsOf(task).map((c) => `\`${c}\``).join(", ")}. No others will run.
  \`npm test\` lints your outputs before running the tests; \`npm run check\`
  runs every check the collector will run.
- **Read-only files here:** ${reads.map((f) => `\`${f}\``).join(", ")}.

**What you may decide.** Only what the spec leaves open: anything under
"Left to the implementer", and details no rule or spec text addresses,
such as names, data layout and helper functions. You may not decide what
the spec means. If a rule or spec text can be read more than one way, if
two of them conflict, or if the spec doesn't say something your
implementation must get right, stop: don't pick a reading, and don't
finish the implementation. Read the rest of this task's rules and spec for
every other such question, so that the next attempt can have them all
settled, and write a stopped report.

**REPORT.md** starts with one line: \`Status: done\` or \`Status: stopped\`.

- **Done:** a \`## Choices\` section listing each choice you made that the
  spec left open, and where your header records it (AdditionalSemantics,
  Cost and so on), and a \`## Notes\` section for anything you found hard
  or needed to know that none of these files told you. A done report has
  no questions.
- **Stopped:** a \`## Questions\` section. For each question: the file and
  rule ID or spec text; what is ambiguous, inconsistent or missing; the
  readings you see, with a concrete case where they differ; and what you
  need to be told. Your outputs are not collected, so they may be missing
  or partial.

${shared}

${task.section}
`;
}

/** The hidden files a task would read. */
const leaks = (task: Task) => readsOf(task).filter((f) => task.hidden.includes(f));

function make(task: Task): void {
  if (task.variant === "d") return makeDistinguish(task);
  const dir = workspaceOf(task);
  const key = keyOf(task);
  if (task.held !== undefined) throw new Error(`task ${task.n} is held: ${task.held}`);
  if (awaitsReview(loadState(), key)) throw new Error(`task ${key} is collected and waits for its phase 2b review: node task.ts review ${key}`);
  if (existsSync(dir)) throw new Error(`${dir} exists; delete it first, or collect it`);
  if (leaks(task).length > 0) throw new Error(`task ${task.n} would read hidden files: ${leaks(task).join(", ")}`);
  if (task.variant === 2) {
    // A second run is for phase 3, so it starts from the same accepted spec
    // as the first and never sees the first run's output.
    if (!isDone(loadState(), task.n)) throw new Error(`task ${task.n}'s first run must be collected and reviewed before its second run`);
    if (task.outputs.length !== 1 || task.outputs[0].headerOnly) throw new Error(`task ${task.n} has no single implementation to run twice`);
  }
  const reads = readsOf(task);
  mkdirSync(dir, { recursive: true });
  const write = (f: string, text: string) => {
    mkdirSync(dirname(join(dir, f)), { recursive: true });
    writeFileSync(join(dir, f), text);
  };
  for (const f of reads) {
    mkdirSync(dirname(join(dir, f)), { recursive: true });
    copyFileSync(join(repo, f), join(dir, f));
  }
  if (task.variant === 1) for (const o of task.outputs) if (existsSync(join(repo, o.file))) copyFileSync(join(repo, o.file), join(dir, o.file));
  const outputs = task.outputs.map((o) => o.file);
  const testFiles = task.tests.join(" ");
  write("TASK.md", taskText(task, reads));
  mkdirSync(join(dir, ".task"), { recursive: true });
  write("package.json", JSON.stringify({
    private: true,
    type: "module",
    scripts: {
      test: `node .task/task.ts lint-here${testFiles ? ` && node --test ${testFiles}` : ""}`,
      typecheck: "tsc -p tsconfig.impl.json && tsc -p tsconfig.json",
      check: "node .task/task.ts check-here",
      ...(commandsOf(task).includes("npm run bench") ? { bench: "node bench.ts" } : {}),
    },
  }, null, 2) + "\n");
  write("tsconfig.impl.json", JSON.stringify(tsconfigFor(outputs, task.binds), null, 2) + "\n");
  write("tsconfig.json", JSON.stringify({ ...tsconfigFor([], ["node"]), files: undefined, include: ["*.ts"] }, null, 2) + "\n");
  const bodies: Record<string, string> = {};
  for (const o of task.outputs) if (o.headerOnly) bodies[o.file] = bodyHash(read(join(repo, o.file)));
  seal(task, { task: task.n, outputs: task.outputs, allowed: task.imports, binds: task.binds, tests: task.tests, inputs: {}, bodies });
  console.log(`made ${dir}\n  reads ${reads.length} files: ${reads.join(", ")}\n  writes ${outputs.join(", ")}, REPORT.md`);
  console.log(`run the agent with: node task.ts run ${keyOf(task)}`);
}

/**
 * Finishes a workspace: hashes and write-protects every file but the
 * outputs, writes the manifest inside and the kept copy outside (which
 * alone holds `kept`), links node_modules and writes the agent's policy.
 */
function seal(task: Task, manifest: Manifest, kept: Partial<Manifest> = {}): void {
  const dir = workspaceOf(task);
  writeFileSync(join(dir, ".task/task.ts"), read(join(repo, "task.ts")));
  const outputs = manifest.outputs.map((o) => o.file);
  for (const f of walk(dir)) if (!outputs.includes(f)) manifest.inputs[f] = sha(join(dir, f));
  // The copy inside can't hold its own hash; the kept copy below does.
  writeFileSync(join(dir, ".task/manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  manifest.inputs[".task/manifest.json"] = sha(join(dir, ".task/manifest.json"));
  for (const f of Object.keys(manifest.inputs)) chmodSync(join(dir, f), 0o444);
  // The kept copy, outside the workspace, is the one collect trusts.
  writeFileSync(manifestOf(task), JSON.stringify({ ...manifest, ...kept }, null, 2) + "\n");
  symlinkSync(join(repo, "node_modules"), join(dir, "node_modules"), "junction");
  writePolicy(task);
}

/**
 * Phase 3: a workspace holding both runs' implementations of a task as
 * a/<file> and b/<file>, in an order chosen at random and recorded only
 * outside, the reference adapter as <file>, and what the task's agent
 * read. The agent writes distinguish.test.ts and REPORT.md.
 */
function makeDistinguish(task: Task): void {
  const state = loadState();
  const dir = workspaceOf(task);
  if (task.outputs.length !== 1 || task.outputs[0].headerOnly) throw new Error(`task ${task.n} has no single implementation to distinguish`);
  const file = task.outputs[0].file;
  for (const key of [`${task.n}`, `${task.n}.2`]) if (!isDone(state, key)) throw new Error(`task ${key} must be collected and reviewed first`);
  if (!existsSync(join(repo, refOf(file)))) throw new Error(`write ${refOf(file)} first: the reference, with exactly the task's exports`);
  if (existsSync(dir)) throw new Error(`${dir} exists; delete it first, or collect it`);
  const reads = closure(repo, [...task.imports, ...task.tests, "rules.ts", refOf(file)], new Set([file])).filter((f) => f !== refOf(file));
  const runs = randomInt(2) === 0 ? [file, alternateOf(file)] : [alternateOf(file), file];
  const labels: Labels = { a: runs[0] === file ? "run 1" : "run 2", b: runs[1] === file ? "run 1" : "run 2" };
  const copy = (from: string, to: string) => {
    mkdirSync(dirname(join(dir, to)), { recursive: true });
    copyFileSync(join(repo, from), join(dir, to));
  };
  for (const f of reads) copy(f, f);
  copy(refOf(file), file);
  copy(runs[0], `a/${file}`);
  copy(runs[1], `b/${file}`);
  writeFileSync(join(dir, "TASK.md"), distinguishText(task, reads));
  writeFileSync(join(dir, "package.json"), JSON.stringify({
    private: true,
    type: "module",
    scripts: { typecheck: "tsc -p tsconfig.json", check: "node .task/task.ts check-here" },
  }, null, 2) + "\n");
  writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({ ...tsconfigFor([], ["node"]), files: undefined, include: ["*.ts"] }, null, 2) + "\n");
  mkdirSync(join(dir, ".task"), { recursive: true });
  const allowed = [...reads.filter((f) => !f.includes("/")), file];
  seal(task, { task: task.n, outputs: [{ file: distinguishFile, headerOnly: false }], allowed, binds: ["node"], tests: [], inputs: {}, bodies: {}, subject: file }, { labels });
  console.log(`made ${dir}\n  reads ${reads.length} files, the reference as ${file}, and a/${file}, b/${file}\n  writes ${distinguishFile}, REPORT.md`);
  console.log(`run the agent with: node task.ts run ${keyOf(task)}`);
}

const distinguishFile = "distinguish.test.ts";

function distinguishText(task: Task, reads: string[]): string {
  const file = task.outputs[0].file;
  return `# Phase 3, task ${task.n}: tell two implementations of \`${file}\` apart

This folder holds everything you need, and everything you may read. The
restrictions below are enforced, not only asked for.

\`a/${file}\` and \`b/${file}\` are two implementations of task ${task.n},
written independently from the same spec (below). Both pass every contract
test here. \`${file}\` at the top level is the reference, with exactly the
exports the spec names.

**Your job:** write tests in \`${distinguishFile}\` that tell A and B apart:
each test passes on one of them and fails on the other. Read both
implementations to find where they differ, then show each difference
through the interfaces alone. Find as many as you can, each a different
difference. Differences in things the spec leaves open count too, such as
error messages or an order the rules don't fix: include them, and say so
in the report. If you find none, say that.

- **Write:** \`${distinguishFile}\` and \`REPORT.md\`. Every other file is
  read-only and is checked unchanged afterward.
- **The implementation under test:** import it from \`./${file}\`.
  \`npm run check\` runs your tests three times: with \`./${file}\` as A,
  as B, and as the reference.
- **Only the interfaces:** your tests must compile against the reference
  \`./${file}\`, so they can use only what the spec exports and the
  interfaces declare. They may import the files here
  (${reads.filter((f) => !f.includes("/")).map((f) => `\`${f}\``).join(", ")}),
  Node built-ins (\`node:*\`) and \`fast-check\`; not \`a/\` or \`b/\`.
  Not allowed: ${forbidden.map(([, w]) => w.split(" (")[0]).join(", ")}, and triple-slash directives.
  Like every file here, it starts with a header comment with an
  \`Imports:\` field listing what it imports.
- **Valid uses only:** every call must meet the rules' \`@requires\` and
  the spec's other obligations on callers. A test that tells them apart
  by breaking a \`@requires\`, or by relying on something the spec puts
  outside the rules, shows nothing about the spec.
- **Each test** is a top-level \`test(...)\` from \`node:test\` (no
  \`describe\`), with a name unique in the file and no \`#\` in it. Tests must
  be repeatable: fixed cases, or fast-check with a fixed seed.
- **Commands:** \`npm run typecheck\` (against the reference) and \`npm run
  check\` (every check the collector runs, and which tests pass as A, B
  and the reference).

**REPORT.md** starts with the line \`Status: done\`, then a \`## Tests\`
section with one bullet per test, in file order. Each bullet starts with
the test's name in bold, \`- **<name>**\`, then says what A and B do
differently, and which spec text or rule ID, if any, you think decides it.
Then a \`## Notes\` section for anything else.

## The spec for task ${task.n}

${task.section}
`;
}

/** Every file under dir, as forward-slash paths, leaving out node_modules. */
function walk(dir: string, sub = ""): string[] {
  return readdirSync(join(dir, sub)).flatMap((name) => {
    const rel = sub ? `${sub}/${name}` : name;
    if (rel === "node_modules") return [];
    return statSync(join(dir, rel)).isDirectory() ? walk(dir, rel) : [rel];
  });
}

// ---- Agent policy ---------------------------------------------------------

const policyOf = (task: Task) => `${workspaceOf(task)}.policy.json`;
const gateOf = (task: Task) => `${workspaceOf(task)}.gate.mjs`;

function writePolicy(task: Task): void {
  const writable = [...(task.variant === "d" ? [distinguishFile] : task.outputs.map((o) => o.file)), "REPORT.md"];
  const commands = commandsOf(task);
  writeFileSync(gateOf(task), `// Lets a task's agent run only these commands.
const allowed = ${JSON.stringify(commands)};
let input = "";
process.stdin.on("data", (d) => (input += d));
process.stdin.on("end", () => {
  const command = (JSON.parse(input).tool_input?.command ?? "").trim();
  if (allowed.includes(command)) process.exit(0);
  process.stderr.write("Only these commands may run: " + allowed.join(", "));
  process.exit(2);
});
`);
  writeFileSync(policyOf(task), JSON.stringify({
    permissions: {
      allow: [...writable.flatMap((f) => [`Edit(./${f})`, `Write(./${f})`]), ...commands.map((c) => `Bash(${c})`)],
      deny: ["PowerShell", "WebFetch", "WebSearch", "NotebookEdit", "Agent", "mcp__*"],
      blockReadsOutsideWorkingDirectories: true,
    },
    hooks: {
      PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: `node "${gateOf(task)}"` }] }],
    },
  }, null, 2) + "\n");
}

/** Runs the task's agent, on model if given (a second run uses a different model from the first). */
function runAgent(task: Task, model?: string): void {
  const dir = workspaceOf(task);
  if (!existsSync(dir)) throw new Error(`no workspace for task ${keyOf(task)}; run node task.ts make ${keyOf(task)}`);
  const args = [
    "-p", "Read TASK.md and do the task it describes. Finish with REPORT.md.",
    "--restricted", "--tools", "Read,Glob,Grep,Edit,Write,Bash",
    "--settings", policyOf(task), "--permission-mode", "dontAsk",
    "--disallowedTools", "PowerShell", "WebFetch", "WebSearch", "mcp__*",
    "--output-format", "json",
    ...(model ? ["--model", model] : []),
  ];
  const r = spawnSync("claude", args, { cwd: dir, encoding: "utf8", env: { ...process.env, CLAUDE_CODE_USE_POWERSHELL_TOOL: "0" }, maxBuffer: 1 << 28 });
  writeFileSync(`${dir}.run.json`, r.stdout ?? "");
  if (r.status !== 0) throw new Error(`agent exited with ${r.status}: ${r.stderr}`);
  console.log(`agent finished; its result is in ${dir}.run.json. Next: node task.ts check ${keyOf(task)}`);
}

// ---- Checking -------------------------------------------------------------

function lintWorkspace(dir: string, m: Manifest): string[] {
  const problems: string[] = [];
  for (const o of m.outputs) {
    const path = join(dir, o.file);
    if (!existsSync(path)) { problems.push(`${o.file}: missing`); continue; }
    const src = read(path);
    if (o.headerOnly) {
      if (bodyHash(src) !== m.bodies[o.file]) problems.push(`${o.file}: changed outside its header`);
    } else {
      problems.push(...lintSource(o.file, src, { allowed: m.allowed, binds: m.binds, packages: m.subject ? ["fast-check"] : [] }));
    }
  }
  return problems;
}

/** The status line REPORT.md starts with, if it has one. */
function statusOf(dir: string): "done" | "stopped" | undefined {
  const path = join(dir, "REPORT.md");
  if (!existsSync(path)) return undefined;
  const first = read(path).split(/\r?\n/).find((l) => l.trim() !== "");
  return (/^Status: (done|stopped)\s*$/.exec(first ?? "")?.[1] as "done" | "stopped" | undefined);
}

/** Problems with REPORT.md's shape: a status line, and the sections its status needs. */
function reportProblems(dir: string, distinguishing: boolean): string[] {
  const path = join(dir, "REPORT.md");
  if (!existsSync(path)) return ["REPORT.md: missing"];
  const status = statusOf(dir);
  if (!status) return ["REPORT.md: must start with the line Status: done or Status: stopped"];
  const text = read(path);
  const has = (heading: string) => new RegExp(`^## ${heading}\\s*$`, "m").test(text);
  if (distinguishing) {
    if (status !== "done" || !has("Tests")) return ["REPORT.md: a phase 3 report starts with Status: done and has a ## Tests section"];
    const named = (bullets(text, "Tests") ?? []).map((b) => /^- \*\*(.+?)\*\*/.exec(b)?.[1]);
    const tests = testNames(read(join(dir, distinguishFile)));
    if (named.join("\n") !== tests.join("\n")) return [`REPORT.md: ## Tests must have one bullet per test, in file order, each starting with its name in bold; the tests are ${tests.map((t) => `"${t}"`).join(", ") || "none"}`];
    return [];
  }
  if (status === "stopped") return has("Questions") ? [] : ["REPORT.md: a stopped report needs a ## Questions section"];
  return [
    ...(has("Choices") ? [] : ["REPORT.md: a done report needs a ## Choices section"]),
    ...(has("Questions") ? ["REPORT.md: a done report has no ## Questions; stop instead"] : []),
  ];
}

function checkWorkspace(dir: string, m: Manifest, full: boolean): string[] {
  // A stopped attempt is checked only for what it may have changed: its
  // outputs aren't collected.
  const stopped = statusOf(dir) === "stopped";
  const problems = stopped ? [] : lintWorkspace(dir, m);
  const outputs = m.outputs.map((o) => o.file);
  for (const [f, hash] of Object.entries(m.inputs)) {
    if (!existsSync(join(dir, f))) problems.push(`${f}: deleted`);
    else if (sha(join(dir, f)) !== hash) problems.push(`${f}: changed, but it is read-only`);
  }
  const known = (f: string) => f in m.inputs || outputs.includes(f) || f === "REPORT.md" || f === ".task/manifest.json";
  for (const f of walk(dir)) if (!known(f)) problems.push(`${f}: not part of the task`);
  problems.push(...reportProblems(dir, m.subject !== undefined));
  if (!full || stopped || problems.length > 0) return problems;
  if (m.subject !== undefined) return distinguishProblems(runVariants(dir, m.subject));
  for (const cmd of ["npx --no-install tsc -p tsconfig.impl.json", "npx --no-install tsc -p tsconfig.json", ...(m.tests.length ? [`node --test ${m.tests.join(" ")}`] : [])]) {
    const r = run(cmd, dir);
    if (!r.ok) problems.push(`${cmd} failed:\n${r.output}`);
  }
  return problems;
}

/** The names of a test file's top-level test(...) calls, in order: phase 3 tests are top-level only. */
function testNames(src: string): string[] {
  return [...src.matchAll(/^test\(\s*(["'`])(.*?)\1/gm)].map((m) => m[2]);
}

type Variants = { results: TestResult[]; problems: string[] };

/**
 * Runs a phase 3 workspace's tests with the subject as the reference, as
 * A and as B, each in a scratch copy, and compiles them against each: the
 * reference compile is what holds the tests to the interfaces.
 */
function runVariants(dir: string, subject: string): Variants {
  const problems: string[] = [];
  const outcomes: Record<"ref" | "a" | "b", Map<string, boolean>> = { ref: new Map(), a: new Map(), b: new Map() };
  for (const v of ["ref", "a", "b"] as const) {
    const scratch = mkdtempSync(join(tmpdir(), `distinguish-${v}-`));
    try {
      for (const f of walk(dir)) {
        if (f.startsWith("a/") || f.startsWith("b/")) continue;
        mkdirSync(dirname(join(scratch, f)), { recursive: true });
        writeFileSync(join(scratch, f), readFileSync(join(dir, f)));
      }
      if (v !== "ref") writeFileSync(join(scratch, subject), readFileSync(join(dir, v, subject)));
      // The workspace's own link: inside a workspace, repo is .task, which has none.
      symlinkSync(join(dir, "node_modules"), join(scratch, "node_modules"), "junction");
      const label = v === "ref" ? "the reference" : v.toUpperCase();
      const compiled = run("npx --no-install tsc -p tsconfig.json", scratch);
      if (!compiled.ok) problems.push(`compiling against ${label}${v === "ref" ? " (the tests may use only the interfaces and the spec's exports)" : ""}:\n${compiled.output}`);
      const tap = run(`node --test --test-reporter=tap ${distinguishFile}`, scratch).output;
      for (const m of tap.matchAll(/^(not )?ok \d+ - (.*?)(?: # .*)?$/gm)) outcomes[v].set(m[2], !m[1]);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  }
  const names = testNames(read(join(dir, distinguishFile)));
  const results = names.map((name) => ({ name, a: outcomes.a.get(name) ?? false, b: outcomes.b.get(name) ?? false, ref: outcomes.ref.get(name) ?? false }));
  for (const name of names) if (!outcomes.a.has(name) || !outcomes.b.has(name)) problems.push(`test "${name}" didn't report a result as A and as B`);
  return { results, problems };
}

/** Each phase 3 test must pass on exactly one of A and B. Prints the results. */
function distinguishProblems({ results, problems }: Variants): string[] {
  const mark = (p: boolean) => (p ? "pass" : "FAIL");
  for (const r of results) console.log(`A ${mark(r.a)}  B ${mark(r.b)}  reference ${mark(r.ref)}  ${r.name}`);
  for (const r of results) if (r.a === r.b) problems.push(`test "${r.name}" ${r.a ? "passes" : "fails"} on both A and B, so it doesn't tell them apart`);
  return problems;
}

function report(problems: string[], ok: string): void {
  if (problems.length === 0) { console.log(ok); return; }
  console.error(problems.join("\n"));
  process.exit(1);
}

/** Where collect copies each workspace output in the repo. */
function collectedPath(task: Task, file: string): string {
  if (task.variant === 2) return alternateOf(file);
  if (task.variant === "d") return `distinguish/task-${task.n}.distinguish.ts`;
  return file;
}

function collect(task: Task): void {
  const dir = workspaceOf(task);
  const key = keyOf(task);
  const m: Manifest = JSON.parse(read(manifestOf(task)));
  const distinguishing = m.subject !== undefined;
  const problems = checkWorkspace(dir, m, !distinguishing);
  // The repo must still hold what the workspace was made from.
  const sources = distinguishing ? Object.keys(m.inputs).filter((f) => f !== m.subject && !/^(a|b|\.task)\/|^(TASK\.md|package\.json|tsconfig\.json)$/.test(f)) : readsOf(task);
  for (const f of sources) if (m.inputs[f] !== sha(join(repo, f))) problems.push(`${f}: changed in the repo since the workspace was made`);
  const variants = distinguishing && problems.length === 0 ? runVariants(dir, m.subject!) : undefined;
  if (variants) problems.push(...distinguishProblems(variants));
  report(problems, "");
  mkdirSync(join(repo, "reports"), { recursive: true });
  const runFile = `${dir}.run.json`;
  const usage: Usage | undefined = existsSync(runFile) ? (({ total_cost_usd, usage, modelUsage, num_turns, duration_ms }) => ({ total_cost_usd, usage, modelUsage, num_turns, duration_ms }))(JSON.parse(read(runFile) || "{}")) : undefined;
  const state = loadState();
  const entry = state[key] ?? {};
  const cleanUp = () => { for (const f of [dir, manifestOf(task), runFile, policyOf(task), gateOf(task)]) rmSync(f, { recursive: true, force: true }); };
  if (statusOf(dir) === "stopped") {
    // The questions go back to phase 1. The workspace goes, so that the
    // next attempt is made fresh from the settled spec.
    const stops = entry.stops ?? [];
    const reportFile = `reports/task-${key}-stop-${stops.length + 1}.md`;
    copyFileSync(join(dir, "REPORT.md"), join(repo, reportFile));
    state[key] = { ...entry, stops: [...stops, { stopped: new Date().toISOString(), report: reportFile, usage }] };
    writeFileSync(statePath, JSON.stringify(state, null, 2) + "\n");
    cleanUp();
    console.log(`task ${key} stopped with questions: ${reportFile}. Settle them in the spec, then make it again.`);
    return;
  }
  for (const o of m.outputs) {
    const to = collectedPath(task, o.file);
    mkdirSync(dirname(join(repo, to)), { recursive: true });
    copyFileSync(join(dir, o.file), join(repo, to));
  }
  const reportFile = `reports/task-${key}.md`;
  copyFileSync(join(dir, "REPORT.md"), join(repo, reportFile));
  state[key] = {
    ...entry,
    collected: new Date().toISOString(),
    outputs: Object.fromEntries(m.outputs.map((o) => [collectedPath(task, o.file), sha(join(repo, collectedPath(task, o.file)))])),
    report: reportFile,
    usage,
    ...(variants ? { labels: m.labels, results: variants.results } : {}),
  };
  writeFileSync(statePath, JSON.stringify(state, null, 2) + "\n");
  // A second run's workspace goes too: phase 3 works from the collected copy.
  if (task.variant !== 1) cleanUp();
  console.log(`collected task ${key}: ${m.outputs.map((o) => collectedPath(task, o.file)).join(", ")}, ${reportFile}${m.labels ? `; A was ${m.labels.a}, B ${m.labels.b}` : ""}`);
}

// ---- Phase 2b ---------------------------------------------------------------

const choiceDispositions = ["open", "adopt", "respecify", "reading"];
const noteOutcomes = ["spec fix", "decision", "nothing"];
/** Phase 3b: what each distinguishing test shows. */
const testFindings = ["freedom", "spec gap", "contract gap"];

/** The sections a review answers bullet by bullet, with the dispositions each allows. */
const reviewedSections = (task: Task): (readonly [string, string[]])[] =>
  task.variant === "d" ? [["Tests", testFindings], ["Notes", noteOutcomes]] : [["Choices", choiceDispositions], ["Notes", noteOutcomes]];

/** The top-level bullets of a section of a markdown file, each with its continuation lines. */
function bullets(text: string, heading: string): string[] | undefined {
  const m = new RegExp(`^## ${heading}\\s*$([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, "m").exec(text);
  if (!m) return undefined;
  return m[1].split(/^(?=- )/m).filter((b) => b.startsWith("- ")).map((b) => b.trim());
}

/**
 * The form of a phase 2b or 3b review: it starts with Status: reviewed,
 * and has one bullet per bullet of each of the report's reviewed sections,
 * in the same order, each starting with a disposition in bold.
 */
function reviewProblems(reportText: string, reviewText: string, sections: (readonly [string, string[]])[]): string[] {
  const problems: string[] = [];
  const first = reviewText.split(/\r?\n/).find((l) => l.trim() !== "");
  if (!/^Status: reviewed\s*$/.test(first ?? "")) problems.push("the review must start with the line Status: reviewed");
  for (const [heading, allowed] of sections) {
    const reported = bullets(reportText, heading) ?? [];
    const reviewed = bullets(reviewText, heading) ?? [];
    if (reviewed.length !== reported.length) {
      problems.push(`## ${heading}: the report has ${reported.length} bullets and the review ${reviewed.length}; review each, in order`);
      continue;
    }
    reviewed.forEach((b, i) => {
      const d = /^- \*\*([a-z ]+)\*\*/.exec(b)?.[1];
      if (!d || !allowed.includes(d)) problems.push(`## ${heading}, bullet ${i + 1}: start with one of ${allowed.map((a) => `**${a}**`).join(", ")}`);
      else if (gapFindings.includes(d) && requeuesOf(b) === undefined) problems.push(`## ${heading}, bullet ${i + 1}: a ${d} names what goes back for another attempt next, as **requeue: 9, 9.2** or **requeue: none**`);
    });
  }
  return problems;
}

/** Phase 3b findings that send implementations back for another attempt. */
const gapFindings = ["spec gap", "contract gap"];

/** The task keys a phase 3b bullet sends back: its second bold token, **requeue: 9, 9.2** (or none). */
function requeuesOf(bullet: string): string[] | undefined {
  const list = /^- \*\*[a-z ]+\*\* \*\*requeue: ([^*]+)\*\*/.exec(bullet)?.[1].trim();
  if (list === undefined) return undefined;
  return list === "none" ? [] : list.split(/,\s*/);
}

const reviewFileOf = (task: Task) => `reports/task-${keyOf(task)}.review.md`;

/**
 * Sends a task back for another attempt: its collected attempt's usage is
 * kept with the review that sent it back, its workspace goes, and its
 * collected outputs stay until an attempt replaces them.
 */
function requeue(state: State, task: Task, review: string): void {
  const key = keyOf(task);
  const entry = state[key] ?? {};
  state[key] = { ...entry, collected: undefined, reviewed: undefined, usage: undefined, requeues: [...(entry.requeues ?? []), { requeued: new Date().toISOString(), review, usage: entry.usage }] };
  for (const f of [workspaceOf(task), manifestOf(task), `${workspaceOf(task)}.run.json`, policyOf(task), gateOf(task)]) rmSync(f, { recursive: true, force: true });
  console.log(`task ${key} goes back for another attempt (${review}); its collected outputs stay until one replaces them`);
}

/**
 * Records a task's phase 2b review. A review with no respecify or reading
 * marks the task done; otherwise the task goes back for another attempt.
 * A phase 3b review is done once recorded, and sends back every task its
 * gap findings name.
 */
function review(task: Task): void {
  const state = loadState();
  const key = keyOf(task);
  const entry = state[key];
  if (!entry?.collected || !entry.report) throw new Error(`task ${key} has no collected attempt to review`);
  const reviewFile = reviewFileOf(task);
  if (!existsSync(join(repo, reviewFile))) throw new Error(`write ${reviewFile} first`);
  const reviewText = read(join(repo, reviewFile));
  report(reviewProblems(read(join(repo, entry.report)), reviewText, reviewedSections(task)), "");
  if (task.variant === "d") {
    const keys = new Set((bullets(reviewText, "Tests") ?? []).flatMap((b) => requeuesOf(b) ?? []));
    const tasks = [...keys].map(findTask);
    state[key] = { ...entry, reviewed: new Date().toISOString(), review: reviewFile };
    for (const t of tasks) requeue(state, t, reviewFile);
    console.log(`task ${key} reviewed: done`);
  } else if ((bullets(reviewText, "Choices") ?? []).some((b) => /^- \*\*(respecify|reading)\*\*/.test(b))) {
    const kept = `reports/task-${key}.review-${(entry.requeues ?? []).length + 1}.md`;
    copyFileSync(join(repo, reviewFile), join(repo, kept));
    rmSync(join(repo, reviewFile));
    requeue(state, task, kept);
  } else {
    state[key] = { ...entry, reviewed: new Date().toISOString(), review: reviewFile };
    console.log(`task ${key} reviewed: done`);
  }
  writeFileSync(statePath, JSON.stringify(state, null, 2) + "\n");
}

/** The output checks, applied in the repo to every collected task's outputs. */
function lintRepo(): string[] {
  const state = loadState();
  const tasks = parseTasks().filter((t) => state[t.n]?.collected);
  // A file written by several tasks is linted under the latest.
  const owner = new Map<string, Task>();
  for (const t of tasks) for (const o of t.outputs) if (!o.headerOnly) owner.set(o.file, t);
  const problems: string[] = [];
  const groups = new Map<string, string[]>();
  for (const [file, t] of owner) {
    if (!existsSync(join(repo, file))) { problems.push(`${file}: missing`); continue; }
    problems.push(...lintSource(file, read(join(repo, file)), { allowed: t.imports, binds: t.binds }));
    const key = [...t.binds].sort().join(",");
    groups.set(key, [...(groups.get(key) ?? []), join(repo, file)]);
  }
  for (const [key, files] of groups) {
    const config = join(tmpdir(), `modular-lint-${process.pid}-${key || "none"}.json`);
    writeFileSync(config, JSON.stringify(tsconfigFor(files, key ? key.split(",") : [], [join(repo, "node_modules", "@types")]), null, 2));
    const r = run(`npx --no-install tsc -p "${config}"`, repo);
    rmSync(config);
    if (!r.ok) problems.push(`compiling ${files.map((f) => relative(repo, f)).join(", ")} with ${key || "no platform"} types:\n${r.output}`);
  }
  return problems;
}

// ---- Costs ------------------------------------------------------------------

/** Each task's round: the number in the nearest `# ... round N` heading above it in impl-specs.md. */
function roundsOf(specs = read(join(repo, "impl-specs.md"))): Map<number, number> {
  const rounds = new Map<number, number>();
  let round = 0;
  for (const line of specs.split(/\r?\n/)) {
    const r = /^# .*\bround (\d+)/i.exec(line);
    if (r) round = Number(r[1]);
    const t = /^## (\d+)\./.exec(line);
    if (t) rounds.set(Number(t[1]), round);
  }
  return rounds;
}

/** Hand-kept records of agents task.ts doesn't run: phase 1b challenges, design sessions. */
type DesignCost = { date: string; round: number; phase: string; what: string; tokens?: number; usd?: number };
const designCostsPath = join(repo, "design-costs.json");

/**
 * Prints every phase 2 attempt's cost, tokens, turns and time, with totals
 * by round, and the hand-kept design-side records. Costs are what Claude
 * Code reports, at API list prices, not what a subscription charges.
 */
function costs(): void {
  const state = loadState();
  const rounds = roundsOf();
  const k = (n = 0) => `${Math.round(n / 1000)}k`;
  const totals = new Map<number, { usd: number; attempts: number }>();
  console.log("phases 2 and 3 (API list prices; 8.2 is task 8's second run, 8.d its distinguishing)");
  console.log("task  attempt         usd  turns   min  cache write  cache read  output  models");
  for (const [n, e] of Object.entries(state).sort(([a], [b]) => parseInt(a) - parseInt(b) || a.localeCompare(b))) {
    const attempts: [string, Usage | undefined][] = [
      ...(e.stops ?? []).map((s, i): [string, Usage | undefined] => [`stopped ${i + 1}`, s.usage]),
      ...(e.requeues ?? []).map((q, i): [string, Usage | undefined] => [`requeued ${i + 1}`, q.usage]),
      ...(e.collected ? [[e.reviewed ? "accepted" : "collected", e.usage] as [string, Usage | undefined]] : []),
    ];
    for (const [label, u] of attempts) {
      if (!u) continue;
      const t = u.usage ?? {};
      const models = Object.keys(u.modelUsage ?? {}).join(", ");
      console.log(`${n.padStart(4)}  ${label.padEnd(11)} ${(u.total_cost_usd ?? 0).toFixed(2).padStart(7)}  ${String(u.num_turns ?? "").padStart(5)}  ${((u.duration_ms ?? 0) / 60000).toFixed(1).padStart(4)}  ${k(t.cache_creation_input_tokens).padStart(11)}  ${k(t.cache_read_input_tokens).padStart(10)}  ${k(t.output_tokens).padStart(6)}  ${models}`);
      const round = rounds.get(parseInt(n)) ?? 0;
      const total = totals.get(round) ?? { usd: 0, attempts: 0 };
      totals.set(round, { usd: total.usd + (u.total_cost_usd ?? 0), attempts: total.attempts + 1 });
    }
  }
  for (const [round, t] of [...totals].sort(([a], [b]) => a - b)) console.log(`round ${round}: $${t.usd.toFixed(2)} over ${t.attempts} attempts`);
  const design: DesignCost[] = existsSync(designCostsPath) ? JSON.parse(read(designCostsPath)) : [];
  if (design.length === 0) return;
  console.log("\ndesign side (design-costs.json, kept by hand)");
  for (const d of design) console.log(`${d.date}  round ${d.round}  ${d.phase.padEnd(8)} ${d.tokens !== undefined ? k(d.tokens).padStart(6) + " tokens" : ""}${d.usd !== undefined ? `  $${d.usd.toFixed(2)}` : ""}  ${d.what}`);
}

// ---- Command line ---------------------------------------------------------

function list(): void {
  const tasks = parseTasks();
  const state = loadState();
  for (const t of tasks) if (isDone(state, t.n)) console.log(`done     ${t.n}. ${t.outputs.map((o) => o.file).join(", ")}`);
  const { waves: ws, waiting } = waves(tasks, state);
  for (const t of tasks) if (awaitsReview(state, t.n)) console.log(`review   ${t.n}. ${t.outputs.map((o) => o.file).join(", ")}  (collected; needs reports/task-${t.n}.review.md, then node task.ts review ${t.n})`);
  for (const t of tasks) if (t.held !== undefined && !isDone(state, t.n)) console.log(`held     ${t.n}. ${t.outputs.map((o) => o.file).join(", ")}  (${t.held})`);
  ws.forEach((wave, i) => {
    for (const t of wave) {
      const leak = leaks(t);
      console.log(`wave ${i + 1}   ${t.n}. ${t.outputs.map((o) => o.file + (o.headerOnly ? " (header)" : "")).join(", ")}  reads ${readsOf(t).length} files${leak.length ? `  READS HIDDEN ${leak.join(", ")}` : ""}${state[t.n]?.stops?.length ? `  stopped ${state[t.n].stops!.length}x` : ""}`);
    }
  });
  for (const t of waiting) console.log(`waits    ${t.n}. ${t.outputs.map((o) => o.file).join(", ")}  (reads the outputs of a task that is held or waits for review)`);
  // Phase 3: second runs and distinguishing, which no other task waits for.
  for (const [key, e] of Object.entries(state)) {
    if (!/\.(2|d)$/.test(key)) continue;
    const status = isDone(state, key) ? "done    " : e.collected ? "review  " : e.stops?.length ? `stopped ${e.stops.length}x` : "        ";
    console.log(`${status} ${key}${e.collected && !e.reviewed ? `  (collected; needs reports/task-${key}.review.md, then node task.ts review ${key})` : ""}`);
  }
}

function main(args: string[]): void {
  const [command, arg] = args;
  const here = process.cwd();
  switch (command) {
    case "list": return list();
    case "costs": return costs();
    case "make": return make(findTask(arg));
    case "run": {
      const model = args.indexOf("--model") >= 0 ? args[args.indexOf("--model") + 1] : undefined;
      return runAgent(findTask(arg), model);
    }
    case "check": {
      const task = findTask(arg);
      return report(checkWorkspace(workspaceOf(task), JSON.parse(read(manifestOf(task))), true), `task ${keyOf(task)}: every check passes`);
    }
    case "collect": return collect(findTask(arg));
    case "review": return review(findTask(arg));
    case "review-check": {
      // The form check alone, for a draft review: records nothing.
      const task = findTask(arg);
      const entry = loadState()[keyOf(task)];
      if (!entry?.report) throw new Error(`task ${keyOf(task)} has no collected report`);
      return report(reviewProblems(read(join(repo, entry.report)), read(join(repo, reviewFileOf(task))), reviewedSections(task)), `task ${keyOf(task)}: the review's form is right`);
    }
    case "lint": return report(lintRepo(), "every collected output passes");
    // Inside a workspace, against its own manifest.
    case "lint-here": return report(lintWorkspace(here, JSON.parse(read(join(here, ".task/manifest.json")))), "outputs pass the lint");
    case "check-here": return report(checkWorkspace(here, JSON.parse(read(join(here, ".task/manifest.json"))), true), "every check passes");
    default:
      console.error("usage: node task.ts list | make <n> | run <n> [--model <m>] | check <n> | collect <n> | review-check <n> | review <n> | lint | costs\n  <n> is a task (8), its second run (8.2) or its phase 3 distinguishing (8.d)");
      process.exit(2);
  }
}

if (import.meta.main) main(process.argv.slice(2));
