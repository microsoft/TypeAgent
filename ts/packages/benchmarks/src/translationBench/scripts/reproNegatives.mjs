// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
//
// Reproduce translation-bench NEGATIVE failures (BAD_NEGATIVE) across the
// gpt-5.6 sol/terra/luna models, using the real TypeAgent translator.
//
// A negative utterance ("Do not X", "Don't X") must NOT produce the target
// action. The dispatcher translator is expected to answer `unknown` (or fail
// to produce the target action). Producing the target action = BAD_NEGATIVE.
//
// Only actions in eligible-gold-actions.generated.json are eligible, and each
// case activates only its target schema (the dispatcher activates a small
// schema set per request; sending all ~290 actions at once exceeds the
// provider's tool-array limit).
//
// Usage:
//   node reproNegatives.mjs --api-key <key> --models sol --limit 20 --concurrency 6

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Command } from "commander";
import { getChatModelMaxConcurrency } from "@typeagent/aiclient";
import {
    getAllActionConfigProvider,
    createTypeAgentTranslatorForSelectedActions,
} from "agent-dispatcher/internal";
import { getInstanceDir } from "agent-dispatcher/helpers/data";
import { getDefaultAppAgentProviders } from "default-agent-provider";

/** Run `tasks` with at most `limit` in flight, preserving result order. */
async function mapConcurrent(tasks, limit) {
    const results = new Array(tasks.length);
    let next = 0;
    const workers = Array.from({ length: Math.min(limit, tasks.length) }, async () => {
        while (true) {
            const i = next++;
            if (i >= tasks.length) return;
            results[i] = await tasks[i]();
        }
    });
    await Promise.all(workers);
    return results;
}

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const benchDir = path.resolve(MODULE_DIR, "..");

const MODEL_MAP = {
    sol: "azure/gpt-5.6-sol",
    terra: "azure/gpt-5.6-terra",
    luna: "azure/gpt-5.6-luna",
};

const DEFAULT_ENDPOINT = "http://127.0.0.1:4627/v1/chat/completions";

const csv = (v) =>
    v
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

const opts = new Command()
    .name("reproNegatives")
    .description(
        "Reproduce translation-bench BAD_NEGATIVE failures via the real TypeAgent translator.",
    )
    .option("--models <list>", "comma-separated model keys", csv, [
        "sol",
        "terra",
        "luna",
    ])
    .option("--limit <n>", "max negative cases to run", Number, 20)
    .option(
        "--only <list>",
        "comma-separated action-id filter, e.g. browser.goForward",
        csv,
        [],
    )
    .option("--repeat <n>", "repeat each cell N times", Number, 1)
    .option("--concurrency <n>", "max in-flight translations", Number, 4)
    .option("--api-key <key>", "API key for the completions endpoint")
    .option("--endpoint <url>", "chat completions endpoint", DEFAULT_ENDPOINT)
    .parse()
    .opts();

// aiclient resolves credentials from the environment; feed it the CLI values.
const KEY_VAR = "OPENAI_API_KEY";
process.env.OPENAI_ENDPOINT = opts.endpoint;
if (opts.apiKey) {
    process.env[KEY_VAR] = opts.apiKey;
}
if (!process.env[KEY_VAR]) {
    throw new Error(`missing credential: pass --api-key or set ${KEY_VAR}`);
}

const models = opts.models;
const limit = opts.limit;
const only = opts.only;
const repeat = opts.repeat;
// Bounded parallelism, capped by the model's configured maxConcurrency so we
// don't outrun provider rate limits.
const concurrency = getChatModelMaxConcurrency(opts.concurrency, undefined, 4);

// ---- eligible-gold allowlist (the only permitted schemas/actions) --------
const allowlist = new Set(
    JSON.parse(
        readFileSync(
            path.join(benchDir, "eligible-gold-actions.generated.json"),
            "utf8",
        ),
    ).allowlist,
);

