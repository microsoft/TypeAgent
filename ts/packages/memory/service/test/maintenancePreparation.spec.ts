// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ViewBuildRunner, ViewBuildStaleError } from "../src/viewBuilds.js";
import { setTimeout as delay } from "node:timers/promises";
import type {
    ViewBuildJob,
    ViewBuildSnapshot,
    WikiSubjectAssessment,
} from "../src/viewTypes.js";

test.each([
    { lanes: 1, mode: "ordered" },
    { lanes: 4, mode: "ordered" },
    { lanes: 4, mode: "stale" },
    { lanes: 4, mode: "unchanged" },
    { lanes: 4, mode: "resume" },
    { lanes: 4, mode: "cancelled" },
    { lanes: 4, mode: "failed" },
    { lanes: 4, mode: "budgeted" },
    { lanes: 4, mode: "slow-cancelled-lookup" },
    { lanes: 4, mode: "slow-cancelled-provider" },
    { lanes: 4, mode: "slow-cancelled-preflight" },
])(
    "Wiki assessment preparation: $lanes lanes, $mode",
    async ({ lanes, mode }) => {
        const snapshots: ViewBuildSnapshot[] = Array.from(
            { length: 8 },
            (_, index) => ({
                corpusId: "corpus",
                actor: "test",
                expectedVersion: 0,
                bounds: {},
                inputs: [],
                definition: {
                    viewId: `candidate-${index}`,
                    kind: "wiki",
                    selector: { kind: "sources", sources: [] },
                    wiki: {
                        construction: "informational-wiki-v1",
                        query: `candidate-${index}`,
                        aliases: [],
                        excludedSourceIds: [],
                    },
                },
                pipeline: "informational-wiki-v1",
                model: "offline",
                fingerprint: `fingerprint-${index}`,
            }),
        );
        const request = {
            corpusId: "corpus",
            expectedHead: null,
            targets: snapshots.map((snapshot) => ({
                definition: snapshot.definition,
                expectedVersion: 0,
            })),
        };
        const job: ViewBuildJob = {
            jobId: "job",
            corpusId: "corpus",
            fingerprint: "job",
            request,
            actor: "test",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            state: "running",
            publication: false,
            maintenancePlan: {
                corpusId: "corpus",
                expectedHead: null,
                targets: [],
            },
            results: snapshots.map((snapshot) => ({
                viewId: snapshot.definition.viewId,
                snapshot,
                state: "pending",
                reason: "queued",
            })),
        };
        if (mode === "resume")
            for (const result of job.results)
                result.snapshot.wikiContribution = {
                    candidateViewId: result.viewId,
                    query: result.viewId,
                    purpose: "Retained contribution",
                    essentialDistinctions: [],
                };
        let active = 0;
        let peak = 0;
        let rejectedStale = false;
        let calls = 0;
        let releaseSlow!: () => void;
        const slow = new Promise<void>((resolve) => {
            releaseSlow = resolve;
        });
        let enteredSlow!: () => void;
        const entered = new Promise<void>((resolve) => {
            enteredSlow = resolve;
        });
        const slowCancellation = async () => {
            runner.cancelAll();
            enteredSlow();
            await slow;
        };
        const applied: string[] = [];
        const assessment: WikiSubjectAssessment = {
            disposition: "defer",
            purpose: "Insufficient evidence",
            reason: "Only a passing mention",
            canonicalViewId: "",
            sharedFragmentIds: [],
            essentialDistinctions: [],
            ambiguousViewIds: [],
        };
        const runner = new ViewBuildRunner(
            {
                identity: "offline",
                generate: async () => {
                    throw new Error("Deferred target must not generate prose");
                },
                validate: async () => {
                    throw new Error("Deferred target must not validate prose");
                },
                assessWikiSubject: async (_input, _pages, signal) => {
                    calls++;
                    peak = Math.max(peak, ++active);
                    try {
                        if (mode === "slow-cancelled-provider") {
                            await slowCancellation();
                            return assessment;
                        }
                        if (mode === "cancelled") runner.cancelAll();
                        await delay(10, undefined, { signal });
                        if (mode === "failed")
                            throw new Error("Assessment provider failed");
                        return assessment;
                    } finally {
                        active--;
                    }
                },
            },
            {
                update: async (_corpusId, _jobId, update) => {
                    update(job);
                    return job;
                },
                current: async () => undefined,
                unchanged: async () => mode === "unchanged",
                canPrepareWikiAssessment: async () => {
                    if (mode === "slow-cancelled-preflight")
                        await slowCancellation();
                    return mode !== "unchanged";
                },
                resumeWikiContribution: async (_job, result) => {
                    if (mode !== "resume") return false;
                    result.state = "skipped";
                    return true;
                },
                wikiPages: async () => {
                    if (mode === "slow-cancelled-lookup")
                        await slowCancellation();
                    return [];
                },
                recordWikiAssessment: async (_job, result) => {
                    if (
                        mode === "stale" &&
                        result.viewId === "candidate-1" &&
                        !rejectedStale
                    ) {
                        rejectedStale = true;
                        throw new ViewBuildStaleError(
                            "Earlier canonical publication changed context",
                        );
                    }
                    applied.push(result.viewId);
                    result.state = "skipped";
                },
                materialize: async () => {
                    throw new Error("Deferred target must not materialize");
                },
            },
            mode === "budgeted"
                ? {
                      inputTokens: 16000,
                      outputTokens: 4000,
                      safetyTokens: 1000,
                      chatAttempts: 24,
                      reservedTokens: 160000,
                      embeddingAttempts: 128,
                      elapsedMs: 600000,
                      tokenizer: "mock",
                      countTokens: (text) => text.length,
                  }
                : undefined,
            undefined,
            undefined,
            1,
            false,
            lanes,
        );
        try {
            runner.start(job);
            if (mode.startsWith("slow-cancelled")) {
                await entered;
                let closed = false;
                const closing = runner.close().then(() => {
                    closed = true;
                });
                await new Promise((resolve) => setImmediate(resolve));
                expect(closed).toBe(false);
                releaseSlow();
                await closing;
            }
            await runner.wait(job.jobId, new AbortController().signal);
            expect(active).toBe(0);
            if (mode.includes("cancelled")) {
                expect(job.state).toBe("cancelled");
                expect(applied).toEqual([]);
                return;
            }
            if (mode === "failed") {
                expect(job.state).toBe("failed");
                expect(
                    job.results.every((result) => result.state === "blocked"),
                ).toBe(true);
                expect(applied).toEqual([]);
                return;
            }
            expect(job.state).toBe("complete");
            if (mode === "unchanged" || mode === "resume") {
                expect(calls).toBe(0);
                expect(applied).toEqual([]);
                return;
            }
            expect(applied).toEqual(
                snapshots.map((snapshot) => snapshot.definition.viewId),
            );
            expect(peak).toBe(mode === "budgeted" ? 1 : lanes);
            expect(calls).toBe(mode === "stale" ? 9 : 8);
        } finally {
            releaseSlow();
            await runner.close();
        }
    },
);
