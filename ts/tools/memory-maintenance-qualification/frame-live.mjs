// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
    appendFile,
    cp,
    mkdtemp,
    readFile,
    readdir,
    realpath,
    stat,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs, isDeepStrictEqual } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { snapshotCompiledCheckpoint, writeJson } from "./harness.mjs";
import { withLiveRunLock } from "./live-resume.mjs";
import { liveDependencyCheckpoint, observeProvider } from "./live-stages.mjs";
import { safeFailure } from "./live-qualification.mjs";
import {
    createFrameViewProvider,
    frameFixture,
    measurementDescriptor,
} from "./frame-fixtures.mjs";

const digest = (value) => createHash("sha256").update(value).digest("hex");
const canonical = (value) => JSON.stringify(value);
const modelRequests = (events) =>
    events.filter((event) => ["chat", "embedding"].includes(event.type));

export function validateFrameFixture(fixture) {
    assert.equal(fixture.version, 1);
    assert.equal(fixture.provenance.kind, "authored-synthetic");
    assert.equal(fixture.cases.length, 30);
    assert.equal(new Set(fixture.cases.map((item) => item.id)).size, 30);
    for (const [slice, count] of Object.entries({
        source: 8,
        question: 8,
        project: 8,
        provider: 6,
    }))
        assert.equal(
            fixture.cases.filter((item) => item.slice === slice).length,
            count,
        );
    for (const item of fixture.cases) {
        assert.equal(item.queries.length, 2);
        assert.ok(
            item.queries.every(
                (query) => typeof query === "string" && query.trim(),
            ),
        );
        assert.ok(Array.isArray(item.expected));
        assert.ok(
            item.expected.every(
                (row) => row.values && Object.keys(row.values).length,
            ),
        );
    }
}

export function scoreFrameRows(expected, rows) {
    assert.equal(rows.length, expected.length, "Unexpected result cardinality");
    const remaining = [...rows];
    for (const wanted of expected) {
        const index = remaining.findIndex(
            (actual) =>
                (wanted.ownerKey === undefined ||
                    actual.ownerKey === wanted.ownerKey) &&
                (wanted.itemKey === undefined ||
                    actual.itemKey === wanted.itemKey) &&
                Object.entries(wanted.values).every(([key, value]) =>
                    isDeepStrictEqual(actual.values[key], value),
                ),
        );
        assert.notEqual(
            index,
            -1,
            `Missing independently expected row: ${canonical(wanted)}`,
        );
        const [actual] = remaining.splice(index, 1);
        assert.ok(actual.itemKey && actual.ownerKey && actual.ownerRevisionId);
    }
    assert.equal(
        new Set(rows.map((row) => canonical([row.ownerKey, row.itemKey]))).size,
        rows.length,
        "Duplicate row identities",
    );
}

export async function collectFramePages(client, request) {
    const rows = [],
        pages = [],
        seen = new Set();
    let cursor;
    do {
        const result = await client.queryFrame({
            ...request,
            ...(cursor ? { cursor } : {}),
        });
        if (pages.length)
            assert.equal(
                result.snapshot,
                pages[0].snapshot,
                "Snapshot changed across pages",
            );
        assert.equal(
            result.coverage.failed,
            0,
            "Failed projection is not a successful empty result",
        );
        assert.equal(
            result.coverage.pending,
            0,
            "Pending projection is not a successful empty result",
        );
        rows.push(...result.rows);
        pages.push(result);
        cursor = result.nextCursor;
        if (cursor) {
            assert.ok(!seen.has(cursor), "Repeated pagination cursor");
            seen.add(cursor);
        }
    } while (cursor);
    return { rows, pages };
}

export function frameScorecard(records) {
    const cases = records.filter((record) => record.kind === "query");
    const group = (language) => {
        const selected = cases.filter((record) => record.language === language);
        return {
            scheduled: language ? 60 : 30,
            completed: selected.length,
            passed: selected.filter((record) => record.passed).length,
        };
    };
    return {
        structured: group(false),
        language: group(true),
        failures: records.filter((record) => !record.passed).length,
    };
}

async function compiledCheckpoint(productRoot) {
    const hashes = {
        ...(await snapshotCompiledCheckpoint(productRoot)),
        ...(await liveDependencyCheckpoint(productRoot)),
    };
    for (const relative of [
        "packages\\memory\\storage\\dist\\sqlite\\sqliteFrameProjection.js",
        "packages\\memory\\mcp-server\\dist\\memoryServiceHost.js",
        "packages\\memory\\mcp-server\\dist\\memoryMcpServer.js",
    ])
        hashes[relative] = digest(
            await readFile(path.join(productRoot, relative)),
        );
    return hashes;
}

function provider(denied, revision = 1) {
    const descriptor = structuredClone(measurementDescriptor);
    if (revision === 2) {
        descriptor.schema.revision = 2;
        descriptor.schema.fields.region = { type: "string", optional: true };
        descriptor.fields.region = "/region";
    }
    return {
        providerId: "eval",
        version: String(revision),
        sourceTypes: ["text"],
        projections: [descriptor],
        authorize: async (source) => !denied.has(source.sourceId),
    };
}

async function loadRuntime(productRoot) {
    const load = (relative) =>
        import(pathToFileURL(path.join(productRoot, relative)).href);
    const config = await load("packages\\config\\dist\\index.js");
    const ai = await load("packages\\aiclient\\dist\\index.js");
    config.loadConfigSync();
    ai.initRuntimeConfigFromProcessEnv();
    const service = await load("packages\\memory\\service\\dist\\index.js");
    const rpc = await load("packages\\memory\\service\\dist\\rpcFacade.js");
    const { MemoryServiceHost } = await load(
        "packages\\memory\\mcp-server\\dist\\memoryServiceHost.js",
    );
    const clients = await load("packages\\memory\\client\\dist\\index.js");
    const { getConfiguredViewModelOptions } = await load(
        "packages\\agentServer\\server\\dist\\viewModelOptions.js",
    );
    return {
        ...service,
        ...rpc,
        ...clients,
        MemoryServiceHost,
        viewOptions: getConfiguredViewModelOptions(),
        configuration: {
            provider: ai.openai.getChatModelSettings().provider,
            arm: "Production index, models and native SQLite; explicit manual view builds; frames, views and agent imports enabled; automatic discovery and synopses disabled",
        },
    };
}