// ---- hardcoded negative utterances --------------------------------------
// 20 fixed imperative-negation cases. `id` is the allowlisted action that must
// NOT be produced; a negative expects no action (`expectedActions: []`).
const NEGATIVE_CASES = [
    { id: "browser.goForward", utterance: "Do not navigate forward in the browser.", expectedActions: [] },
    { id: "browser.goBack", utterance: "Don't go back to the previous page.", expectedActions: [] },
    { id: "browser.scrollDown", utterance: "Do not scroll down this page.", expectedActions: [] },
    { id: "browser.scrollUp", utterance: "Please don't scroll up.", expectedActions: [] },
    { id: "browser.stopReadPageContent", utterance: "Don't stop the browser's ongoing page-reading session.", expectedActions: [] },
    { id: "browser.readPageContent", utterance: "Do not read the contents of this page aloud.", expectedActions: [] },
    { id: "browser.closeWebPage", utterance: "Don't close the current web page.", expectedActions: [] },
    { id: "browser.closeAllWebPages", utterance: "Leave all my shopping, banking, news, email, and calendar browser tabs alone; don't close any of them.", expectedActions: [] },
    { id: "browser.reloadPage", utterance: "Please don't reload the page.", expectedActions: [] },
    { id: "browser.captureScreenshot", utterance: "Do not take a screenshot of the browser.", expectedActions: [] },
    { id: "browser.zoomReset", utterance: "Don't reset the browser zoom level.", expectedActions: [] },
    { id: "browser.followLinkByText", utterance: "Do not follow the 'Learn more' link on this page.", expectedActions: [] },
    { id: "browser.changeSearchProvider", utterance: "Don't change my default search provider.", expectedActions: [] },
    { id: "browser.openWebPage", utterance: "Do not open a new web page right now.", expectedActions: [] },
    { id: "desktop.AdjustScreenBrightness", utterance: "Do not adjust the screen brightness.", expectedActions: [] },
    { id: "desktop.AdjustVolume", utterance: "Don't change the system volume.", expectedActions: [] },
    { id: "desktop.ApplyTheme", utterance: "Do not apply a new desktop theme.", expectedActions: [] },
    { id: "desktop.CloseProgram", utterance: "Please don't close any running programs.", expectedActions: [] },
    { id: "list.clearList", utterance: "Do not clear my shopping list.", expectedActions: [] },
    { id: "timer.cancelReminder", utterance: "Don't cancel my reminder.", expectedActions: [] },
];

for (const c of NEGATIVE_CASES) {
    if (!allowlist.has(c.id)) {
        throw new Error(`negative case action not in eligible-gold allowlist: ${c.id}`);
    }
}

/** Flatten a translated action (possibly a multiple-action wrapper) to ids. */
function producedActionIds(data, schemaOf) {
    if (data === null || typeof data !== "object") return [];
    if (Array.isArray(data.actions)) {
        return data.actions.flatMap((a) => producedActionIds(a, schemaOf));
    }
    // Multiple-action entries wrap the real action.
    if (data.action !== undefined) return producedActionIds(data.action, schemaOf);

    const actionName = data.actionName;
    if (typeof actionName !== "string") return [];
    // `unknown` is the translator's no-actionable-intent answer -> a PASS.
    if (actionName === "unknown") return [];
    const schemaName = data.translatorName ?? schemaOf(actionName) ?? "";
    return [schemaName ? `${schemaName}.${actionName}` : actionName];
}

