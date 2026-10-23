// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
    mkdirSync,
    readFileSync,
    readdirSync,
    rmSync,
    writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
    enqueueRecipeAuthoring,
    prepareRecipeAuthorRequest,
    recipeAuthorToolAllowlist,
    sealRecipeAuthoringContext,
    verifyRecipeAuthoringContext,
    type RecipeAuthoringContext,
    type RecipeAuthoringContextStore,
    type RecipeTaskCompletion,
    type SealedRecipeAuthoringContext,
} from "../src/recipeAuthoring.js";
import { parseRecipeAuthorCandidate } from "../src/recipeAuthoringCandidate.js";
import {
    DurableRecipeAuthoringContextStore,
    parseRecipeAuthoringEnvelope,
} from "../src/recipeAuthoringStore.js";
import {
    claimRecipeAuthoring,
    failRecipeAuthoring,
    submitRecipeCandidate,
    type RecipeAuthoringValidationPlan,
} from "../src/recipeAuthoringValidation.js";
import { DurableRecipeCatalog } from "../src/recipeCatalog.js";
import {
    recipeDigest,
    recipeRuntimeAbi,
    recipeSchemaDigest,
    sealRecipeArtifact,
    type RecipeArtifact,
    type RecipeCapture,
    type RecipeCatalog,
    type RecipeCatalogEntry,
    type RecipeCatalogTransaction,
    type RecipeJob,
    type RecipeScope,
} from "../src/recipeCore.js";
import { FakeRecipeHost } from "../src/recipeTesting.js";

const scope: RecipeScope = { workspaceId: "workspace", profileId: "profile" };
const now = "2026-10-15T20:00:00.000Z";
const expiry = "2026-10-15T21:00:00.000Z";

class ContextStore implements RecipeAuthoringContextStore {
    readonly envelopes = new Map<string, SealedRecipeAuthoringContext>();
    fail = false;

    async put(envelope: SealedRecipeAuthoringContext) {
        if (this.fail) throw new Error("Persistence unavailable.");
        const id = envelope.context.capture.captureId;
        const existing = this.envelopes.get(id);
        if (existing && existing.digest !== envelope.digest)
            throw new Error("Immutable context conflict.");
        this.envelopes.set(id, structuredClone(envelope));
    }

    async get(_scope: RecipeScope, id: string) {
        return structuredClone(this.envelopes.get(id));
    }
}

class Catalog implements RecipeCatalog {
    revision = 0;
    captures = new Map<string, RecipeCapture>();
    jobs = new Map<string, RecipeJob>();
    entries: RecipeCatalogEntry[] = [];
    conflict = false;
    failUpdates = false;

    async snapshot(requestedScope: RecipeScope) {
        return {
            scope: requestedScope,
            catalogRevision: this.revision,
            entries: structuredClone(this.entries),
        };
    }

    async transact(
        _scope: RecipeScope,
        expectedRevision: number,
        mutate: (transaction: RecipeCatalogTransaction) => void,
    ) {
        if (this.conflict || expectedRevision !== this.revision)
            return {
                status: "conflict" as const,
                catalogRevision: this.revision,
            };
        const jobs = structuredClone(this.jobs);
        const captures = structuredClone(this.captures);
        const entries = structuredClone(this.entries);
        const artifacts: RecipeArtifact[] = [];
        mutate({
            enqueueCapture: (capture, job) => {
                if (captures.has(capture.captureId) || jobs.has(job.jobId))
                    return "existing";
                captures.set(capture.captureId, structuredClone(capture));
                jobs.set(job.jobId, structuredClone(job));
                return "inserted";
            },
            claimJob: (jobId, ownerId, _now, expiresAt) => {
                const job = jobs.get(jobId);
                if (
                    !job ||
                    job.state === "ready" ||
                    job.state === "prepared" ||
                    (job.claim && job.claim.expiresAt > _now)
                )
                    return undefined;
                const claimed = {
                    ...job,
                    attempt: job.attempt + 1,
                    claim: {
                        ownerId,
                        expiresAt,
                        token: `claim-${job.attempt + 1}`,
                    },
                };
                jobs.set(jobId, claimed);
                return structuredClone(claimed);
            },
            updateJob: (job, token) => {
                if (
                    this.failUpdates ||
                    jobs.get(job.jobId)?.claim?.token !== token
                )
                    throw new Error("Stale or unavailable job claim.");
                jobs.set(job.jobId, structuredClone(job));
            },
            putImmutable: (artifact) =>
                artifacts.push(structuredClone(artifact)),
            publish: (ref, captureId, state) => {
                const artifact = artifacts.find(
                    (artifact) => artifact.revision === ref.revision,
                );
                if (!artifact) throw new Error("Missing immutable artifact.");
                entries.push({ artifact, captureId, state });
            },
            invalidate: () => {
                throw new Error("Not used by authoring.");
            },
        });
        this.jobs = jobs;
        this.captures = captures;
        this.entries = entries;
        return {
            status: "committed" as const,
            catalogRevision: ++this.revision,
        };
    }

