// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { setTimeout as delay } from "node:timers/promises";
import { performance } from "node:perf_hooks";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createDocMemorySettings } from "@typeagent/conversation-memory";
import { createKnowProCorpusIndex } from "./knowProCorpusIndex.js";
import { ViewBuildRunner, ViewBuildStaleError } from "./viewBuilds.js";
import type {
    ViewBuildJob,
    ViewBuildSnapshot,
    WikiPagePurposeContext,
} from "./viewTypes.js";

export function createLatencyWikiJob(): ViewBuildJob {
    const snapshot: ViewBuildSnapshot = {
        corpusId: "offline",
        actor: "offline",
        expectedVersion: 0,
        bounds: {},
        pipeline: "informational-wiki-v1",
        model: "offline-fixture-v1",
        fingerprint: "frozen",
        inputs: [
            {
                sourceId: "source",
                revisionId: "revision",
                title: "Offline source",
                content: "The review remains open.",
                contentHash: "a".repeat(64),
                passages: [
                    {
                        sourceId: "source",
                        revisionId: "revision",
                        locator: `indexed:0:${"a".repeat(64)}:0-24`,
                        excerpt: "The review remains open.",
                    },
                ],
            },
        ],
        definition: {
            viewId: "candidate",
            kind: "wiki",
            selector: {
                kind: "sources",
                sources: [{ sourceId: "source", revisionId: "revision" }],
            },
            wiki: {
                construction: "informational-wiki-v1",
                query: "open review",
                aliases: [],
                excludedSourceIds: [],
            },
        },
    };
    return {
        jobId: "offline-job",
        corpusId: "offline",
        fingerprint: "frozen",
        actor: "offline",
        createdAt: "2026-11-09T00:00:00Z",
        updatedAt: "2026-11-09T00:00:00Z",
        request: { corpusId: "offline", expectedHead: null, targets: [] },
        state: "running",
        publication: false,
        maintenancePlan: {
            corpusId: "offline",
            expectedHead: null,
            targets: [],
        },
        results: Array.from({ length: 12 }, (_, ordinal) => ({
            viewId: `candidate-${ordinal}`,
            state: "pending",
            reason: "Admitted",
            snapshot: {
                ...structuredClone(snapshot),
                definition: {
                    ...structuredClone(snapshot.definition),
                    viewId: `candidate-${ordinal}`,
                },
            },
        })),
    };
}

export async function replayWikiAssessment(
    concurrency: 1 | 2 | 4,
    churn: boolean,
) {
    const job = createLatencyWikiJob();
    let version = 0,
        attempts = 0,
        discarded = 0,
        active = 0,
        peak = 0;
    const captured = new WeakMap<WikiPagePurposeContext[], number>();
    const receipts: string[] = [];
    const runner = new ViewBuildRunner(
        {
            identity: "offline-fixture-v1",
            assessWikiSubject: async (_input, _pages, signal) => {
                attempts++;
                active++;
                peak = Math.max(peak, active);
                try {
                    await delay(4, undefined, { signal });
                } finally {
                    active--;
                }
                return {
                    disposition: "defer",
                    purpose: "Incidental review mention",
                    reason: "No explanatory substance beyond a passing mention",
                    canonicalViewId: "",
                    sharedFragmentIds: [],
                    essentialDistinctions: [],
                    ambiguousViewIds: [],
                };
            },
            generate: async () => {
                throw new Error("Uncaptured synthesis request");
            },
            validate: async () => {
                throw new Error("Uncaptured validation request");
            },
        },
        {
            current: async () => undefined,
            wikiPages: async () => {
                const pages: WikiPagePurposeContext[] = [];
                captured.set(pages, version);
                return pages;
            },
            recordWikiAssessment: async (_job, result, assessment, pages) => {
                if (captured.get(pages) !== version) {
                    discarded++;
                    throw new ViewBuildStaleError(
                        "Current-page witness changed",
                    );
                }
                receipts.push(result.viewId);
                result.state = "skipped";
                result.reason = assessment.reason;
                result.wikiAssessment = assessment;
                if (churn) version++;
            },
            update: async (_corpus, _id, update) => {
                update(job);
                return job;
            },
            materialize: async () => {
                throw new Error("Unexpected materialization");
            },
        },
        undefined,
        undefined,
        undefined,
        1,
        false,
        concurrency,
    );
    const start = performance.now();
    runner.start(job);
    try {
        await runner.wait(job.jobId, AbortSignal.timeout(10_000));
    } finally {
        await runner.close();
    }
    if (job.state !== "complete" || receipts.length !== 12 || active !== 0)
        throw new Error("Wiki replay did not settle with all guarded receipts");
    return {
        wallMs: performance.now() - start,
        attempts,
        discarded,
        peak,
        receipts,
        states: job.results.map(({ state }) => state),
        publication: job.publication,
    };
}

