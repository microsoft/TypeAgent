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
 * task in the repo.
 * Run: node task.ts list | make <n> | run <n> | check <n> | collect <n> | lint
 * Imports: node:fs, node:path, node:crypto, node:child_process, node:os
 */

import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, posix, relative, resolve } from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";

/** The blueprint's interface files, and platform subsets: imported with import type only. */
export const interfaceFiles = ["events.ts", "geometry.ts", "color.ts", "shape.ts", "dataModel.ts", "shapeModel.ts", "frames.ts", "view.ts", "shapeView.ts", "layout.ts", "canvas.ts", "dom.ts"];

/** Commands a task's agent may run. */
const commands = ["npm test", "npm run typecheck", "npm run check"];

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
}

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
    tasks.push({ n: Number(head[1]), title: head[2], section: part.trimEnd(), outputs, imports: tsFiles(imports), binds, tests, hidden, held });
  }
  return tasks;
}

function findTask(arg: string | undefined): Task {
  const task = parseTasks().find((t) => String(t.n) === arg || t.outputs[0]?.file === arg);
  if (!task) throw new Error(`no task ${arg}; run node task.ts list`);
  return task;
}

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

/** One attempt that stopped with questions. */
type Stop = { stopped: string; report: string; usage?: unknown };
/** One phase 2b review that sent the task back for another attempt. */
type Requeue = { requeued: string; review: string };
type State = Record<string, {
  collected?: string; outputs?: Record<string, string>; report?: string; usage?: unknown; stops?: Stop[];
  /** When phase 2b accepted the collected outputs, and its record. */
  reviewed?: string; review?: string; requeues?: Requeue[];
}>;
/** Collected and accepted by phase 2b: only then do tasks that read its outputs run. */
const isDone = (state: State, n: number) => Boolean(state[n]?.collected && state[n]?.reviewed);
/** Collected, and waiting for phase 2b. */
const awaitsReview = (state: State, n: number) => Boolean(state[n]?.collected && !state[n]?.reviewed);
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

interface LintRules { allowed: string[]; binds: string[] }

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
    const target = /^\.\/([\w.]+\.ts)$/.exec(spec)?.[1];
    if (!target) { say(`imports ${spec}; only ./<file>.ts imports are allowed`); continue; }
    used.push(target);
    if (!rules.allowed.includes(target)) say(`imports ${target}, which its task doesn't list`);
    const allTypes = /^\{[^}]*\}$/.test(names.trim()) && names.trim().slice(1, -1).split(",").every((n) => /^\s*type\s/.test(n) || n.trim() === "");
    if (interfaceFiles.includes(target) && !typeOnly && !allTypes) say(`imports ${target} without import type`);
  }

  const [header] = splitHeader(src);
  const declared = /^\s*\*\s*Imports:(.*)$/m.exec(header)?.[1];
  if (declared === undefined) say("has no Imports field in its header");
  else {
    const listed = new Set([...declared.matchAll(/(node:[\w/]+|[\w.]+\.ts)/g)].map((m) => m[1]));
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
}