    subscribe() {
        return () => {};
    }
}

function task(): RecipeTaskCompletion {
    return {
        token: {
            id: "token",
            status: "claimed",
            sessionId: "session",
            expiresAt: expiry,
            learning: true,
        },
        taskId: "task",
        selectedTaskId: "task",
        sessionId: "session",
        origin: "task",
        outcome: "succeeded",
        successEventId: "answer",
        now,
    };
}

function context(): RecipeAuthoringContext {
    return {
        capture: {
            captureId: "capture",
            tokenId: "token",
            sessionId: "session",
            taskId: "task",
            boundary: { firstEventId: "request", lastEventId: "answer" },
            origin: "task",
            outcome: "succeeded",
            scope,
            mode: "read-only",
            request: "Return a greeting for Ada.",
            decisionSummary:
                "Use the current input name, not a historical name.",
            contextArtifacts: [],
            omissions: [],
            outputEvidenceIds: ["output"],
            calls: [],
        },
        constraints: ["Return complete output."],
        messages: [
            { eventId: "request", role: "user", content: "Greet Ada." },
            { eventId: "answer", role: "assistant", content: "Hello Ada" },
        ],
        workingCode: [
            {
                id: "working",
                language: "typescript",
                text: 'return "Hello " + input;',
                version: "1",
            },
        ],
        capabilities: [],
        outputs: [
            { id: "output", eventId: "answer", evidence: { raw: "Hello Ada" } },
        ],
        omissions: [],
    };
}

function candidate(): RecipeArtifact {
    const source =
        'export async function execute(api, input) { return "Hello " + input; }';
    return sealRecipeArtifact({
        schemaVersion: 1,
        kind: "program",
        recipeId: "greet",
        name: "Greet",
        description: "Greet the supplied name.",
        execution: "symbolic",
        authorization: "live_host",
        source: {
            language: "typescript",
            text: source,
            digest: recipeDigest(source),
        },
        executable: {
            language: "javascript",
            text: source,
            digest: recipeDigest(source),
            sourceDigest: recipeDigest(source),
            runtimeAbi: recipeRuntimeAbi,
            compiler: {
                name: "fixture",
                version: "1",
                optionsDigest: "options",
            },
        },
        inputSchema: { type: "string" },
        outputSchema: { type: "string" },
        output: {
            kind: "content",
            requirements: ["Full greeting"],
            identity: "current_run",
        },
        capabilities: [],
        semanticFunctions: [],
        applicability: {
            assumptions: ["One name"],
            unsupported: ["Missing name"],
        },
        generalization: [
            {
                kind: "parameter",
                name: "name",
                producer: "input",
                evidenceIds: ["output"],
            },
        ],
        specification: {
            id: "greeting-spec",
            revision: "1",
            intent: "Greet the supplied name.",
            outputRequirements: ["Hello followed by current name"],
            rubric: "No historical name.",
            counterexamples: ["Different name", "Missing name"],
        },
        matching: {
            grammar: ["<Start> = greet $(name:string) -> { name };"],
            examples: [
                { request: "greet Ada", input: "Ada", evidenceIds: ["output"] },
            ],
            negatives: ["delete greeting"],
            collisionEvidenceIds: [],
        },
        provenance: {
            captureId: "capture",
            tokenId: "token",
            taskId: "task",
            evidenceIds: ["output"],
        },
        fixtures: [
            {
                id: "author-claimed",
                origin: "synthetic",
                result: "passed",
                specificationRevision: "1",
                noLiveEffects: true,
            },
        ],
        createdAt: now,
    });
}