function createService(runtime, root, denied = new Set(), options = {}) {
    return new runtime.FileMemoryService(root, {
        ...runtime.viewOptions,
        frameProjections: true,
        agentSessionImports: true,
        sourceSynopses: false,
        informationalViews: true,
        viewDrafts: true,
        maintenanceMode: "manual",
        discoveryPolicy: "off",
        automaticKnowledgeDiscovery: false,
        sourceFrameProviders: [provider(denied)],
        ...options,
    });
}

async function ingest(service, runtime, corpusId, source) {
    const job = await service.ingestDocument({
        corpusId,
        source,
        pipeline: { updatePolicy: "replaceActiveRevision" },
    });
    const result = await runtime.waitForMemoryJob(service, job.jobId);
    assert.equal(
        result.state,
        "complete",
        `Ingestion ${source.sourceId} failed: ${result.error ?? result.state}`,
    );
    return job;
}

async function settledView(service, request) {
    let job = await service.buildViews(request);
    while (job.state === "running") {
        await delay(250);
        job = await service.getViewBuild({
            corpusId: request.corpusId,
            jobId: job.jobId,
        });
        assert.ok(job, "Build receipt disappeared");
    }
    assert.equal(
        job.state,
        "complete",
        `View construction failed: ${canonical(job.results)}`,
    );
    return job;
}

async function publish(service, corpusId, viewId) {
    const view = await service.getView({ corpusId, viewId });
    assert.ok(view, `View ${viewId} was not constructed`);
    const publication = await service.publishView({
        corpusId,
        viewId,
        revisionId: view.revisionId,
        expectedVersion: view.version,
        expectedHead: (await service.listViews(corpusId)).head,
    });
    assert.equal(
        publication.indexState,
        "ready",
        `View publication failed: ${canonical(publication)}`,
    );
    assert.equal(publication.publishedRevisionId, view.revisionId);
    return view;
}

async function buildPilotViews(service, corpusId, receipts) {
    const selected = (id) => [
        { sourceId: id, revisionId: receipts[id].revisionId },
    ];
    const definitions = [
        {
            viewId: "eval-questions",
            kind: "schemaView",
            selector: { kind: "sources", sources: selected("question-facts") },
            schemaView: {
                construction: "schema-defined-v1",
                title: "Synthetic approved account questions",
                slots: frameFixture.slots,
                template: "questions-v1",
                discovery: { enabled: false, maxProposals: 0 },
            },
        },
        {
            viewId: "eval-project",
            kind: "projectBrief",
            selector: { kind: "sources", sources: selected("project-facts") },
            projectSummary: {
                construction: "informational-project-summary-v1",
                query: "Northstar project",
                aliases: [],
                excludedSourceIds: [],
            },
        },
    ];
    for (const definition of definitions) {
        await settledView(service, {
            corpusId,
            expectedHead: (await service.listViews(corpusId)).head,
            targets: [{ definition, expectedVersion: 0 }],
            publication: false,
        });
        await publish(service, corpusId, definition.viewId);
    }
}

async function resolveSchema(client, corpusId, id) {
    let schemaId = id;
    if (id.startsWith("@")) {
        const slots = await collectFramePages(client, {
            corpusId,
            schemaId: "question.slot",
            schemaRevision: 2,
            predicate: {
                and: [{ fieldId: "slotId", op: "eq", value: id.slice(1) }],
            },
        });
        assert.equal(
            slots.rows.length,
            1,
            `Missing admitted question schema for ${id}`,
        );
        schemaId = slots.rows[0].values.answerSchemaId;
        const schema = (await client.listFrameSchemas(corpusId)).find(
            (candidate) =>
                candidate.id === schemaId &&
                candidate.revision ===
                    slots.rows[0].values.answerSchemaRevision,
        );
        assert.ok(schema, `Unresolvable question schema link for ${id}`);
        return schema;
    }
    const schema = (await client.listFrameSchemas(corpusId)).find(
        (candidate) => candidate.id === schemaId,
    );
    assert.ok(schema, `Missing schema ${schemaId}`);
    return schema;
}

export async function validateFrameEvidence(service, corpusId, rows) {
    for (const row of rows) {
        assert.ok(row.schemaId && Number.isSafeInteger(row.schemaRevision));
        if (row.origin === "derived")
            assert.equal(
                row.granularity,
                row.schemaId.startsWith("question.answer.")
                    ? "section"
                    : "view",
            );
        if (
            row.schemaId.startsWith("project.") ||
            row.schemaId.startsWith("question.answer.") ||
            row.schemaId === "eval.measurements"
        )
            assert.ok(row.evidence.length, "Missing source support");
        for (const evidence of [...row.evidence, ...row.opposition]) {
            const content = await service.getSourceContent({
                corpusId,
                sourceId: evidence.sourceId,
                revisionId: evidence.revisionId,
                maxChars: 120000,
            });
            assert.ok(content, "Citation source is unavailable");
            assert.ok(
                evidence.excerpt && content.content.includes(evidence.excerpt),
                "Citation is not exact retained evidence",
            );
        }
    }
}

export function frameFailure(error) {
    const message = error instanceof Error ? error.message : "";
    const stack =
        error instanceof Error ? (error.stack?.split("\n") ?? []) : [];
    return {
        ...safeFailure(error),
        productMessage: /Invalid frame|Unsupported frame|Unknown frame/.test(
            message,
        )
            ? message
            : undefined,
        assertion: error?.code === "ERR_ASSERTION" ? message : undefined,
        harnessFrames: stack.flatMap(
            (line) => line.match(/frame-live\.mjs:\d+:\d+/g) ?? [],
        ),
        serviceOrigin: stack[1]?.match(
            /\/packages\/memory\/service\/dist\/([^/\s]+\.js:\d+:\d+)/,
        )?.[1],
        serviceValidation:
            /(?:viewBuildValidation|viewValidation|fileMemoryService|informationalProject|viewExtensions|viewContent|schemaView)\.js:\d+:\d+/.test(
                stack[1] ?? "",
            )
                ? message
                : undefined,
    };
}

