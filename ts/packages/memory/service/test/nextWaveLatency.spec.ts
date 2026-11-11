// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { FileMemoryService } from "../src/fileMemoryService.js";
import { ViewBuildRunner } from "../src/viewBuilds.js";
import { createLatencyWikiJob } from "../src/latencyQualificationFixture.js";
import { hydrateInformational } from "../src/informationalWiki.js";
import { hydrateProjectSummary } from "../src/informationalProject.js";
import { projectBriefRoles } from "../src/projectBrief.js";
import { waitForMemoryJob } from "../src/rpcFacade.js";
import { FakeSemanticCorpusIndex } from "./fakeSemanticCorpusIndex.js";

test("parallel evidence-only utility preparation needs no canonical-page reads or writes", async () => {
    const job = createLatencyWikiJob();
    let active = 0,
        peak = 0,
        assessments = 0,
        receipts = 0;
    const runner = new ViewBuildRunner(
        {
            identity: "offline-utility-first",
            assessWikiSubject: async (_input, pages, signal) => {
                expect(pages).toEqual([]);
                active++;
                peak = Math.max(peak, active);
                try {
                    await delay(2, undefined, { signal });
                    assessments++;
                    return {
                        disposition: "defer",
                        deferBasis: "evidence",
                        purpose: "Incidental mention",
                        reason: "No substantive standalone explanation",
                        canonicalViewId: "",
                        sharedFragmentIds: [],
                        essentialDistinctions: [],
                        ambiguousViewIds: [],
                    };
                } finally {
                    active--;
                }
            },
            generate: async () => {
                throw new Error("Unexpected generation");
            },
            validate: async () => {
                throw new Error("Unexpected validation");
            },
        },
        {
            current: async () => undefined,
            wikiPages: async () => {
                throw new Error("Utility must not load canonical pages");
            },
            recordWikiAssessment: async (_job, target, assessment, pages) => {
                expect(pages).toEqual([]);
                receipts++;
                target.wikiAssessment = assessment;
                target.state = "skipped";
            },
            update: async (_corpus, _id, update) => {
                update(job);
                return job;
            },
            materialize: async () => {
                throw new Error("Unexpected install");
            },
        },
        undefined,
        undefined,
        undefined,
        1,
        false,
        2,
        true,
        undefined,
        undefined,
        true,
    );
    try {
        runner.start(job);
        await runner.wait(job.jobId, AbortSignal.timeout(10000));
        expect(job.state).toBe("complete");
        expect([assessments, receipts, active, peak]).toEqual([12, 12, 0, 2]);
    } finally {
        await runner.close();
    }
});

class ParallelPagesIndex extends FakeSemanticCorpusIndex {
    async listSubjects() {
        return {
            total: 1,
            items: [
                {
                    term: "Atlas migration",
                    sourceIds: ["source"],
                    postingCount: 1,
                    initiative: true,
                },
            ],
        };
    }
    async readFragments() {
        const document = this.documents.find(
            (entry) => entry.source.sourceId === "source",
        );
        if (!document) throw new Error("Original source missing");
        return {
            fragments: [
                {
                    sourceId: document.source.sourceId,
                    revisionId: document.revision.revisionId,
                    snippet: document.content,
                    locator: `indexed:0:${document.revision.contentHash}:0-${document.content.length}`,
                    score: 1,
                },
            ],
            readChars: document.content.length,
            limited: false,
        };
    }
}