function plan(artifact = candidate()): RecipeAuthoringValidationPlan {
    return {
        implementationRevision: artifact.revision,
        specification: structuredClone(artifact.specification),
        fixtures: ["Ada", "Grace"].map((name, index) => ({
            id: `greet-${name}`,
            origin: index === 0 ? "observed" : "independent",
            input: name,
            expected: { status: "passed", output: `Hello ${name}` },
            createHost: () => new FakeRecipeHost(),
            context: {
                runId: `fixture-${name}`,
                callId: "greet",
                signal: new AbortController().signal,
                binding: {
                    ...scope,
                    providerId: "fixture",
                    accountId: "account",
                    sessionId: "session",
                    generation: "1",
                },
            },
            execute: async (_host, input) => `Hello ${input}`,
        })),
    };
}

async function start(
    captureContext = context(),
    store = new ContextStore(),
    catalog = new Catalog(),
) {
    await enqueueRecipeAuthoring(captureContext, task(), store, catalog);
    const job = [...catalog.jobs.values()][0];
    const attempt = await claimRecipeAuthoring(catalog, store, {
        job,
        ownerId: "reviewer",
        now,
        expiresAt: expiry,
    });
    if (attempt.status !== "authoring") throw new Error(attempt.message);
    return { store, catalog, job: attempt.job, request: attempt.request };
}