async function pilot(runtime, run, state, record, phase) {
    const service = createService(runtime, path.join(run, "isolated-store"));
    let host, client;
    try {
        state.capabilities = await service.getCapabilities();
        assert.equal(state.capabilities.features.dataFrames, true);
        state.corpusId = (
            await service.createCorpus("Synthetic dataframe live pilot")
        ).corpusId;
        state.ingestion = {};
        for (const source of frameFixture.sources) {
            phase(`ingest:${source.sourceId}`);
            state.ingestion[source.sourceId] = await ingest(
                service,
                runtime,
                state.corpusId,
                source,
            );
            await writeJson(path.join(run, "state.json"), state);
        }
        phase("native-agent-session-import");
        const { events, ...session } = frameFixture.session;
        let imported = await service.importAgentSession({
            ...session,
            corpusId: state.corpusId,
            importType: "agent-session-jsonl",
            idempotencyKey: "fixture-v1",
            expectedCursor: 0,
            final: true,
            jsonl:
                events.map((event) => JSON.stringify(event)).join("\n") + "\n",
        });
        while (imported.state === "running") {
            await delay(250);
            imported = await service.getAgentSessionImport({
                corpusId: state.corpusId,
                sessionId: session.sessionId,
            });
            assert.ok(imported, "Import receipt disappeared");
        }
        state.agentImport = imported;
        assert.equal(imported.state, "complete", "Native agent import failed");
        assert.deepEqual(imported.losses, []);
        phase("live-view-construction");
        await buildPilotViews(service, state.corpusId, state.ingestion);
        state.views = (await service.listViews(state.corpusId)).views;
        await writeJson(
            path.join(run, "accepted-view-payloads.json"),
            state.views,
        );
        host = await runtime.MemoryServiceHost.start(service);
        assert.equal((await fetch(host.healthEndpoint)).status, 200);
        client = await runtime.McpMemoryServiceClient.create({
            kind: "http",
            url: host.endpoint,
            headers: { Authorization: `Bearer ${host.bearerToken}` },
        });
        const local = new runtime.InProcessMemoryServiceClient(service);
        assert.deepEqual(
            await client.listFrameSchemas(state.corpusId),
            await local.listFrameSchemas(state.corpusId),
        );
        for (const item of frameFixture.cases) {
            for (const [index, query] of [
                undefined,
                ...item.queries,
            ].entries()) {
                const language = index > 0;
                phase(
                    `${item.id}:${language ? `language-${index}` : "structured"}`,
                );
                const event = {
                    kind: "query",
                    caseId: item.id,
                    slice: item.slice,
                    language,
                    paraphrase: index,
                    passed: false,
                };
                const started = performance.now();
                try {
                    const schema = await resolveSchema(
                        local,
                        state.corpusId,
                        item.schemaId,
                    );
                    const request = {
                        corpusId: state.corpusId,
                        schemaId: schema.id,
                        schemaRevision: schema.revision,
                        ...item.scope,
                        limit: 2,
                        ...(language
                            ? { query }
                            : { predicate: item.predicate }),
                    };
                    const result = await collectFramePages(
                        language ? client : local,
                        request,
                    );
                    event.result = result;
                    scoreFrameRows(item.expected, result.rows);
                    await validateFrameEvidence(
                        service,
                        state.corpusId,
                        result.rows,
                    );
                    const parity = await collectFramePages(
                        language ? local : client,
                        request,
                    );
                    assert.deepEqual(
                        parity.rows,
                        result.rows,
                        "HTTP MCP/service row mismatch",
                    );
                    assert.equal(
                        parity.pages[0].snapshot,
                        result.pages[0].snapshot,
                    );
                    event.passed = true;
                } catch (error) {
                    event.failure = frameFailure(error);
                }
                event.milliseconds = performance.now() - started;
                await record(event);
            }
        }
        state.scorecard = frameScorecard(state.records);
        state.accepted =
            state.scorecard.structured.passed === 30 &&
            state.scorecard.language.passed === 60;
    } finally {
        await client?.close();
        if (host) await host.close();
        else await service.close();
    }
}

async function measured(action) {
    const cpu = process.cpuUsage(),
        started = performance.now();
    const result = await action();
    return {
        result,
        milliseconds: performance.now() - started,
        cpuMicroseconds: process.cpuUsage(cpu),
    };
}

async function lifecycle(runtime, run, state, record, phase) {
    assert.equal(state.accepted, true, "Lifecycle requires an accepted pilot");
    const root = path.join(run, "lifecycle-store");
    await cp(path.join(run, "isolated-store"), root, {
        recursive: true,
        errorOnExist: true,
        force: false,
    });
    const denied = new Set();
    let service = createService(runtime, root, denied);
    const corpusId = state.corpusId;
    const request = {
        corpusId,
        schemaId: "eval.measurements",
        schemaRevision: 1,
        predicate: { and: [] },
    };
    const check = async (id, action) => {
        phase(id);
        const start = modelRequests(state.providerRequests).length;
        const sample = await measured(action);
        await record({
            kind: "lifecycle",
            caseId: id,
            passed: true,
            milliseconds: sample.milliseconds,
            modelRequests: modelRequests(state.providerRequests).length - start,
        });
    };
    try {
        await check("restart-exact", async () =>
            scoreFrameRows(
                frameFixture.cases.find(
                    (item) => item.id === "provider-same-item",
                ).expected,
                (
                    await service.queryFrame({
                        ...request,
                        predicate: frameFixture.cases.find(
                            (item) => item.id === "provider-same-item",
                        ).predicate,
                    })
                ).rows,
            ),
        );
        await check("revocation", async () => {
            denied.add("measurements");
            await assert.rejects(
                service.queryFrame(request),
                /Unknown frame schema/,
            );
            denied.delete("measurements");
            assert.equal((await service.queryFrame(request)).rows.length, 5);
        });
        await check("source-replacement-stale-cursor", async () => {
            const first = await service.queryFrame({ ...request, limit: 1 });
            assert.ok(first.nextCursor);
            const original = frameFixture.sources.find(
                (source) => source.sourceId === "measurements",
            );
            await ingest(service, runtime, corpusId, {
                ...original,
                text: JSON.stringify({
                    items: [
                        {
                            id: "replacement",
                            component: "api",
                            duration: 70,
                            passed: false,
                            tags: [],
                            region: "north",
                        },
                    ],
                }),
            });
            assert.equal(
                (await service.queryFrame(request)).rows[0].itemKey,
                "replacement",
            );
            await assert.rejects(
                service.queryFrame({
                    ...request,
                    limit: 1,
                    cursor: first.nextCursor,
                }),
                /cursor|snapshot/i,
            );
        });
        await check("retained-schema-backfill", async () => {
            await service.close();
            const before = modelRequests(state.providerRequests).length;
            service = createService(runtime, root, denied, {
                sourceFrameProviders: [provider(denied, 2)],
            });
            const result = await service.queryFrame({
                ...request,
                schemaRevision: 2,
            });
            assert.equal(result.rows[0].values.region, "north");
            await assert.rejects(
                service.queryFrame(request),
                /Unknown frame schema/,
            );
            assert.equal(
                modelRequests(state.providerRequests).length,
                before,
                "Backfill unexpectedly dispatched a model",
            );
        });
        await check("question-retirement", async () => {
            const before = await resolveSchema(service, corpusId, "@budget");
            const questions = await service.listQuestions(corpusId);
            const budget = questions.items.find(
                (item) => item.slot.id === "budget",
            );
            await service.editQuestion({
                corpusId,
                viewId: budget.viewId,
                slotId: "budget",
                expectedHead: questions.head,
                expectedVersion: budget.viewVersion,
                edit: { kind: "approval", approval: "rejected" },
            });
            assert.ok(
                !(await service.listFrameSchemas(corpusId)).some(
                    (schema) => schema.id === before.id,
                ),
            );
        });
        await check("forget-and-restart", async () => {
            const preview = await service.previewForgetSource(
                corpusId,
                "measurements",
            );
            await service.forgetSource({
                corpusId,
                sourceId: "measurements",
                confirmationToken: preview.confirmationToken,
            });
            await service.close();
            service = createService(runtime, root, denied, {
                sourceFrameProviders: [provider(denied, 2)],
            });
            assert.ok(
                !(await service.listFrameSchemas(corpusId)).some(
                    (schema) => schema.id === request.schemaId,
                ),
            );
            assert.ok(
                !(await service.getFrameProjectionStatus(corpusId)).owners.some(
                    (owner) => owner.ownerKey === "source:measurements",
                ),
            );
        });
        await check("clear-while-disabled", async () => {
            await service.close();
            service = createService(runtime, root, denied, {
                frameProjections: false,
            });
            await service.clearCorpus(corpusId);
            await service.close();
            service = createService(runtime, root);
            assert.equal(
                (await service.getFrameProjectionStatus(corpusId)).owners
                    .length,
                0,
            );
        });
    } finally {
        await service.close();
    }
}

