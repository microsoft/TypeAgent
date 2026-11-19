/**
 * TypeArc's command line.
 *
 *   node tool/cli/typearc.ts init <dir>    make a project in dir
 *   node tool/cli/typearc.ts check [dir]   run the fast checks (dir defaults to .)
 *
 * A project is a directory with typearc.json:
 *   {
 *     "interfaces": ["list.ts"],
 *     "ruleLanguage": "../rules.ts",
 *     "scenarios": "scenarios.ts",
 *     "references": { "List": { "file": "listkit.ts", "make": "makeList" } }
 *   }
 * interfaces are its interface files; each may have a vocabulary file
 * beside it (list.vocab.ts). ruleLanguage is the path of the rule
 * language (rules.ts), which the vocabularies re-export. scenarios, if
 * given, is the design's scenarios file, and references say how the
 * scenario judge makes an instance of each interface (references are test
 * infrastructure, not design). Paths are relative to the project and
 * written with "/".
 *
 * check runs the checks that need no implementation, and exits nonzero if
 * any fails:
 * - rule format: known tags, @deferred plans, @abstract refinements, and an
 *   expression for every rule the checker evaluates;
 * - boundary: design files import only design files and use no words of
 *   the test harness;
 * - vocabulary purity: no module state and no sources of nondeterminism
 *   in vocabulary files (a syntactic check, so it can miss some impurity);
 * - rules compile: rules.gen.ts is written from the rule expressions, and
 *   tsc checks it, the scenarios and the references against the interfaces
 *   and vocabularies;
 * - scenario subset: the scenarios file is written in the subset
 *   (scenarios.ts here);
 * - scenarios: each is judged on the references (scenarios.ts here);
 * - proofs: each .lean file under proof/ is checked, if Lean is installed,
 *   and a forbidden scenario counts as proved by a theorem with its name.
 * Imports: design.ts, ruleGen.ts, ruleCheck.ts, scenarios.ts,
 * node:child_process, node:fs, node:os, node:path, node:url
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, posix, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { boundaryProblems, parseDesign, planProblems, refinementProblems, tagProblems } from "./design.ts";
import type { RuleSet } from "./ruleCheck.ts";
import { generateRules } from "./ruleGen.ts";
import { judgeScenarios, parseScenarios, type References } from "./scenarios.ts";

const toolRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const projectFile = "typearc.json";
const generated = "rules.gen.ts";

interface Project {
  readonly dir: string;
  readonly interfaces: readonly string[];
  readonly ruleLanguage: string;
  readonly scenarios?: string;
  readonly references: References;
}

/** The interface files' vocabulary files that exist. */
const vocabFiles = (p: Project) => p.interfaces.map((f) => f.replace(/\.ts$/, ".vocab.ts")).filter((f) => existsSync(join(p.dir, f)));

const designFiles = (p: Project) => [...p.interfaces, ...vocabFiles(p), p.ruleLanguage, ...(p.scenarios ? [p.scenarios] : [])];

const referenceFiles = (p: Project) => [...new Set(Object.values(p.references).map((r) => r.file))];

function loadProject(dir: string): Project {
  const path = join(dir, projectFile);
  if (!existsSync(path)) throw new Error(`${dir} has no ${projectFile}; make one with: typearc init ${dir}`);
  const raw = JSON.parse(readFileSync(path, "utf8")) as { interfaces?: unknown; ruleLanguage?: unknown; scenarios?: unknown; references?: unknown };
  const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");
  if (!strings(raw.interfaces) || typeof raw.ruleLanguage !== "string") {
    throw new Error(`${path} needs "interfaces" (a list of files) and "ruleLanguage" (a path)`);
  }
  if (raw.scenarios !== undefined && typeof raw.scenarios !== "string") throw new Error(`${path}: "scenarios" is a path`);
  const references = (raw.references ?? {}) as Record<string, { file?: unknown; make?: unknown }>;
  for (const [iface, r] of Object.entries(references)) {
    if (typeof r?.file !== "string" || typeof r.make !== "string") throw new Error(`${path}: the reference for ${iface} needs "file" and "make"`);
  }
  const project: Project = { dir, interfaces: raw.interfaces, ruleLanguage: raw.ruleLanguage, scenarios: raw.scenarios, references: references as References };
  for (const f of [...raw.interfaces, raw.ruleLanguage, ...(project.scenarios ? [project.scenarios] : []), ...referenceFiles(project)]) {
    if (!existsSync(join(dir, f))) throw new Error(`${path} names ${f}, which doesn't exist`);
  }
  return project;
}

/** A check's name and its problems; skipped says why it didn't run. */
interface Outcome {
  readonly name: string;
  readonly problems: readonly string[];
  readonly skipped?: string;
  readonly note?: string;
}

/** The tags whose expressions the rule checker evaluates; each needs an expression. */
const evaluated = new Set(["requires", "ensures", "invariant", "initially"]);