test("Wiki and project synthesis overlap frozen inputs while installation stays serialized", async () => {
    const root = await mkdtemp(
        path.join(os.tmpdir(), "memory-frozen-families-"),
    );
    let release!: () => void, bothStarted!: () => void;
    const held = new Promise<void>((resolve) => {
        release = resolve;
    });
    const started = new Promise<void>((resolve) => {
        bothStarted = resolve;
    });
    const pipelines = new Set<string>();
    const timeout = new AbortController();
    let installing = 0,
        peakInstalling = 0;
    const service = new FileMemoryService(root, {
        maintenanceMode: "manual",
        automaticKnowledgeDiscovery: false,
        sourceSynopses: false,
        performanceExperiments:
            "family-frozen-preparation,wiki-full-context,wiki-stable-evidence,wiki-utility-first,wiki-coalesced-discovery",
        maintenanceConcurrency: { builds: 3 },
        wikiAssessmentConcurrency: 2,
        indexFactory: (_id, directory) => new ParallelPagesIndex(directory),
        viewPublicationCheckpoint: async () => {
            installing++;
            peakInstalling = Math.max(peakInstalling, installing);
            try {
                await delay(2);
            } finally {
                installing--;
            }
        },
        viewSynthesisAdapter: {
            identity: "offline-frozen-families",
            assessWikiSubject: async () => ({
                disposition: "distinct",
                purpose: "Independent migration reference",
                reason: "Substantive scoped source guidance",
                canonicalViewId: "",
                sharedFragmentIds: [],
                essentialDistinctions: [],
                ambiguousViewIds: [],
            }),
            generate: async (input, signal) => {
                pipelines.add(input.pipeline);
                if (pipelines.size === 2) bothStarted();
                await held;
                signal.throwIfAborted();
                if (input.definition.projectSummary)
                    return hydrateProjectSummary(input, {
                        title: "Atlas migration",
                        summary: "Migration scope and acceptance",
                        completeness: "partial",
                        ...Object.fromEntries(
                            projectBriefRoles.map((role) => [
                                role,
                                role === "goalsScope"
                                    ? input.inputs[0].content
                                    : "Not established in selected evidence.",
                            ]),
                        ),
                        limits: "Selected original source",
                        citationIds: ["f0"],
                        projectState: "unknown",
                        incidentState: "unknown",
                        capacityState: "unknown",
                        assignments: [],
                        milestoneItems: [],
                        decisionItems: [],
                        riskItems: [],
                        openQuestions: [],
                    });
                return hydrateInformational(input, {
                    title: "Atlas migration",
                    summary: "Migration scope and acceptance",
                    status: "partial",
                    prose: input.inputs[0].content,
                    limits: "Selected original source",
                    citationIds: ["f0"],
                });
            },
            validate: async () => {
                throw new Error("Unexpected generic support path");
            },
        },
    });
    try {
        const { corpusId } = await service.createCorpus("Frozen families");
        const admitted = await service.ingestDocument({
            corpusId,
            source: {
                sourceId: "source",
                sourceType: "text",
                title: "Atlas migration",
                text: "Atlas migration moves the reporting database in two phases. The owner validates read parity before redirecting production queries. Rollback retains the original database until acceptance is complete.",
            },
        });
        expect((await waitForMemoryJob(service, admitted.jobId)).state).toBe(
            "complete",
        );
        const checkpoint = await service.createKnowledgeCheckpoint({
            corpusId,
            families: ["wiki", "projects"],
            producerComplete: true,
            timeoutMs: 30000,
        });
        await Promise.race([
            started,
            delay(10000, undefined, { signal: timeout.signal }).then(() => {
                throw new Error(
                    "Independent family preparation did not overlap",
                );
            }),
        ]);
        expect(pipelines).toEqual(
            new Set([
                "informational-wiki-v1",
                "informational-project-summary-v1",
            ]),
        );
        release();
        const done = await service.waitForKnowledgeCheckpoint({
            corpusId,
            checkpointId: checkpoint.checkpointId,
            timeoutMs: 30000,
        });
        if (done.state === "failed") throw new Error(JSON.stringify(done));
        expect(done.state).toBe("ready");
        expect(peakInstalling).toBe(1);
        expect((await service.listViews(corpusId)).views).toHaveLength(2);
    } finally {
        timeout.abort();
        release();
        await service.close();
        await rm(root, { recursive: true, force: true });
    }
});

test("frozen family preparation rejects a scheduler without independent build capacity", () => {
    expect(
        () =>
            new FileMemoryService("unused", {
                performanceExperiments: "family-frozen-preparation",
                maintenanceConcurrency: { builds: 2 },
            }),
    ).toThrow("at least three");
});

test.each([
    {
        experiments: "wiki-grouped-contributions",
        concurrency: 2,
        message: "complete canonical context",
    },
    {
        experiments: "wiki-grouped-contributions,wiki-full-context",
        concurrency: 1,
        message: "preparation concurrency at least two",
    },
])(
    "grouped contributions reject an unsafe configuration: $message",
    ({ experiments, concurrency, message }) => {
        expect(
            () =>
                new FileMemoryService("unused", {
                    performanceExperiments: experiments,
                    wikiAssessmentConcurrency: concurrency,
                }),
        ).toThrow(message);
    },
);
