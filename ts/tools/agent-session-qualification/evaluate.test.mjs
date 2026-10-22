import test from "node:test";
import assert from "node:assert/strict";
import {
    mkdir,
    writeFile,
    readFile,
    rm,
    readdir,
    cp,
    symlink,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import {
    tsRoot,
    QualificationError,
    ModelTracker,
    EmbeddingTracker,
    embeddingTokenizer,
    embeddingBatches,
    prepareResume,
    stateInventory,
    CallBudget,
    embeddingRuntimeConfig,
    advertisedCopilotCapacity,
    wireEmbeddingSettings,
    OfflineSubstringIndex,
    answerPrompt,
    judgePrompt,
    artifactSupportPrompt,
    chunkJsonl,
    evaluate,
    runCli,
    importRequests,
    limits,
    loadFixtures,
    parseArgs,
    ratio,
    resolveCitation,
    resolveRawSearchMatch,
    harnessCapacityBlock,
    safeFailure,
    scoreAnswer,
    sha256,
    writePredictions,
} from "./evaluate.mjs";

const directory = path.dirname(fileURLToPath(import.meta.url));
const json = (file, value) => writeFile(file, JSON.stringify(value), "utf8");

async function fixture(t, eventOverrides = []) {
    const root = path.join(directory, `.test-work-${randomUUID()}`);
    await mkdir(root);
    t.after(() => rm(root, { recursive: true, force: true }));
    await mkdir(path.join(root, "fixtures"));
    const fixtures = path.join(root, "fixtures");
    await mkdir(path.join(fixtures, "imports"));
    await mkdir(path.join(fixtures, "gold"));
    const events = eventOverrides.length
        ? eventOverrides
        : [
              {
                  schemaVersion: 1,
                  id: "first",
                  sessionId: "session-1",
                  kind: "objective",
                  text: "Synthetic offline fixture: preserve café 🧠.",
              },
              {
                  schemaVersion: 1,
                  id: "last",
                  sessionId: "session-1",
                  kind: "verification",
                  text: "Synthetic offline fixture: exact final tail.",
              },
          ];
    const text = events.map((event) => JSON.stringify(event)).join("\n");
    await writeFile(path.join(fixtures, "imports", "case.jsonl"), text);
    const gold = {
        questions: [
            {
                questionId: "benchmark-original-id",
                question: "What is the synthetic tail?",
                answer: "GOLD-SECRET-ANSWER",
                requiredTerms: ["GOLD-SECRET-TERM"],
                evidenceEventIds: ["last"],
            },
        ],
    };
    await json(path.join(fixtures, "gold", "case.json"), gold);
    const manifest = {
        schemaVersion: 1,
        cases: [
            {
                caseId: "synthetic-case",
                sessionId: "session-1",
                repository: "synthetic/repo",
                importType: "agent-session-jsonl",
                input: "imports\\case.jsonl",
                gold: "gold\\case.json",
                sha256: sha256(text),
                provenance: {
                    public: true,
                    license: "MIT",
                    sourceUrl: "https://example.org/synthetic-test-only",
                },
            },
        ],
    };
    await json(path.join(fixtures, "manifest.json"), manifest);
    return { root, fixtures, text, events, manifest, gold };
}

function options(f, overrides = {}) {
    return {
        fixtureRoot: f.fixtures,
        runDirectory: path.join(f.root, "run"),
        mode: "protocol",
        provider: "configured",
        cases: [],
        timeoutMs: 30_000,
        maxModelCalls: 80,
        maxQuestions: 3,
        ...overrides,
    };
}

test("CLI validates bounds, selections, twenty-minute default and explicit two-hour ceiling", () => {
    const result = parseArgs([
        "--fixture-root",
        ".",
        "--run-directory",
        "new-run",
        "--case",
        "one,two",
        "--case",
        "three",
    ]);
    assert.equal(result.mode, "protocol");
    assert.equal(result.provider, "configured");
    assert.equal(result.maxModelCalls, 80);
    assert.equal(result.timeoutMs, 1_200_000);
    assert.equal(result.maxQuestions, 3);
    assert.deepEqual(result.cases, ["one", "two", "three"]);
    for (const extra of [
        ["--timeout-ms", "7200001"],
        ["--max-model-calls", "0"],
        ["--mode", "fake"],
        ["--provider", "unknown"],
        ["--max-questions", "-1"],
        ["--unknown", "value"],
    ])
        assert.throws(() =>
            parseArgs([
                "--fixture-root",
                ".",
                "--run-directory",
                "new-run",
                ...extra,
            ]),
        );
});

test("embedding CLI is explicit/live-only, with pinned routing and no named-profile or provider fallback", () => {
    const args = ["--fixture-root", ".", "--run-directory", "new"];
    assert.equal(parseArgs(args).embeddings, "none");
    assert.equal(
        parseArgs([...args, "--mode", "live", "--embeddings", "copilot"])
            .embeddings,
        "copilot",
    );
    assert.equal(
        parseArgs([...args, "--mode", "live", "--timeout-ms", "7200000"])
            .timeoutMs,
        7200000,
    );
    assert.throws(
        () => parseArgs([...args, "--embeddings", "copilot"]),
        /require-live/,
    );
    assert.throws(
        () => parseArgs([...args, "--mode", "live", "--embeddings", "azure"]),
        /invalid-embedding/,
    );
    const prior = {
        defaultEmbeddingModel: "other",
        embeddingModels: { other: { provider: "azure" } },
        embedding: { provider: "local" },
        copilot: { fallbackModels: ["other-model"] },
    };
    const routed = embeddingRuntimeConfig(prior, "copilot");
    assert.equal(routed.defaultEmbeddingModel, undefined);
    assert.equal(routed.embeddingModels, undefined);
    assert.deepEqual(routed.embedding, {
        provider: "copilot",
        model: "text-embedding-3-small",
        size: 1536,
        maxBatchSize: 64,
    });
    assert.deepEqual(routed.copilot.fallbackModels, []);
    assert.equal(routed.copilot.defaultModel, "gpt-6-luna");
    assert.equal(routed.copilot.maxRetryAttempts, 0);
    assert.equal(prior.embedding.provider, "local");
    assert.equal(
        embeddingRuntimeConfig(prior, "none").embedding.provider,
        "none",
    );
});

test("advertised Copilot limits admit complete long inputs and reject missing, invalid or conflicting capabilities", async (t) => {
    const advertised = {
        max_context_window_tokens: 1_000_000,
        max_output_tokens: 128_000,
        max_prompt_tokens: 872_000,
    };
    const entry = { id: "gpt-6-luna", capabilities: { limits: advertised } };
    const capacity = advertisedCopilotCapacity([entry, structuredClone(entry)]);
    assert.equal(capacity.matchedEntries, 2);
    assert.deepEqual(capacity.constraints, {
        contextTokens: 1_000_000,
        inputTokens: 872_000,
        outputTokens: 8192,
    });
    assert.match(capacity.source, /listModels/);
    const { tracked } = await tracker(
        t,
        {
            completionSettings: {},
            complete: async () => {
                throw new Error("must not complete");
            },
        },
        { constraints: capacity.constraints },
    );
    assert.equal(tracked.fits("x".repeat(610_000)), true);
    assert.equal(tracked.fits("x".repeat(873_000)), false);
    assert.equal(
        harnessCapacityBlock(capacity.constraints).configuredConstraints
            .inputTokens,
        872_000,
    );
    for (const invalid of [
        [],
        [{ id: "another-model", capabilities: entry.capabilities }],
        [{ ...entry, policy: { state: "disabled" } }],
        [
            {
                ...entry,
                capabilities: {
                    limits: { ...advertised, max_prompt_tokens: undefined },
                },
            },
        ],
        [
            {
                ...entry,
                capabilities: {
                    limits: { ...advertised, max_output_tokens: 0 },
                },
            },
        ],
        [
            entry,
            {
                ...entry,
                capabilities: {
                    limits: { ...advertised, max_prompt_tokens: 800_000 },
                },
            },
        ],
    ])
        assert.throws(
            () => advertisedCopilotCapacity(invalid),
            /copilot-selected-model/,
        );
});

async function embeddingSetup({
    inner,
    maxCalls = 10,
    perCallMs = 120_000,
} = {}) {
    const [
        { identifyEmbeddingModel },
        { checkSerializedRequestConstraints },
        kp,
    ] = await Promise.all([
        import(
            pathToFileURL(
                path.join(
                    tsRoot,
                    "packages",
                    "aiclient",
                    "dist",
                    "identifiedEmbedding.js",
                ),
            ).href
        ),
        import(
            pathToFileURL(
                path.join(
                    tsRoot,
                    "packages",
                    "aiclient",
                    "dist",
                    "requestConstraints.js",
                ),
            ).href
        ),
        import(
            pathToFileURL(
                path.join(
                    tsRoot,
                    "packages",
                    "knowledgeProcessor",
                    "dist",
                    "index.js",
                ),
            ).href
        ),
    ]);
    const vector = [1, ...Array(1535).fill(0)];
    const model = identifyEmbeddingModel(
        inner ?? {
            maxBatchSize: 64,
            generateEmbedding: async () => ({ success: true, data: vector }),
            generateEmbeddingBatch: async (texts) => ({
                success: true,
                data: texts.map(() => vector),
            }),
        },
        {
            provider: "copilot",
            model: "text-embedding-3-small",
            revision: "provider-managed-unversioned",
            dimensions: 1536,
            pooling: "provider-managed",
            normalization: "l2",
            preprocessing: "provider-managed text embedding",
            configuration: { model: "text-embedding-3-small" },
        },
    );
    const controller = new AbortController();
    const budget = new CallBudget(maxCalls);
    const saved = [];
    const tracked = new EmbeddingTracker({
        signal: controller.signal,
        callBudget: budget,
        checkConstraints: checkSerializedRequestConstraints,
        perCallMs,
        persist: async (calls) => saved.push(structuredClone(calls)),
    });
    return {
        tracked,
        model,
        vector,
        budget,
        controller,
        saved,
        kp,
        checkSerializedRequestConstraints,
    };
}

test("production embedding cache tracks only uncached invocations/items, preserves identity/roles and shares chat budget", async (t) => {
    const setup = await embeddingSetup({ maxCalls: 2 });
    const cache = setup.kp.createEmbeddingCache(
        setup.tracked.wrap(setup.model),
        64,
    );
    await cache.generateEmbedding("public input");
    await cache.generateEmbedding("public input");
    assert.equal(setup.tracked.calls.length, 1);
    assert.equal(setup.tracked.calls[0].items, 1);
    assert.equal(setup.tracked.calls[0].dimensions, 1536);
    assert.equal(setup.tracked.calls[0].outputSha256.length, 64);
    assert.equal(cache.embeddingIdentity.provider, "copilot");
    assert.equal(cache.forRole("query").embeddingIdentity.task, "query");
    const chat = new ModelTracker({
        model: {
            completionSettings: {},
            complete: async () => ({ success: true, data: "{}" }),
        },
        identity: "controlled",
        maxCalls: 2,
        callBudget: setup.budget,
        signal: setup.controller.signal,
        checkConstraints: setup.checkSerializedRequestConstraints,
    });
    await chat.complete("answer", "public question");
    assert.equal(setup.budget.used, 2);
    await assert.rejects(
        cache.generateEmbedding("new public input"),
        /max-model-calls/,
    );
    assert.throws(() => setup.tracked.assertHealthy(), /no-lexical-fallback/);
    assert.ok(!JSON.stringify(setup.saved).includes("public input"));
});

test("embedding fetch scope captures only safe model/usage metadata and applies cancellation without remote calls", async (t) => {
    const originalFetch = globalThis.fetch;
    let receivedSignal;
    const vector = [1, ...Array(1535).fill(0)];
    globalThis.fetch = async (_input, init) => {
        receivedSignal = init.signal;
        return new Response(
            JSON.stringify({
                model: "text-embedding-3-small",
                usage: {
                    prompt_tokens: 4,
                    total_tokens: 4,
                    secret: "never-retain",
                },
                data: [{ index: 0, embedding: vector }],
                privateField: "never-retain",
            }),
            { headers: { "Content-Type": "application/json" } },
        );
    };
    t.after(() => {
        globalThis.fetch = originalFetch;
    });
    const setup = await embeddingSetup({
        inner: {
            maxBatchSize: 64,
            generateEmbedding: async (input) => {
                const response = await fetch(
                    "https://controlled.invalid/not-a-real-call",
                    {
                        method: "POST",
                        body: JSON.stringify({
                            model: "text-embedding-3-small",
                            input: [input],
                        }),
                    },
                );
                return {
                    success: true,
                    data: (await response.json()).data[0].embedding,
                };
            },
        },
    });
    const restore = setup.tracked.installFetchScope();
    try {
        await setup.tracked
            .wrap(setup.model)
            .generateEmbedding("Public controlled text.");
    } finally {
        restore();
    }
    assert.ok(receivedSignal instanceof AbortSignal);
    assert.equal(setup.tracked.calls[0].transportAttempts, 1);
    assert.equal(
        setup.tracked.calls[0].returnedModel,
        "text-embedding-3-small",
    );
    assert.equal(setup.tracked.calls[0].usageAvailability, "provider-returned");
    assert.deepEqual(setup.tracked.calls[0].usage, {
        prompt_tokens: 4,
        total_tokens: 4,
    });
    assert.ok(!JSON.stringify(setup.saved).includes("never-retain"));
    assert.ok(!JSON.stringify(setup.saved).includes("controlled.invalid"));
});

test("embedding failures, schema errors, admission budgets and timeouts never silently fall back", async () => {
    const auth = await embeddingSetup({
        inner: {
            maxBatchSize: 64,
            generateEmbedding: async () => {
                throw new Error(
                    "401 auth secret-token https://private-endpoint",
                );
            },
        },
    });
    await assert.rejects(
        auth.tracked.wrap(auth.model).generateEmbedding("public"),
        /embedding-provider-completion-failed/,
    );
    assert.equal(auth.tracked.calls[0].failure.category, "auth");
    assert.ok(!JSON.stringify(auth.saved).includes("secret-token"));
    assert.throws(() => auth.tracked.assertHealthy(), /no-lexical-fallback/);
    const bounded = await embeddingSetup();
    await assert.rejects(
        bounded.tracked
            .wrap(bounded.model)
            .generateEmbedding(" a".repeat(8193)),
        /embedding-model-item-token-limit/,
    );
    assert.equal(bounded.budget.used, 0);
    assert.throws(() => bounded.tracked.assertHealthy(), /no-lexical-fallback/);
    assert.throws(
        () =>
            bounded.tracked.wrap({
                ...bounded.model,
                embeddingIdentity: {
                    ...bounded.model.embeddingIdentity,
                    provider: "azure",
                },
            }),
        /no-fallback/,
    );
    const timeout = await embeddingSetup({
        perCallMs: 10,
        inner: {
            maxBatchSize: 64,
            generateEmbedding: async () => new Promise(() => {}),
        },
    });
    await assert.rejects(
        timeout.tracked.wrap(timeout.model).generateEmbedding("public"),
        /model-timeout/,
    );
    assert.equal(timeout.tracked.calls[0].failure.category, "timeout");
});

test("cl100k embedding admission counts actual tokens including literal special-token-looking public text", async () => {
    const tokenizer = embeddingTokenizer();
    assert.equal(tokenizer.name, "cl100k_base");
    assert.equal(tokenizer.countTokens(" a".repeat(8192)), 8192);
    assert.equal(tokenizer.countTokens(" a".repeat(8193)), 8193);
    assert.equal(tokenizer.countTokens("<|endoftext|>"), 7);
    const setup = await embeddingSetup();
    const model = setup.tracked.wrap(setup.model);
    const longBytes = "x".repeat(16_000);
    assert.ok(Buffer.byteLength(longBytes) > 8192);
    assert.ok(tokenizer.countTokens(longBytes) < 8192);
    await model.generateEmbedding(longBytes);
    await model.generateEmbedding(" a".repeat(8192));
    await model.generateEmbedding("<|endoftext|>");
    assert.deepEqual(
        setup.tracked.calls.map((call) => call.inputTokens),
        [tokenizer.countTokens(longBytes), 8192, 7],
    );
    assert.equal(setup.budget.used, 3);
    assert.equal(
        setup.tracked.calls[0].tokenizer.specialTokens,
        "literal text",
    );
    await assert.rejects(
        model.generateEmbedding(" a".repeat(8193)),
        /item-token-limit-exceeded-no-truncation/,
    );
    assert.equal(setup.budget.used, 3);
});

test("embedding aggregate admission splits actual-token and item bounds without text loss, role/identity changes or undercounting", async () => {
    const tokenizer = embeddingTokenizer();
    const inputs = Array.from(
        { length: 64 },
        (_, i) => ` ${i}` + " a".repeat(8190),
    );
    const observed = [];
    const vector = [1, ...Array(1535).fill(0)];
    const setup = await embeddingSetup({
        inner: {
            maxBatchSize: 64,
            generateEmbeddingBatch: async (texts) => {
                observed.push([...texts]);
                return { success: true, data: texts.map(() => vector) };
            },
        },
    });
    const model = setup.tracked.wrap(setup.model).forRole("query");
    const result = await model.generateEmbeddingBatch(inputs);
    assert.equal(result.data.length, inputs.length);
    assert.equal(observed.length, 2);
    assert.deepEqual(observed.flat(), inputs);
    assert.equal(setup.budget.used, 2);
    for (const [i, call] of setup.tracked.calls.entries()) {
        assert.equal(call.identity.task, "query");
        assert.deepEqual(call.identity, model.embeddingIdentity);
        assert.equal(
            call.inputTokens,
            observed[i].reduce(
                (sum, text) => sum + tokenizer.countTokens(text),
                0,
            ),
        );
        assert.ok(call.inputTokens <= 300_000);
        assert.ok(call.itemTokens.every((count) => count <= 8192));
        assert.equal(call.globalOrdinal, i + 1);
    }
    assert.deepEqual(
        embeddingBatches(["one", "two", "three"], 2, tokenizer).map(
            (part) => part.inputs,
        ),
        [["one", "two"], ["three"]],
    );
    const limited = await embeddingSetup({ maxCalls: 1 });
    await assert.rejects(
        limited.tracked.wrap(limited.model).generateEmbeddingBatch(inputs),
        /max-model-calls/,
    );
    assert.equal(limited.budget.used, 1);
    assert.equal(limited.tracked.calls.length, 1);
    assert.throws(() => limited.tracked.assertHealthy(), /no-lexical-fallback/);
    const cancelled = await embeddingSetup({
        inner: {
            maxBatchSize: 64,
            generateEmbeddingBatch: async (texts) => {
                cancelled.controller.abort(
                    new QualificationError("cancelled", "test-cancelled"),
                );
                return { success: true, data: texts.map(() => vector) };
            },
        },
    });
    await assert.rejects(
        cancelled.tracked.wrap(cancelled.model).generateEmbeddingBatch(inputs),
        /test-cancelled/,
    );
    assert.equal(cancelled.budget.used, 1);
    assert.equal(cancelled.tracked.calls.length, 1);
    assert.throws(
        () =>
            embeddingBatches(["public"], 64, {
                ...tokenizer,
                name: "o200k_base",
            }),
        /tokenizer-unavailable-no-fallback/,
    );
});

test("global cancellation reaches the scoped embedding transport and is retained without provider secrets", async (t) => {
    const originalFetch = globalThis.fetch;
    let entered;
    const started = new Promise((resolve) => {
        entered = resolve;
    });
    let transportAborted = false;
    globalThis.fetch = async (_input, init) =>
        new Promise((_, reject) => {
            init.signal.addEventListener(
                "abort",
                () => {
                    transportAborted = true;
                    reject(init.signal.reason);
                },
                { once: true },
            );
            entered();
        });
    t.after(() => {
        globalThis.fetch = originalFetch;
    });
    const setup = await embeddingSetup({
        inner: {
            maxBatchSize: 64,
            generateEmbedding: async (input) => {
                await fetch("https://controlled.invalid/not-a-real-call", {
                    method: "POST",
                    body: JSON.stringify({
                        model: "text-embedding-3-small",
                        input: [input],
                    }),
                });
                throw new Error("must not finish");
            },
        },
    });
    const restore = setup.tracked.installFetchScope();
    try {
        const pending = setup.tracked
            .wrap(setup.model)
            .generateEmbedding("Public cancellation fixture.");
        await started;
        setup.controller.abort(
            new QualificationError(
                "cancelled",
                "controlled-global-embedding-cancel",
            ),
        );
        await assert.rejects(pending, /controlled-global-embedding-cancel/);
        assert.equal(transportAborted, true);
        assert.equal(setup.tracked.calls[0].failure.category, "cancelled");
        assert.ok(!JSON.stringify(setup.saved).includes("controlled.invalid"));
    } finally {
        restore();
    }
});

test("all production DocMemory embedding lanes use the tracked cache with no retry/fallback lane", async () => {
    const setup = await embeddingSetup();
    const settings = {
        queryTranslator: { controlled: true },
        conversationSettings: {
            relatedTermIndexSettings: { embeddingIndexSettings: {} },
            messageTextIndexSettings: { embeddingIndexSettings: {} },
            threadSettings: {},
            semanticRefIndexSettings: {
                knowledgeExtractor: { controlled: true },
            },
        },
    };
    const extractor =
        settings.conversationSettings.semanticRefIndexSettings
            .knowledgeExtractor;
    const wired = wireEmbeddingSettings(
        settings,
        setup.tracked.wrap(setup.model),
        setup.kp.createEmbeddingCache,
    );
    const lanes = [
        wired.conversationSettings.relatedTermIndexSettings
            .embeddingIndexSettings,
        wired.conversationSettings.messageTextIndexSettings
            .embeddingIndexSettings,
        wired.conversationSettings.threadSettings,
    ];
    for (const lane of lanes) {
        assert.equal(lane.embeddingModel, wired.embeddingModel);
        assert.equal(lane.embeddingSize, 1536);
        assert.equal(lane.retryMaxAttempts, 0);
    }
    assert.equal(
        wired.conversationSettings.semanticRefIndexSettings.knowledgeExtractor,
        extractor,
    );
    await wired.embeddingModel.generateEmbeddingBatch([
        "first public item",
        "second public item",
    ]);
    assert.equal(setup.tracked.calls[0].items, 2);
});

test("fixture validates input hash, provenance, license, schema, gold IDs and contained paths", async (t) => {
    const f = await fixture(t);
    const [loaded] = await loadFixtures(f.fixtures);
    assert.equal(loaded.events.length, 2);
    assert.equal(loaded.gold.questions[0].questionId, "benchmark-original-id");
    const mutations = [
        (entry) => {
            entry.sha256 = "0".repeat(64);
        },
        (entry) => {
            entry.provenance.public = false;
        },
        (entry) => {
            entry.provenance.license = "NOASSERTION";
        },
        (entry) => {
            entry.provenance.license = "";
        },
        (entry) => {
            entry.provenance.sourceUrl = "https://127.0.0.1/private";
        },
        (entry) => {
            entry.provenance.sourceUrl = "https://172.16.0.1/private";
        },
        (entry) => {
            entry.provenance.sourceUrl = "https://user:password@example.org";
        },
        (entry) => {
            entry.input = "..\\private.jsonl";
        },
        (entry) => {
            entry.importType = "copilot-session-jsonl";
        },
    ];
    for (const mutation of mutations) {
        const changed = structuredClone(f.manifest);
        mutation(changed.cases[0]);
        await json(path.join(f.fixtures, "manifest.json"), changed);
        await assert.rejects(loadFixtures(f.fixtures));
    }
    await json(path.join(f.fixtures, "manifest.json"), f.manifest);
    await assert.rejects(loadFixtures(f.fixtures, ["missing"]));
    const badGold = structuredClone(f.gold);
    badGold.questions[0].evidenceEventIds = ["fabricated"];
    await json(path.join(f.fixtures, "gold", "case.json"), badGold);
    await assert.rejects(loadFixtures(f.fixtures));
});

test("chunks obey bytes AND record limits without losing final non-newline Unicode record", () => {
    const lines = Array.from({ length: 251 }, (_, id) =>
        JSON.stringify({ id, text: "🧠".repeat(id % 7 ? 300 : 3000) }),
    );
    const chunks = chunkJsonl(lines.join("\r\n"));
    assert.ok(chunks.length > 3);
    assert.equal(
        chunks.reduce((n, chunk) => n + chunk.records, 0),
        lines.length,
    );
    assert.deepEqual(
        chunks.flatMap((chunk) => chunk.jsonl.trimEnd().split("\n")),
        lines,
    );
    for (const chunk of chunks) {
        assert.ok(Buffer.byteLength(chunk.jsonl) <= limits.chunkBytes);
        assert.ok(chunk.records <= limits.chunkRecords);
    }
    assert.equal(
        chunkJsonl(Array.from({ length: 201 }, () => "{}").join("\n")).length,
        3,
    );
    assert.throws(() => chunkJsonl("x".repeat(limits.chunkBytes)));
    assert.throws(() => chunkJsonl("{}\n\n{}"));
});

test("optional exact-byte gold hash is verified before runtime/QA and tampering fails without memory access", async (t) => {
    const f = await fixture(t);
    const file = path.join(f.fixtures, "gold", "case.json");
    const bytes = await readFile(file);
    const expected = sha256(bytes);
    f.manifest.cases[0].goldSha256 = expected.toUpperCase();
    f.manifest.cases[0].artifact = {
        rowSha256: "a".repeat(64),
        responseRevision: "public-revision",
    };
    await json(path.join(f.fixtures, "manifest.json"), f.manifest);
    const [loaded] = await loadFixtures(f.fixtures);
    assert.equal(loaded.goldSha256, expected);
    assert.deepEqual(loaded.goldBytes, bytes);
    assert.deepEqual(loaded.entry.artifact, f.manifest.cases[0].artifact);
    await writeFile(file, Buffer.concat([bytes, Buffer.from("\n")]));
    let opened = false;
    const receipt = await evaluate(options(f), {
        createRuntime: async () => {
            opened = true;
            throw new Error("must not open memory");
        },
    });
    assert.equal(opened, false);
    assert.equal(receipt.state, "failed");
    assert.deepEqual(receipt.failure, {
        category: "schema",
        code: "gold-sha256-mismatch",
    });
});

test("import and answer inputs never contain evaluator gold; final chunk is explicit and empty", async (t) => {
    const f = await fixture(t);
    const [loaded] = await loadFixtures(f.fixtures);
    const requests = importRequests(loaded, "corpus");
    assert.equal(requests.at(-1).jsonl, "");
    assert.equal(requests.at(-1).expectedCursor, 2);
    assert.equal(requests.at(-1).final, true);
    assert.ok(!JSON.stringify(requests).includes("GOLD-SECRET"));
    const prompt = answerPrompt(loaded.gold.questions[0].question, [
        { eventId: "last", text: "untrusted text" },
    ]);
    assert.ok(!prompt.includes("GOLD-SECRET"));
    assert.ok(prompt.includes("untrusted evidence"));
    assert.ok(
        judgePrompt(loaded.gold.questions[0], {
            answer: "candidate",
            evidenceEventIds: [],
        }).includes("GOLD-SECRET-ANSWER"),
    );
    assert.ok(
        !judgePrompt(loaded.gold.questions[0], {
            answer: "candidate",
        }).includes("GOLD-SECRET-TERM"),
    );
});

test("exact citation resolver handles UTF-16 offsets and rejects fabricated IDs, spans and excerpts", () => {
    const text = "café 🧠\nexact tail";
    const content = "header\n" + text + "\n";
    const evidence = {
        eventId: "e",
        sourceId: "s",
        revisionId: "r",
        locator: `chars:7-${7 + text.length}`,
        excerpt: text,
    };
    const events = new Map([["e", { text }]]);
    assert.equal(resolveCitation(evidence, content, events).excerpt, text);
    for (const change of [
        { eventId: "fake" },
        { excerpt: "invented" },
        { locator: "chars:8-100000" },
        { locator: "chars:7-8" },
        { locator: "message:1" },
    ])
        assert.throws(() =>
            resolveCitation({ ...evidence, ...change }, content, events),
        );
});

test("KnowPro message whitespace reflow maps to exact source offsets while QA retains original Unicode event text", () => {
    const text =
        "A café 🧠 station, giving you more\n\nflexibility when filling up.";
    const header = '{"id":"event-original"}\n';
    const content = header + text;
    const source = { sourceId: "s", revisionId: "r", content };
    const episode = {
        text: content,
        spans: [{ eventId: "e", start: header.length, end: content.length }],
    };
    const events = new Map([["e", { text }]]);
    const match = {
        sourceId: "s",
        revisionId: "r",
        locator: "message:0",
        snippet:
            '{"id":"event-original"} A café 🧠 station , giving you more flexibility when filling up .',
    };
    const resolved = resolveRawSearchMatch(match, source, episode, events);
    assert.equal(
        resolved.check.representation,
        "knowpro-whitespace-layout; not-verbatim-source",
    );
    assert.equal(resolved.check.verified, null);
    assert.equal(
        resolved.check.sourceAlignment.locator,
        `chars:0-${content.length}`,
    );
    assert.equal(resolved.check.sourceAlignment.exactOriginalExcerpt, content);
    assert.deepEqual(resolved.check.originalEventSpans, ratio(1, 1));
    assert.deepEqual(resolved.evidence.events, [
        {
            eventId: "e",
            text,
            locator: `chars:${header.length}-${content.length}`,
        },
    ]);
    const exact = resolveRawSearchMatch(
        {
            ...match,
            locator: `chars:${header.length}-${content.length}`,
            snippet: text,
        },
        source,
        episode,
        events,
    );
    assert.equal(exact.check.verified, true);
    assert.deepEqual(
        harnessCapacityBlock().configuredConstraints,
        limits.constraints,
    );
    assert.equal(
        harnessCapacityBlock().capacityScope,
        "harness-configured-budget",
    );
    assert.equal(
        harnessCapacityBlock().providerContextCapacity,
        "not-assessed",
    );
});

test("raw search alignment still rejects lexical corruption, wrappers, bad offsets, stale/fabricated identities and ambiguity", () => {
    const text = "Exact original evidence 🧠.";
    const source = { sourceId: "s", revisionId: "r", content: text };
    const episode = {
        text,
        spans: [{ eventId: "e", start: 0, end: text.length }],
    };
    const events = new Map([["e", { text }]]);
    const match = {
        sourceId: "s",
        revisionId: "r",
        locator: "message:0",
        snippet: text,
    };
    for (const change of [
        { snippet: "Exact fabricated evidence 🧠." },
        { snippet: "WRAPPER " + text },
        { locator: "unknown:0" },
        { locator: "chars:0-3" },
        {
            locator: `chars:0-${text.length}`,
            snippet: "Exact  original evidence 🧠.",
        },
        { sourceId: "fake" },
        { revisionId: "stale" },
        { snippet: " " },
    ])
        assert.throws(() =>
            resolveRawSearchMatch(
                { ...match, ...change },
                source,
                episode,
                events,
            ),
        );
    assert.throws(() =>
        resolveRawSearchMatch(
            match,
            source,
            { ...episode, text: "different" },
            events,
        ),
    );
    assert.throws(() =>
        resolveRawSearchMatch(
            match,
            source,
            episode,
            new Map([["e", { text: "altered event" }]]),
        ),
    );
    assert.throws(
        () =>
            resolveRawSearchMatch(
                { ...match, snippet: "Exact original" },
                { ...source, content: text + "\n" + text },
                { text: text + "\n" + text, spans: [] },
                events,
            ),
        /ambiguous/,
    );
});

test("artifact support prompt contains only IDs, bodies, and original evidence, never gold or other model assertions", () => {
    const prompt = artifactSupportPrompt([
        {
            memoryId: "memory-a",
            body: "Retained body",
            evidence: [{ eventId: "original", excerpt: "Original evidence." }],
            title: "Not supplied title",
            scope: { repository: "Not supplied scope" },
            gold: "GOLD-SECRET",
        },
    ]);
    const supplied = JSON.parse(prompt.split("\n").at(-1));
    assert.deepEqual(Object.keys(supplied.memories[0]), [
        "memoryId",
        "body",
        "originalEvidence",
    ]);
    assert.ok(!prompt.includes("GOLD-SECRET"));
    assert.ok(!prompt.includes("Not supplied"));
    assert.ok(
        prompt.includes("NOT independently established atomic-claim precision"),
    );
});

test("metric denominators are actual counts, and missing evidence is not vacuous 100 percent", () => {
    assert.deepEqual(ratio(0, 0), { numerator: 0, denominator: 0, rate: null });
    const score = scoreAnswer(
        {
            answer: "One real term",
            evidenceEventIds: ["one", "fake", "outside"],
        },
        {
            requiredTerms: ["real", "missing"],
            evidenceEventIds: ["one", "two"],
        },
        new Set(["one"]),
        new Set(["one", "two", "outside"]),
    );
    assert.deepEqual(score.requiredTerms, ratio(1, 2));
    assert.deepEqual(score.suppliedEvidenceSupport, ratio(1, 3));
    assert.deepEqual(score.originalEventValidity, ratio(2, 3));
    assert.deepEqual(score.goldEvidenceRecall, ratio(1, 2));
    assert.deepEqual(score.fabricatedEventIds, ["fake"]);
    assert.deepEqual(score.unsupportedEventIds, ["fake", "outside"]);
});

test("official-compatible prediction JSONL preserves original question IDs and omits capacity-blocked answers", async (t) => {
    const f = await fixture(t);
    const files = await writePredictions(f.root, "synthetic", [
        {
            questionId: "original-benchmark-id",
            arms: [
                {
                    arm: "no-memory",
                    state: "complete",
                    answer: { answer: "A real retained answer." },
                },
                { arm: "full-context", state: "capacity-blocked" },
            ],
        },
    ]);
    assert.equal(files.length, 4);
    assert.deepEqual(
        JSON.parse(
            await readFile(
                path.join(f.root, "predictions.synthetic.no-memory.jsonl"),
                "utf8",
            ),
        ),
        {
            question_id: "original-benchmark-id",
            hypothesis: "A real retained answer.",
        },
    );
    assert.equal(
        await readFile(
            path.join(f.root, "predictions.synthetic.full-context.jsonl"),
            "utf8",
        ),
        "",
    );
});

async function tracker(t, model, overrides = {}) {
    const { checkSerializedRequestConstraints } = await import(
        pathToFileURL(
            path.join(
                tsRoot,
                "packages",
                "aiclient",
                "dist",
                "requestConstraints.js",
            ),
        ).href
    );
    const controller = new AbortController();
    const saved = [];
    const tracked = new ModelTracker({
        model,
        identity: "controlled-no-network",
        maxCalls: 2,
        signal: controller.signal,
        checkConstraints: checkSerializedRequestConstraints,
        persist: async (calls) => saved.push(structuredClone(calls)),
        ...overrides,
    });
    return { tracked, controller, saved };
}

test("all completion roles are tracked, bounded, hashed and usage-whitelisted", async (t) => {
    let count = 0;
    const model = {
        completionSettings: {},
        complete: async (_prompt, usage) => {
            count++;
            usage({
                prompt_tokens: 5,
                completion_tokens: 2,
                total_tokens: 7,
                secret: "never-retain",
            });
            return {
                success: true,
                data: '{"answer":"ok","evidenceEventIds":[]}',
            };
        },
    };
    const { tracked, saved } = await tracker(t, model);
    await tracked
        .forRole("knowpro-extraction-or-query")
        .complete("safe public input");
    await tracked.complete("answer", "question");
    await assert.rejects(
        tracked.complete("judge", "judge input"),
        /max-model-calls/,
    );
    assert.equal(count, 2);
    assert.equal(saved.length, 2);
    assert.equal(tracked.calls[0].inputSha256, sha256("safe public input"));
    assert.equal(tracked.calls[0].usage.total_tokens, 7);
    assert.ok(!JSON.stringify(tracked.calls).includes("never-retain"));
    assert.ok(!tracked.fits("x".repeat(49_000)));
    await assert.rejects(
        tracked.complete("distillation", "x".repeat(49_000)),
        /no-truncation/,
    );
    assert.equal(count, 2);
});

test("per-model timeout and caller/global cancellation abort even an ignoring injected model", async (t) => {
    const model = {
        completionSettings: {},
        complete: async () => new Promise(() => {}),
    };
    const first = await tracker(t, model, { perCallMs: 15 });
    await assert.rejects(
        first.tracked.complete("distillation", "small"),
        /model-timeout/,
    );
    assert.equal(first.tracked.calls[0].failure.category, "timeout");
    const second = await tracker(t, model);
    const global = second.tracked.complete("answer", "small");
    second.controller.abort(
        new QualificationError("cancelled", "controlled-global-cancel"),
    );
    await assert.rejects(global, /controlled-global-cancel/);
    const third = await tracker(t, model);
    const caller = new AbortController();
    const pending = third.tracked
        .forRole("knowpro")
        .complete("small", undefined, undefined, undefined, caller.signal);
    caller.abort(
        new QualificationError("cancelled", "controlled-caller-cancel"),
    );
    await assert.rejects(pending, /controlled-caller-cancel/);
    assert.equal(third.tracked.calls[0].failure.category, "cancelled");
});

test("safe failure classification never exposes raw authentication material", async (t) => {
    const f = await fixture(t);
    const receipt = await evaluate(options(f), {
        createRuntime: async () => {
            throw new Error(
                "401 authentication failed: secret-token https://private-provider.example",
            );
        },
    });
    assert.equal(receipt.state, "failed");
    assert.equal(receipt.failure.category, "auth");
    const retained = await readFile(
        path.join(f.root, "run", "receipt.json"),
        "utf8",
    );
    assert.ok(!retained.includes("secret-token"));
    assert.ok(!retained.includes("private-provider"));
    assert.deepEqual(safeFailure(new Error("schema JSON invalid")), {
        category: "schema",
        code: "operation-failed",
    });
});

test("global runner deadline persists a failed receipt for an unresponsive controlled runtime", async (t) => {
    const f = await fixture(t);
    const receipt = await evaluate(options(f, { timeoutMs: 15 }), {
        createRuntime: async () => new Promise(() => {}),
    });
    assert.equal(receipt.state, "failed");
    assert.deepEqual(receipt.failure, {
        category: "timeout",
        code: "global-timeout",
    });
    assert.deepEqual(
        JSON.parse(await readFile(path.join(f.root, "run", "receipt.json")))
            .failure,
        receipt.failure,
    );
});

test("CLI preserves the stored and returned global deadline failure when final disk accounting also fails", async (t) => {
    const f = await fixture(t);
    const stdout = [],
        stderr = [];
    const cli = await runCli(
        [
            "--fixture-root",
            f.fixtures,
            "--run-directory",
            path.join(f.root, "run"),
            "--timeout-ms",
            "15",
        ],
        {
            stdout: (text) => stdout.push(JSON.parse(text)),
            stderr: (text) => stderr.push(text),
            evaluateRun: (settings) =>
                evaluate(settings, {
                    createRuntime: async () => new Promise(() => {}),
                    diskBytes: async () => {
                        throw new Error("ENOENT: stat disappearing.json");
                    },
                }),
        },
    );
    const stored = JSON.parse(
        await readFile(path.join(f.root, "run", "receipt.json")),
    );
    const failure = { category: "timeout", code: "global-timeout" };
    assert.equal(cli.exitCode, 1);
    assert.equal(cli.result.state, "failed");
    assert.deepEqual(cli.result.failure, failure);
    assert.deepEqual(stored.failure, failure);
    assert.deepEqual(stdout[0].failure, failure);
    assert.deepEqual(stderr, []);
    assert.equal(stored.diskBytes, null);
    assert.deepEqual(stored.diskBytesFailure, {
        category: "schema",
        code: "operation-failed",
    });
    assert.ok(!JSON.stringify(stored).includes("disappearing.json"));
});

test("offline production-owner integration: exact import, replay/restart, nonvacuous citations and forget tombstone", async (t) => {
    const f = await fixture(t);
    const receipt = await evaluate(options(f));
    assert.equal(receipt.state, "complete", JSON.stringify(receipt));
    assert.equal(receipt.counters.modelCalls, 0);
    assert.ok(receipt.counters.extractions > 0);
    assert.equal(receipt.cases[0].receipt.cursor, 2);
    assert.equal(receipt.cases[0].chunks.at(-1).bytes, 0);
    assert.deepEqual(receipt.cases[0].sourceSpans, ratio(2, 2));
    assert.deepEqual(receipt.cases[0].memoryCitationValidity, ratio(0, 0));
    assert.equal(receipt.cases[0].scopeFiltering.state, "not-applicable");
    assert.deepEqual(receipt.cases[0].replay.callDeltas, {
        extractions: 0,
        modelCalls: 0,
        indexWrites: 0,
    });
    assert.deepEqual(receipt.cases[0].restart.callDeltas, {
        extractions: 0,
        modelCalls: 0,
        indexWrites: 0,
    });
    assert.equal(receipt.cases[0].forget.invalidated, true);
    assert.equal(receipt.cases[0].questions.length, 0);
    assert.ok(receipt.peakObservedRssBytes > 0);
    assert.ok(receipt.diskBytes > 0);
    assert.ok(
        (await readdir(path.join(f.root, "run", "synthetic-case"))).includes(
            "artifacts.json",
        ),
    );
    await assert.rejects(evaluate(options(f)), /EEXIST/);
});

async function recoveryFixture(t, failureStage = "index") {
    const f = await fixture(
        t,
        Array.from({ length: 205 }, (_, i) => ({
            schemaVersion: 1,
            id: `event-${i}`,
            sessionId: "session-1",
            taskId: i % 100 < 80 ? "task-a" : "task-b",
            kind: "objective",
            text: `Synthetic public recovery fixture record ${i}.`,
        })),
    );
    await json(path.join(f.fixtures, "gold", "case.json"), { questions: [] });
    const [{ FileMemoryService }, parser] = await Promise.all([
        import(
            pathToFileURL(
                path.join(
                    tsRoot,
                    "packages",
                    "memory",
                    "service",
                    "dist",
                    "fileMemoryService.js",
                ),
            ).href
        ),
        import(
            pathToFileURL(
                path.join(
                    tsRoot,
                    "packages",
                    "memory",
                    "service",
                    "dist",
                    "agentSessionParsing.js",
                ),
            ).href
        ),
    ]);
    const admissions = [];
    const runtime = (fail) => async (settings, signal, counters) => ({
        parser,
        stop: async () => {},
        open: () => {
            const service = new FileMemoryService(
                path.join(settings.runDirectory, "state"),
                {
                    agentSessionImports: true,
                    sourceSynopses: false,
                    informationalViews: false,
                    viewDrafts: false,
                    indexFactory: (_id, folder) => {
                        const index = new OfflineSubstringIndex(
                            folder,
                            counters,
                        );
                        const rebuild = index.rebuild.bind(index);
                        index.rebuild = async (documents) => {
                            if (
                                fail &&
                                failureStage === "index" &&
                                documents.length >= 3
                            ) {
                                counters.indexWrites++;
                                throw new Error(
                                    "controlled embedding admission failure",
                                );
                            }
                            await rebuild(documents);
                        };
                        return index;
                    },
                    agentSessionDistillationModel: {
                        identity: "offline-controlled-empty-memory-extraction",
                        fits: () => true,
                        complete: async (_prompt, received) => {
                            assert.equal(signal.aborted, false);
                            assert.equal(received.aborted, false);
                            counters.extractions++;
                            if (
                                fail &&
                                failureStage === "deadline" &&
                                counters.extractions === 4
                            )
                                await new Promise((_, reject) => {
                                    received.addEventListener(
                                        "abort",
                                        () => reject(received.reason),
                                        { once: true },
                                    );
                                });
                            if (
                                fail &&
                                failureStage === "extraction" &&
                                counters.extractions === 4
                            )
                                throw new Error(
                                    "controlled extraction failure",
                                );
                            return '{"memories":[]}';
                        },
                    },
                },
            );
            const admit = service.importAgentSession.bind(service);
            service.importAgentSession = async (request) => {
                const receipt = await admit(request);
                admissions.push({
                    directory: settings.runDirectory,
                    key: request.idempotencyKey,
                    expectedCursor: request.expectedCursor,
                    state: receipt.state,
                    cursor: receipt.cursor,
                });
                return receipt;
            };
            return service;
        },
    });
    const failed = await evaluate(
        options(f, {
            maxQuestions: 0,
            ...(failureStage === "deadline" ? { timeoutMs: 3000 } : {}),
        }),
        {
            createRuntime: runtime(true),
        },
    );
    assert.equal(failed.state, "failed", JSON.stringify(failed));
    if (failureStage === "deadline") {
        assert.deepEqual(failed.failure, {
            category: "timeout",
            code: "global-timeout",
        });
        const file = path.join(
            f.root,
            "run",
            "state",
            failed.cases[0].corpusId,
            "agent-sessions",
            sha256(JSON.stringify("session-1")),
            "session.json",
        );
        let stored;
        for (let i = 0; i < 100; i++) {
            stored = JSON.parse(await readFile(file));
            if (stored.receipt.state === "cancelled") break;
            await new Promise((resolve) => setTimeout(resolve, 10));
        }
        assert.equal(stored.receipt.state, "cancelled");
        assert.equal(stored.receipt.cursor, 100);
    } else {
        assert.ok(failed.failedImportReceipt, JSON.stringify(failed));
        assert.equal(failed.failedImportReceipt.cursor, 100);
    }
    return { f, failed, runtime, admissions };
}

test("real production-owner recovery copies failed state, accepts advanced FAILED historical receipts and retries pending before unsubmitted chunks", async (t) => {
    for (const failureStage of ["index", "extraction"]) {
        await t.test(failureStage, async (t) => {
            const { f, failed, runtime, admissions } = await recoveryFixture(
                t,
                failureStage,
            );
            const source = path.join(f.root, "run");
            const before = await stateInventory(source);
            const recovered = await evaluate(
                options(f, {
                    runDirectory: path.join(f.root, "recovery"),
                    resumeFrom: source,
                    maxQuestions: 0,
                }),
                { createRuntime: runtime(false) },
            );
            assert.equal(
                recovered.state,
                "complete",
                JSON.stringify(recovered),
            );
            assert.equal(recovered.cases[0].corpusId, failed.cases[0].corpusId);
            assert.equal(recovered.cases[0].receipt.cursor, 205);
            assert.equal(recovered.resume.committedCursor, 100);
            assert.equal(recovered.resume.originalStateUnchanged, true);
            assert.equal(recovered.resume.sourceState, "failed");
            assert.deepEqual(await stateInventory(source), before);
            assert.deepEqual(
                admissions
                    .filter((item) => item.directory.endsWith("recovery"))
                    .slice(0, 4)
                    .map(({ key, expectedCursor, state, cursor }) => ({
                        key,
                        expectedCursor,
                        state,
                        cursor,
                    })),
                [
                    {
                        key: "qualification-0",
                        expectedCursor: 0,
                        state: "failed",
                        cursor: 100,
                    },
                    {
                        key: "qualification-1",
                        expectedCursor: 100,
                        state: "running",
                        cursor: 100,
                    },
                    {
                        key: "qualification-2",
                        expectedCursor: 200,
                        state: "running",
                        cursor: 200,
                    },
                    {
                        key: "qualification-final",
                        expectedCursor: 205,
                        state: "running",
                        cursor: 205,
                    },
                ],
            );
            assert.equal(
                recovered.counters.extractions,
                failureStage === "index" ? 3 : 2,
            );
            assert.equal(
                recovered.counters.indexWrites,
                failureStage === "index" ? 3 : 2,
                "includes one final source-forget index rebuild",
            );
            assert.equal(
                recovered.cumulativeCounters.extractions,
                failed.counters.extractions + recovered.counters.extractions,
            );
            assert.equal(
                recovered.cumulativeCounters.indexWrites,
                failed.counters.indexWrites + recovered.counters.indexWrites,
            );
            assert.ok(recovered.cumulativeElapsedMs >= failed.elapsedMs);
            assert.ok(
                Object.values(recovered.cases[0].replay.callDeltas).every(
                    (n) => n === 0,
                ),
            );
            assert.ok(
                Object.values(recovered.cases[0].restart.callDeltas).every(
                    (n) => n === 0,
                ),
            );
            assert.equal(recovered.cases[0].forget.invalidated, true);
        });
    }
});

test("real production-owner deadline cancellation recovers only a matching timed-out checkpoint, without changing the source", async (t) => {
    const { f, failed, runtime, admissions } = await recoveryFixture(
        t,
        "deadline",
    );
    const source = path.join(f.root, "run");
    const before = await stateInventory(source);
    const recovered = await evaluate(
        options(f, {
            runDirectory: path.join(f.root, "deadline-recovery"),
            resumeFrom: source,
            maxQuestions: 0,
        }),
        { createRuntime: runtime(false) },
    );
    assert.equal(recovered.state, "complete", JSON.stringify(recovered));
    assert.equal(recovered.resume.deadlineCancellation, true);
    assert.equal(recovered.resume.originalStateUnchanged, true);
    assert.deepEqual(await stateInventory(source), before);
    assert.equal(recovered.cases[0].corpusId, failed.cases[0].corpusId);
    assert.equal(recovered.cases[0].receipt.cursor, 205);
    assert.equal(recovered.counters.extractions, 2);
    assert.equal(recovered.counters.indexWrites, 2);
    assert.deepEqual(
        admissions
            .filter((entry) => entry.directory.endsWith("deadline-recovery"))
            .slice(0, 3)
            .map(({ expectedCursor, state, cursor }) => ({
                expectedCursor,
                state,
                cursor,
            })),
        [
            { expectedCursor: 0, state: "cancelled", cursor: 100 },
            { expectedCursor: 100, state: "running", cursor: 100 },
            { expectedCursor: 200, state: "running", cursor: 200 },
        ],
    );
    const fixtures = await loadFixtures(f.fixtures);
    for (const [name, edit] of [
        [
            "not-global-deadline",
            async (copy) => {
                const file = path.join(copy, "receipt.json");
                const receipt = JSON.parse(await readFile(file));
                receipt.failure = {
                    category: "cancelled",
                    code: "process-cancelled",
                };
                await json(file, receipt);
            },
        ],
        [
            "wrong-committed-cursor",
            async (copy) => {
                const file = path.join(copy, "receipt.json");
                const receipt = JSON.parse(await readFile(file));
                receipt.cases[0].receipt.cursor++;
                await json(file, receipt);
            },
        ],
        [
            "wrong-request",
            async (copy) => {
                const file = path.join(
                    copy,
                    "state",
                    failed.cases[0].corpusId,
                    "agent-sessions",
                    sha256(JSON.stringify("session-1")),
                    "session.json",
                );
                const stored = JSON.parse(await readFile(file));
                stored.pending.hash = "0".repeat(64);
                await json(file, stored);
            },
        ],
    ]) {
        const copy = path.join(f.root, name);
        await cp(source, copy, { recursive: true });
        await edit(copy);
        const output = path.join(f.root, `${name}-output`);
        await mkdir(output);
        await assert.rejects(
            prepareResume(
                options(f, { resumeFrom: copy, runDirectory: output }),
                fixtures,
            ),
            /resume-checkpoint-request-or-cursor-mismatch/,
        );
    }
    assert.deepEqual(await stateInventory(source), before);
});

test("resume rejects stale snapshots, request/evidence/model mismatches, absolute original-state references and nested output before runtime", async (t) => {
    const { f, failed } = await recoveryFixture(t);
    const original = path.join(f.root, "run");
    const originalInventory = await stateInventory(original);
    const fixtureData = await loadFixtures(f.fixtures);
    const sessionPath = path.join(
        "state",
        failed.cases[0].corpusId,
        "agent-sessions",
        sha256(JSON.stringify("session-1")),
        "session.json",
    );
    let ordinal = 0;
    async function rejectSource(edit, pattern, override = {}) {
        const source = path.join(f.root, `modified-${ordinal}`);
        const output = path.join(f.root, `rejected-${ordinal++}`);
        await cp(original, source, { recursive: true });
        await edit(source);
        await mkdir(output);
        await assert.rejects(
            prepareResume(
                options(f, {
                    ...override,
                    resumeFrom: source,
                    runDirectory: output,
                }),
                fixtureData,
            ),
            pattern,
        );
    }
    await rejectSource(
        (source) =>
            writeFile(
                path.join(source, "synthetic-case", "input.jsonl"),
                "changed",
            ),
        /snapshot-hash-mismatch/,
    );
    await rejectSource(async (source) => {
        const file = path.join(source, sessionPath);
        const stored = JSON.parse(await readFile(file));
        stored.requests[0].hash = "0".repeat(64);
        await json(file, stored);
    }, /request-or-cursor-mismatch/);
    await rejectSource(async (source) => {
        const file = path.join(source, sessionPath);
        const stored = JSON.parse(await readFile(file));
        stored.pending.episodes[0].episode.events[0].text = "changed evidence";
        await json(file, stored);
    }, /checkpoint-evidence-mismatch/);
    await rejectSource(
        async (source) => {
            const file = path.join(source, "receipt.json");
            const receipt = JSON.parse(await readFile(file));
            receipt.mode = "live";
            receipt.provider = "copilot";
            receipt.modelCapacity = { selectedModel: "gpt-6-luna" };
            await json(file, receipt);
            await json(path.join(source, "model-calls.json"), [
                { model: "copilot:other" },
            ]);
        },
        /chat-model-identity-mismatch/,
        { mode: "live", provider: "copilot" },
    );
    await rejectSource(
        (source) =>
            json(path.join(source, "state", "writable-path.json"), {
                path: path.join(source, "state", "index.json"),
            }),
        /original-absolute-path-forbidden/,
    );
    await rejectSource(
        (source) =>
            symlink(
                path.join(original, "state"),
                path.join(source, "state", "linked-state"),
                "junction",
            ),
        /state-links-forbidden/,
    );
    const nested = path.join(original, "nested-output");
    await assert.rejects(
        prepareResume(
            options(f, { resumeFrom: original, runDirectory: nested }),
            fixtureData,
        ),
        /outside-source-run/,
    );
    await assert.rejects(
        evaluate(options(f, { resumeFrom: original, runDirectory: nested })),
        /outside-source-run/,
    );
    assert.ok(!(await readdir(original)).includes("nested-output"));
    const alias = path.join(f.root, "original-alias");
    await symlink(original, alias, "junction");
    await assert.rejects(
        evaluate(
            options(f, {
                resumeFrom: original,
                runDirectory: path.join(alias, "nested-output"),
            }),
        ),
        /outside-source-run/,
    );
    await rejectSource(async (source) => {
        const file = path.join(source, "receipt.json");
        const receipt = JSON.parse(await readFile(file));
        receipt.state = "running";
        await json(file, receipt);
    }, /finalized-compatible-failed/);
    assert.deepEqual(await stateInventory(original), originalInventory);
    assert.equal(
        parseArgs([
            "--fixture-root",
            ".",
            "--run-directory",
            "new",
            "--resume-from",
            original,
        ]).resumeFrom,
        original,
    );
});

test("controlled injected paired-arm pipeline keeps gold isolated, judges only after answers, and exercises nonempty scope filtering", async (t) => {
    const f = await fixture(t);
    f.gold.questions[0].question = "Synthetic offline fixture";
    await json(path.join(f.fixtures, "gold", "case.json"), f.gold);
    const observed = [];
    const receipt = await evaluate(
        options(f, { mode: "live", maxQuestions: 1 }),
        {
            createRuntime: async (settings, signal, counters) => {
                const [
                    { FileMemoryService },
                    parser,
                    { checkSerializedRequestConstraints },
                ] = await Promise.all([
                    import(
                        pathToFileURL(
                            path.join(
                                tsRoot,
                                "packages",
                                "memory",
                                "service",
                                "dist",
                                "fileMemoryService.js",
                            ),
                        ).href
                    ),
                    import(
                        pathToFileURL(
                            path.join(
                                tsRoot,
                                "packages",
                                "memory",
                                "service",
                                "dist",
                                "agentSessionParsing.js",
                            ),
                        ).href
                    ),
                    import(
                        pathToFileURL(
                            path.join(
                                tsRoot,
                                "packages",
                                "aiclient",
                                "dist",
                                "requestConstraints.js",
                            ),
                        ).href
                    ),
                ]);
                function eventIds(value) {
                    if (!value || typeof value !== "object") return [];
                    return [
                        ...(typeof value.eventId === "string"
                            ? [value.eventId]
                            : []),
                        ...Object.values(value).flatMap(eventIds),
                    ];
                }
                const model = {
                    completionSettings: {},
                    complete: async (prompt) => {
                        const payload = JSON.parse(prompt.split("\n").at(-1));
                        if (Object.hasOwn(payload, "memories")) {
                            observed.push({ role: "artifact-support", prompt });
                            return {
                                success: true,
                                data: JSON.stringify({
                                    assessments: payload.memories.map(
                                        (memory) => ({
                                            memoryId: memory.memoryId,
                                            supported: true,
                                            criticalErrors: [],
                                        }),
                                    ),
                                }),
                            };
                        }
                        if (Object.hasOwn(payload, "referenceAnswer")) {
                            observed.push({ role: "judge", prompt });
                            return {
                                success: true,
                                data: '{"assessment":"partial","reason":"Controlled evaluator response."}',
                            };
                        }
                        if (Object.hasOwn(payload, "question")) {
                            observed.push({ role: "answer", prompt });
                            return {
                                success: true,
                                data: JSON.stringify({
                                    answer: "Controlled answer or abstention.",
                                    evidenceEventIds: [
                                        ...new Set(eventIds(payload.evidence)),
                                    ],
                                }),
                            };
                        }
                        observed.push({ role: "distillation", prompt });
                        return {
                            success: true,
                            data: JSON.stringify({
                                memories: [
                                    {
                                        kind: "semantic",
                                        title: "Synthetic fixture finding",
                                        body: "The synthetic fixture contains an exact final tail.",
                                        state: "diagnostic-only",
                                        eventIds: ["last"],
                                        supersedes: [],
                                    },
                                ],
                            }),
                        };
                    },
                };
                const tracked = new ModelTracker({
                    model,
                    identity: "controlled-offline-injection-not-real-model",
                    maxCalls: settings.maxModelCalls,
                    signal,
                    checkConstraints: checkSerializedRequestConstraints,
                    persist: (calls) =>
                        json(
                            path.join(
                                settings.runDirectory,
                                "model-calls.json",
                            ),
                            calls,
                        ),
                });
                return {
                    parser,
                    tracker: tracked,
                    stop: async () => {},
                    open: () =>
                        new FileMemoryService(
                            path.join(settings.runDirectory, "state"),
                            {
                                sourceSynopses: false,
                                informationalViews: false,
                                viewDrafts: false,
                                indexFactory: (_id, folder) =>
                                    new OfflineSubstringIndex(folder, counters),
                                agentSessionDistillationModel: {
                                    identity: tracked.identity,
                                    fits: (prompt) => tracked.fits(prompt),
                                    complete: async (prompt, received) => {
                                        counters.extractions++;
                                        return (
                                            await tracked.complete(
                                                "distillation",
                                                prompt,
                                                { signal: received },
                                            )
                                        ).data;
                                    },
                                },
                            },
                        ),
                };
            },
        },
    );
    assert.equal(receipt.state, "complete", JSON.stringify(receipt));
    assert.equal(receipt.cases[0].scopeFiltering.state, "verified");
    assert.equal(receipt.cases[0].artifactSupport.state, "complete");
    assert.deepEqual(receipt.cases[0].artifactSupport.supported, ratio(1, 1));
    assert.deepEqual(receipt.cases[0].memoryCitationValidity, ratio(1, 1));
    const question = receipt.cases[0].questions[0];
    assert.equal(question.questionId, "benchmark-original-id");
    assert.deepEqual(
        question.arms.map((arm) => arm.arm),
        ["no-memory", "raw-episode-rag", "distilled", "full-context"],
    );
    assert.deepEqual(
        question.arms[0].scores.suppliedEvidenceSupport,
        ratio(0, 0),
    );
    assert.equal(
        question.arms[1].scores.suppliedEvidenceSupport.denominator,
        2,
    );
    assert.equal(
        question.arms[2].scores.suppliedEvidenceSupport.denominator,
        1,
    );
    assert.equal(observed.filter((call) => call.role === "answer").length, 4);
    assert.equal(
        observed.findIndex((call) => call.role === "judge"),
        observed.findLastIndex((call) => call.role === "answer") + 1,
    );
    for (const call of observed) {
        if (call.role !== "judge")
            assert.ok(!call.prompt.includes("GOLD-SECRET"));
        else assert.ok(call.prompt.includes("GOLD-SECRET-ANSWER"));
    }
});