async function diskBytes(root) {
    let bytes = 0;
    for (const entry of await readdir(root, { withFileTypes: true })) {
        const file = path.join(root, entry.name);
        bytes += entry.isDirectory()
            ? await diskBytes(file)
            : (await stat(file)).size;
    }
    return bytes;
}

export function percentiles(values) {
    assert.ok(values.length);
    const sorted = [...values].sort((a, b) => a - b);
    const at = (fraction) =>
        sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
    return {
        samples: values.length,
        p50: at(0.5),
        p95: at(0.95),
        minimum: sorted[0],
        maximum: sorted.at(-1),
    };
}

async function performanceReplay(runtime, run, state, record, phase) {
    assert.equal(
        state.accepted,
        true,
        "Performance requires an accepted pilot",
    );
    for (const size of [100, 1000, 10000]) {
        phase(`performance-seed:${size}`);
        const seed = path.join(run, `performance-seed-${size}`);
        await cp(path.join(run, "isolated-store"), seed, {
            recursive: true,
            errorOnExist: true,
            force: false,
        });
        let service = createService(runtime, seed, new Set(), {
            frameProjections: false,
        });
        const source = {
            sourceId: "scale",
            sourceType: "text",
            title: "Synthetic scale measurements",
            metadata: { frameProviderId: "eval" },
            text: JSON.stringify({
                items: Array.from({ length: size }, (_, i) => ({
                    id: `row-${i}`,
                    component: i % 2 ? "api" : "batch",
                    duration: i % 100,
                    passed: i % 2 === 0,
                    tags: ["scale"],
                })),
            }),
        };
        const seedIngestion = await measured(() =>
            ingest(service, runtime, state.corpusId, source),
        );
        await service.close();
        await record({
            kind: "performance-seed",
            size,
            passed: true,
            milliseconds: seedIngestion.milliseconds,
            sourceSha256: digest(source.text),
        });
        for (let repetition = 0; repetition < 3; repetition++) {
            const root = path.join(run, `performance-${size}-${repetition}`);
            await cp(seed, root, {
                recursive: true,
                errorOnExist: true,
                force: false,
            });
            service = createService(runtime, root);
            try {
                const request = {
                    corpusId: state.corpusId,
                    schemaId: "eval.measurements",
                    schemaRevision: 1,
                    sourceIds: ["scale"],
                    limit: 1000,
                    predicate: {
                        and: [
                            {
                                fieldId: "duration",
                                op: "gte",
                                value: 50,
                                unit: "ms",
                            },
                        ],
                    },
                };
                const cold = await measured(() =>
                    collectFramePages(service, request),
                );
                assert.equal(cold.result.rows.length, size / 2);
                const warm = [];
                for (let i = 0; i < 10; i++) {
                    const sample = await measured(() =>
                        collectFramePages(service, request),
                    );
                    assert.equal(sample.result.rows.length, size / 2);
                    warm.push({
                        milliseconds: sample.milliseconds,
                        cpuMicroseconds: sample.cpuMicroseconds,
                    });
                }
                await record({
                    kind: "performance",
                    size,
                    repetition,
                    passed: true,
                    coldMilliseconds: cold.milliseconds,
                    coldCpuMicroseconds: cold.cpuMicroseconds,
                    warm,
                    warmMilliseconds: percentiles(
                        warm.map((sample) => sample.milliseconds),
                    ),
                    pages: cold.result.pages.length,
                    rows: cold.result.rows.length,
                    bytes: await diskBytes(root),
                });
            } finally {
                await service.close();
            }
        }
    }
}

export function validateFrameContinuation(
    parent,
    owner,
    checkpoint,
    fixtureSha256,
) {
    assert.equal(
        parent.accepted,
        true,
        "Continuation requires a passing complete pilot",
    );
    assert.equal(
        parent.outcome,
        "FRAME_PILOT_LIFECYCLE_PERFORMANCE_COMPLETED",
        "Parent must have completed the primary pilot and core lifecycle",
    );
    assert.equal(parent.receiptId, owner.receiptId, "Run ownership changed");
    assert.equal(
        parent.runDirectory,
        owner.runDirectory,
        "Owned directory changed",
    );
    assert.equal(parent.fixtureSha256, fixtureSha256, "Fixture/gold changed");
    assert.deepEqual(
        parent.checkpoint,
        checkpoint,
        "Compiled checkpoint changed",
    );
    assert.ok(parent.corpusId);
}

