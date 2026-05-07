// Phrase-corpus generator (S2 Phase 1).
//
// For each (action, model) pair, asks the model to produce 3 example
// user utterances in three distinct phrasing styles (imperative,
// conversational, casual).  Results are merged across models with
// per-phrase source attribution and written to a JSON file that S3's
// probe-corpus can replay through the embedding ranker.
//
// SAFETY: read-only dispatcher (no actions, no translation pipeline,
// no cache writes) — same shape as probe-runner.mjs.  All work is
// chat-completion calls + a single JSON file write.
//
// Usage (from ts/):
//   node packages/cli/scripts/corpus-runner.mjs

import { config as loadDotenv } from "dotenv";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoTsRoot = path.resolve(__dirname, "../../..");
loadDotenv({ path: path.join(repoTsRoot, ".env") });

import { createDispatcher } from "agent-dispatcher";
import {
    getDefaultAppAgentProviders,
    getDefaultConstructionProvider,
    getIndexingServiceRegistry,
} from "default-agent-provider";
import { getInstanceDir } from "agent-dispatcher/helpers/data";
import { openai } from "aiclient";
import { getAppAgentName } from "agent-dispatcher/internal";

// --- Config ------------------------------------------------------------------

/** Models to query.  Phase 1 = OpenAI-family only.  Phase 2 will add
 * non-OpenAI deployments once those exist. */
const MODELS = ["GPT_4_O", "GPT_4_O_MINI", "GPT_4_1", "GPT_5", "GPT_5_NANO"];

/** Schemas to scope the sample to.  Both small + documented => fast +
 * easy to eyeball. */
const SAMPLE_SCHEMAS = ["player", "list"];

const PHRASES_PER_CALL = 3; // imperative / conversational / casual
const CONCURRENCY = 8;
const OUTPUT_PATH = path.resolve("f:/tmp/corpus-sample.json");

// --- Helpers -----------------------------------------------------------------

function buildPrompt({
    agentName,
    agentDescription,
    schemaName,
    actionName,
    actionDescription,
    paramSummary,
}) {
    return [
        "You are helping calibrate a natural-language action-routing system.",
        "Given an action that an AI agent can perform, generate three example",
        "user utterances that a real person might say to trigger this action.",
        "",
        `Agent: ${agentName}`,
        `Agent purpose: ${agentDescription || "(no description)"}`,
        `Schema: ${schemaName}`,
        `Action: ${actionName}`,
        `Action description: ${actionDescription || "(none provided)"}`,
        `Parameters: ${paramSummary || "(none)"}`,
        "",
        "Generate three example utterances in distinct phrasing styles:",
        "  1. IMPERATIVE  — terse, command-like.",
        "  2. CONVERSATIONAL — polite or full-sentence.",
        "  3. CASUAL — short, idiomatic, may abbreviate or omit articles.",
        "",
        "If the action takes parameters with concrete values (a song name,",
        "a list name, etc.), invent plausible specific values rather than",
        "leaving placeholders.",
        "",
        'Return ONLY a JSON object: {"imperative":"…","conversational":"…","casual":"…"}.',
        "No commentary, no markdown fences, no preamble.",
    ].join("\n");
}

function describeParameters(definition) {
    const params = definition?.type?.fields?.parameters;
    if (!params) return undefined;
    const paramType = params.type;
    if (!paramType || paramType.type !== "object") return undefined;
    const lines = [];
    for (const [propName, propField] of Object.entries(paramType.fields)) {
        const propDoc = (propField.comments ?? [])
            .map((c) => c.trim())
            .filter(Boolean)
            .join(" ");
        lines.push(propDoc ? `${propName}: ${propDoc}` : propName);
    }
    return lines.length > 0 ? lines.join("\n") : undefined;
}

/** Strip the most common JSON-in-prose patterns models occasionally
 * produce despite the "no fences" instruction. */
function extractJSON(raw) {
    let s = raw.trim();
    if (s.startsWith("```")) {
        // ```json ... ``` or ``` ... ```
        s = s.replace(/^```[a-zA-Z]*\n?/, "").replace(/```$/, "");
    }
    // Take from the first { to the last } (defensive).
    const first = s.indexOf("{");
    const last = s.lastIndexOf("}");
    if (first >= 0 && last > first) s = s.slice(first, last + 1);
    return s.trim();
}