const workspaceOf = (task: Task) => join(tasksDir, `task-${task.n}-${task.outputs[0].file.replace(/\.ts$/, "")}`);
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
- **Commands:** ${commands.map((c) => `\`${c}\``).join(", ")}. No others will run.
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
  const dir = workspaceOf(task);
  if (task.held !== undefined) throw new Error(`task ${task.n} is held: ${task.held}`);
  if (awaitsReview(loadState(), task.n)) throw new Error(`task ${task.n} is collected and waits for its phase 2b review: node task.ts review ${task.n}`);
  if (existsSync(dir)) throw new Error(`${dir} exists; delete it first, or collect it`);
  if (leaks(task).length > 0) throw new Error(`task ${task.n} would read hidden files: ${leaks(task).join(", ")}`);
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
  for (const o of task.outputs) if (existsSync(join(repo, o.file))) copyFileSync(join(repo, o.file), join(dir, o.file));
  const outputs = task.outputs.map((o) => o.file);
  const testFiles = task.tests.join(" ");
  write("TASK.md", taskText(task, reads));
  write("package.json", JSON.stringify({
    private: true,
    type: "module",
    scripts: {
      test: `node .task/task.ts lint-here${testFiles ? ` && node --test ${testFiles}` : ""}`,
      typecheck: "tsc -p tsconfig.impl.json && tsc -p tsconfig.json",
      check: "node .task/task.ts check-here",
    },
  }, null, 2) + "\n");
  write("tsconfig.impl.json", JSON.stringify(tsconfigFor(outputs, task.binds), null, 2) + "\n");
  write("tsconfig.json", JSON.stringify({ ...tsconfigFor([], ["node"]), files: undefined, include: ["*.ts"] }, null, 2) + "\n");
  write(".task/task.ts", read(join(repo, "task.ts")));
  const inputs: Record<string, string> = {};
  const bodies: Record<string, string> = {};
  for (const o of task.outputs) if (o.headerOnly) bodies[o.file] = bodyHash(read(join(repo, o.file)));
  const manifest: Manifest = { task: task.n, outputs: task.outputs, allowed: task.imports, binds: task.binds, tests: task.tests, inputs, bodies };
  for (const f of walk(dir)) if (!outputs.includes(f)) inputs[f] = sha(join(dir, f));
  // The copy inside can't hold its own hash; the kept copy below does.
  write(".task/manifest.json", JSON.stringify(manifest, null, 2) + "\n");
  inputs[".task/manifest.json"] = sha(join(dir, ".task/manifest.json"));
  for (const f of Object.keys(inputs)) chmodSync(join(dir, f), 0o444);
  // The kept copy, outside the workspace, is the one collect trusts.
  writeFileSync(manifestOf(task), JSON.stringify(manifest, null, 2) + "\n");
  symlinkSync(join(repo, "node_modules"), join(dir, "node_modules"), "junction");
  writePolicy(task);
  console.log(`made ${dir}\n  reads ${reads.length} files: ${reads.join(", ")}\n  writes ${outputs.join(", ")}, REPORT.md`);
  console.log(`run the agent with: node task.ts run ${task.n}`);
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
const gatePath = () => join(tasksDir, "bash-gate.mjs");

