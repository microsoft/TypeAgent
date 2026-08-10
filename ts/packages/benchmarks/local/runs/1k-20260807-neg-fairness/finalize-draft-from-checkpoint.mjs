#!/usr/bin/env node
/** Build a benchmark draft jsonl from a generation checkpoint (no gold edits).
 * Re-runs finalizeTranslationBenchGeneratedCaseLineage so parameterScore and
 * canonical hashes match the current synthesizer (B/C/D wiring).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const RUN = path.dirname(fileURLToPath(import.meta.url));
const tsRoot = path.resolve(RUN, "../../../../../");
const ckpt =
  process.env.TB_CHECKPOINT_PATH ||
  path.join(RUN, "artifacts/generate-checkpoint.jsonl");
const out =
  process.env.TB_OUT_PATH || path.join(RUN, "artifacts/benchmark-draft-1000.jsonl");
const name =
  process.env.TB_BENCHMARK_NAME || "typeagent-translation-bench-1k-all-actions";
const prior = process.env.TB_PRIOR_DRAFT || out;

const genMod = await import(
  pathToFileURL(
    path.join(
      tsRoot,
      "packages/benchmarks/dist/translationBench/synthesizer/datasetGenerator.js",
    ),
  ).href,
);
const bmMod = await import(
  pathToFileURL(
    path.join(
      tsRoot,
      "packages/benchmarks/dist/translationBench/synthesizer/benchmark.js",
    ),
  ).href,
);
const eligMod = await import(
  pathToFileURL(
    path.join(
      tsRoot,
      "packages/benchmarks/dist/translationBench/synthesizer/eligibleActions.js",
    ),
  ).href,
);

const cases = [];
const seenIds = new Set();
const seenUtterances = new Set();
let lineNo = 0;
for (const line of fs.readFileSync(ckpt, "utf8").split("\n")) {
  lineNo += 1;
  if (!line.trim()) continue;
  let rec;
  try {
    rec = JSON.parse(line);
  } catch (err) {
    throw new Error(`${ckpt}:${lineNo}: invalid JSON (${err.message})`);
  }
  if (rec.kind !== "translation-bench-row" || rec.value?.recordType !== "case") {
    continue;
  }
  const c = rec.value;
  if (typeof c.id !== "string" || !c.seed || !Array.isArray(c.generalizations)) {
    throw new Error(
      `${ckpt}:${lineNo}: malformed case (missing id/seed/generalizations)`,
    );
  }
  if (seenIds.has(c.id)) {
    throw new Error(`${ckpt}:${lineNo}: duplicate case id '${c.id}'`);
  }
  seenIds.add(c.id);
  for (const probe of [c.seed, ...c.generalizations]) {
    if (seenUtterances.has(probe.utterance)) {
      throw new Error(
        `${ckpt}:${lineNo}: duplicate utterance '${probe.utterance}'`,
      );
    }
    seenUtterances.add(probe.utterance);
  }
  cases.push(c);
}
if (cases.length === 0) throw new Error(`No cases in ${ckpt}`);
cases.sort((a, b) => String(a.id).localeCompare(String(b.id)));

if (!fs.existsSync(prior)) {
  throw new Error(`Missing header source (TB_PRIOR_DRAFT): ${prior}`);
}
const header = JSON.parse(fs.readFileSync(prior, "utf8").split("\n")[0]);
if (header.recordType !== "metadata" || !header.construction) {
  throw new Error(
    `${prior}: first line is not a metadata header with construction`,
  );
}
header.name = name;

const catalog = header.schemas;
const finalizedCases = cases.map((c) =>
  genMod.finalizeTranslationBenchGeneratedCaseLineage(c, catalog),
);

// Rebuild generation coverage to match the cases actually emitted (partial OK).
const scheduledActionCount = new Set(
  finalizedCases.map((c) =>
    JSON.stringify([c.targetAction.schemaName, c.targetAction.actionName]),
  ),
).size;
const catalogActionCount = catalog.reduce(
  (sum, schema) => sum + (schema.tools?.length || 0),
  0,
);
const eligibleActionCount = eligMod.countEligibleTranslationBenchActions(
  catalog,
  eligMod.getPackagedScheduleExcludedActionIds(catalog, {
    allowMissingExactIds: true,
  }),
);
const priorGen = header.construction.generation || {};
header.construction.generation = {
  ...priorGen,
  caseCount: finalizedCases.length,
  coverage: {
    ...(priorGen.coverage || {}),
    schemaCount: catalog.length,
    actionCount: catalogActionCount,
    scheduledActionCount,
    complete: scheduledActionCount === eligibleActionCount,
    catalogDigest:
      priorGen.coverage?.catalogDigest ||
      priorGen.catalogDigest ||
      undefined,
  },
};
// Drop undefined catalogDigest if missing
if (header.construction.generation.coverage.catalogDigest === undefined) {
  // keep whatever was on prior - required field may exist
  delete header.construction.generation.coverage.catalogDigest;
  // try from checkpoint header
}

// Rebuild the decision ledger from the actual cases so it matches them 1:1.
const stripHash = ({ canonicalPayloadHash, ...rest }) => rest;
header.construction.decisionLedger = finalizedCases.flatMap((c) =>
  [c.seed, ...c.generalizations].map((probe, i) => ({
    decision: "score",
    candidateId: `${c.id}:${i === 0 ? "seed" : `gen-${i}`}`,
    lineage: stripHash(probe.lineage),
    bankId: c.id,
    role: probe.selection.role,
    targetAction: probe.selection.targetAction,
    rationale: probe.selection.rationale,
    confidence: probe.selection.confidence,
  })),
);

// Ensure catalogDigest present: read from checkpoint settings if needed
if (!header.construction.generation.coverage.catalogDigest) {
  for (const line of fs.readFileSync(ckpt, "utf8").split("\n")) {
    if (!line.trim()) continue;
    const rec = JSON.parse(line);
    if (rec.kind === "translation-bench-checkpoint") {
      const d = rec.settings?.catalogDigest;
      if (d) header.construction.generation.coverage.catalogDigest = d;
      break;
    }
  }
}

const benchmark = { metadata: header, cases: finalizedCases };
const text = bmMod.formatTranslationBenchBenchmarkJsonl(benchmark);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, text);
const withPs = finalizedCases.filter((c) => c.seed?.parameterScore).length;
console.log(
  JSON.stringify(
    {
      out,
      cases: finalizedCases.length,
      name,
      seedWithParameterScore: withPs,
      scheduledActionCount,
      eligibleActionCount,
      complete: scheduledActionCount === eligibleActionCount,
    },
    null,
    2,
  ),
);
