// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
    FileMemoryService,
    createMemoryServiceRpcFacade,
} from "@typeagent/memory-service";
import { FakeProcedureCorpusIndex } from "../../../memory/service/dist/test/fakeProcedureCorpusIndex.js";
import { createMemoryHubRunbookFunctions } from "../dist/agent/memoryHubRunbooks.mjs";
import { addRunbookInbox } from "../dist/agent/memoryHubRunbookInbox.mjs";
import { validateViewRequest } from "../dist/views/server/features/views/viewValidation.mjs";

async function fixture(t, options = {}) {
    const root = await mkdtemp(
        path.join(os.tmpdir(), "typeagent-runbook-view-"),
    );
    const service = new FileMemoryService(root, {
        indexFactory: (_id, directory) =>
            new FakeProcedureCorpusIndex(directory),
        procedureIndexFactory: (_id, directory) =>
            new FakeProcedureCorpusIndex(directory),
        eventIndexFactory: (_id, directory) =>
            new FakeProcedureCorpusIndex(directory),
        ...options,
    });
    t.after(async () => {
        await service.close();
        await rm(root, { recursive: true, force: true });
    });
    const corpus = await service.createCorpus("Runbook adapter fixtures");
    const ingest = await service.ingestDocument({
        corpusId: corpus.corpusId,
        source: {
            sourceType: "markdown",
            title: "Exact original",
            markdown: "Check the worker.\nThen stop.",
            canonicalUri: "urn:fixture:worker",
        },
    });
    await waitForJob(service, ingest.jobId);
    const citation = {
        sourceId: ingest.sourceId,
        revisionId: ingest.revisionId,
        locator: "chars:0-17",
        excerpt: "Check the worker.",
    };
    const document = {
        title: "Worker guide",
        steps: ["Check the worker."],
        citations: [citation],
        additionalSections: [
            { heading: "Site notes", content: "Keep this unknown section." },
        ],
    };
    const saved = await service.saveProcedure({
        corpusId: corpus.corpusId,
        document,
    });
    return {
        service,
        corpus,
        ingest,
        citation,
        saved,
        hub: createMemoryHubRunbookFunctions(
            () => service,
            () => undefined,
        ),
    };
}
async function waitForJob(service, jobId) {
    for (let index = 0; index < 200; index++) {
        const job = await service.getJob(jobId);
        if (
            job &&
            ["complete", "partial", "failed", "cancelled"].includes(job.state)
        ) {
            assert.notEqual(job.state, "failed", job.error);
            return job;
        }
        await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error("Offline fixture ingestion did not finish");
}
function edition(citation) {
    return {
        schemaVersion: 1,
        goal: "Check the worker",
        applicability: [],
        inputs: [],
        preconditions: [],
        steps: [
            {
                id: "check",
                title: "Check",
                humanText: "Check the worker.",
                agentInstruction: "Check the worker.",
                safety: "unknown",
                citations: [citation],
                manualReason: "Review manually",
            },
        ],
        verification: [],
        rollback: [],
        synthesis: { sourceReferences: [citation] },
        review: { state: "draft" },
    };
}

test("Runbooks retain old-guide eligibility, exact originals and additional sections", async (t) => {
    const { hub, corpus, saved, ingest } = await fixture(t);
    const page = await hub.memoryHubRunbooks({
        corpusId: corpus.corpusId,
        states: ["saved"],
    });
    assert.equal(page.total, 1);
    assert.equal(page.items[0].readiness, "howto");
    assert.match(page.warnings.join(" "), /catalogs are unavailable/);
    const detail = await hub.memoryHubRunbook({
        corpusId: corpus.corpusId,
        kind: "procedure",
        objectId: saved.procedureId,
    });
    assert.equal(detail.originals[0].citation.revisionId, ingest.revisionId);
    assert.equal(detail.originals[0].content, "Check the worker.\nThen stop.");
    assert.deepEqual(detail.originals[0].location, {
        kind: "characters",
        start: 0,
        end: 17,
    });
    assert.equal(
        detail.procedure.document.additionalSections[0].heading,
        "Site notes",
    );
});

test("Used by joins every retained version, pages stable identities and rejects scope changes", async (t) => {
    const { hub, corpus, saved, ingest } = await fixture(t);
    const next = await hub.memoryHubSaveRunbook({
        corpusId: corpus.corpusId,
        procedureId: saved.procedureId,
        expectedVersion: saved.version,
        document: { ...saved.document, steps: ["Check manually", "Verify"] },
    });
    const page = await hub.memoryHubRunbookUsedBy({
        corpusId: corpus.corpusId,
        sourceId: ingest.sourceId,
        pageSize: 1,
    });
    assert.equal(page.total, 2);
    assert.equal(page.items[0].procedure.version, next.version);
    assert.equal("canonicalJson" in page.items[0].procedure, false);
    const older = await hub.memoryHubRunbookUsedBy({
        corpusId: corpus.corpusId,
        sourceId: ingest.sourceId,
        pageSize: 1,
        continuationToken: page.nextContinuationToken,
    });
    assert.equal(older.items[0].procedure.version, saved.version);
    await assert.rejects(
        hub.memoryHubRunbookUsedBy({
            corpusId: corpus.corpusId,
            sourceId: "another-source",
            continuationToken: page.nextContinuationToken,
        }),
        /another scope|results changed/,
    );
    const history = await hub.memoryHubRunbookHistory({
        corpusId: corpus.corpusId,
        procedureId: saved.procedureId,
        pageSize: 1,
    });
    assert.equal(history.items[0].version, next.version);
    assert.equal("markdown" in history.items[0], false);
    await assert.rejects(
        hub.memoryHubSaveRunbook({
            corpusId: corpus.corpusId,
            procedureId: saved.procedureId,
            expectedVersion: saved.version,
            document: saved.document,
        }),
        /conflict|version/i,
    );
});

test("Manual binding requires explicit safety, saves a new draft and never calls execution", async (t) => {
    const { hub, corpus, saved, citation, service } = await fixture(t);
    const draft = await hub.memoryHubSaveRunbook({
        corpusId: corpus.corpusId,
        procedureId: saved.procedureId,
        expectedVersion: saved.version,
        document: { ...saved.document, agentEdition: edition(citation) },
    });
    await assert.rejects(
        hub.memoryHubAcceptBinding({
            corpusId: corpus.corpusId,
            procedureId: saved.procedureId,
            expectedVersion: draft.version,
            stepId: "check",
            manualReason: "Inspect manually",
            safety: "unknown",
            safetyConfirmed: false,
        }),
        /Explicit safety/,
    );
    const bound = await hub.memoryHubAcceptBinding({
        corpusId: corpus.corpusId,
        procedureId: saved.procedureId,
        expectedVersion: draft.version,
        stepId: "check",
        manualReason: "Inspect manually",
        safety: "unknown",
        safetyConfirmed: true,
    });
    assert.equal(bound.version, draft.version + 1);
    assert.equal(bound.document.agentEdition.review.state, "draft");
    assert.deepEqual(bound.document.agentEdition.steps[0].binding, {
        kind: "manual",
        accepted: true,
        reason: "Inspect manually",
    });
    assert.equal(
        (await service.getProcedure(corpus.corpusId, saved.procedureId))
            .version,
        bound.version,
    );
});

test("Stale comparison retains previous evidence and the author's edition", async (t) => {
    const { hub, corpus, saved, citation, service, ingest } = await fixture(t);
    await hub.memoryHubSaveRunbook({
        corpusId: corpus.corpusId,
        procedureId: saved.procedureId,
        expectedVersion: saved.version,
        document: { ...saved.document, agentEdition: edition(citation) },
    });

    for (const toolName of ["inspect", "_inspect", '["native","inspect"]']) {
        await t.test(
            `MCP acceptance persists native name ${toolName} and reconstructs exact catalog identity for drift`,
            async (t) => {
                const { service, corpus, saved, citation } = await fixture(t);
                const target = {
                    id: JSON.stringify(["fixture-server", toolName]),
                    kind: "mcp",
                    serverConfigId: "fixture-server",
                    name: "Inspect",
                    description: "Read status",
                    version: "v1",
                    fingerprint: "a".repeat(64),
                    inputSchema: {
                        type: "object",
                        properties: {},
                        additionalProperties: false,
                    },
                    safety: { requiresConfirmation: true, readOnly: true },
                };
                const checked = [];
                const capabilities = {
                    listSkills: async () => [],
                    listBindingTargets: async () => ({
                        targets: [target],
                        notices: [],
                        total: 1,
                    }),
                    checkBindingTargets: async (request) => {
                        checked.push(request);
                        return {
                            valid: true,
                            issues: [],
                            argumentChecks: request.bindings.map(
                                (binding, bindingIndex) => ({
                                    binding,
                                    bindingIndex,
                                    argumentsValidated: true,
                                }),
                            ),
                        };
                    },
                };
                const hub = createMemoryHubRunbookFunctions(
                    () => service,
                    () => capabilities,
                );
                const draft = await hub.memoryHubSaveRunbook({
                    corpusId: corpus.corpusId,
                    procedureId: saved.procedureId,
                    expectedVersion: saved.version,
                    document: {
                        ...saved.document,
                        agentEdition: {
                            ...edition(citation),
                            inputs: [
                                {
                                    id: "worker",
                                    description: "Worker name",
                                    type: "string",
                                    required: true,
                                    secret: false,
                                },
                            ],
                        },
                    },
                });
                const bound = await hub.memoryHubAcceptBinding({
                    corpusId: corpus.corpusId,
                    procedureId: saved.procedureId,
                    expectedVersion: draft.version,
                    stepId: "check",
                    targetId: target.id,
                    fingerprint: target.fingerprint,
                    targetVersion: target.version,
                    safety: "readOnly",
                    safetyConfirmed: true,
                    arguments: {
                        worker: { $input: "worker" },
                        literal: { $literal: { $input: "not-a-reference" } },
                    },
                });
                assert.equal(
                    bound.document.agentEdition.steps[0].binding.targetId,
                    toolName,
                );
                assert.equal(
                    bound.document.agentEdition.steps[0].binding.serverId,
                    "fixture-server",
                );
                assert.equal(checked[0].bindings[0].id, target.id);
                assert.deepEqual(
                    bound.document.agentEdition.steps[0].binding.arguments,
                    {
                        worker: { $input: "worker" },
                        literal: { $literal: { $input: "not-a-reference" } },
                    },
                );
                assert.equal(checked[0].inputs[0].id, "worker");
                await hub.memoryHubRunbooks({ corpusId: corpus.corpusId });
                assert.equal(checked.at(-1).bindings[0].id, target.id);
                assert.equal(
                    checked.at(-1).bindings[0].serverConfigId,
                    "fixture-server",
                );
                assert.equal(checked.at(-1).inputSchema.type, "object");
                assert.deepEqual(
                    checked.at(-1).bindings[0].arguments,
                    bound.document.agentEdition.steps[0].binding.arguments,
                );
                const accept = {
                    corpusId: corpus.corpusId,
                    procedureId: saved.procedureId,
                    expectedVersion: bound.version,
                    stepId: "check",
                    targetId: target.id,
                    fingerprint: target.fingerprint,
                    targetVersion: target.version,
                    safety: "readOnly",
                    safetyConfirmed: true,
                    arguments: { worker: { $input: "worker" } },
                };
                capabilities.checkBindingTargets = async () => ({
                    valid: true,
                    issues: [],
                });
                await assert.rejects(
                    hub.memoryHubAcceptBinding(accept),
                    /did not attest/,
                );
                capabilities.checkBindingTargets = async (request) => ({
                    valid: true,
                    issues: [],
                    argumentChecks: [
                        {
                            bindingIndex: 1,
                            binding: request.bindings[0],
                            argumentsValidated: true,
                        },
                    ],
                });
                await assert.rejects(
                    hub.memoryHubAcceptBinding(accept),
                    /did not attest/,
                );
                capabilities.checkBindingTargets = async (request) => ({
                    valid: true,
                    issues: [],
                    argumentChecks: [
                        {
                            bindingIndex: 0,
                            binding: {
                                ...request.bindings[0],
                                arguments: { worker: "substituted" },
                            },
                            argumentsValidated: true,
                        },
                    ],
                });
                await assert.rejects(
                    hub.memoryHubAcceptBinding(accept),
                    /did not attest/,
                );
                await assert.rejects(
                    hub.memoryHubAcceptBinding({
                        ...accept,
                        arguments: { worker: { $input: "undeclared" } },
                    }),
                    /undeclared/,
                );
                assert.equal(
                    (
                        await service.getProcedure(
                            corpus.corpusId,
                            saved.procedureId,
                        )
                    ).version,
                    bound.version,
                );
            },
        );
    }
    const replacement = await service.replaceSource({
        corpusId: corpus.corpusId,
        sourceId: ingest.sourceId,
        expectedActiveRevisionId: ingest.revisionId,
        source: {
            sourceType: "markdown",
            title: "Updated original",
            markdown: "Stop first; then check.",
        },
        retainRevisionHistory: true,
    });
    await waitForJob(service, replacement.jobId);
    const stale = await service.getProcedure(
        corpus.corpusId,
        saved.procedureId,
    );
    assert.equal(stale.state, "stale");
    const comparison = await hub.memoryHubCompareRunbook({
        corpusId: corpus.corpusId,
        procedureId: saved.procedureId,
        version: stale.version,
    });
    assert.equal(comparison.previous[0].citation.revisionId, ingest.revisionId);
    assert.equal(
        comparison.updated[0].citation.revisionId,
        replacement.revisionId,
    );
    assert.deepEqual(
        comparison.affectedSteps.map((step) => step.stepId),
        ["check"],
    );
    assert.equal(
        comparison.current.document.agentEdition.steps[0].agentInstruction,
        "Check the worker.",
    );
    const synthesisRequests = [];
    service.requestRunbookSynthesis = async (request) => {
        synthesisRequests.push(request);
        return {
            ...request,
            jobId: "draft-job",
            state: "running",
            createdAt: "2026-10-02",
            updatedAt: "2026-10-02",
            candidateIds: [],
            warnings: [],
        };
    };
    const synthesisRequest = {
        corpusId: corpus.corpusId,
        procedureId: saved.procedureId,
        version: stale.version,
        sourceId: ingest.sourceId,
        revisionId: replacement.revisionId,
    };
    await assert.rejects(
        hub.memoryHubSynthesizeRunbook({
            ...synthesisRequest,
            revisionId: ingest.revisionId,
        }),
        /no longer available/,
    );
    const synthesis = await hub.memoryHubSynthesizeRunbook(synthesisRequest);
    assert.equal(synthesis.jobId, "draft-job");
    assert.deepEqual(synthesisRequests, [
        {
            corpusId: corpus.corpusId,
            sourceId: ingest.sourceId,
            revisionId: replacement.revisionId,
        },
    ]);
    assert.equal(
        (await service.getProcedure(corpus.corpusId, saved.procedureId))
            .version,
        stale.version,
    );
});

test("explicit stale synthesis crosses the real canonical facade and preserves the existing procedure", async (t) => {
    const { service, corpus, saved, ingest } = await fixture(t, {
        runbookSynthesizer: async (input) => {
            const citation = {
                sourceId: input.sourceId,
                revisionId: input.revisionId,
                locator: `chars:0-${input.content.length}`,
                excerpt: input.content,
            };
            const document = edition(citation);
            document.steps[0].humanText = input.content;
            document.steps[0].agentInstruction =
                "Inspect the exact retained instructions manually.";
            return {
                classification: "runbook",
                confidence: 1,
                reason: "Offline functional fixture only",
                warnings: [],
                procedures: [
                    {
                        sectionFingerprint: "explicit-update",
                        title: "Updated guide",
                        agentEdition: document,
                    },
                ],
            };
        },
    });
    const replacement = await service.replaceSource({
        corpusId: corpus.corpusId,
        sourceId: ingest.sourceId,
        expectedActiveRevisionId: ingest.revisionId,
        retainRevisionHistory: true,
        source: {
            sourceType: "markdown",
            title: "Updated original",
            markdown: "Stop before checking the worker.",
        },
    });
    await waitForJob(service, replacement.jobId);
    const before = await service.getProcedure(
        corpus.corpusId,
        saved.procedureId,
    );
    const settings = await service.getPersonalHowToSettings(corpus.corpusId);
    await service.updatePersonalHowToSettings(corpus.corpusId, {
        expectedRevision: settings.revision,
        enabled: true,
        detectCandidates: true,
        preferences: { runbook: { buildAgentEdition: true } },
    });
    const facade = createMemoryServiceRpcFacade(service);
    const hub = createMemoryHubRunbookFunctions(() => facade);
    const request = {
        corpusId: corpus.corpusId,
        procedureId: saved.procedureId,
        version: before.version,
        sourceId: ingest.sourceId,
        revisionId: replacement.revisionId,
    };
    await assert.rejects(
        hub.memoryHubSynthesizeRunbook({
            ...request,
            revisionId: ingest.revisionId,
        }),
        /no longer available/,
    );
    const started = await hub.memoryHubSynthesizeRunbook(request);
    let job = await facade.getRunbookJob(started.jobId);
    const deadline = Date.now() + 5_000;
    while (job?.state === "running" && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        job = await facade.getRunbookJob(started.jobId);
    }
    assert.equal(job.state, "complete", job.error);
    assert.equal(job.revisionId, replacement.revisionId);
    assert.equal(job.candidateIds.length, 1);
    const candidate = await service.getProcedureCandidate(
        corpus.corpusId,
        job.candidateIds[0],
    );
    assert.equal(candidate.agentEdition.review.state, "draft");
    assert.equal(candidate.citations[0].revisionId, replacement.revisionId);
    assert.deepEqual(
        await service.getProcedure(corpus.corpusId, saved.procedureId),
        before,
    );
    assert.equal(
        (await hub.memoryHubSynthesizeRunbook(request)).jobId,
        started.jobId,
    );
});

test("Runbook gateway rejects contradictory bindings, forged kinds and missing lifecycle guards", () => {
    const binding = {
        corpusId: "c",
        procedureId: "p",
        expectedVersion: 1,
        stepId: "s",
        safety: "unknown",
        safetyConfirmed: true,
    };
    for (const params of [
        { ...binding },
        { ...binding, command: "inspect", manualReason: "Manual" },
        { ...binding, targetId: "tool" },
        { ...binding, command: "inspect", arguments: { secret: "literal" } },
    ])
        assert.throws(() =>
            validateViewRequest({ method: "memoryHubAcceptBinding", params }),
        );
    assert.throws(() =>
        validateViewRequest({
            method: "memoryHubSkillAction",
            params: {
                identity: { scope: "user", origin: "fixture", name: "worker" },
                revisionId: "r",
                expectedState: "draft",
                action: "validate",
            },
        }),
    );
    assert.throws(() =>
        validateViewRequest({
            method: "memoryHubReadRunbookAsset",
            params: {
                corpusId: "c",
                sourceId: "s",
                revisionId: "r",
                assetId: "a",
                hash: "bad",
                variant: "original",
            },
        }),
    );
});

test("Inbox drift is durable-state-qualified, and missing catalogs are not successful zero counts", async () => {
    const snapshot = { corpora: [], inbox: [], procedures: [], errors: [] };
    const runbooks = {
        memoryHubRunbooks: async () => ({
            items: [
                {
                    kind: "procedure",
                    corpusId: "c",
                    corpusName: "C",
                    objectId: "p",
                    title: "Worker",
                    latestVersion: 2,
                    updatedAt: "2026-10-02",
                    skills: [],
                    drift: [{ stepId: "check", reason: "Fingerprint changed" }],
                },
            ],
            total: 1,
            errors: [],
            warnings: ["One catalog is unavailable"],
        }),
    };
    await addRunbookInbox(snapshot, runbooks, {
        listRunbookJobs: async () => [],
    });
    assert.equal(snapshot.inbox[0].kind, "bindingDrift");
    assert.match(snapshot.inbox[0].fingerprint, /Fingerprint changed/);
    assert.equal(snapshot.errors[0].operation, "skills");
});