async function generateForOne({ model, modelName, action }) {
    const prompt = buildPrompt(action);
    const result = await model.complete(prompt);
    if (!result.success) {
        return {
            error: result.message ?? String(result),
            phrases: [],
        };
    }
    let parsed;
    try {
        parsed = JSON.parse(extractJSON(result.data));
    } catch (err) {
        return {
            error: `JSON parse failed: ${err.message}; raw: ${result.data.slice(0, 200)}`,
            phrases: [],
        };
    }
    const phrases = [];
    for (const style of ["imperative", "conversational", "casual"]) {
        const text = typeof parsed[style] === "string" ? parsed[style].trim() : "";
        if (text) {
            phrases.push({ text, style, model: modelName });
        }
    }
    return { phrases };
}

/** Run an array of async tasks with bounded concurrency. */
async function pmap(tasks, concurrency, onProgress) {
    const results = new Array(tasks.length);
    let next = 0;
    let done = 0;
    async function worker() {
        for (;;) {
            const i = next++;
            if (i >= tasks.length) return;
            try {
                results[i] = await tasks[i]();
            } catch (err) {
                results[i] = { error: String(err) };
            } finally {
                done++;
                onProgress?.(done, tasks.length);
            }
        }
    }
    await Promise.all(Array.from({ length: concurrency }, worker));
    return results;
}

// --- Run ---------------------------------------------------------------------

