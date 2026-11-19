/**
 * RuleGen is a script: it compiles the rule expressions of the circles
 * interface files into rules.gen.ts, with tool/cli/ruleGen.ts (which says
 * how). Only the files in `compiled` are compiled; the rest follow as
 * their rules get expressions.
 * Run: node ruleGen.ts to write; node ruleGen.ts --check exits nonzero if
 * rules.gen.ts is out of date (npm run typecheck runs it).
 * Imports: catalog.ts, tool/cli/ruleGen.ts, node:fs
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { sources } from "./catalog.ts";
import { generateRules } from "./tool/cli/ruleGen.ts";

/** The interface files whose rules are compiled. */
const compiled = ["dataModel.ts", "shapeModel.ts"];
const out = "rules.gen.ts";

/** The design files that declare types a rule expression may name. */
const typeFiles = ["geometry.ts", "color.ts", "shape.ts", "events.ts", "dataModel.ts", "shapeModel.ts", "frames.ts", "view.ts", "shapeView.ts", "layout.ts", "rules.ts"];

if (import.meta.main) {
  const text = await generateRules({ dir: ".", interfaces: sources, compiled, typeFiles, regenerate: "node ruleGen.ts" });
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
