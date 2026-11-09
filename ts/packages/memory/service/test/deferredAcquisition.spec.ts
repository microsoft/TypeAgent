// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { DeferredAcquisitionCoordinator } from "../src/deferredAcquisition.js";
import type {
    AcquisitionReadiness,
    AcquisitionRequestInput,
    AcquisitionTool,
    DeferredAcquisitionHost,
} from "../src/acquisitionTypes.js";
import type { QuestionInventory } from "../src/schemaViewTypes.js";
import type { DocumentIngestRequest } from "../src/types.js";
import { writeRunbookJson } from "../src/durableRunbookJson.js";

function latch<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => {
        resolve = done;
    });
    return { promise, resolve };
}

function fixture() {
    const input: AcquisitionRequestInput = {
        corpusId: "corpus",
        principalId: "principal",
        policyId: "policy",
        toolId: "read",
        resourceIdentity: "resource:one",
        scopeFingerprint: "scope",
        authorizedArguments: { resource: "one" },
        consumers: [
            { viewId: "view1", slotId: "slot", definitionRevision: "revision" },
        ],
        lineage: { rootId: "root", maxCalls: 2 },
    };
    const readiness: AcquisitionReadiness = {
        authorityValid: true,
        scopeEvaluated: true,
        pendingJobIds: [],
        pendingBatchIds: [],
        consumers: [
            { ...input.consumers[0], status: "missing" },
            {
                viewId: "view2",
                slotId: "slot",
                definitionRevision: "revision",
                status: "missing",
            },
        ],
    };
    const inventory: QuestionInventory = {
        head: "head",
        items: ["view1", "view2"].map((viewId) => ({
            corpusId: "corpus",
            viewId,
            viewTitle: viewId,
            viewVersion: 1,
            viewRevisionId: "published-view-revision",
            definitionRevision: "revision",
            attentionScore: 1,
            fingerprint: viewId,
            slot: {
                id: "slot",
                question: "What is the value?",
                cardinality: "singleton",
                schema: { type: "string" },
                approval: "approved",
                discoveryCitations: [],
                rubric: {
                    version: 1,
                    selection: "manual",
                    requireConfirmation: false,
                    authoritySourceIds: [],
                },
            },
            details: {
                kind: "question",
                slotId: "slot",
                candidates: [],
                selectedCandidateIds: [],
                answerState: "pending",
                reviewState: "unreviewed",
                freshness: "current",
                coverage: "unknown",
                evaluatedSources: [],
                scopeFingerprint: "scope",
            },
        })),
    };
    const admitted: DocumentIngestRequest[] = [];
    let failAdmission = false;
    const host: DeferredAcquisitionHost = {
        listQuestions: async () => inventory,
        inspect: async () => structuredClone(readiness),
        withAdmissionBarrier: async (_id, operation) => operation(),
        admit: async (request) => {
            if (failAdmission) throw new Error("Index admission unavailable");
            admitted.push(request);
            return {
                jobId: "job",
                sourceId: request.source.sourceId!,
                revisionId: "source-revision",
                state: "accepted",
                statusUri: "memory://jobs/job",
            };
        },
        getSource: async () => undefined,
        getJob: async () => undefined,
    };
    let calls = 0;
    const tool: AcquisitionTool = {
        id: "read",
        read: async () => {
            calls++;
            return { title: "Retained read", text: "A value" };
        },
    };
    return {
        input,
        readiness,
        host,
        admitted,
        tool,
        calls: () => calls,
        failAdmission: (fail: boolean) => {
            failAdmission = fail;
        },
    };
}