function ruleFormat(p: Project): Outcome {
  const all = parseDesign(p.dir, p.interfaces);
  const rules = all.flatMap((i) => i.rules);
  const ids = new Set<string>();
  const problems = [
    ...tagProblems(p.dir, p.interfaces),
    ...planProblems(all),
    ...refinementProblems(all),
    ...rules.flatMap((r) => {
      const out: string[] = [];
      if (ids.has(r.id)) out.push(`${r.id} is defined twice`);
      ids.add(r.id);
      if (evaluated.has(r.tag) && !r.expression) out.push(`${r.id} has no expression, so it can't be checked`);
      return out;
    }),
  ];
  const interfaces = all.filter((i) => !i.module).length;
  return { name: "rule format", problems, note: `${interfaces} interfaces, ${rules.length} rules` };
}

/** Words in a vocabulary file that make a function's result depend on more than its arguments. */
const impure = /\b(Math\.random|Date|performance|process|globalThis|console|crypto|setTimeout|setInterval|fetch)\b/;

function vocabularyPurity(p: Project): Outcome {
  const problems = vocabFiles(p).flatMap((file) => readFileSync(join(p.dir, file), "utf8").split(/\r?\n/).flatMap((line, n) => {
    const where = `${file}:${n + 1}`;
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) return [];
    if (/^(export\s+)?(let|var)\s/.test(line)) return [`${where} declares module state; vocabulary functions are pure`];
    const word = impure.exec(line)?.[0];
    return word ? [`${where} uses ${word}; vocabulary functions are pure`] : [];
  }));
  return { name: "vocabulary purity", problems };
}

/** Runs tsc from the tool's own installation on files, relative to dir. */
function tsc(dir: string, files: readonly string[]): string[] {
  const bin = join(toolRoot, "node_modules", "typescript", "bin", "tsc");
  const run = spawnSync(process.execPath, [
    bin, "--ignoreConfig", "--noEmit", "--strict", "--target", "es2022", "--module", "nodenext",
    "--allowImportingTsExtensions", "--erasableSyntaxOnly", ...files,
  ], { cwd: dir, encoding: "utf8" });
  if (run.status === 0) return [];
  return `${run.stdout}${run.stderr}`.split(/\r?\n/).filter((l) => l.trim() !== "");
}

async function rulesCompile(p: Project): Promise<Outcome> {
  let text: string;
  try {
    text = await generateRules({
      dir: p.dir,
      interfaces: p.interfaces,
      compiled: p.interfaces,
      typeFiles: [...p.interfaces, p.ruleLanguage],
      regenerate: "typearc check",
    });
  } catch (e) {
    return { name: "rules compile", problems: [e instanceof Error ? e.message : String(e)] };
  }
  const out = join(p.dir, generated);
  const changed = !existsSync(out) || readFileSync(out, "utf8") !== text;
  if (changed) writeFileSync(out, text);
  // An error inside the generated file is reported with the rule it came
  // from: ruleGen.ts writes "// <rule ID>: <headline>" above each rule's code.
  const lines = text.split("\n");
  const ruleAt = (line: number) => {
    for (let i = line - 1; i >= 0; i--) {
      const id = /^\/\/ (\S+): /.exec(lines[i])?.[1];
      if (id) return id;
    }
    return undefined;
  };
  const problems = tsc(p.dir, [...p.interfaces, ...vocabFiles(p), generated, ...(p.scenarios ? [p.scenarios] : []), ...referenceFiles(p)]).map((e) => {
    const line = new RegExp(`^${generated.replace(".", "\\.")}\\((\\d+),`).exec(e)?.[1];
    const id = line ? ruleAt(Number(line)) : undefined;
    return id ? `${id}: ${e.replace(/^[^:]*: /, "")}` : e;
  });
  return { name: "rules compile", problems, note: changed ? `wrote ${generated}` : undefined };
}

/** The lean executable: on the PATH, or where elan installs it. */
function leanCommand(): string | undefined {
  if (spawnSync("lean", ["--version"], { encoding: "utf8" }).status === 0) return "lean";
  const elan = join(homedir(), ".elan", "bin", process.platform === "win32" ? "lean.exe" : "lean");
  return existsSync(elan) ? elan : undefined;
}