describe("host-independent contextual recipe authoring", () => {
    it.each([false, true])(
        "recovers catalog jobs across reopen with missing context=%s",
        async (missingContext) => {
            const directory = resolve(".recipe-authoring-tests", randomUUID());
            mkdirSync(directory, { recursive: true });
            let store = new DurableRecipeAuthoringContextStore(directory);
            let catalog = new DurableRecipeCatalog(directory);
            try {
                const enqueue = await enqueueRecipeAuthoring(
                    context(),
                    task(),
                    store,
                    catalog,
                );
                if (
                    enqueue.learning.status !== "queued" &&
                    enqueue.learning.status !== "existing"
                )
                    throw new Error(JSON.stringify(enqueue));
                const jobId = enqueue.learning.jobId;
                catalog.close();
                catalog = new DurableRecipeCatalog(directory);
                store = new DurableRecipeAuthoringContextStore(directory);
                const job = await catalog.getJob(scope, jobId);
                if (!job) throw new Error("Queued job was not retained.");
                if (missingContext)
                    rmSync(resolve(directory, "recipe-authoring-context"), {
                        recursive: true,
                        force: true,
                    });
                const attempt = await claimRecipeAuthoring(catalog, store, {
                    job,
                    ownerId: "offline-reviewer",
                    now: new Date().toISOString(),
                    expiresAt: new Date(Date.now() + 60_000).toISOString(),
                });
                if (missingContext) {
                    expect(attempt.status).toBe("blocked");
                } else {
                    if (attempt.status !== "authoring")
                        throw new Error(attempt.message);
                    const publication = await submitRecipeCandidate(
                        catalog,
                        store,
                        attempt.job,
                        candidate(),
                        plan(),
                    );
                    expect(publication).toMatchObject({
                        status: "published",
                        state: "ready",
                    });
                }
                catalog.close();
                catalog = new DurableRecipeCatalog(directory);
                expect(await catalog.getJob(scope, jobId)).toMatchObject({
                    state: missingContext ? "blocked" : "ready",
                });
                expect((await catalog.snapshot(scope)).entries).toHaveLength(
                    missingContext ? 0 : 1,
                );
            } finally {
                catalog.close();
                rmSync(directory, { recursive: true, force: true });
            }
        },
    );
    async function withDurableStore(
        run: (
            store: DurableRecipeAuthoringContextStore,
            directory: string,
        ) => Promise<void>,
    ) {
        const directory = resolve(
            ".recipe-authoring-store-tests",
            randomUUID(),
        );
        mkdirSync(directory, { recursive: true });
        try {
            await run(
                new DurableRecipeAuthoringContextStore(directory),
                directory,
            );
        } finally {
            rmSync(directory, { recursive: true, force: true });
        }
    }

    function putFromProcess(
        directory: string,
        envelope: SealedRecipeAuthoringContext,
    ) {
        return new Promise<{ code: number | null; error: string }>(
            (resolve, reject) => {
                const process = spawn(
                    globalThis.process.execPath,
                    [
                        fileURLToPath(
                            new URL(
                                "./recipeAuthoringStoreProcess.js",
                                import.meta.url,
                            ),
                        ),
                        directory,
                    ],
                    { stdio: ["pipe", "pipe", "pipe"] },
                );
                let error = "";
                process.stderr.setEncoding("utf8");
                process.stderr.on("data", (chunk: string) => {
                    error += chunk;
                });
                process.stdout.resume();
                process.on("error", reject);
                process.on("close", (code) => resolve({ code, error }));
                process.stdin.end(JSON.stringify(envelope));
            },
        );
    }

    describe("durable scoped authoring context store", () => {
        it("retains immutable envelopes across restart and returns independent copies", async () => {
            await withDurableStore(async (store, directory) => {
                const envelope = sealRecipeAuthoringContext(context(), task());
                await store.put(envelope);
                const restarted = new DurableRecipeAuthoringContextStore(
                    directory,
                );
                const retained = await restarted.get(scope, "capture");
                expect(retained).toEqual(envelope);
                retained!.context.capture.request = "Changed copy";
                expect(await restarted.get(scope, "capture")).toEqual(envelope);
                await restarted.put(envelope);
                expect(
                    readdirSync(resolve(directory, "recipe-authoring-context")),
                ).toHaveLength(1);
            });
        });

        it("atomically deduplicates identical writers across processes", async () => {
            await withDurableStore(async (store, directory) => {
                const envelope = sealRecipeAuthoringContext(context(), task());
                const results = await Promise.all([
                    putFromProcess(directory, envelope),
                    putFromProcess(directory, envelope),
                    putFromProcess(directory, envelope),
                ]);
                expect(results.map((result) => result.code)).toEqual([0, 0, 0]);
                expect(await store.get(scope, "capture")).toEqual(envelope);
                expect(
                    readdirSync(resolve(directory, "recipe-authoring-context")),
                ).toHaveLength(1);
            });
        });

        it("retains exactly one immutable winner for different concurrent process writers", async () => {
            await withDurableStore(async (store, directory) => {
                const first = sealRecipeAuthoringContext(context(), task());
                const changed = context();
                changed.capture.decisionSummary =
                    "Different proposed decision summary.";
                const second = sealRecipeAuthoringContext(changed, task());
                const results = await Promise.all([
                    putFromProcess(directory, first),
                    putFromProcess(directory, second),
                ]);
                expect(results.map((result) => result.code).sort()).toEqual([
                    0, 1,
                ]);
                expect(
                    results.find((result) => result.code === 1)?.error,
                ).toContain("Immutable authoring context conflict");
                const retained = await store.get(scope, "capture");
                expect([first.digest, second.digest]).toContain(
                    retained?.digest,
                );
            });
        });

        it("never exposes crashed partial staging files and rejects corrupted published JSON", async () => {
            await withDurableStore(async (store, directory) => {
                const root = resolve(directory, "recipe-authoring-context");
                mkdirSync(root);
                writeFileSync(
                    resolve(root, ".pending-crashed"),
                    '{"schemaVersion":1,',
                );
                expect(await store.get(scope, "capture")).toBeUndefined();
                const envelope = sealRecipeAuthoringContext(context(), task());
                await store.put(envelope);
                const destination = resolve(
                    root,
                    `${recipeDigest(JSON.stringify([scope.workspaceId, scope.profileId, "capture"]))}.json`,
                );
                writeFileSync(destination, '{"schemaVersion":1,');
                await expect(store.get(scope, "capture")).rejects.toThrow(
                    /Cannot read retained/,
                );
                await expect(store.put(envelope)).rejects.toThrow(
                    /Cannot read retained/,
                );
                expect(readFileSync(destination, "utf8")).toBe(
                    '{"schemaVersion":1,',
                );
            });
        });

        it("guards scope identity and rejects path traversal without exposing another scope", async () => {
            await withDurableStore(async (store, directory) => {
                const envelope = sealRecipeAuthoringContext(context(), task());
                await store.put(envelope);
                await expect(
                    store.get({ ...scope, profileId: "other" }, "capture"),
                ).resolves.toBeUndefined();
                await expect(store.get(scope, "..\\capture")).rejects.toThrow(
                    /identity/,
                );
                await expect(
                    store.get(
                        { ...scope, workspaceId: "../outside" },
                        "capture",
                    ),
                ).rejects.toThrow(/identity/);
                const root = resolve(directory, "recipe-authoring-context");
                const filename = readdirSync(root)[0];
                const other = { ...scope, profileId: "other" };
                writeFileSync(
                    resolve(
                        root,
                        `${recipeDigest(JSON.stringify([other.workspaceId, other.profileId, "capture"]))}.json`,
                    ),
                    readFileSync(resolve(root, filename)),
                );
                await expect(store.get(other, "capture")).rejects.toThrow(
                    /scope or capture mismatch/,
                );
            });
            expect(
                () => new DurableRecipeAuthoringContextStore("relative"),
            ).toThrow(/absolute/);
        });

        it.each([
            { password: "fixture-secret" },
            { access_token: "fixture-token" },
            "Bearer fixture-token",
            "-----BEGIN PRIVATE KEY-----",
        ])(
            "rejects credential-bearing context rather than persisting it (%j)",
            async (raw) => {
                await withDurableStore(async (store, directory) => {
                    const value = context();
                    value.outputs[0].evidence.raw = raw;
                    const envelope = sealRecipeAuthoringContext(value, task());
                    await expect(store.put(envelope)).rejects.toThrow(
                        /Credential/,
                    );
                    expect(readdirSync(directory)).toEqual([]);
                });
            },
        );

        it("rejects unsupported context fields and format versions explicitly", async () => {
            await withDurableStore(async (store, directory) => {
                const envelope = sealRecipeAuthoringContext(context(), task());
                const unsupported = {
                    ...envelope,
                    unsupportedHistory: "unscoped",
                };
                await expect(store.put(unsupported)).rejects.toThrow(
                    /Unsupported/,
                );
                expect(() =>
                    parseRecipeAuthoringEnvelope('{"digest":"bad"}'),
                ).toThrow();
                await store.put(envelope);
                const root = resolve(directory, "recipe-authoring-context");
                const filename = readdirSync(root)[0];
                writeFileSync(
                    resolve(root, filename),
                    JSON.stringify({ schemaVersion: 2, envelope }),
                );
                await expect(store.get(scope, "capture")).rejects.toThrow(
                    /version/,
                );
            });
        });

        it("retains omitted private artifacts as scoped references without reading or expanding bytes", async () => {
            await withDurableStore(async (store, directory) => {
                const value = context();
                value.outputs[0].evidence = {
                    privateArtifacts: [
                        {
                            scope,
                            taskId: "task",
                            reference: {
                                schemaVersion: 1,
                                capability: "private-result-evidence-v1",
                                owner: "trace",
                                ownerId: "opaque-owner",
                                toolCallId: "opaque-call",
                                source: "result",
                                id: "opaque-private-artifact",
                                encoding: "json-utf8",
                                sha256: recipeDigest("not copied"),
                                sizeBytes: 10000,
                                sensitive: true,
                                view: { omitted: true },
                                omittedPaths: [["payload"]],
                                blobs: [],
                            },
                        },
                    ],
                };
                value.omissions.push({
                    material: "raw private bytes",
                    reason: "Retained in scoped private artifact.",
                    required: false,
                });
                const envelope = sealRecipeAuthoringContext(value, task());
                await store.put(envelope);
                expect(
                    await new DurableRecipeAuthoringContextStore(directory).get(
                        scope,
                        "capture",
                    ),
                ).toEqual(envelope);
                const persisted = readFileSync(
                    resolve(
                        directory,
                        "recipe-authoring-context",
                        readdirSync(
                            resolve(directory, "recipe-authoring-context"),
                        )[0],
                    ),
                    "utf8",
                );
                expect(persisted).not.toContain("not copied");
            });
        });
    });
    it.each([
        [
            "unknown top-level field",
            (value: Record<string, unknown>) => {
                value.extra = true;
            },
        ],
        [
            "invalid output kind",
            (value: Record<string, unknown>) => {
                (value.output as Record<string, unknown>).kind = "invented";
            },
        ],
        [
            "malformed grammar",
            (value: Record<string, unknown>) => {
                (value.matching as Record<string, unknown>).grammar =
                    "not-an-array";
            },
        ],
        [
            "missing fixture safety",
            (value: Record<string, unknown>) => {
                value.fixtures = [{ id: "unsafe" }];
            },
        ],
        [
            "unknown generalization",
            (value: Record<string, unknown>) => {
                value.generalization = [
                    { kind: "invented", name: "name", evidenceIds: ["output"] },
                ];
            },
        ],
    ])(
        "strictly rejects child JSON with %s before integrity checks",
        (_label, mutate) => {
            const value = JSON.parse(JSON.stringify(candidate())) as Record<
                string,
                unknown
            >;
            mutate(value);
            expect(() =>
                parseRecipeAuthorCandidate(JSON.stringify(value)),
            ).toThrow(/Malformed candidate/);
        },
    );

    it("parses complete child JSON but does not claim source compilation or containment", () => {
        expect(parseRecipeAuthorCandidate(JSON.stringify(candidate()))).toEqual(
            candidate(),
        );
        expect(() => parseRecipeAuthorCandidate("plain answer")).toThrow();
        expect(() => parseRecipeAuthorCandidate("null")).toThrow();
    });

    it("seals explicit selected-task success and complete context without hidden reasoning", () => {
        const input = context();
        const sealed = sealRecipeAuthoringContext(input, task());
        input.workingCode[0].text = "changed";
        expect(sealed.context.workingCode[0].text).not.toBe("changed");
        expect(Object.isFrozen(sealed.context.messages)).toBe(true);
        expect(() =>
            verifyRecipeAuthoringContext(sealed, "capture"),
        ).not.toThrow();
        const tampered = structuredClone(sealed);
        tampered.context.capture.request = "Different task";
        expect(() => verifyRecipeAuthoringContext(tampered, "capture")).toThrow(
            /digest/,
        );
    });

    it.each([
        [
            "failed task",
            (t: RecipeTaskCompletion) => {
                t.outcome = "failed";
            },
        ],
        [
            "aborted task",
            (t: RecipeTaskCompletion) => {
                t.outcome = "aborted";
            },
        ],
        [
            "incomplete task",
            (t: RecipeTaskCompletion) => {
                t.outcome = "incomplete";
            },
        ],
        [
            "author child",
            (t: RecipeTaskCompletion) => {
                t.origin = "recipe_author";
            },
        ],
        [
            "validator child",
            (t: RecipeTaskCompletion) => {
                t.origin = "recipe_validator";
            },
        ],
        [
            "wrong task",
            (t: RecipeTaskCompletion) => {
                t.selectedTaskId = "other";
            },
        ],
        [
            "wrong token",
            (t: RecipeTaskCompletion) => {
                t.token.id = "other";
            },
        ],
        [
            "idle token",
            (t: RecipeTaskCompletion) => {
                t.token.status = "armed";
            },
        ],
        [
            "wrong session",
            (t: RecipeTaskCompletion) => {
                t.sessionId = "other";
            },
        ],
        [
            "expired token",
            (t: RecipeTaskCompletion) => {
                t.token.expiresAt = now;
            },
        ],
        [
            "no success event",
            (t: RecipeTaskCompletion) => {
                t.successEventId = "idle";
            },
        ],
    ])(
        "rejects %s rather than deriving success from idle or tool completion",
        (_label, change) => {
            const completion = task();
            change(completion);
            expect(() =>
                sealRecipeAuthoringContext(context(), completion),
            ).toThrow();
        },
    );

    it.each([
        [
            "missing output",
            (c: RecipeAuthoringContext) => {
                c.outputs = [];
            },
        ],
        [
            "empty output",
            (c: RecipeAuthoringContext) => {
                c.outputs[0].evidence = {};
            },
        ],
        [
            "wrong boundary",
            (c: RecipeAuthoringContext) => {
                c.capture.boundary.firstEventId = "other";
            },
        ],
        [
            "required omission",
            (c: RecipeAuthoringContext) => {
                c.omissions.push({
                    material: "source",
                    reason: "unavailable",
                    required: true,
                });
            },
        ],
        [
            "unknown tool call",
            (c: RecipeAuthoringContext) => {
                c.messages[1].callId = "other";
            },
        ],
        [
            "orphan nested call",
            (c: RecipeAuthoringContext) => {
                c.capture.calls.push({
                    callId: "child",
                    parentCallId: "missing",
                    executionOwner: "host",
                });
            },
        ],
    ])("rejects %s", (_label, change) => {
        const input = context();
        change(input);
        expect(() => sealRecipeAuthoringContext(input, task())).toThrow();
    });

    it("persists before acknowledging and deduplicates repeated completion events", async () => {
        const store = new ContextStore();
        const catalog = new Catalog();
        const first = await enqueueRecipeAuthoring(
            context(),
            task(),
            store,
            catalog,
        );
        const repeat = await enqueueRecipeAuthoring(
            context(),
            task(),
            store,
            catalog,
        );
        expect(first.learning.status).toBe("queued");
        expect(repeat.learning.status).toBe("existing");
        expect(catalog.jobs.size).toBe(1);
        expect(store.envelopes.size).toBe(1);
        const changed = context();
        changed.capture.request = "Different request";
        expect(
            (await enqueueRecipeAuthoring(changed, task(), store, catalog))
                .learning.status,
        ).toBe("failed");
    });

    it("keeps original answer success separate from persistence and CAS failure", async () => {
        const store = new ContextStore();
        const catalog = new Catalog();
        store.fail = true;
        const failed = await enqueueRecipeAuthoring(
            context(),
            task(),
            store,
            catalog,
        );
        expect(failed).toMatchObject({
            taskOutcome: "succeeded",
            learning: { status: "failed" },
        });
        expect(catalog.jobs.size).toBe(0);
        store.fail = false;
        catalog.conflict = true;
        expect(
            (await enqueueRecipeAuthoring(context(), task(), store, catalog))
                .learning.status,
        ).toBe("failed");
        expect(catalog.jobs.size).toBe(0);
        catalog.conflict = false;
        expect(
            (await enqueueRecipeAuthoring(context(), task(), store, catalog))
                .learning.status,
        ).toBe("queued");
    });

    it("does not enqueue or persist with learning off", async () => {
        const input = context();
        input.capture.mode = "off";
        const store = new ContextStore();
        const catalog = new Catalog();
        expect(
            (await enqueueRecipeAuthoring(input, task(), store, catalog))
                .learning.status,
        ).toBe("off");
        expect(store.envelopes.size).toBe(0);
        expect(catalog.jobs.size).toBe(0);
    });

    it("produces restricted request data only, with no child launch or business-operation surface", async () => {
        const { request, catalog } = await start();
        expect(request.tools).toEqual(recipeAuthorToolAllowlist);
        expect(request.requiresHostEnforcedToolRestriction).toBe(true);
        expect(request.instructions).toContain("Do not invoke business tools");
        expect(request.tools).not.toContain("invoke_capability");
        expect(catalog.entries).toEqual([]);
    });

    it("recovers from retained context or durably blocks when it is missing", async () => {
        const store = new ContextStore();
        const catalog = new Catalog();
        await enqueueRecipeAuthoring(context(), task(), store, catalog);
        store.envelopes.clear();
        const attempt = await claimRecipeAuthoring(catalog, store, {
            job: [...catalog.jobs.values()][0],
            ownerId: "later-session",
            now,
            expiresAt: expiry,
        });
        expect(attempt.status).toBe("blocked");
        expect([...catalog.jobs.values()][0]).toMatchObject({
            state: "blocked",
            message: "Missing retained task context.",
        });
    });

    it("rejects corrupted retained context and a mismatched job scope", async () => {
        const { store, job } = await start();
        await expect(
            prepareRecipeAuthorRequest(
                { ...job, scope: { ...scope, profileId: "other" } },
                store,
            ),
        ).rejects.toThrow(/scope/);
        store.envelopes.get("capture")!.context.capture.request = "tampered";
        await expect(prepareRecipeAuthorRequest(job, store)).rejects.toThrow(
            /digest/,
        );
    });

    it.each(["prepare", "read-only", "all"] as const)(
        "validates independent fresh-input fixtures and atomically publishes %s",
        async (mode) => {
            const input = context();
            input.capture.mode = mode;
            const { store, catalog, job } = await start(input);
            const result = await submitRecipeCandidate(
                catalog,
                store,
                job,
                candidate(),
                plan(),
            );
            expect(result.status).toBe("published");
            if (result.status !== "published") return;
            expect(result.state).toBe(
                mode === "prepare" ? "prepared" : "ready",
            );
            expect(
                result.artifact.fixtures.map((fixture) => fixture.id),
            ).toEqual(["greet-Ada", "greet-Grace"]);
            expect(catalog.entries).toHaveLength(1);
            expect(catalog.jobs.get(job.jobId)?.result?.revision).toBe(
                result.artifact.revision,
            );
        },
    );

    it("fails on wrong fresh output, without publishing or replaying the original task", async () => {
        const { store, catalog, job } = await start();
        const validation = plan();
        validation.fixtures[1].execute = async () => "Hello Ada";
        const result = await submitRecipeCandidate(
            catalog,
            store,
            job,
            candidate(),
            validation,
        );
        expect(result).toMatchObject({
            status: "failed",
            recoveryPersisted: true,
        });
        expect(catalog.entries).toEqual([]);
        expect(catalog.jobs.get(job.jobId)?.state).toBe("failed");
    });

    it("retains the specification across implementation revisions and rejects self-asserted tests", async () => {
        const { store, catalog, job } = await start();
        const validation = plan();
        validation.specification.revision = "independent-revision";
        const result = await submitRecipeCandidate(
            catalog,
            store,
            job,
            candidate(),
            validation,
        );
        expect(result).toMatchObject({
            status: "failed",
            message: expect.stringContaining("specification"),
        });
        expect(catalog.entries).toEqual([]);
    });

    it.each(["missing-independent", "same-input", "wrong-provenance"] as const)(
        "rejects %s validation",
        async (kind) => {
            const { store, catalog, job } = await start();
            const validation = plan();
            const artifact = structuredClone(candidate());
            if (kind === "missing-independent")
                validation.fixtures[1].origin = "synthetic";
            if (kind === "same-input") validation.fixtures[1].input = "Ada";
            if (kind === "wrong-provenance")
                artifact.provenance.taskId = "other";
            const result = await submitRecipeCandidate(
                catalog,
                store,
                job,
                artifact,
                validation,
            );
            expect(result.status).toBe("failed");
            expect(catalog.entries).toEqual([]);
        },
    );

    it("supports explicit insufficient-context reporting without invalidating task success", async () => {
        const { catalog, job } = await start();
        expect(
            await failRecipeAuthoring(
                catalog,
                job,
                "blocked",
                "Missing selection rule.",
            ),
        ).toMatchObject({ status: "blocked", recoveryPersisted: true });
        expect(catalog.jobs.get(job.jobId)?.message).toBe(
            "Missing selection rule.",
        );
        catalog.failUpdates = true;
        expect(
            await failRecipeAuthoring(
                catalog,
                job,
                "failed",
                "Validation failed.",
            ),
        ).toMatchObject({ status: "failed", recoveryPersisted: false });
    });

    it.each(["read-only", "all"] as const)(
        "uses only fake write fixtures and respects %s publication",
        async (mode) => {
            const input = context();
            input.capture.mode = mode;
            const capability = {
                id: "send",
                transport: "native" as const,
                providerId: "fixture",
                operation: "send",
                contractVersion: "1",
                inputSchema: { type: "string" as const },
                outputSchema: { type: "string" as const },
                schemaDigest: recipeSchemaDigest(
                    { type: "string" },
                    { type: "string" },
                ),
                compatibility: "exact" as const,
                effect: "write" as const,
            };
            input.capabilities = [capability];
            const base = candidate();
            const { revision: _revision, ...draft } = base;
            const artifact = sealRecipeArtifact({
                ...draft,
                capabilities: [capability],
            });
            const validation = plan(artifact);
            let fakeWrites = 0;
            validation.fixtures.forEach((fixture) => {
                fixture.createHost = () => {
                    const host = new FakeRecipeHost();
                    host.registerCapability(capability, (value) => {
                        fakeWrites++;
                        return { status: "completed", value };
                    });
                    return host;
                };
                fixture.execute = async (host, value, call, implementation) => {
                    expect(implementation.revision).toBe(artifact.revision);
                    const output = await host.invokeCapability(
                        capability,
                        value,
                        call,
                    );
                    if (output.status !== "completed")
                        throw new Error(output.status);
                    return `Hello ${output.value}`;
                };
            });
            const { store, catalog, job } = await start(input);
            expect(
                await submitRecipeCandidate(
                    catalog,
                    store,
                    job,
                    artifact,
                    validation,
                ),
            ).toMatchObject({
                status: "published",
                state: mode === "read-only" ? "prepared" : "ready",
            });
            expect(fakeWrites).toBe(2);
            expect(catalog.entries).toHaveLength(1);
        },
    );

    it("rejects malformed submission payloads with an explicit persisted failure", async () => {
        const { store, catalog, job } = await start();
        const result = await submitRecipeCandidate(
            catalog,
            store,
            job,
            '{"kind":"program"}',
            plan(),
        );
        expect(result).toMatchObject({
            status: "failed",
            recoveryPersisted: true,
        });
        expect(catalog.entries).toEqual([]);
    });
});