async function main() {
    const instanceDir = getInstanceDir();
    const defaultAppAgentProviders = getDefaultAppAgentProviders(instanceDir);
    const defaultConstructionProvider = getDefaultConstructionProvider();
    const indexingServiceRegistry =
        await getIndexingServiceRegistry(instanceDir);

    process.stderr.write(
        "Spinning up dispatcher (read-only — no actions / translation / cache)…\n",
    );
    const dispatcher = await createDispatcher("corpus-runner", {
        appAgentProviders: defaultAppAgentProviders,
        agents: { actions: false, commands: ["dispatcher"] },
        translation: { enabled: false },
        explainer: { enabled: false },
        cache: { enabled: false },
        constructionProvider: defaultConstructionProvider,
        indexingServiceRegistry,
        clientIO: stubClientIO(),
    });
    process.stderr.write("Dispatcher ready.\n\n");

    // Use the public "internal" export to enumerate action configs
    // independently of the running dispatcher.
    const { getAllActionConfigProvider } = await import(
        "agent-dispatcher/internal"
    );
    const { provider } = await getAllActionConfigProvider(
        defaultAppAgentProviders,
    );
    const allConfigs = provider.getActionConfigs();

    // Filter to sample.
    const sampled = allConfigs.filter((cfg) =>
        SAMPLE_SCHEMAS.includes(cfg.schemaName),
    );
    if (sampled.length === 0) {
        process.stderr.write(
            `No matching schemas found for sample: ${SAMPLE_SCHEMAS.join(", ")}.\n`,
        );
        process.stderr.write(
            `Available schemas: ${allConfigs.map((c) => c.schemaName).join(", ")}\n`,
        );
        await dispatcher.close();
        process.exit(1);
    }

    // Build the action list with all metadata we need for the prompt.
    const actions = [];
    for (const cfg of sampled) {
        const schemaFile = provider.getActionSchemaFileForConfig(cfg);
        const agentName = getAppAgentName(cfg.schemaName);
        // ActionConfig is a flattened AppAgentManifest — schema-level
        // description lives directly on the config.
        const agentDescription = cfg.description ?? undefined;
        for (const [actionName, definition] of schemaFile.parsedActionSchema
            .actionSchemas) {
            actions.push({
                agentName,
                agentDescription,
                schemaName: cfg.schemaName,
                actionName,
                actionDescription:
                    definition.comments?.[0]?.trim() || undefined,
                paramSummary: describeParameters(definition),
                definition,
            });
        }
    }
    process.stderr.write(
        `Sampled ${actions.length} action(s) across ${sampled.length} schema(s): ${sampled.map((c) => c.schemaName).join(", ")}\n`,
    );

    // Instantiate one chat model per name.  Each call shares the model
    // instance — the underlying pool handles concurrency limits.
    const models = MODELS.map((name) => ({
        name,
        model: openai.createChatModel(name, undefined, undefined, [
            "corpus-runner",
        ]),
    }));

    // Build the (action × model) task list.
    const tasks = [];
    for (const action of actions) {
        for (const m of models) {
            tasks.push(async () => {
                const out = await generateForOne({
                    model: m.model,
                    modelName: m.name,
                    action,
                });
                return { action, model: m.name, ...out };
            });
        }
    }

    process.stderr.write(
        `Running ${tasks.length} (action × model) generation(s) at concurrency ${CONCURRENCY}…\n`,
    );
    const t0 = Date.now();
    const results = await pmap(tasks, CONCURRENCY, (done, total) => {
        if (done % 10 === 0 || done === total) {
            process.stderr.write(`  [${done}/${total}]\n`);
        }
    });
    const elapsedMs = Date.now() - t0;
    process.stderr.write(
        `\nGeneration complete in ${(elapsedMs / 1000).toFixed(1)}s.\n`,
    );

    // Merge results per (schema, action).  Dedupe by lowercased text
    // but keep ALL source attributions so downstream analysis can see
    // which models converged on the same wording.
    const byAction = new Map();
    let errorCount = 0;
    for (const r of results) {
        if (r.error) {
            errorCount++;
            process.stderr.write(
                `  [warn] ${r.action.schemaName}.${r.action.actionName} via ${r.model}: ${r.error}\n`,
            );
            continue;
        }
        const key = `${r.action.schemaName}.${r.action.actionName}`;
        if (!byAction.has(key)) {
            byAction.set(key, {
                schemaName: r.action.schemaName,
                actionName: r.action.actionName,
                description: r.action.actionDescription,
                phrases: [],
            });
        }
        const slot = byAction.get(key);
        for (const p of r.phrases) {
            const existing = slot.phrases.find(
                (x) => x.text.toLowerCase() === p.text.toLowerCase(),
            );
            if (existing) {
                if (!existing.sources.some((s) => s.model === p.model && s.style === p.style)) {
                    existing.sources.push({ model: p.model, style: p.style });
                }
            } else {
                slot.phrases.push({
                    text: p.text,
                    sources: [{ model: p.model, style: p.style }],
                });
            }
        }
    }

    const corpus = {
        scannedAt: new Date().toISOString(),
        models: MODELS,
        sampledSchemas: SAMPLE_SCHEMAS,
        actionCount: byAction.size,
        actions: Array.from(byAction.values()).sort((a, b) =>
            `${a.schemaName}.${a.actionName}`.localeCompare(
                `${b.schemaName}.${b.actionName}`,
            ),
        ),
    };

    fs.writeFileSync(OUTPUT_PATH, JSON.stringify(corpus, null, 2));
    process.stderr.write(`\nWrote corpus to ${OUTPUT_PATH}\n`);

    // Per-action dedup summary.
    const totalPhrases = corpus.actions.reduce(
        (n, a) => n + a.phrases.length,
        0,
    );
    const totalSources = corpus.actions.reduce(
        (n, a) =>
            n + a.phrases.reduce((m, p) => m + p.sources.length, 0),
        0,
    );
    const dedupRatio =
        totalSources > 0 ? totalPhrases / totalSources : 0;
    process.stdout.write(
        `\n${corpus.actionCount} actions, ${totalPhrases} unique phrases (from ${totalSources} raw model outputs, dedup keep-rate ${(
            dedupRatio * 100
        ).toFixed(1)}%, ${errorCount} errors)\n`,
    );

    // Top-line per-action summary so we can eyeball the result without
    // opening the JSON.
    process.stdout.write(`\nPer-action breakdown:\n`);
    for (const a of corpus.actions) {
        const styleTags = new Set();
        const modelTags = new Set();
        for (const p of a.phrases) {
            for (const s of p.sources) {
                styleTags.add(s.style);
                modelTags.add(s.model);
            }
        }
        process.stdout.write(
            `  ${a.schemaName}.${a.actionName}: ${a.phrases.length} unique phrases (${modelTags.size} models, ${styleTags.size} styles)\n`,
        );
    }

    await dispatcher.close();
}

function stubClientIO() {
    const noop = () => {};
    const noopAsync = async () => {};
    return {
        clear: noop, exit: noop, shutdown: noop,
        setUserRequest: noop, setDisplayInfo: noop,
        setDisplay: noop, appendDisplay: noop, appendDiagnosticData: noop,
        setDynamicDisplay: noop,
        question: async () => 0, proposeAction: async () => undefined,
        notify: noop, openLocalView: noopAsync, closeLocalView: noopAsync,
        requestChoice: noop, requestInteraction: noop,
        interactionResolved: noop, interactionCancelled: noop,
        takeAction: noop,
    };
}

main().catch((err) => {
    process.stderr.write(`corpus-runner failed: ${err?.stack ?? err}\n`);
    process.exit(1);
});