describe("deferred acquisition", () => {
    let root: string;
    const coordinators: DeferredAcquisitionCoordinator[] = [];
    beforeEach(async () => {
        root = await mkdtemp(path.join(process.cwd(), ".acquisition-test-"));
    });
    afterEach(async () => {
        await Promise.all(coordinators.splice(0).map((c) => c.close()));
        await rm(root, { recursive: true, force: true });
    });
    function coordinator(f: ReturnType<typeof fixture>, enabled = true) {
        const result = new DeferredAcquisitionCoordinator(root, f.host, {
            toolsEnabled: enabled,
            periodicEnabled: enabled,
            tools: [f.tool],
            maxCallsPerRequest: 2,
            maxDurationMs: 2000,
        });
        coordinators.push(result);
        return result;
    }

    it("defers relevant jobs, batches and unevaluated scope without calling a tool", async () => {
        const f = fixture();
        const c = coordinator(f);
        await c.add(f.input);
        f.readiness.pendingJobIds = ["relevant"];
        await c.runOnce("corpus");
        f.readiness.pendingJobIds = [];
        f.readiness.pendingBatchIds = ["batch"];
        await c.runOnce("corpus");
        f.readiness.pendingBatchIds = [];
        f.readiness.scopeEvaluated = false;
        await c.runOnce("corpus");
        expect(f.calls()).toBe(0);
        f.readiness.scopeEvaluated = true;
        await c.runOnce("corpus");
        expect(f.calls()).toBe(1);
        expect(f.admitted).toHaveLength(1);
        expect((await c.list("corpus"))[0].state).toBe("ingesting");
        f.readiness.consumers.forEach((consumer) => {
            consumer.status = "resolved";
        });
        await c.runOnce("corpus");
        expect((await c.list("corpus"))[0].state).toBe("resolved");
    });

    it("coalesces two views into one retained source and closes obsolete need without fetching", async () => {
        const f = fixture();
        const c = coordinator(f);
        const first = await c.add(f.input);
        const second = await c.add({
            ...f.input,
            consumers: [f.readiness.consumers[1]],
        });
        expect(first.requestId).toBe(second.requestId);
        expect(second.consumers).toHaveLength(2);
        await c.runOnce("corpus");
        expect(f.calls()).toBe(1);
        expect(f.admitted).toHaveLength(1);
        expect(f.admitted[0].source.sourceId).toBe(first.sourceId);
        const obsolete = fixture();
        obsolete.input.resourceIdentity = "other";
        obsolete.readiness.consumers.forEach((consumer) => {
            consumer.status = "obsolete";
        });
        const c2 = coordinator(obsolete);
        await c2.add(obsolete.input);
        await c2.runOnce("corpus");
        expect(obsolete.calls()).toBe(0);
    });

    it("does not let a relevant pending job starve an unrelated request", async () => {
        const f = fixture();
        const c = coordinator(f);
        const waiting = await c.add(f.input);
        await c.add({ ...f.input, resourceIdentity: "resource:two" });
        f.host.inspect = async (request) => ({
            ...f.readiness,
            pendingJobIds:
                request.requestId === waiting.requestId ? ["relevant"] : [],
        });
        await c.runOnce("corpus");
        const requests = await c.list("corpus");
        expect(requests[0].state).toBe("deferred");
        expect(requests[1].state).toBe("ingesting");
        expect(f.calls()).toBe(1);
    });

    it("does not close a stale resolved answer before current scope evaluation", async () => {
        const f = fixture();
        const c = coordinator(f);
        await c.add(f.input);
        f.readiness.consumers.forEach((consumer) => {
            consumer.status = "resolved";
        });
        f.readiness.scopeEvaluated = false;
        await c.runOnce("corpus");
        expect((await c.list("corpus"))[0].state).toBe("deferred");
        f.readiness.scopeEvaluated = true;
        await c.runOnce("corpus");
        expect((await c.list("corpus"))[0].state).toBe("resolved");
        expect(f.calls()).toBe(0);
    });

    it("persists the exact acquired payload before admission and reuses it after restart", async () => {
        const f = fixture();
        f.failAdmission(true);
        const c = coordinator(f);
        await c.add(f.input);
        await c.runOnce("corpus");
        const staged = (await c.list("corpus"))[0];
        expect(staged.state).toBe("acquired");
        expect(staged.error).toBe("Index admission unavailable");
        expect(staged.staged?.source.capturedAt).toBeDefined();
        await c.close();
        f.failAdmission(false);
        const restarted = coordinator(f);
        await restarted.runOnce("corpus");
        expect(f.calls()).toBe(1);
        expect(f.admitted[0]).toEqual(staged.staged);
    });

    it("reconciles active source revisions before replay and does not overwrite a newer revision", async () => {
        const f = fixture();
        f.failAdmission(true);
        const c = coordinator(f);
        await c.add(f.input);
        await c.runOnce("corpus");
        f.failAdmission(false);
        f.host.getSource = async (_corpus, sourceId) => ({
            corpusId: "corpus",
            sourceId,
            sourceType: "text",
            title: "Newer",
            activeRevisionId: "newer",
            revisions: [
                {
                    revisionId: "newer",
                    sourceId,
                    state: "ready",
                    contentHash: "new",
                    mimeType: "text/plain",
                    pipelineVersion: "1",
                },
            ],
        });
        await c.runOnce("corpus");
        expect(f.calls()).toBe(1);
        expect(f.admitted).toHaveLength(0);
        expect((await c.list("corpus"))[0].error).toContain(
            "source revision changed",
        );
    });

    it("recovers an admitted source after a lost receipt without another read or intake", async () => {
        const f = fixture();
        const c = coordinator(f);
        let durable: DocumentIngestRequest | undefined;
        let admissions = 0;
        f.host.admit = async (request) => {
            admissions++;
            durable = request;
            throw new Error("Receipt interrupted");
        };
        f.host.getSource = async () => {
            if (!durable) return undefined;
            const source = durable.source;
            const revisionId = createHash("sha256")
                .update(source.text!)
                .digest("hex");
            return {
                corpusId: durable.corpusId,
                sourceId: source.sourceId!,
                sourceType: source.sourceType,
                title: source.title,
                activeRevisionId: revisionId,
                revisions: [
                    {
                        revisionId,
                        contentHash: revisionId,
                        sourceId: source.sourceId!,
                        state: "ready",
                        mimeType: "text/plain",
                        pipelineVersion: "1",
                        ...(source.capturedAt === undefined
                            ? {}
                            : { capturedAt: source.capturedAt }),
                    },
                ],
            };
        };
        await c.add(f.input);
        await c.runOnce("corpus");
        await c.close();
        const restarted = coordinator(f);
        await restarted.runOnce("corpus");
        expect(admissions).toBe(1);
        expect(f.calls()).toBe(1);
        expect((await restarted.list("corpus"))[0].state).toBe("ingested");
    });

    it("reconciles an active admitted job before retrying intake", async () => {
        const f = fixture();
        const c = coordinator(f);
        const request = await c.add(f.input);
        await c.runOnce("corpus");
        f.host.getJob = async () => ({
            jobId: "job",
            corpusId: "corpus",
            sourceId: request.sourceId,
            revisionId: "source-revision",
            state: "persisting",
            createdAt: request.createdAt,
            updatedAt: request.updatedAt,
            progress: { completed: 0, total: 1 },
            warnings: [],
        });
        await c.runOnce("corpus");
        expect(f.admitted).toHaveLength(1);
        expect(f.calls()).toBe(1);
    });

    it("persists ingested separately while questions remain unmet and never repeats completed intake", async () => {
        const f = fixture();
        const c = coordinator(f);
        const request = await c.add(f.input);
        await c.runOnce("corpus");
        expect((await c.list("corpus"))[0].state).toBe("ingesting");
        f.host.getJob = async () => ({
            jobId: "job",
            corpusId: "corpus",
            sourceId: request.sourceId,
            revisionId: "source-revision",
            state: "complete",
            createdAt: request.createdAt,
            updatedAt: request.updatedAt,
            progress: { completed: 1, total: 1 },
            warnings: [],
        });
        f.readiness.scopeEvaluated = false;
        await c.runOnce("corpus");
        expect((await c.list("corpus"))[0].state).toBe("ingested");
        await c.close();
        const restarted = coordinator(f);
        f.host.getJob = async () => {
            throw new Error("Job lookup unavailable");
        };
        await restarted.runOnce("corpus");
        f.readiness.scopeEvaluated = true;
        await restarted.runOnce("corpus");
        expect((await restarted.list("corpus"))[0].state).toBe("ingested");
        expect(f.admitted).toHaveLength(1);
        expect(f.calls()).toBe(1);
        f.readiness.consumers.forEach((consumer) => {
            consumer.status = "resolved";
        });
        await restarted.runOnce("corpus");
        expect((await restarted.list("corpus"))[0].state).toBe("resolved");
    });

    it("fences an expired worker before staging or admission", async () => {
        const f = fixture();
        const fetched = latch<void>();
        const release = latch<{ title: string; text: string }>();
        f.tool.read = async () => {
            fetched.resolve();
            return release.promise;
        };
        const c = coordinator(f);
        await c.add({ ...f.input, maxCalls: 2 });
        const oldRun = c.runOnce("corpus");
        await fetched.promise;
        const file = path.join(root, "corpus", "acquisitions", "requests.json");
        const store = JSON.parse(await readFile(file, "utf8"));
        store.requests[0].lease.expiresAt = Date.now() - 1;
        await writeRunbookJson(file, JSON.stringify(store));
        const newer = fixture();
        const c2 = coordinator({ ...newer, host: f.host });
        await c2.runOnce("corpus");
        release.resolve({ title: "Obsolete", text: "Old result" });
        await oldRun;
        expect(f.admitted).toHaveLength(1);
        expect(f.admitted[0].source.text).toBe("A value");
        expect((await c2.list("corpus"))[0].staged?.source.text).toBe(
            "A value",
        );
    });

    it("cancels in-flight reads and durably scrubs removal-related state", async () => {
        const f = fixture();
        f.input.lineage.rootId = "source-derived-routing-label";
        const fetched = latch<void>();
        const release = latch<{ title: string; text: string }>();
        f.tool.read = async () => {
            fetched.resolve();
            return release.promise;
        };
        const c = coordinator(f);
        const request = await c.add(f.input);
        const run = c.runOnce("corpus");
        await fetched.promise;
        await c.cancel("corpus", request.requestId);
        release.resolve({ title: "Late", text: "Removed payload" });
        await run;
        expect(f.admitted).toHaveLength(0);
        expect((await c.list("corpus"))[0].staged).toBeUndefined();
        await c.suppress("corpus", { uncertain: true });
        await expect(c.add(f.input)).rejects.toThrow("suppressed by removal");
        const file = await readFile(
            path.join(root, "corpus", "acquisitions", "requests.json"),
            "utf8",
        );
        expect(file).not.toContain("resource:one");
        expect(file).not.toContain("Removed payload");
        expect(file).not.toContain("source-derived-routing-label");
    });

    it("durably suppresses a removed source identity and scrubs its staged result", async () => {
        const f = fixture();
        f.failAdmission(true);
        const c = coordinator(f);
        const request = await c.add(f.input);
        await c.runOnce("corpus");
        expect((await c.list("corpus"))[0].staged).toBeDefined();
        await c.suppress("corpus", { sourceIds: [request.sourceId] });
        await c.close();
        const restarted = coordinator(f);
        const removed = (await restarted.list("corpus"))[0];
        expect(removed.state).toBe("cancelled");
        expect(removed.staged).toBeUndefined();
        expect(removed.authorizedArguments).toEqual({});
        await expect(restarted.add(f.input)).rejects.toThrow(
            "suppressed by removal",
        );
        expect(f.calls()).toBe(1);
    });

    it("accounts call allowances across cancelled requests in a finite lineage", async () => {
        const f = fixture();
        const c = coordinator(f);
        const first = await c.add({
            ...f.input,
            lineage: { rootId: "finite", maxCalls: 1 },
        });
        await c.runOnce("corpus");
        await c.cancel("corpus", first.requestId);
        await c.add({
            ...f.input,
            resourceIdentity: "resource:next",
            lineage: { rootId: "finite", maxCalls: 2 },
        });
        await c.runOnce("corpus");
        expect(f.calls()).toBe(1);
        expect((await c.list("corpus"))[1].error).toBe(
            "Acquisition call allowance exhausted",
        );
    });

    it("rejects oversized results before staging or intake and enforces tool duration", async () => {
        const f = fixture();
        const c = new DeferredAcquisitionCoordinator(root, f.host, {
            toolsEnabled: true,
            tools: [f.tool],
            maxBytes: 8,
            maxDurationMs: 100,
        });
        coordinators.push(c);
        await c.add(f.input);
        await c.runOnce("corpus");
        expect((await c.list("corpus"))[0].error).toBe(
            "Acquisition response exceeds byte limit",
        );
        expect((await c.list("corpus"))[0].staged).toBeUndefined();
        expect(f.admitted).toHaveLength(0);
        const never = latch<{ title: string; text: string }>();
        f.tool.read = async () => never.promise;
        await c.add({ ...f.input, resourceIdentity: "resource:slow" });
        await c.runOnce("corpus");
        expect((await c.list("corpus"))[1].error).toMatch(
            /Acquisition (aborted|duration exceeded)/,
        );
        expect(f.admitted).toHaveLength(0);
    });

    it("defaults to disabled tools and periodic operation", async () => {
        const f = fixture();
        const c = new DeferredAcquisitionCoordinator(root, f.host, {
            tools: [f.tool],
        });
        coordinators.push(c);
        await c.add(f.input);
        await c.runOnce("corpus");
        expect(f.calls()).toBe(0);
        expect((await c.list("corpus"))[0].error).toBe(
            "Acquisition tools disabled",
        );
        expect(() =>
            c.startPeriodic({
                corpusIds: ["corpus"],
                intervalMs: 10,
                maxTicks: 1,
            }),
        ).toThrow("Periodic acquisition disabled");
    });

    it("does not admit caller-supplied staged payload or internal accounting fields", async () => {
        const f = fixture();
        const c = coordinator(f, false);
        const supplied = {
            ...f.input,
            lineageIdentity: "caller-controlled",
            calls: -100,
            staged: {
                corpusId: "corpus",
                source: {
                    sourceId: "injected",
                    sourceType: "text",
                    title: "Unapproved",
                    text: "Injected",
                },
            },
        };
        const request = await c.add(supplied);
        expect(request.staged).toBeUndefined();
        expect(request.calls).toBe(0);
        expect(request.lineageIdentity).not.toBe("caller-controlled");
        await c.runOnce("corpus");
        expect(f.admitted).toHaveLength(0);
        expect(f.calls()).toBe(0);
    });

    it("retains host-derived source tags and distinguishes tag scopes in acquisition identity", async () => {
        const f = fixture();
        const c = coordinator(f);
        const first = await c.add({
            ...f.input,
            sourceTags: ["domain", "shared"],
        });
        const same = await c.add({
            ...f.input,
            sourceTags: ["shared", "domain"],
        });
        const other = await c.add({ ...f.input, sourceTags: ["other-domain"] });
        expect(same.requestId).toBe(first.requestId);
        expect(other.sourceId).not.toBe(first.sourceId);
        await c.runOnce("corpus");
        expect(f.admitted[0].source.tags).toEqual(["domain", "shared"]);
        expect(f.admitted[1].source.tags).toEqual(["other-domain"]);
        await c.suppress("corpus", { uncertain: true });
        const removed = await c.list("corpus");
        expect(
            removed.every((request) => request.sourceTags === undefined),
        ).toBe(true);
        expect(removed.every((request) => request.staged === undefined)).toBe(
            true,
        );
        await expect(
            c.add({ ...f.input, sourceTags: ["x".repeat(101)] }),
        ).rejects.toThrow("bounded source tags");
    });

    it("retains host-derived project membership and distinguishes project scopes", async () => {
        const f = fixture();
        const c = coordinator(f);
        const first = await c.add({ ...f.input, sourceProject: "project-one" });
        const second = await c.add({
            ...f.input,
            sourceProject: "project-two",
        });
        expect(first.sourceId).not.toBe(second.sourceId);
        await c.runOnce("corpus");
        expect(f.admitted[0].source.metadata?.project).toBe("project-one");
        expect(f.admitted[1].source.metadata?.project).toBe("project-two");
        await c.suppress("corpus", { uncertain: true });
        expect(
            (await c.list("corpus")).every(
                (request) => request.sourceProject === undefined,
            ),
        ).toBe(true);
        await expect(c.add({ ...f.input, sourceProject: " " })).rejects.toThrow(
            "bounded source project",
        );
    });

    it("uses the same bounded coordinator for finite periodic triggers", async () => {
        const f = fixture();
        const c = coordinator(f);
        await c.add(f.input);
        const triggered = latch<void>();
        const actual = c.runOnce.bind(c);
        const run = import.meta.jest.spyOn(c, "runOnce");
        run.mockImplementation(async (corpusId) => {
            const result = await actual(corpusId);
            triggered.resolve();
            return result;
        });
        c.startPeriodic({ corpusIds: ["corpus"], intervalMs: 10, maxTicks: 1 });
        await triggered.promise;
        await new Promise((resolve) => setTimeout(resolve, 40));
        expect(run).toHaveBeenCalledTimes(1);
        expect(f.calls()).toBe(1);
        await c.close();
    });
});