export async function replayDerivativeIndex(structuredOnly: boolean) {
    const root = await mkdtemp(
        path.join(os.tmpdir(), "memory-derivative-replay-"),
    );
    const originalEmbedding = process.env.TYPEAGENT_EMBEDDING_PROVIDER;
    process.env.TYPEAGENT_EMBEDDING_PROVIDER = "none";
    let attempts = 0;
    const empty = { entities: [], actions: [], inverseActions: [], topics: [] };
    const settings = () => {
        const value = createDocMemorySettings(64, undefined, {
            completionSettings: {},
            complete: async () => {
                throw new Error("Uncaptured model request");
            },
        });
        value.conversationSettings.semanticRefIndexSettings.knowledgeExtractor =
            {
                settings: { maxContextLength: 4096 },
                extract: async () => {
                    throw new Error("Unexpected extraction interface");
                },
                extractWithRetry: async () => {
                    if (!structuredOnly) {
                        attempts++;
                        await delay(4);
                    }
                    return {
                        success: true,
                        data: structuredOnly
                            ? empty
                            : { ...empty, topics: ["release-gate"] },
                    };
                },
            };
        return value;
    };
    const hash = (value: unknown) =>
        createHash("sha256").update(JSON.stringify(value)).digest("hex");
    const content =
        "# Open review\n\nPlatform readiness does not establish approval. The review remains open.";
    const query = {
        terms: ["review"],
        sourceIds: ["wiki-view"],
        maxFragments: 4,
    };
    const aliasQuery = {
        ...query,
        terms: ["release-gate"],
        includeDiagnostics: true,
    };
    try {
        const index = createKnowProCorpusIndex("offline", root, settings);
        const start = performance.now();
        await index.rebuild(
            [
                {
                    source: {
                        sourceId: "wiki-view",
                        corpusId: "offline",
                        sourceType: "markdown",
                        title: "Open review",
                        activeRevisionId: "view-revision",
                    },
                    revision: {
                        sourceId: "wiki-view",
                        revisionId: "view-revision",
                        contentHash: createHash("sha256")
                            .update(content)
                            .digest("hex"),
                        mimeType: "text/markdown",
                        pipelineVersion: "offline",
                        state: "ready",
                    },
                    content,
                    pipeline: { mode: "content" },
                },
            ],
            AbortSignal.timeout(10_000),
            async () => {},
        );
        const buildMs = performance.now() - start;
        if (!index.readFragments)
            throw new Error("Native fragment index unavailable");
        const lexical = await index.readFragments(query);
        const alias = await index.readFragments(aliasQuery);
        const graph = await index.getKnowledgeGraph();
        const reopened = createKnowProCorpusIndex("offline", root, settings);
        await reopened.initialize();
        if (!reopened.readFragments)
            throw new Error("Reopened native fragment index unavailable");
        const reopenExact =
            hash(await reopened.readFragments(query)) === hash(lexical) &&
            hash(await reopened.readFragments(aliasQuery)) === hash(alias) &&
            hash(await reopened.getKnowledgeGraph()) === hash(graph);
        if (!reopenExact)
            throw new Error("Native derivative cold-reopen parity failed");
        return {
            buildMs,
            attempts,
            reopenExact,
            lexicalDigest: hash(lexical),
            aliasDigest: hash(alias),
            semanticDigest: hash(graph),
        };
    } finally {
        if (originalEmbedding === undefined)
            delete process.env.TYPEAGENT_EMBEDDING_PROVIDER;
        else process.env.TYPEAGENT_EMBEDDING_PROVIDER = originalEmbedding;
        await rm(root, { recursive: true, force: true });
    }
}