/** The proofs' outcome, and the names of the theorems in the proof files that check. */
function proofs(p: Project): Outcome & { proved: ReadonlySet<string> } {
  const dir = join(p.dir, "proof");
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".lean")) : [];
  const proved = new Set<string>();
  if (files.length === 0) return { name: "proofs", problems: [], skipped: "no proof/*.lean", proved };
  const lean = leanCommand();
  if (!lean) return { name: "proofs", problems: [], skipped: "Lean isn't installed", proved };
  const problems = files.flatMap((f) => {
    const run = spawnSync(lean, [f], { cwd: dir, encoding: "utf8" });
    if (run.status !== 0) return [`proof/${f}:`, ...`${run.stdout}${run.stderr}`.split(/\r?\n/).filter((l) => l.trim() !== "")];
    // A file that checks has no sorry: Lean reports one as a warning, so look for it.
    if (/declaration uses [`']sorry[`']/.test(`${run.stdout}${run.stderr}`)) return [`proof/${f}: uses sorry`];
    for (const m of readFileSync(join(dir, f), "utf8").matchAll(/^theorem\s+(\S+)/gm)) proved.add(m[1]);
    return [];
  });
  return { name: "proofs", problems, note: `${files.length} ${files.length === 1 ? "file" : "files"}`, proved };
}

/**
 * The subset check and the judge; the judge runs only when the subset and
 * the rules compile. A forbidden scenario is proved when a proof file that
 * checks has a theorem with its ID, dashes written as underscores
 * (undo-wrong-order: theorem undo_wrong_order). The name links them; that
 * the theorem states the scenario faithfully is for its reviewer.
 */
async function scenarioChecks(p: Project, compiled: Outcome, proved: ReadonlySet<string>): Promise<Outcome[]> {
  if (!p.scenarios) return [{ name: "scenarios", problems: [], skipped: "no scenarios file" }];
  const interfaces = new Set(parseDesign(p.dir, p.interfaces).filter((i) => !i.module).map((i) => i.name));
  const syntax = parseScenarios(p.dir, p.scenarios, interfaces);
  const subset: Outcome = { name: "scenario subset", problems: syntax.problems };
  if (syntax.problems.length || compiled.problems.length) {
    return [subset, { name: "scenarios", problems: [], skipped: "the subset or the rules have problems" }];
  }
  const rules = (await import(pathToFileURL(join(p.dir, generated)).href)) as RuleSet;
  const j = await judgeScenarios({ dir: p.dir, scenariosFile: p.scenarios, ruleLanguage: p.ruleLanguage, rules, references: p.references, syntax });
  const isProved = (id: string) => proved.has(id.replace(/-/g, "_"));
  const done = j.unproved.filter(isProved);
  const open = j.unproved.filter((id) => !isProved(id));
  const note = `${j.judged.length} allowed judged` +
    (done.length ? `; ${done.length} forbidden proved` : "") +
    (open.length ? `; forbidden, unproved until a proof: ${open.join(", ")}` : "");
  return [subset, { name: "scenarios", problems: j.problems, note }];
}

async function check(dir: string): Promise<boolean> {
  const p = loadProject(dir);
  const compiled = await rulesCompile(p);
  const proof = proofs(p);
  const outcomes: Outcome[] = [
    ruleFormat(p),
    { name: "boundary", problems: boundaryProblems(p.dir, designFiles(p)) },
    vocabularyPurity(p),
    compiled,
    ...(await scenarioChecks(p, compiled, proof.proved)),
    proof,
  ];
  for (const o of outcomes) {
    const status = o.skipped ? "skip" : o.problems.length ? "FAIL" : "ok";
    const note = o.skipped ?? o.note;
    console.log(`${status.padEnd(4)}  ${o.name}${note ? ` (${note})` : ""}`);
    for (const line of o.problems) console.log(`      ${line}`);
  }
  return outcomes.every((o) => o.problems.length === 0);
}

function init(dir: string): void {
  if (existsSync(join(dir, projectFile))) throw new Error(`${dir} already has ${projectFile}`);
  mkdirSync(dir, { recursive: true });
  const ruleLanguage = relative(dir, join(toolRoot, "rules.ts")).split("\\").join("/");
  const project = { interfaces: [] as string[], ruleLanguage: posix.normalize(ruleLanguage) };
  writeFileSync(join(dir, projectFile), `${JSON.stringify(project, null, 2)}\n`);
  if (!existsSync(join(dir, "brief.md"))) {
    writeFileSync(join(dir, "brief.md"), "# The brief\n\nThe project's starting prose: what it is, who it is for, and what is in scope.\n");
  }
  if (!existsSync(join(dir, "decisions.md"))) {
    writeFileSync(join(dir, "decisions.md"), "# Decisions\n\nPhase 1 decisions, agreed with the human, with their dates.\n");
  }
  console.log(`made ${dir}: ${projectFile}, brief.md, decisions.md. Add interface files to "interfaces" in ${projectFile}.`);
}

if (import.meta.main) {
  const [command, dir = "."] = process.argv.slice(2);
  try {
    if (command === "init" && process.argv[3]) init(dir);
    else if (command === "check") process.exitCode = (await check(dir)) ? 0 : 1;
    else {
      console.error("usage: typearc init <dir> | typearc check [dir]");
      process.exitCode = 2;
    }
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exitCode = 2;
  }
}
