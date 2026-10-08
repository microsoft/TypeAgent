// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {
    ViewBuildRequest,
    ViewBuildJob,
    ViewSynthesisOutput,
    ViewSupportReport,
    ViewBuildSnapshot,
    ViewSaveRequest,
    ViewVersion,
} from "../src/viewTypes.js";
import { FileMemoryService } from "../src/fileMemoryService.js";
import { waitForMemoryJob } from "../src/rpcFacade.js";
import { FakeProcedureCorpusIndex } from "./fakeProcedureCorpusIndex.js";
import { mergeProse, mergeView } from "../src/viewMerge.js";
import { authoredRelationships } from "../src/viewRelationships.js";
import { ViewHistory } from "../src/viewHistory.js";
import { ViewBuildRunner } from "../src/viewBuilds.js";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { inventoryTestAnswer } from "./viewInventoryTestModel.js";

function output(
    input: ViewBuildSnapshot,
    body = "Inspect pressure.\n\nPreserve approval boundaries.\n",
): ViewSynthesisOutput {
    const source = input.inputs[0];
    const citation = {
        sourceId: source.sourceId,
        revisionId: source.revisionId,
        locator: `chars:0-${source.content.length}`,
        excerpt: source.content,
    };
    const roles = [
        "description",
        "prerequisites",
        "diagnostic",
        "guard",
        "verification",
        "recovery",
        "context",
    ] as const;
    return {
        content: {
            kind: "troubleshootingGuide",
            title: "Conditional pressure diagnosis",
            sections: roles.map((role) => ({
                id: role,
                role,
                heading: role,
                body,
            })),
            citations: [citation],
        },
        relationships: roles.map((role) => ({
            id: `support-${role}`,
            predicate: "supportedBy",
            from: {
                kind: "section",
                viewId: input.definition.viewId,
                sectionId: role,
            },
            to: {
                kind: "source",
                sourceId: source.sourceId,
                revisionId: source.revisionId,
            },
            citations: [citation],
        })),
        outcome: "diagnosticOnly",
        missingEvidence: ["Verified resolution is not recorded"],
    };
}

function support(
    candidate: ViewSynthesisOutput,
    supported: boolean,
): ViewSupportReport {
    return {
        supported,
        missingContext: supported ? [] : ["Approval boundary omitted"],
        reasons: [],
        sections: candidate.content.sections.map((section) => ({
            sectionId: section.id,
            supported,
            reason: "Offline controlled assessment",
        })),
        relationships: candidate.relationships.map((edge) => ({
            edgeId: edge.id,
            supported,
            reason: "Offline controlled assessment",
        })),
    };
}