function writePolicy(task: Task): void {
  const writable = [...task.outputs.map((o) => o.file), "REPORT.md"];
  writeFileSync(gatePath(), `// Lets a task's agent run only these commands.
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
      PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: `node "${gatePath()}"` }] }],
    },
  }, null, 2) + "\n");
}

function runAgent(task: Task): void {
  const dir = workspaceOf(task);
  if (!existsSync(dir)) throw new Error(`no workspace for task ${task.n}; run node task.ts make ${task.n}`);
  const args = [
    "-p", "Read TASK.md and do the task it describes. Finish with REPORT.md.",
    "--restricted", "--tools", "Read,Glob,Grep,Edit,Write,Bash",
    "--settings", policyOf(task), "--permission-mode", "dontAsk",
    "--disallowedTools", "PowerShell", "WebFetch", "WebSearch", "mcp__*",
    "--output-format", "json",
  ];
  const r = spawnSync("claude", args, { cwd: dir, encoding: "utf8", env: { ...process.env, CLAUDE_CODE_USE_POWERSHELL_TOOL: "0" }, maxBuffer: 1 << 28 });
  writeFileSync(`${dir}.run.json`, r.stdout ?? "");
  if (r.status !== 0) throw new Error(`agent exited with ${r.status}: ${r.stderr}`);
  console.log(`agent finished; its result is in ${dir}.run.json. Next: node task.ts check ${task.n}`);
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
      problems.push(...lintSource(o.file, src, { allowed: m.allowed, binds: m.binds }));
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
function reportProblems(dir: string): string[] {
  const path = join(dir, "REPORT.md");
  if (!existsSync(path)) return ["REPORT.md: missing"];
  const status = statusOf(dir);
  if (!status) return ["REPORT.md: must start with the line Status: done or Status: stopped"];
  const text = read(path);
  const has = (heading: string) => new RegExp(`^## ${heading}\\s*$`, "m").test(text);
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
  problems.push(...reportProblems(dir));
  if (!full || stopped || problems.length > 0) return problems;
  for (const cmd of ["npx --no-install tsc -p tsconfig.impl.json", "npx --no-install tsc -p tsconfig.json", ...(m.tests.length ? [`node --test ${m.tests.join(" ")}`] : [])]) {
    const r = run(cmd, dir);
    if (!r.ok) problems.push(`${cmd} failed:\n${r.output}`);
  }
  return problems;
}

function report(problems: string[], ok: string): void {
  if (problems.length === 0) { console.log(ok); return; }
  console.error(problems.join("\n"));
  process.exit(1);
}

function collect(task: Task): void {
  const dir = workspaceOf(task);
  const m: Manifest = JSON.parse(read(manifestOf(task)));
  const problems = checkWorkspace(dir, m, true);
  // The repo must still hold what the workspace was made from.
  for (const f of readsOf(task)) if (m.inputs[f] !== sha(join(repo, f))) problems.push(`${f}: changed in the repo since the workspace was made`);
  report(problems, "");
  mkdirSync(join(repo, "reports"), { recursive: true });
  const runFile = `${dir}.run.json`;
  const usage = existsSync(runFile) ? (({ total_cost_usd, usage, modelUsage, num_turns, duration_ms }) => ({ total_cost_usd, usage, modelUsage, num_turns, duration_ms }))(JSON.parse(read(runFile) || "{}")) : undefined;
  const state = loadState();
  const entry = state[task.n] ?? {};
  if (statusOf(dir) === "stopped") {
    // The questions go back to phase 1. The workspace goes, so that the
    // next attempt is made fresh from the settled spec.
    const stops = entry.stops ?? [];
    const reportFile = `reports/task-${task.n}-stop-${stops.length + 1}.md`;
    copyFileSync(join(dir, "REPORT.md"), join(repo, reportFile));
    state[task.n] = { ...entry, stops: [...stops, { stopped: new Date().toISOString(), report: reportFile, usage }] };
    writeFileSync(statePath, JSON.stringify(state, null, 2) + "\n");
    for (const f of [dir, manifestOf(task), runFile, policyOf(task)]) rmSync(f, { recursive: true, force: true });
    console.log(`task ${task.n} stopped with questions: ${reportFile}. Settle them in the spec, then make it again.`);
    return;
  }
  for (const o of m.outputs) copyFileSync(join(dir, o.file), join(repo, o.file));
  const reportFile = `reports/task-${task.n}.md`;
  copyFileSync(join(dir, "REPORT.md"), join(repo, reportFile));
  state[task.n] = {
    ...entry,
    collected: new Date().toISOString(),
    outputs: Object.fromEntries(m.outputs.map((o) => [o.file, sha(join(repo, o.file))])),
    report: reportFile,
    usage,
  };
  writeFileSync(statePath, JSON.stringify(state, null, 2) + "\n");
  console.log(`collected task ${task.n}: ${m.outputs.map((o) => o.file).join(", ")}, ${reportFile}`);
}

// ---- Phase 2b ---------------------------------------------------------------

const choiceDispositions = ["open", "adopt", "respecify", "reading"];
const noteOutcomes = ["spec fix", "decision", "nothing"];

/** The top-level bullets of a section of a markdown file, each with its continuation lines. */
function bullets(text: string, heading: string): string[] | undefined {
  const m = new RegExp(`^## ${heading}\\s*$([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, "m").exec(text);
  if (!m) return undefined;
  return m[1].split(/^(?=- )/m).filter((b) => b.startsWith("- ")).map((b) => b.trim());
}

/**
 * The form of a phase 2b review: it starts with Status: reviewed, and has
 * one bullet per bullet of the report's Choices and Notes, in the same
 * order, each starting with a disposition in bold.
 */
function reviewProblems(reportText: string, reviewText: string): string[] {
  const problems: string[] = [];
  const first = reviewText.split(/\r?\n/).find((l) => l.trim() !== "");
  if (!/^Status: reviewed\s*$/.test(first ?? "")) problems.push("the review must start with the line Status: reviewed");
  for (const [heading, allowed] of [["Choices", choiceDispositions], ["Notes", noteOutcomes]] as const) {
    const reported = bullets(reportText, heading) ?? [];
    const reviewed = bullets(reviewText, heading) ?? [];
    if (reviewed.length !== reported.length) {
      problems.push(`## ${heading}: the report has ${reported.length} bullets and the review ${reviewed.length}; review each, in order`);
      continue;
    }
    reviewed.forEach((b, i) => {
      const d = /^- \*\*([a-z ]+)\*\*/.exec(b)?.[1];
      if (!d || !allowed.includes(d)) problems.push(`## ${heading}, bullet ${i + 1}: start with one of ${allowed.map((a) => `**${a}**`).join(", ")}`);
    });
  }
  return problems;
}