async function main() {


    const { provider } = await getAllActionConfigProvider(
        getDefaultAppAgentProviders(getInstanceDir()),
    );

    const selected = only.length > 0
        ? NEGATIVE_CASES.filter((c) => only.includes(c.id))
        : NEGATIVE_CASES;
    const cases = selected.slice(0, Math.min(limit, selected.length));
    console.log(
        `negatives=${cases.length} models=${models.join(",")} concurrency=${concurrency} (real TypeAgent translator)\n`,
    );

    const summary = {};
    for (const m of models) summary[m] = { pass: 0, fail: 0, err: 0 };

    // One unit of work per (case, model); run them through a bounded pool.
    const jobs = [];
    for (const c of cases) {
        // Activate only the target action's schema for this request, matching
        // how the dispatcher scopes translation per request.
        const schemaName = c.id.slice(0, c.id.lastIndexOf("."));
        const actionConfig = provider.tryGetActionConfig(schemaName);
        if (actionConfig === undefined) {
            console.log(`SKIP ${c.id}: schema '${schemaName}' not available`);
            continue;
        }
        // Offer ONLY the eligible-gold allowlisted actions for this schema.
        // Activating the whole schema would expose non-gold actions (e.g.
        // browser.executeAdHocScript, excluded as llmAsAJudge), letting the
        // model "pass" a negative by firing an ineligible action.
        const schemaFile = provider.getActionSchemaFileForConfig(actionConfig);
        const allDefs = schemaFile.parsedActionSchema.actionSchemas;
        const definitions = [];
        for (const [actionName, def] of allDefs) {
            if (allowlist.has(`${schemaName}.${actionName}`)) {
                definitions.push(def);
            }
        }
        if (definitions.length === 0) {
            console.log(`SKIP ${c.id}: no allowlisted actions in '${schemaName}'`);
            continue;
        }
        for (const m of models) {
            for (let r = 0; r < repeat; r++) {
                jobs.push({ c, m, actionConfig, definitions });
            }
        }
    }

    const outcomes = await mapConcurrent(
        jobs.map(({ c, m, actionConfig, definitions }) => async () => {
            const model = MODEL_MAP[m] ?? m;
            try {
                const translator = createTypeAgentTranslatorForSelectedActions(
                    definitions,
                    actionConfig,
                    [],
                    [],
                    provider,
                    undefined,
                    model,
                );
                const result = await translator.translate(c.utterance);
                if (!result.success) {
                    // Translator refusing to produce an action is the correct
                    // behavior for a negative.
                    return { m, kind: "pass" };
                }
                const produced = producedActionIds(result.data, (a) =>
                    translator.getSchemaName(a),
                );
                const bad = produced.length !== c.expectedActions.length;
                // Guard: anything produced must be allowlisted. If not, the
                // offered action set leaked non-gold actions and the result is
                // not trustworthy.
                const offLimits = produced.filter((p) => !allowlist.has(p));
                return { m, c, produced, offLimits, kind: bad ? "fail" : "pass" };
            } catch (e) {
                return { m, c, kind: "err", message: String(e?.message ?? e) };
            }
        }),
        concurrency,
    );

    // Report in deterministic case order, not completion order.
    for (const o of outcomes) {
        summary[o.m][o.kind]++;
        if (o.kind === "fail") {
            console.log(`FAIL BAD_NEGATIVE ${o.m.padEnd(5)} | target=${o.c.id}`);
            console.log(`   utterance:       ${o.c.utterance}`);
            console.log(`   expectedActions: ${JSON.stringify(o.c.expectedActions)}`);
            console.log(`   produced:        ${JSON.stringify(o.produced)}\n`);
        } else if (o.kind === "err") {
            console.log(`ERR  ${o.m} ${o.c.id}: ${o.message.slice(0, 200)}`);
        }
    }

    console.log("\n=== summary (negative cases; PASS = no action produced) ===");
    let anyScored = false;
    for (const m of models) {
        const s = summary[m];
        const scored = s.pass + s.fail;
        if (scored > 0) anyScored = true;
        const rate = scored ? `${((100 * s.fail) / scored).toFixed(1)}%` : "n/a (nothing scored)";
        console.log(
            `${m.padEnd(6)} pass=${s.pass} fail=${s.fail} err=${s.err} bad-negative-rate=${rate}`,
        );
    }
    if (!anyScored) {
        console.log(
            "\nNO RESULTS: every call errored — the numbers above are not a signal.",
        );
        process.exitCode = 1;
    }
}

await main();
