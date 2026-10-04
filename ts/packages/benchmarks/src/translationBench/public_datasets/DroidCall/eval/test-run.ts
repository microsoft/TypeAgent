// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Convenience smoke runner for the DroidCall eval.
 *
 * Defaults to five cases across every model in run-config.json, writing to an
 * isolated results folder.
 * Override with env vars or pass extra runEval flags after `--`.
 *
 *   pnpm run build
 *   node dist/translationBench/public_datasets/DroidCall/eval/test-run.js
 *
 *   # override models / case count
 *   DROIDCALL_MODELS="azure/gpt-4o,azure/gpt-5.6-luna#low" DROIDCALL_MAX_CASES=10 \
 *     node dist/.../eval/test-run.js
 *
 *   # forward any runEval flag (e.g. keep the shared TPM db)
 *   node dist/.../eval/test-run.js --rate-limiter-db /tmp/droidcall.sqlite
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// dist/translationBench/public_datasets/DroidCall/eval -> package root.
const PACKAGE_ROOT = path.resolve(__dirname, "../../../../..");
const SMOKE_OUT = path.join(
    PACKAGE_ROOT,
    `src/translationBench/public_datasets/DroidCall/eval/results/smoke-${process.pid}`,
);

const MODELS =
    process.env.DROIDCALL_MODELS ??
    [
        "azure/gpt-4.1",
        "azure/gpt-4.1-mini",
        "azure/gpt-5.4-nano",
        "azure/gpt-5.6-sol",
        "azure/gpt-5.6-terra",
        "azure/gpt-5.6-luna#none",
        "azure/gpt-5.6-luna#low",
        "azure/gpt-4o",
    ].join(",");
const CASE_IDS = process.env.DROIDCALL_CASE_IDS;
const CASE_ARGS =
    CASE_IDS !== undefined
        ? ["--case-ids", CASE_IDS]
        : ["--max-cases", process.env.DROIDCALL_MAX_CASES ?? "5"];

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
    `DroidCall smoke: ${CASE_IDS?.split(",").length ?? process.env.DROIDCALL_MAX_CASES} case(s) × [${MODELS}]`,
);
console.log(`out-dir: ${SMOKE_OUT}\n`);

// Importing runEval executes its main() with the argv above.
await import("./runEval.js");