async function rebuildView(service, corpusId, view, sourceIds) {
    assert.ok(view, "Current view must be captured before source invalidation");
    const current = await service.getView({ corpusId, viewId: view.viewId });
    // Replacing one source invalidates the hidden informational draft once.
    const expectedVersion = view.definition.projectSummary
        ? view.version + 1
        : current?.version;
    assert.ok(
        expectedVersion,
        "Replacement must expose a current or newly invalidated target version",
    );
    const { revisionId: _revision, ...definition } = view.definition;
    definition.selector = {
        kind: "sources",
        sources: await Promise.all(
            sourceIds.map(async (sourceId) => ({
                sourceId,
                revisionId: (await service.getSource(corpusId, sourceId))
                    .activeRevisionId,
            })),
        ),
    };
    await settledView(service, {
        corpusId,
        expectedHead: (await service.listViews(corpusId)).head,
        publication: false,
        targets: [{ definition, expectedVersion }],
    });
    return publish(service, corpusId, view.viewId);
}

async function supplementaryViews(service, runtime, corpusId) {
    const projectView = await service.getView({
        corpusId,
        viewId: "eval-project",
    });
    const questionView = await service.getView({
        corpusId,
        viewId: "eval-questions",
    });
    await ingest(service, runtime, corpusId, {
        ...frameFixture.sources.find(
            (source) => source.sourceId === "project-facts",
        ),
        text: "Northstar project is active. Incident not applicable. Capacity validated. Delivery owner is Bea. Review is unassigned. Launch milestone is confirmed for 2026-11-10. The audit milestone was removed, not deferred. Risk dependency-delay is resolved. Decisions retain-api and retain-tests are confirmed.",
    });
    const stale = await service.queryFrame({
        corpusId,
        schemaId: "project.owner",
        schemaRevision: 2,
        includeUnconfirmed: true,
        predicate: { and: [] },
    });
    assert.equal(
        stale.rows.length,
        0,
        "Replaced source retained stale derived facts",
    );
    await rebuildView(service, corpusId, projectView, ["project-facts"]);
    const owners = await resolveSchema(service, corpusId, "project.owner");
    const ownerRows = await service.queryFrame({
        corpusId,
        schemaId: owners.id,
        schemaRevision: owners.revision,
        predicate: { and: [{ fieldId: "owner", op: "eq", value: "Bea" }] },
    });
    assert.equal(ownerRows.rows.length, 1);
    const old = await service.queryFrame({
        corpusId,
        schemaId: owners.id,
        schemaRevision: owners.revision,
        predicate: { and: [{ fieldId: "owner", op: "eq", value: "Ada" }] },
    });
    assert.equal(old.rows.length, 0);
    const milestones = await service.queryFrame({
        corpusId,
        schemaId: "project.milestone",
        schemaRevision: 1,
        predicate: { and: [] },
    });
    assert.equal(milestones.rows.length, 1);
    assert.equal(milestones.rows[0].values.date.raw, "2026-11-10");
    await ingest(service, runtime, corpusId, {
        ...frameFixture.sources.find(
            (source) => source.sourceId === "question-facts",
        ),
        text: "The evaluation account budget is now 150. Shipping city Dublin and tier 2 are unchanged. Automated renewal is false. No account codename has been supplied.",
    });
    await rebuildView(service, corpusId, questionView, ["question-facts"]);
    const budget = await resolveSchema(service, corpusId, "@budget");
    const answers = await service.queryFrame({
        corpusId,
        schemaId: budget.id,
        schemaRevision: budget.revision,
        predicate: { and: [] },
    });
    assert.deepEqual(
        answers.rows.map((row) => row.values.value),
        [150],
    );
    return {
        owners: ownerRows.rows,
        milestones: milestones.rows,
        updatedBudget: answers.rows,
    };
}

async function supplementaryQuestionReview(service, corpusId) {
    const budget = await resolveSchema(service, corpusId, "@budget");
    const inventory = await service.listQuestions(corpusId);
    const question = inventory.items.find((item) => item.slot.id === "budget");
    await service.editQuestion({
        corpusId,
        viewId: question.viewId,
        slotId: "budget",
        expectedHead: inventory.head,
        expectedVersion: question.viewVersion,
        edit: {
            kind: "review",
            candidateId: question.details.selectedCandidateIds[0],
            review: "rejected",
        },
    });
    const rejected = await service.queryFrame({
        corpusId,
        schemaId: budget.id,
        schemaRevision: budget.revision,
        includeUnconfirmed: true,
        predicate: { and: [] },
    });
    assert.equal(rejected.rows.length, 0);
}

async function supplementaryProvider(service, runtime, corpusId, extension) {
    await ingest(service, runtime, corpusId, {
        sourceId: "provider-qualification",
        sourceType: "text",
        title: "Producer report qualification",
        text: "The API duration is a producer report, not independent performance verification.",
    });
    const identity = extension.installed.descriptor.identity;
    const viewId = runtime.extensionViewId(
        identity.providerId,
        "recap",
        "measurements",
    );
    const sources = await Promise.all(
        ["measurements", "provider-qualification", "scope-b"].map(
            async (sourceId) => ({
                sourceId,
                revisionId: (await service.getSource(corpusId, sourceId))
                    .activeRevisionId,
            }),
        ),
    );
    await settledView(service, {
        corpusId,
        expectedHead: (await service.listViews(corpusId)).head,
        publication: false,
        targets: [
            {
                expectedVersion: 0,
                definition: {
                    viewId,
                    kind: "extension",
                    selector: { kind: "sources", sources },
                    extension: {
                        ...identity,
                        definitionId: "recap",
                        targetKey: "measurements",
                        eligibilityVersion: "1",
                        policyDigest: runtime.viewExtensionDigest(
                            "Explicit evaluation",
                        ),
                        parameters: {},
                    },
                },
            },
        ],
    });
    const request = {
        corpusId,
        schemaId: "eval-recap.duration",
        schemaRevision: 1,
        includeUnconfirmed: true,
        predicate: {
            and: [{ fieldId: "duration", op: "gte", value: 40, unit: "ms" }],
        },
    };
    const result = await service.queryFrame(request);
    assert.equal(result.rows.length, 1);
    assert.equal(result.rows[0].values.duration, 50);
    assert.deepEqual(
        result.rows[0].sourceIds,
        ["measurements"],
        "Opposition or influence became supporting candidates",
    );
    assert.deepEqual(
        result.rows[0].opposition.map((citation) => citation.sourceId),
        ["provider-qualification"],
    );
    assert.equal(result.rows[0].granularity, "record");
    extension.revoke();
    assert.ok(
        !(await service.listFrameSchemas(corpusId)).some(
            (schema) => schema.id === request.schemaId,
        ),
    );
    extension.restore();
    assert.equal((await service.queryFrame(request)).rows.length, 1);
    return { viewId, rows: result.rows };
}

