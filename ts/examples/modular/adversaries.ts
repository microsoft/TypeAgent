// Checks that the contract suites catch known-wrong implementations.
//
// Each file adversaries/<RuleID>--<variant>.adversary.ts runs a contract suite
// against a deliberately wrong implementation. The suite must fail, and the
// failures must include the test named <RuleID>. An adversary that escapes
// means a test gap, or a rule that the tests don't actually enforce.
//
// First, adversaries/helpers.check.ts must pass: the helpers that adversaries are
// built from, with no bug switched on, pass their contracts.
//
// Runs use a fixed fast-check seed (FC_SEED, default 1), so results repeat.
//
// Run with: npm run adversaries
// Or, for only the adversaries whose file names contain some text:
//   npm run adversaries -- <text>

import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";

const dir = "adversaries";
const only = process.argv[2] ?? "";
const files = readdirSync(dir).filter((f) => f.endsWith(".adversary.ts") && f.includes(only)).sort();
let escapes = 0;
const env = { ...process.env, FC_SEED: process.env.FC_SEED ?? "1" };

// The helpers adversaries are built from must pass with no bug switched on.
const helpers = spawnSync(process.execPath, ["--test", `${dir}/helpers.check.ts`], {
  encoding: "utf8", timeout: 600_000, maxBuffer: 256 * 1024 * 1024, env,
});
if (helpers.status !== 0) {
  console.log(helpers.stdout);
  console.log("helpers.check.ts failed: fix the helpers before trusting any adversary");
  process.exit(1);
}

for (const file of files) {
  const rule = file.slice(0, file.indexOf("--"));
  const run = spawnSync(process.execPath, ["--test", "--test-reporter=tap", `${dir}/${file}`], {
    encoding: "utf8", timeout: 600_000, maxBuffer: 256 * 1024 * 1024, env,
  });
  const failed = [...run.stdout.matchAll(/^\s*not ok \d+ - (.+?)\s*$/gm)].map((m) => m[1]);
  const caught = run.status !== 0 && failed.includes(rule);
  if (!caught) escapes++;
  console.log(`${caught ? "caught " : "ESCAPED"} ${file}${caught ? "" : `  (failed: ${failed.join(", ") || "nothing"})`}`);
}

console.log(`\n${files.length} adversaries, ${escapes} escaped`);
process.exitCode = escapes === 0 ? 0 : 1;