describe("durable draft builds and explicit edit merge", () => {
    let root: string;
    let service: FileMemoryService;
    let generate: jest.Mock<
        Promise<ViewSynthesisOutput>,
        [ViewBuildSnapshot, AbortSignal]
    >;
    let supported: boolean;
    let validate: jest.Mock<
        Promise<ViewSupportReport>,
        [ViewBuildSnapshot, ViewSynthesisOutput, AbortSignal]
    >;
    const open = () =>
        new FileMemoryService(root, {
            viewDrafts: true,
            indexFactory: (_id, directory) =>
                new FakeProcedureCorpusIndex(directory),
            viewSynthesisAdapter: {
                identity: "offline-test-model",
                generate: (input, signal) => generate(input, signal),
                validate: (input, candidate, signal) =>
                    validate(input, candidate, signal),
            },
        });
    beforeEach(async () => {
        root = await mkdtemp(path.join(os.tmpdir(), "memory-view-builds-"));
        supported = true;
        generate = import.meta.jest.fn(
            async (input: ViewBuildSnapshot, signal: AbortSignal) => {
                signal.throwIfAborted();
                return output(input);
            },
        );
        validate = import.meta.jest.fn(
            async (
                _input: ViewBuildSnapshot,
                candidate: ViewSynthesisOutput,
                signal: AbortSignal,
            ) => {
                signal.throwIfAborted();
                return support(candidate, supported);
            },
        );
        service = open();
    });
    afterEach(async () => {
        await service.close();
        await rm(root, { recursive: true, force: true });
    });
    async function fixture(count = 1): Promise<ViewBuildRequest> {
        const corpus = await service.createCorpus("Build fixture");
        const source = await service.ingestDocument({
            corpusId: corpus.corpusId,
            source: {
                sourceId: "evidence",
                sourceType: "text",
                title: "Synthetic diagnostic record",
                text: "Inspect pressure. Preserve approval boundaries. No verified resolution.",
                capturedAt: "2026-10-02T00:00:00Z",
                sourceModifiedAt: "2026-10-01T00:00:00Z",
            },
        });
        await waitForMemoryJob(service, source.jobId);
        return {
            corpusId: corpus.corpusId,
            expectedHead: (await service.listViews(corpus.corpusId)).head,
            targets: Array.from({ length: count }, (_, index) => ({
                expectedVersion: 0,
                definition: {
                    viewId: `guide-${index}`,
                    kind: "troubleshootingGuide",
                    selector: {
                        kind: "sources",
                        sources: [
                            {
                                sourceId: source.sourceId,
                                revisionId: source.revisionId,
                            },
                        ],
                    },
                },
            })),
        };
    }
    async function wait(job: ViewBuildJob): Promise<ViewBuildJob> {
        for (let tries = 0; tries < 1000; tries++) {
            const value = await service.getViewBuild(job);
            if (!value) throw new Error("Missing durable build");
            if (value.state !== "running") return value;
            await new Promise<void>((resolve) => setTimeout(resolve, 10));
        }
        throw new Error("Build did not terminate");
    }
    async function rebuild(request: ViewBuildRequest): Promise<ViewBuildJob> {
        const snapshot = await service.listViews(request.corpusId);
        return wait(
            await service.buildViews({
                ...request,
                expectedHead: snapshot.head,
                targets: request.targets.map((target) => ({
                    ...target,
                    expectedVersion:
                        snapshot.views.find(
                            (view) => view.viewId === target.definition.viewId,
                        )?.version ?? 0,
                })),
            }),
        );
    }
    async function edit(view: ViewVersion, body: string): Promise<ViewVersion> {
        const content = structuredClone(
            view.content,
        ) as ViewSaveRequest["content"];
        content.sections[0].body = body;
        return (
            await service.saveViewDraft({
                corpusId: view.corpusId,
                viewId: view.viewId,
                expectedHead: (await service.listViews(view.corpusId)).head,
                expectedVersion: view.version,
                definition: {
                    viewId: view.viewId,
                    kind: "troubleshootingGuide",
                    selector: view.definition.selector,
                },
                content,
                relationships: authoredRelationships(view),
            })
        ).version;
    }
    test("real multi-source snapshots, temporal exclusion, publication rejection and idempotent restart", async () => {
        const request = await fixture();
        const extra = await service.ingestDocument({
            corpusId: request.corpusId,
            source: {
                sourceId: "later",
                sourceType: "text",
                title: "Later record",
                text: "Simulated recovery only.",
                capturedAt: "2026-10-04T00:00:00Z",
            },
        });
        await waitForMemoryJob(service, extra.jobId);
        const early = {
            ...request,
            bounds: { learnedBefore: "2026-10-03T00:00:00Z" },
        };
        const job = await wait(await service.buildViews(early));
        expect(job.state).toBe("complete");
        expect(
            generate.mock.calls[0][0].inputs.map((input) => input.sourceId),
        ).toEqual(["evidence"]);
        expect(job.results[0].missingEvidence).toContain(
            "Verified resolution is not recorded",
        );
        expect(job.results[0].snapshot.actor).toBe(os.userInfo().username);
        expect(
            (
                await service.getView({
                    corpusId: request.corpusId,
                    viewId: "guide-0",
                })
            )?.generation?.input?.fingerprint,
        ).toBe(job.results[0].snapshot.fingerprint);
        await expect(
            service.buildViews({
                ...request,
                targets: [
                    {
                        ...request.targets[0],
                        expectedVersion: 1,
                        definition: {
                            ...request.targets[0].definition,
                            selector: {
                                kind: "sources",
                                sources: [
                                    {
                                        sourceId: extra.sourceId,
                                        revisionId: extra.revisionId,
                                    },
                                ],
                            },
                        },
                    },
                ],
                bounds: early.bounds,
            }),
        ).rejects.toThrow("temporal");
        await expect(
            service.buildViews({
                ...request,
                publication: true,
            } as unknown as ViewBuildRequest),
        ).rejects.toThrow("draft-only");
        await service.close();
        service = open();
        expect((await service.buildViews(early)).jobId).toBe(job.jobId);
        expect(generate).toHaveBeenCalledTimes(1);
    });
    test("partial batches, exact offset failure and semantic/context rejection are inspectable", async () => {
        const request = await fixture(2);
        generate.mockImplementation(async (input) => {
            const candidate = output(input);
            if (input.definition.viewId === "guide-1")
                candidate.content.citations[0].excerpt =
                    "Not the retained source";
            return candidate;
        });
        const job = await wait(await service.buildViews(request));
        expect(job.state).toBe("partial");
        expect(job.results.map((result) => result.state)).toEqual([
            "draft",
            "blocked",
        ]);
        expect((await service.listViews(request.corpusId)).views).toHaveLength(
            1,
        );
        supported = false;
        const next = await rebuild({
            ...request,
            targets: [request.targets[0]],
        });
        expect(next.results[0].state).toBe("blocked");
        expect(next.results[0].reason).toContain("Approval boundary omitted");
        expect(
            (await service.listViews(request.corpusId)).views[0].version,
        ).toBe(1);
    });
    test("human paragraph edits survive two appends with attribution and exact generated bases", async () => {
        const request = await fixture();
        await wait(await service.buildViews(request));
        const generated = (await service.listViews(request.corpusId)).views[0];
        const human = await edit(
            generated,
            "Inspect pressure carefully.\n\nPreserve approval boundaries.\n",
        );
        const actor = human.edits!.find(
            (operation) => operation.status === "active",
        )!.actor;
        generate.mockImplementation(async (input) =>
            output(
                input,
                "Inspect pressure.\n\nPreserve approval boundaries.\n\nConfirm simulation.\n",
            ),
        );
        const first = await rebuild(request);
        expect(first.results[0].state).toBe("merged");
        const merged = (await service.listViews(request.corpusId)).views[0];
        expect(merged.content.sections[0].body).toBe(
            "Inspect pressure carefully.\n\nPreserve approval boundaries.\n\nConfirm simulation.\n",
        );
        expect(
            merged.edits!.find((operation) => operation.status === "merged")!
                .actor,
        ).toBe(actor);
        generate.mockImplementation(async (input) =>
            output(
                input,
                "Inspect pressure.\n\nPreserve approval boundaries.\n\nConfirm simulation.\n\nRetain limits.\n",
            ),
        );
        expect((await rebuild(request)).results[0].state).toBe("merged");
        expect(
            (await service.listViews(request.corpusId)).views[0].content
                .sections[0].body,
        ).toContain("carefully");
    });
    test.each(["sections", "relationships"] as const)(
        "a superficially supported audit with missing %s is blocked before saving",
        async (field) => {
            const request = await fixture();
            validate.mockImplementation(async (_input, candidate) => ({
                ...support(candidate, true),
                [field]: [],
            }));
            const job = await wait(await service.buildViews(request));
            expect(job.results[0].state).toBe("blocked");
            expect(job.results[0].reason).toContain(
                "Evidence validator did not inspect every exact",
            );
            expect((await service.listViews(request.corpusId)).views).toEqual(
                [],
            );
        },
    );
    test("finished runner persistence errors stay explicit and source forget erases their retained payload", async () => {
        const request = await fixture();
        const job = structuredClone(
            await wait(await service.buildViews(request)),
        );
        job.state = "running";
        let entered!: () => void;
        const failure = new Promise<void>((resolve) => {
            entered = resolve;
        });
        const runner = new ViewBuildRunner(
            {
                identity: "offline-test-model",
                generate: (input, signal) => generate(input, signal),
                validate: (input, candidate, signal) =>
                    validate(input, candidate, signal),
            },
            {
                update: async () => {
                    entered();
                    throw new Error(
                        "Injected durability failure with retained synthetic excerpt",
                    );
                },
                current: async () => undefined,
                materialize: async () => {
                    throw new Error(
                        "Unexpected materialization after failed receipt write",
                    );
                },
            },
        );
        runner.start(job);
        await failure;
        await expect(runner.close()).rejects.toThrow(
            "View build persistence failed",
        );
        expect(() => runner.assertPersistence(job.jobId)).toThrow(
            "retained synthetic excerpt",
        );
        runner.forget("unrelated-corpus", "evidence");
        expect(() => runner.assertPersistence(job.jobId)).toThrow(
            "retained synthetic excerpt",
        );
        runner.forget(request.corpusId, "evidence");
        expect(() => runner.assertPersistence(job.jobId)).not.toThrow();
        await expect(runner.close()).resolves.toBeUndefined();
    });
    test("a late receipt-write failure cannot resurrect a forgotten job error payload", async () => {
        const request = await fixture();
        const job = structuredClone(
            await wait(await service.buildViews(request)),
        );
        job.state = "running";
        let entered!: () => void;
        let fail!: (error: Error) => void;
        const started = new Promise<void>((resolve) => {
            entered = resolve;
        });
        const pending = new Promise<ViewBuildJob>((_resolve, reject) => {
            fail = reject;
        });
        let writes = 0;
        const runner = new ViewBuildRunner(
            {
                identity: "offline-test-model",
                generate: (input, signal) => generate(input, signal),
                validate: (input, candidate, signal) =>
                    validate(input, candidate, signal),
            },
            {
                update: async (_corpusId, _jobId, update) => {
                    if (++writes === 3) {
                        entered();
                        return pending;
                    }
                    update(job);
                    return job;
                },
                current: async () => undefined,
                materialize: async () => {
                    throw new Error("Injected publication failure");
                },
            },
        );
        runner.start(job);
        await started;
        runner.forget(request.corpusId, "evidence");
        fail(new Error("Forgotten synthetic excerpt from late failed receipt"));
        await expect(runner.close()).resolves.toBeUndefined();
        expect(() => runner.assertPersistence(job.jobId)).not.toThrow();
    });
    test("materialization failure is a failed receipt rather than an evidence rejection and preserves the current draft", async () => {
        const request = await fixture();
        const completed = await wait(await service.buildViews(request));
        const prior = (await service.listViews(request.corpusId)).views[0];
        const job = structuredClone(completed);
        job.state = "running";
        job.results[0].state = "pending";
        let finish!: () => void;
        const finished = new Promise<void>((resolve) => {
            finish = resolve;
        });
        const runner = new ViewBuildRunner(
            {
                identity: "offline-test-model",
                generate: (input, signal) => generate(input, signal),
                validate: (input, candidate, signal) =>
                    validate(input, candidate, signal),
            },
            {
                update: async (_corpusId, _jobId, update) => {
                    update(job);
                    if (job.state !== "running") finish();
                    return job;
                },
                current: async () => undefined,
                materialize: async () => {
                    throw new Error("Injected history publication failure");
                },
            },
        );
        runner.start(job);
        await finished;
        await runner.close();
        expect(job.state).toBe("failed");
        expect(job.results[0].state).toBe("failed");
        expect(job.results[0].reason).toBe(
            "Injected history publication failure",
        );
        expect(
            (await service.listViews(request.corpusId)).views[0].revisionId,
        ).toBe(prior.revisionId);
    });
    test("conflict comparison, deduplication, authenticated resolution and rebuild preservation", async () => {
        const request = await fixture();
        await wait(await service.buildViews(request));
        await edit(
            (await service.listViews(request.corpusId)).views[0],
            "Inspect pressure carefully.\n\nPreserve approval boundaries.\n",
        );
        generate.mockImplementation(async (input) =>
            output(
                input,
                "Inspect pressure conservatively.\n\nPreserve approval boundaries.\n",
            ),
        );
        const first = await rebuild(request);
        const second = await rebuild(request);
        expect(first.results[0].conflictId).toBe(second.results[0].conflictId);
        const conflict = (await service.getViewConflict({
            corpusId: request.corpusId,
            conflictId: first.results[0].conflictId!,
        }))!;
        expect(conflict.base!.content.sections[0].body).toContain(
            "Inspect pressure.",
        );
        const current = (await service.listViews(request.corpusId)).views[0];
        expect(current.content.sections[0].body).toContain("carefully");
        const resolve = {
            corpusId: request.corpusId,
            conflictId: conflict.conflictId,
            expectedHead: (await service.listViews(request.corpusId)).head!,
            expectedVersion: current.version,
            expectedRevisionId: current.revisionId,
            inputFingerprint: conflict.input.fingerprint,
            choice: "human" as const,
        };
        supported = false;
        await expect(service.resolveViewConflict(resolve)).rejects.toThrow(
            "Unsupported evidence",
        );
        supported = true;
        const resolved = await service.resolveViewConflict(resolve);
        expect(resolved.version.actor).toBe(os.userInfo().username);
        expect((await service.getViewConflict(resolve))?.state).toBe(
            "resolved",
        );
        expect((await rebuild(request)).results[0].state).toBe("merged");
        expect(
            (await service.listViews(request.corpusId)).views[0].content
                .sections[0].body,
        ).toContain("carefully");
    });
    test("source forget in flight removes job, view, conflict and every history object payload", async () => {
        const request = await fixture();
        await wait(await service.buildViews(request));
        await edit(
            (await service.listViews(request.corpusId)).views[0],
            "Inspect pressure carefully.\n\nPreserve approval boundaries.\n",
        );
        generate.mockImplementation(async (input) =>
            output(
                input,
                "Inspect pressure conservatively.\n\nPreserve approval boundaries.\n",
            ),
        );
        const conflictId = (await rebuild(request)).results[0].conflictId!;
        expect(
            await service.getViewConflict({
                corpusId: request.corpusId,
                conflictId,
            }),
        ).toBeDefined();
        let entered!: () => void;
        const started = new Promise<void>((resolve) => {
            entered = resolve;
        });
        generate.mockImplementation(async (_input, signal) => {
            entered();
            return new Promise((_resolve, reject) =>
                signal.addEventListener("abort", () => reject(signal.reason), {
                    once: true,
                }),
            );
        });
        const admitted = await service.buildViews({
            ...request,
            expectedHead: (await service.listViews(request.corpusId)).head,
            targets: [{ ...request.targets[0], expectedVersion: 2 }],
        });
        await started;
        const preview = await service.previewForgetSource(
            request.corpusId,
            "evidence",
        );
        await service.forgetSource({
            corpusId: request.corpusId,
            sourceId: "evidence",
            confirmationToken: preview.confirmationToken,
        });
        expect(await service.getViewBuild(admitted)).toBeUndefined();
        expect(
            await service.getViewConflict({
                corpusId: request.corpusId,
                conflictId,
            }),
        ).toBeUndefined();
        expect((await service.listViews(request.corpusId)).views).toEqual([]);
        const history = new ViewHistory<Record<string, unknown>>(
            path.join(root, request.corpusId, "personal-how-to"),
            () => ({}),
        );
        expect(JSON.stringify((await history.read()).state)).not.toContain(
            "Inspect pressure",
        );
        await service.close();
        service = open();
        expect(await service.listViewBuilds(request.corpusId)).toEqual([]);
    });
    test("combined resolution retains unchanged edit identity and attributes only newly changed targets", async () => {
        const request = await fixture();
        await wait(await service.buildViews(request));
        const prior = (await service.listViews(request.corpusId)).views[0];
        const content = structuredClone(
            prior.content as ViewSaveRequest["content"],
        );
        content.title = "Explicit human title";
        content.sections[0].body =
            "Inspect pressure carefully.\n\nPreserve approval boundaries.\n";
        const saved = await service.saveViewDraft({
            corpusId: request.corpusId,
            viewId: prior.viewId,
            expectedHead: (await service.listViews(request.corpusId)).head,
            expectedVersion: prior.version,
            definition: request.targets[0].definition,
            content,
            relationships: authoredRelationships(prior),
        });
        const titleEdit = saved.version.edits!.find(
            (edit) => edit.target === "title",
        )!;
        const bodyEdit = saved.version.edits!.find(
            (edit) => edit.target === "section:description",
        )!;
        generate.mockImplementation(async (input) =>
            output(
                input,
                "Inspect pressure conservatively.\n\nPreserve approval boundaries.\n",
            ),
        );
        const build = await rebuild(request);
        const conflict = (await service.getViewConflict({
            corpusId: request.corpusId,
            conflictId: build.results[0].conflictId!,
        }))!;
        content.sections[0].body =
            "Inspect pressure carefully and conservatively.\n\nPreserve approval boundaries.\n";
        const resolved = await service.resolveViewConflict({
            corpusId: request.corpusId,
            conflictId: conflict.conflictId,
            expectedHead: (await service.listViews(request.corpusId)).head!,
            expectedVersion: saved.version.version,
            expectedRevisionId: saved.version.revisionId,
            inputFingerprint: conflict.input.fingerprint,
            choice: "combined",
            combined: {
                ...conflict.candidate,
                content,
                relationships: authoredRelationships(saved.version),
            },
        });
        const retained = resolved.version.edits!.find(
            (edit) => edit.id === titleEdit.id,
        )!;
        expect(retained.actor).toBe(titleEdit.actor);
        expect(retained.createdAt).toBe(titleEdit.createdAt);
        expect(retained.status).toBe("merged");
        expect(
            resolved.version.edits!.find((edit) => edit.id === bodyEdit.id)
                ?.status,
        ).toBe("cleared");
        expect(
            resolved.version.edits!.find(
                (edit) =>
                    edit.target === bodyEdit.target && edit.status === "active",
            )?.actor,
        ).toBe(os.userInfo().username);
        expect((await rebuild(request)).results[0].state).toBe("merged");
        expect(
            (await service.listViews(request.corpusId)).views[0].edits!.find(
                (edit) => edit.id === titleEdit.id,
            )?.status,
        ).toBe("merged");
    });
    test("unknown section or edge mutations cannot hide behind another tracked edit", async () => {
        const request = await fixture();
        await wait(await service.buildViews(request));
        const current = await edit(
            (await service.listViews(request.corpusId)).views[0],
            "Inspect pressure carefully.\n\nPreserve approval boundaries.\n",
        );
        const candidate = output(current.generation!.input!);
        const section = structuredClone(current);
        section.content.sections[1].body = "Untracked human section";
        expect(mergeView(section, candidate).conflicts).toContain(
            "untracked:section:prerequisites",
        );
        const edge = structuredClone(current);
        const removed = edge.relationships.find(
            (entry) => entry.origin !== "system",
        )!;
        edge.relationships = edge.relationships.filter(
            (entry) => entry.id !== removed.id,
        );
        expect(
            mergeView(edge, candidate).conflicts.some((target) =>
                target.startsWith("untracked:edge:"),
            ),
        ).toBe(true);
    });
    test("cancellation terminates durable state even if generator ignores cancellation", async () => {
        const request = await fixture();
        generate.mockImplementation(() => new Promise(() => {}));
        const admitted = await service.buildViews(request);
        await service.cancelViewBuild(admitted);
        expect((await service.getViewBuild(admitted))?.state).toBe("cancelled");
        expect((await service.listViews(request.corpusId)).views).toEqual([]);
    });
    test("semantic edge tombstones survive re-identification and preserve human additions on repeated builds", async () => {
        const request = await fixture();
        let identity = "first-agent-edge";
        generate.mockImplementation(async (input) => {
            const candidate = output(input);
            candidate.relationships.push({
                ...candidate.relationships[0],
                id: identity,
                predicate: "dependsOn",
            });
            return candidate;
        });
        await wait(await service.buildViews(request));
        const prior = (await service.listViews(request.corpusId)).views[0];
        const edges = authoredRelationships(prior).filter(
            (edge) => edge.id !== identity,
        );
        edges.push({
            ...edges[1],
            id: "human-dependency",
            predicate: "dependsOn",
        });
        const saved = await service.saveViewDraft({
            corpusId: request.corpusId,
            viewId: prior.viewId,
            expectedHead: (await service.listViews(request.corpusId)).head,
            expectedVersion: prior.version,
            definition: request.targets[0].definition,
            content: prior.content as ViewSaveRequest["content"],
            relationships: edges,
        });
        expect(
            saved.version.edits?.some(
                (edit) =>
                    edit.operation === "delete" &&
                    edit.target.startsWith("edge:"),
            ),
        ).toBe(true);
        for (identity of ["reidentified-agent-edge", "third-agent-edge"]) {
            expect((await rebuild(request)).results[0].state).toBe("merged");
            const current = (await service.listViews(request.corpusId))
                .views[0];
            expect(
                current.relationships.some((edge) => edge.id === identity),
            ).toBe(false);
            expect(
                current.relationships.find(
                    (edge) => edge.id === "human-dependency",
                )?.origin,
            ).toBe("human");
            expect(
                current.relationships.find(
                    (edge) => edge.id === "support-description",
                )?.origin,
            ).toBe("generator");
        }
    });
    test("concurrent human saves make in-flight materialization stale", async () => {
        const request = await fixture();
        await wait(await service.buildViews(request));
        let finish!: (candidate: ViewSynthesisOutput) => void;
        let captured!: ViewBuildSnapshot;
        let entered!: () => void;
        const started = new Promise<void>((resolve) => {
            entered = resolve;
        });
        generate.mockImplementation(async (input) => {
            captured = input;
            entered();
            return new Promise((resolve) => {
                finish = resolve;
            });
        });
        const admitted = await service.buildViews({
            ...request,
            expectedHead: (await service.listViews(request.corpusId)).head,
            targets: [{ ...request.targets[0], expectedVersion: 1 }],
        });
        await started;
        await edit(
            (await service.listViews(request.corpusId)).views[0],
            "Human work remains.\n\nPreserve approval boundaries.\n",
        );
        finish(output(captured));
        const result = await wait(admitted);
        expect(result.results[0].state).toBe("stale");
        expect(
            (await service.listViews(request.corpusId)).views[0].content
                .sections[0].body,
        ).toContain("Human work remains");
    });
    test("retained source replacement during generation rejects obsolete materialization without leaking replacement inputs", async () => {
        const request = await fixture();
        await wait(await service.buildViews(request));
        let finish!: (candidate: ViewSynthesisOutput) => void;
        let captured!: ViewBuildSnapshot;
        let entered!: () => void;
        const started = new Promise<void>((resolve) => {
            entered = resolve;
        });
        generate.mockImplementation(async (input) => {
            captured = input;
            entered();
            return new Promise((resolve) => {
                finish = resolve;
            });
        });
        const admitted = await service.buildViews({
            ...request,
            expectedHead: (await service.listViews(request.corpusId)).head,
            targets: [{ ...request.targets[0], expectedVersion: 1 }],
        });
        await started;
        const replaced = await service.ingestDocument({
            corpusId: request.corpusId,
            source: {
                sourceId: "evidence",
                sourceType: "text",
                title: "Synthetic replacement",
                text: "New headroom warning requires qualification.",
            },
            pipeline: {
                updatePolicy: "retainRevisionHistory",
                expectedActiveRevisionId: captured.inputs[0].revisionId,
            },
        });
        expect((await waitForMemoryJob(service, replaced.jobId)).state).toBe(
            "complete",
        );
        finish(output(captured));
        const job = await wait(admitted);
        expect(job.results[0].state).toBe("stale");
        expect(job.results[0].snapshot.inputs[0].content).not.toContain(
            "New headroom warning",
        );
        const current = (await service.listViews(request.corpusId)).views[0];
        expect(current.state).toBe("stale");
        expect(current.generation!.candidateId).toBe(
            (
                await service.getViewHistory({
                    corpusId: request.corpusId,
                    viewId: current.viewId,
                })
            )[0].version.generation!.candidateId,
        );
        expect(current.content.sections[0].body).not.toContain(
            "New headroom warning",
        );
    });
    test.each(["generating", "inventorying", "checkingInventory"] as const)(
        "restart reconciles durable %s as interrupted and retry admits a new guarded build",
        async (stage) => {
            const request = await fixture();
            const completed = await wait(await service.buildViews(request));
            await service.close();
            const history = new ViewHistory<{
                builds: Record<string, ViewBuildJob>;
                views: Record<string, ViewVersion[]>;
                index: unknown;
            }>(path.join(root, request.corpusId, "personal-how-to"), () => ({
                builds: {},
                views: {},
                index: {},
            }));
            const { head, state } = await history.read();
            state.builds[completed.jobId].state = "running";
            state.builds[completed.jobId].results[0].state = stage;
            await history.commit(
                head,
                state,
                {},
                "test-crash-fixture",
                "Simulate durable interrupted execution",
            );
            service = open();
            const interrupted = (await service.getViewBuild(completed))!;
            expect(interrupted.state).toBe("interrupted");
            expect(interrupted.results[0].state).toBe("interrupted");
            expect(interrupted.results[0].reason).toContain(
                "Service restarted",
            );
            const retried = await wait(
                await service.retryViewBuild(interrupted),
            );
            expect(retried.jobId).not.toBe(interrupted.jobId);
            expect(retried.state).toBe("complete");
        },
    );
    test("compiled CLI builds, inspects and resolves using configured loopback model across separate lifetimes", async () => {
        const request = await fixture();
        await service.close();
        let modelBody = "Inspect pressure.\n\nPreserve approval boundaries.\n";
        const schemas = new Set<string>();
        const modelFailures: unknown[] = [];
        const model = createServer(async (incoming, response) => {
            try {
                const chunks: Buffer[] = [];
                for await (const chunk of incoming)
                    chunks.push(Buffer.from(chunk));
                const body = JSON.parse(
                    Buffer.concat(chunks).toString("utf8"),
                ) as {
                    messages: Array<{ role: string; content: string }>;
                    response_format?: {
                        type: string;
                        json_schema?: {
                            name: string;
                            strict: boolean;
                            schema: { required: string[] };
                        };
                    };
                };
                const schema = body.response_format?.json_schema;
                if (
                    body.response_format?.type !== "json_schema" ||
                    !schema?.strict
                )
                    throw new Error(
                        "Configured view constructor/audit must send strict structured output schema",
                    );
                schemas.add(schema.name);
                const prompt = body.messages.find(
                    (message) => message.role === "user",
                )?.content;
                if (!prompt) throw new Error("Missing synthetic model prompt");
                const answer = inventoryTestAnswer(
                    schema.name,
                    JSON.parse(prompt),
                    modelBody,
                );
                response.writeHead(200, { "content-type": "application/json" });
                response.end(
                    JSON.stringify({
                        id: "synthetic-test",
                        choices: [
                            {
                                message: {
                                    role: "assistant",
                                    content: JSON.stringify(answer),
                                },
                                finish_reason: "stop",
                            },
                        ],
                    }),
                );
            } catch (error) {
                modelFailures.push(error);
                response.writeHead(500, { "content-type": "application/json" });
                response.end(
                    JSON.stringify({
                        error: "Synthetic loopback model request failed",
                    }),
                );
            }
        });
        await new Promise<void>((resolve) =>
            model.listen(0, "127.0.0.1", resolve),
        );
        try {
            const address = model.address();
            if (!address || typeof address === "string")
                throw new Error("Missing loopback model port");
            const malformed = await fetch(
                `http://127.0.0.1:${address.port}/chat/completions`,
                { method: "POST", body: "PRIVATE_LOOPBACK_INPUT" },
            );
            expect(malformed.status).toBe(500);
            expect(await malformed.json()).toEqual({
                error: "Synthetic loopback model request failed",
            });
            expect(modelFailures).toHaveLength(1);
            expect(modelFailures[0]).toBeInstanceOf(SyntaxError);
            modelFailures.length = 0;
            const cli = fileURLToPath(
                new URL("../memoryViewsCli.js", import.meta.url),
            );
            const file = path.join(root, "build-request.json");
            await writeFile(file, JSON.stringify(request));
            const environment = {
                ...process.env,
                TYPEAGENT_RUNBOOK_MODEL_ENDPOINT: "openai:W3_LOOPBACK",
                OPENAI_ENDPOINT_W3_LOOPBACK: `http://127.0.0.1:${address.port}/chat/completions`,
                OPENAI_API_KEY_W3_LOOPBACK: "synthetic-test-token-not-a-secret",
                OPENAI_MODEL_W3_LOOPBACK: "synthetic-test-model",
                OPENAI_ORGANIZATION_W3_LOOPBACK: "synthetic-test",
                OPENAI_RESPONSE_FORMAT_W3_LOOPBACK: "1",
                ENABLE_MODEL_REQUEST_LOGGING_W3_LOOPBACK: "false",
            };
            const run = (command: string[]) =>
                promisify(execFile)(
                    process.execPath,
                    [cli, "--store", root, "--enable-view-drafts", ...command],
                    { env: environment, timeout: 30000 },
                );
            const built: ViewBuildJob = JSON.parse(
                (await run(["build", file])).stdout,
            );
            expect(built.state).toBe("complete");
            expect(built.results[0].state).toBe("draft");
            const status: ViewBuildJob = JSON.parse(
                (await run(["status", request.corpusId, built.jobId])).stdout,
            );
            expect(status.results[0].revisionId).toBe(
                built.results[0].revisionId,
            );
            expect(
                JSON.parse(
                    (await run(["history", request.corpusId, "guide-0"]))
                        .stdout,
                )[0].version.generation.input.model,
            ).toContain("W3_LOOPBACK");
            const listed: { head: string; views: ViewVersion[] } = JSON.parse(
                (await run(["list", request.corpusId])).stdout,
            );
            const human = structuredClone(
                listed.views[0].content as ViewSaveRequest["content"],
            );
            human.sections[0].body =
                "Inspect pressure carefully.\n\nPreserve approval boundaries.\n";
            const humanFile = path.join(root, "human-edit.json");
            await writeFile(
                humanFile,
                JSON.stringify({
                    corpusId: request.corpusId,
                    viewId: "guide-0",
                    expectedHead: listed.head,
                    expectedVersion: 1,
                    definition: request.targets[0].definition,
                    content: human,
                    relationships: authoredRelationships(listed.views[0]),
                }),
            );
            const saved = JSON.parse(
                (await run(["save", humanFile])).stdout,
            ) as { version: ViewVersion };
            modelBody =
                "Inspect pressure conservatively.\n\nPreserve approval boundaries.\n";
            const before = JSON.parse(
                (await run(["list", request.corpusId])).stdout,
            ) as { head: string };
            await writeFile(
                file,
                JSON.stringify({
                    ...request,
                    expectedHead: before.head,
                    targets: [
                        {
                            ...request.targets[0],
                            expectedVersion: saved.version.version,
                        },
                    ],
                }),
            );
            const conflicted = JSON.parse(
                (await run(["build", file])).stdout,
            ) as ViewBuildJob;
            const conflictId = conflicted.results[0].conflictId!;
            expect(conflicted.results[0].state).toBe("conflicted");
            const comparison = JSON.parse(
                (await run(["inspect", request.corpusId, conflictId])).stdout,
            ) as { input: ViewBuildSnapshot; human: ViewVersion };
            expect(comparison.human.content.sections[0].body).toContain(
                "carefully",
            );
            const pending = JSON.parse(
                (await run(["list", request.corpusId])).stdout,
            ) as { head: string };
            const resolution = path.join(root, "resolution.json");
            await writeFile(
                resolution,
                JSON.stringify({
                    corpusId: request.corpusId,
                    conflictId,
                    expectedHead: pending.head,
                    expectedVersion: saved.version.version,
                    expectedRevisionId: saved.version.revisionId,
                    inputFingerprint: comparison.input.fingerprint,
                    choice: "human",
                }),
            );
            const resolved = JSON.parse(
                (await run(["resolve", resolution])).stdout,
            ) as { version: ViewVersion };
            expect(resolved.version.actor).toBe(os.userInfo().username);
            expect(resolved.version.content.sections[0].body).toContain(
                "carefully",
            );
            expect([...schemas].sort()).toEqual([
                "memory_inventory_artifact_support",
                "memory_inventory_guide_construction",
                "memory_source_fact_inventory",
                "memory_source_inventory_check",
            ]);
        } finally {
            await new Promise<void>((resolve, reject) =>
                model.close((error) => (error ? reject(error) : resolve())),
            );
            service = open();
            expect(modelFailures).toEqual([]);
        }
    }, 120000);
});

describe("bounded whitespace-preserving three-way prose", () => {
    test.each([
        [
            "A\r\n\r\n```sql\r\nx\r\n```\r\n\r\nB\r\n",
            "H\r\n\r\n```sql\r\nx\r\n```\r\n\r\nB\r\n",
            "A\r\n\r\n```sql\r\nx\r\n```\r\n\r\nB\r\n\r\nC\r\n",
            "H\r\n\r\n```sql\r\nx\r\n```\r\n\r\nB\r\n\r\nC\r\n",
        ],
        ["A\nB\n", "H\nB\n", "H\nB\n", "H\nB\n"],
        ["A\nB\n", "H\nB\n", "G\nB\n", undefined],
        ["A\nB\n", "B\n", "G\nB\n", undefined],
        ["A\nB\n", "A\nH\nB\n", "A\nG\nB\n", undefined],
    ])(
        "retains exact text or reports conflict",
        (base, human, generated, expected) => {
            expect(mergeProse(base, human, generated)).toBe(expected);
        },
    );
});
