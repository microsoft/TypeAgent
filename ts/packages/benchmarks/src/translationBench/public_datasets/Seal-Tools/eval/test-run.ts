// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Convenience smoke runner for the Seal-Tools eval.
 *
 * Defaults to 2 easy + 3 difficult cases across azure/gpt-5.6-luna, azure/gpt-4o,
 * and azure/gpt-4.1 (routed through the local LiteLLM gateway), writing to an
 * isolated fixtures/ folder (never clobbers a real run).
 * Override with env vars or pass extra runEval flags after `--`.
 *
 *   pnpm run build
 *   node dist/translationBench/public_datasets/Seal-Tools/eval/test-run.js
 *
 *   # override models / case count
 *   SEAL_MODELS="azure/gpt-4o,azure/gpt-5.6-luna#low" SEAL_MAX_CASES=10 \
 *     node dist/.../eval/test-run.js
 *
 *   # forward any runEval flag (e.g. keep the shared TPM db)
 *   node dist/.../eval/test-run.js --rate-limiter-db /tmp/seal.sqlite
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// dist/translationBench/public_datasets/Seal-Tools/eval -> package root.
const PACKAGE_ROOT = path.resolve(__dirname, "../../../../..");
const SMOKE_OUT = path.join(
    PACKAGE_ROOT,
    "src/translationBench/public_datasets/Seal-Tools/eval/fixtures",
);

const MODELS =
    process.env.SEAL_MODELS ??
    "azure/gpt-5.6-luna,azure/gpt-4o,azure/gpt-4.1";
const DEFAULT_CASE_IDS = [
    "sealtools-dev-easy-0",
    "sealtools-dev-easy-1",
    "sealtools-dev-difficult-201",
    "sealtools-dev-difficult-202",
    "sealtools-dev-difficult-209",
].join(",");
const CASE_IDS =
    process.env.SEAL_CASE_IDS ??
    (process.env.SEAL_MAX_CASES === undefined ? DEFAULT_CASE_IDS : undefined);
const CASE_ARGS =
    CASE_IDS !== undefined
        ? ["--case-ids", CASE_IDS]
        : ["--max-cases", process.env.SEAL_MAX_CASES!];

// Route azure/* ids through the local LiteLLM gateway (never ollama) unless the
// caller already picked a provider.
if (process.env.TYPEAGENT_MODEL_PROVIDER === undefined) {
    const base =
        process.env.LOCAL_LITELLM_OPENAI_BASE_URL ??
        (process.env.LITELLM_BASE_URL !== undefined
            ? `${process.env.LITELLM_BASE_URL.replace(/\/$/, "")}/v1`
            : undefined);
    const key =
        process.env.LOCAL_LITELLM_API_KEY ?? process.env.LITELLM_API_KEY;
    if (base !== undefined && key !== undefined) {
        process.env.TYPEAGENT_MODEL_PROVIDER = "openai";
        process.env.OPENAI_ENDPOINT = `${base.replace(/\/$/, "")}/chat/completions`;
        process.env.OPENAI_API_KEY = key;
    }
}

// Fresh each run so a rerun re-translates instead of resuming the checkpoint.
fs.rmSync(SMOKE_OUT, { recursive: true, force: true });

// runEval reads process.argv via commander; seed defaults, then let any extra
// args the user passed (argv[2:]) override.
process.argv = [
    process.argv[0]!,
    process.argv[1]!,
    ...CASE_ARGS,
    "--models",
    MODELS,
    "--out-dir",
    SMOKE_OUT,
    ...process.argv.slice(2),
];

console.log(
    `Seal-Tools smoke: ${CASE_IDS?.split(",").length ?? process.env.SEAL_MAX_CASES} case(s) × [${MODELS}]`,
);
console.log(`out-dir: ${SMOKE_OUT}\n`);

// Importing runEval executes its main() with the argv above.
await import("./runEval.js");