async function supplementaryFiltering(service, runtime, corpusId) {
    for (let index = 0; index < 8; index++)
        await ingest(service, runtime, corpusId, {
            sourceId: index === 7 ? "filter-target" : `filter-decoy-${index}`,
            sourceType: "text",
            title: "Synthetic API release validation",
            metadata: { frameProviderId: "eval" },
            text: JSON.stringify({
                narrative:
                    "The synthetic API release validation completed successfully.",
                items: [
                    {
                        id: "release",
                        component: "api",
                        duration: index === 7 ? 50 : 10,
                        passed: true,
                        tags: ["filter"],
                    },
                ],
            }),
        });
    const filter = {
        schemaId: "eval.measurements",
        schemaRevision: 1,
        predicate: {
            and: [
                { fieldId: "duration", op: "gte", value: 50, unit: "ms" },
                { fieldId: "tags", op: "eq", value: "filter" },
            ],
        },
    };
    const candidates = await collectFramePages(service, {
        ...filter,
        corpusId,
    });
    assert.deepEqual(
        candidates.rows.map((row) => row.sourceIds),
        [["filter-target"]],
    );
    const results = [];
    for (const query of ["validation"]) {
        const request = { corpusId, query, limit: 1 };
        const control = await measured(() => service.search(request));
        const filtered = await measured(() =>
            service.search({ ...request, frameFilter: filter }),
        );
        assert.deepEqual(
            filtered.result.matches.map((match) => match.sourceId),
            ["filter-target"],
        );
        results.push({
            query,
            unfiltered: control.result.matches.map((match) => match.sourceId),
            filtered: filtered.result.matches.map((match) => match.sourceId),
            controlMilliseconds: control.milliseconds,
            filteredMilliseconds: filtered.milliseconds,
        });
    }
    assert.ok(
        results.some((result) => !result.unfiltered.includes("filter-target")),
        "Before-top-N discrimination was not exercised",
    );
    await assert.rejects(
        service.search({
            corpusId,
            query: "release",
            frameFilter: { ...filter, schemaRevision: 999 },
        }),
        /Unknown frame schema/,
    );
    return results;
}

export async function invalidateDuringLanguage(
    service,
    state,
    request,
    invalidate,
) {
    const before = state.providerRequests.filter(
        (event) => event.type === "chat",
    ).length;
    let settled = false;
    const pending = service.queryFrame(request).then(
        (result) => {
            settled = true;
            return { result };
        },
        (error) => {
            settled = true;
            return { error };
        },
    );
    await delay(50);
    assert.equal(
        settled,
        false,
        "Query finished before invalidation could race it",
    );
    await invalidate();
    const outcome = await pending;
    assert.ok(
        outcome.error,
        "Invalidated facts escaped after awaited model work",
    );
    assert.match(
        outcome.error.message,
        /Unknown frame schema revision|Frame .*changed during the read/,
    );
    const chatRequests =
        state.providerRequests.filter((event) => event.type === "chat").length -
        before;
    assert.ok(chatRequests > 0, "Race did not exercise a real chat request");
    return { invalidationError: outcome.error.message, chatRequests };
}