/**
 * Records a task's phase 2b review. A review with no respecify or reading
 * marks the task done; otherwise the task goes back for another attempt,
 * and its collected outputs stay until one replaces them.
 */
function review(task: Task): void {
  const state = loadState();
  const entry = state[task.n];
  if (!entry?.collected || !entry.report) throw new Error(`task ${task.n} has no collected attempt to review`);
  const reviewFile = `reports/task-${task.n}.review.md`;
  if (!existsSync(join(repo, reviewFile))) throw new Error(`write ${reviewFile} first`);
  const reviewText = read(join(repo, reviewFile));
  report(reviewProblems(read(join(repo, entry.report)), reviewText), "");
  const again = (bullets(reviewText, "Choices") ?? []).some((b) => /^- \*\*(respecify|reading)\*\*/.test(b));
  if (again) {
    const requeues = entry.requeues ?? [];
    const kept = `reports/task-${task.n}.review-${requeues.length + 1}.md`;
    copyFileSync(join(repo, reviewFile), join(repo, kept));
    rmSync(join(repo, reviewFile));
    state[task.n] = { ...entry, collected: undefined, reviewed: undefined, requeues: [...requeues, { requeued: new Date().toISOString(), review: kept }] };
    for (const f of [workspaceOf(task), manifestOf(task), `${workspaceOf(task)}.run.json`, policyOf(task)]) rmSync(f, { recursive: true, force: true });
    console.log(`task ${task.n} goes back for another attempt (${kept}); its collected outputs stay until one replaces them`);
  } else {
    state[task.n] = { ...entry, reviewed: new Date().toISOString(), review: reviewFile };
    console.log(`task ${task.n} reviewed: done`);
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
}

function main(args: string[]): void {
  const [command, arg] = args;
  const here = process.cwd();
  switch (command) {
    case "list": return list();
    case "make": return make(findTask(arg));
    case "run": return runAgent(findTask(arg));
    case "check": {
      const task = findTask(arg);
      return report(checkWorkspace(workspaceOf(task), JSON.parse(read(manifestOf(task))), true), `task ${task.n}: every check passes`);
    }
    case "collect": return collect(findTask(arg));
    case "review": return review(findTask(arg));
    case "review-check": {
      // The form check alone, for a draft review: records nothing.
      const task = findTask(arg);
      const entry = loadState()[task.n];
      if (!entry?.report) throw new Error(`task ${task.n} has no collected report`);
      return report(reviewProblems(read(join(repo, entry.report)), read(join(repo, `reports/task-${task.n}.review.md`))), `task ${task.n}: the review's form is right`);
    }
    case "lint": return report(lintRepo(), "every collected output passes");
    // Inside a workspace, against its own manifest.
    case "lint-here": return report(lintWorkspace(here, JSON.parse(read(join(here, ".task/manifest.json")))), "outputs pass the lint");
    case "check-here": return report(checkWorkspace(here, JSON.parse(read(join(here, ".task/manifest.json"))), true), "every check passes");
    default:
      console.error("usage: node task.ts list | make <n> | run <n> | check <n> | collect <n> | review-check <n> | review <n> | lint");
      process.exit(2);
  }
}

if (import.meta.main) main(process.argv.slice(2));