async function supplement(runtime, run, state, record, phase) {
    const root = path.join(run, "supplement-store");
    await cp(path.join(run, "isolated-store"), root, {
        recursive: true,
        errorOnExist: true,
        force: false,
    });
    const denied = new Set(),
        deniedSources = new Set();
    const extension = createFrameViewProvider(runtime.viewExtensionDigest);
    const options = {
        extensionBuilds: true,
        extensionProviders: [extension.installed],
        sourceAuthorization: async (request) =>
            !deniedSources.has(request.sourceId),
    };
    let service = createService(runtime, root, denied, options);
    const corpusId = state.corpusId;
    const passed = new Set();
    const check = async (id, action, prerequisites = []) => {
        phase(id);
        const blocked = prerequisites.filter((id) => !passed.has(id));
        if (blocked.length) {
            await record({
                kind: "supplement",
                caseId: id,
                passed: false,
                blocked,
            });
            return;
        }
        const start = modelRequests(state.providerRequests).length;
        const event = {
            kind: "supplement",
            caseId: id,
            passed: false,
        };
        const started = performance.now();
        try {
            const sample = await measured(action);
            event.detail = sample.result;
            event.passed = true;
            passed.add(id);
        } catch (error) {
            event.failure = frameFailure(error);
        }
        event.milliseconds = performance.now() - started;
        event.modelRequests =
            modelRequests(state.providerRequests).length - start;
        await record(event);
    };
    try {
        await check("view-and-selected-answer-updates", () =>
            supplementaryViews(service, runtime, corpusId),
        );
        await check(
            "selected-answer-review",
            () => supplementaryQuestionReview(service, corpusId),
            ["view-and-selected-answer-updates"],
        );
        await check("view-provider-evidence-and-revocation", () =>
            supplementaryProvider(service, runtime, corpusId, extension),
        );
        extension.restore();
        await check(
            "view-source-authorization",
            async () => {
                deniedSources.add("project-facts");
                const schema = await resolveSchema(
                    service,
                    corpusId,
                    "project.owner",
                );
                const result = await service.queryFrame({
                    corpusId,
                    schemaId: schema.id,
                    schemaRevision: schema.revision,
                    includeUnconfirmed: true,
                    predicate: { and: [] },
                });
                assert.equal(result.rows.length, 0);
                deniedSources.clear();
            },
            ["view-and-selected-answer-updates"],
        );
        deniedSources.clear();
        await check("revocation-during-real-language-work", async () => {
            try {
                return await invalidateDuringLanguage(
                    service,
                    state,
                    {
                        corpusId,
                        schemaId: "eval.measurements",
                        schemaRevision: 1,
                        query: "Find api measurements with duration strictly greater than 45 milliseconds.",
                    },
                    async () => {
                        denied.add("measurements");
                    },
                );
            } finally {
                denied.clear();
            }
        });
        await check(
            "view-revocation-during-real-language-work",
            async () => {
                try {
                    return await invalidateDuringLanguage(
                        service,
                        state,
                        {
                            corpusId,
                            schemaId: "eval-recap.duration",
                            schemaRevision: 1,
                            includeUnconfirmed: true,
                            query: "Find recap durations strictly greater than 45 milliseconds.",
                        },
                        async () => {
                            extension.revoke();
                        },
                    );
                } finally {
                    extension.restore();
                }
            },
            ["view-provider-evidence-and-revocation"],
        );
        await check("filter-before-ranking-and-no-fallback", () =>
            supplementaryFiltering(service, runtime, corpusId),
        );
        await check("opposition-forget-and-restart", async () => {
            const preview = await service.previewForgetSource(
                corpusId,
                "provider-qualification",
            );
            await service.forgetSource(
                {
                    corpusId,
                    sourceId: "provider-qualification",
                    confirmationToken: preview.confirmationToken,
                },
                ["view-provider-evidence-and-revocation"],
            );
            await service.close();
            service = createService(runtime, root, denied, options);
            assert.ok(
                !(await service.listFrameSchemas(corpusId)).some(
                    (schema) => schema.id === "eval-recap.duration",
                ),
            );
        });
    } finally {
        await service.close();
    }
    for (let repetition = 0; repetition < 3; repetition++) {
        const pair = {};
        for (const enabled of [false, true]) {
            const armRoot = path.join(run, `paired-${repetition}-${enabled}`);
            await cp(path.join(run, "isolated-store"), armRoot, {
                recursive: true,
                errorOnExist: true,
                force: false,
            });
            service = createService(runtime, armRoot, new Set(), {
                frameProjections: enabled,
            });
            try {
                const search = await measured(() =>
                    service.search({
                        corpusId,
                        query: "Northstar",
                        limit: 5,
                    }),
                );
                pair[enabled ? "enabled" : "disabled"] = {
                    milliseconds: search.milliseconds,
                    cpuMicroseconds: search.cpuMicroseconds,
                    matches: search.result.matches.map(
                        (match) => match.sourceId,
                    ),
                };
                assert.ok(
                    search.result.matches.length > 0,
                    "Paired semantic control must retrieve a known fixture source",
                );
                if (enabled) {
                    const request = {
                        corpusId,
                        schemaId: "eval.measurements",
                        schemaRevision: 1,
                        query: "Find api measurements with duration greater than or equal to 40 milliseconds.",
                    };
                    const before = modelRequests(state.providerRequests).length;
                    const cold = await measured(() =>
                        collectFramePages(service, request),
                    );
                    const afterCold = modelRequests(
                        state.providerRequests,
                    ).length;
                    assert.equal(
                        afterCold - before,
                        1,
                        "Cold translation must dispatch one actual model request",
                    );
                    const warm = await measured(() =>
                        collectFramePages(service, request),
                    );
                    assert.equal(cold.result.rows.length, 1);
                    assert.deepEqual(warm.result.rows, cold.result.rows);
                    assert.equal(
                        modelRequests(state.providerRequests).length,
                        afterCold,
                    );
                    pair.translation = {
                        coldMilliseconds: cold.milliseconds,
                        warmMilliseconds: warm.milliseconds,
                        coldModelRequests: afterCold - before,
                        warmModelRequests: 0,
                    };
                }
            } finally {
                await service.close();
            }
        }
        assert.deepEqual(
            [...pair.disabled.matches].sort(),
            [...pair.enabled.matches].sort(),
            "Paired semantic source identities changed",
        );
        await record({
            kind: "paired-performance",
            repetition,
            passed: true,
            ...pair,
        });
    }
    const raceRoot = path.join(run, "forget-race-store");
    await cp(path.join(run, "isolated-store"), raceRoot, {
        recursive: true,
        errorOnExist: true,
        force: false,
    });
    service = createService(runtime, raceRoot);
    try {
        await check("forget-during-real-language-work", () =>
            invalidateDuringLanguage(
                service,
                state,
                {
                    corpusId,
                    schemaId: "eval.measurements",
                    schemaRevision: 1,
                    query: "Find api measurements whose duration exceeds 35 milliseconds.",
                },
                async () => {
                    const preview = await service.previewForgetSource(
                        corpusId,
                        "measurements",
                    );
                    await service.forgetSource({
                        corpusId,
                        sourceId: "measurements",
                        confirmationToken: preview.confirmationToken,
                    });
                },
            ),
        );
        await service.close();
        service = createService(runtime, raceRoot);
        assert.ok(
            !(await service.listFrameSchemas(corpusId)).some(
                (schema) => schema.id === "eval.measurements",
            ),
        );
    } finally {
        await service.close();
    }
}

export function frameSupplementScorecard(records) {
    const summarize = (kind, scheduled) => {
        const selected = records.filter((row) => row.kind === kind);
        const blocked = selected.filter((row) => row.blocked?.length).length;
        const passed = selected.filter((row) => row.passed).length;
        return {
            scheduled,
            attempted: selected.length - blocked,
            passed,
            failed: selected.length - blocked - passed,
            blocked,
            missing: scheduled - selected.length,
        };
    };
    return {
        lifecycle: summarize("supplement", 9),
        pairedPerformance: summarize("paired-performance", 3),
    };
}

export async function runFrameEvaluation(options) {
    assert.equal(
        options.authorizedLiveBenchmark,
        true,
        "Explicit benchmark inference authorization is required",
    );
    assert.ok(
        path.isAbsolute(options.productRoot) &&
            path.isAbsolute(options.outputRoot),
        "Absolute product/output paths are required",
    );
    validateFrameFixture(frameFixture);
    const productRoot = await realpath(options.productRoot);
    const outputRoot = await realpath(options.outputRoot);
    const relativeOutput = path.relative(productRoot, outputRoot);
    assert.ok(
        relativeOutput === ".." ||
            relativeOutput.startsWith(`..${path.sep}`) ||
            path.isAbsolute(relativeOutput),
        "Run artifacts must be outside the product tree",
    );
    const run = await mkdtemp(path.join(outputRoot, "memory-frames-"));
    const state = {
        receiptId: randomUUID(),
        runDirectory: run,
        productRoot,
        startedAt: new Date().toISOString(),
        outcome: "IN_PROGRESS",
        productCommit: execFileSync(
            "git",
            ["-C", productRoot, "rev-parse", "HEAD"],
            { encoding: "utf8" },
        ).trim(),
        fixtureSha256: digest(canonical(frameFixture)),
        fixtureModuleSha256: digest(
            await readFile(new URL("./frame-fixtures.mjs", import.meta.url)),
        ),
        sourceDiffSha256: digest(
            execFileSync(
                "git",
                ["-C", productRoot, "diff", "HEAD", "--", "packages"],
                { encoding: "utf8" },
            ),
        ),
        harnessSha256: digest(await readFile(fileURLToPath(import.meta.url))),
        checkpoint: await compiledCheckpoint(productRoot),
        records: [],
        providerRequests: [],
    };
    let parent;
    if (options.continueFrom) {
        const parentRoot = await realpath(options.continueFrom);
        const parentBytes = await readFile(path.join(parentRoot, "state.json"));
        parent = JSON.parse(parentBytes);
        validateFrameContinuation(
            parent,
            JSON.parse(
                await readFile(path.join(parentRoot, "ownership.json"), "utf8"),
            ),
            state.checkpoint,
            state.fixtureSha256,
        );
        assert.equal(await realpath(parent.runDirectory), parentRoot);
        assert.equal(parent.productRoot, productRoot);
        state.continuation = {
            parentRunDirectory: parentRoot,
            parentStateSha256: digest(parentBytes),
            parentHarnessSha256: parent.harnessSha256,
        };
        state.prerequisiteScorecard = parent.scorecard;
        state.corpusId = parent.corpusId;
        state.accepted = true;
        await cp(
            path.join(parentRoot, "isolated-store"),
            path.join(run, "isolated-store"),
            { recursive: true, errorOnExist: true, force: false },
        );
    }
    await writeJson(path.join(run, "ownership.json"), {
        receiptId: state.receiptId,
        runDirectory: run,
    });
    await writeJson(path.join(run, "manifest.json"), {
        fixture: frameFixture,
        descriptor: measurementDescriptor,
        fixtureSha256: state.fixtureSha256,
        fixtureModuleSha256: state.fixtureModuleSha256,
    });
    await writeJson(path.join(run, "state.json"), state);
    process.stdout.write(
        JSON.stringify({ kind: "run-directory", runDirectory: run }) + "\n",
    );
    return withLiveRunLock(run, async () => {
        let role = "startup";
        const restore = observeProvider(state.providerRequests, () => role);
        const phase = (next) => {
            role = next;
            process.stdout.write(JSON.stringify({ phase: next }) + "\n");
        };
        const record = async (event) => {
            state.records.push(event);
            await appendFile(
                path.join(run, "results.jsonl"),
                JSON.stringify(event) + "\n",
            );
            await writeJson(path.join(run, "state.json"), state);
            process.stdout.write(
                JSON.stringify({
                    caseId: event.caseId,
                    kind: event.kind,
                    passed: event.passed,
                    milliseconds: event.milliseconds,
                }) + "\n",
            );
        };
        try {
            const runtime = await loadRuntime(productRoot);
            state.configuration = runtime.configuration;
            if (parent) {
                assert.deepEqual(
                    state.configuration,
                    parent.configuration,
                    "Configured arm changed",
                );
                await supplement(runtime, run, state, record, phase);
                const score = frameSupplementScorecard(state.records);
                state.outcome =
                    score.lifecycle.passed === 9 &&
                    score.pairedPerformance.passed === 3
                        ? "FRAME_SUPPLEMENT_COMPLETED"
                        : "FRAME_SUPPLEMENT_FAILED";
            } else {
                await pilot(runtime, run, state, record, phase);
                if (state.accepted) {
                    await lifecycle(runtime, run, state, record, phase);
                    await performanceReplay(runtime, run, state, record, phase);
                }
                state.outcome = state.accepted
                    ? "FRAME_PILOT_LIFECYCLE_PERFORMANCE_COMPLETED"
                    : "FRAME_PILOT_FAILED";
            }
        } catch (error) {
            state.outcome = "EXECUTION_FAILED";
            state.failure = frameFailure(error);
            await record({
                kind: "execution",
                caseId: role,
                passed: false,
                failure: state.failure,
            });
        } finally {
            restore();
            state.finishedAt = new Date().toISOString();
            state.scorecard = parent
                ? undefined
                : frameScorecard(state.records);
            state.actualModels = [
                ...new Set(
                    modelRequests(state.providerRequests)
                        .map((event) => event.model)
                        .filter(Boolean),
                ),
            ];
            await writeJson(path.join(run, "state.json"), state);
            await writeJson(path.join(run, "summary.json"), {
                outcome: state.outcome,
                scorecard: state.scorecard,
                prerequisiteScorecard: state.prerequisiteScorecard,
                supplementScorecard: parent
                    ? frameSupplementScorecard(state.records)
                    : undefined,
                actualModels: state.actualModels,
                providerRequests: modelRequests(state.providerRequests).length,
                failure: state.failure,
            });
        }
        return {
            runDirectory: run,
            outcome: state.outcome,
            scorecard: state.scorecard,
        };
    });
}

if (
    process.argv[1] &&
    fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
    const { values } = parseArgs({
        options: {
            product: { type: "string" },
            output: { type: "string" },
            "continue-from": { type: "string" },
            "authorized-live-benchmark": { type: "boolean" },
        },
    });
    const result = await runFrameEvaluation({
        productRoot: values.product,
        outputRoot: values.output,
        authorizedLiveBenchmark: values["authorized-live-benchmark"],
        continueFrom: values["continue-from"],
    });
    process.stdout.write(JSON.stringify(result) + "\n");
    process.exitCode = [
        "FRAME_PILOT_LIFECYCLE_PERFORMANCE_COMPLETED",
        "FRAME_SUPPLEMENT_COMPLETED",
    ].includes(result.outcome)
        ? 0
        : 1;
}
