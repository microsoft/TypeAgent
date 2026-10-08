// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FileMemoryService } from "../src/fileMemoryService.js";
import { waitForMemoryJob } from "../src/rpcFacade.js";
import { FakeProcedureCorpusIndex } from "./fakeProcedureCorpusIndex.js";
import type {
    ViewBuildJob,
    ViewBuildSnapshot,
    ViewSynthesisOutput,
    ViewSupportReport,
} from "../src/viewTypes.js";

const fixtures = fileURLToPath(
    new URL("../../test/fixtures/distillation/", import.meta.url),
);
const earlyFiles = [
    "project-charter.md",
    "service-overview.md",
    "operating-constraints.md",
    "session-01.md",
    "session-02.md",
];
const lateFiles = ["session-03.md", "session-04.md", "status-review.md"];

// These are controlled offline model responses, not generator logic or imported model inputs.
function controlledGuide(
    input: ViewBuildSnapshot,
    checkpoint: "early" | "full" | "followup",
): ViewSynthesisOutput {
    const early = checkpoint === "early";
    const sections: ViewSynthesisOutput["content"]["sections"] = [
        {
            id: "goal",
            role: "description",
            heading: "Goal and applicability",
            body: "Diagnose checkout latency in payments-api for the separate October rehearsal. Azure SQL execution and application connection acquisition are separate concerns; future incidents require fresh evidence.",
        },
        {
            id: "prerequisites",
            role: "prerequisites",
            heading: "Prerequisites",
            body: "Require read access, the known previous configuration, measured workload headroom and explicit change approval. Ownership placeholders are unresolved identities, not permission.",
        },
        {
            id: "trajectory",
            role: "diagnostic",
            heading: "Diagnostic trajectory",
            body: early
                ? "Checkout p95 rose from 420 to 2800 milliseconds with errors 2.1 percent. SQL CPU was 68 percent against an 80 percent scale-review threshold. The reporting-query hypothesis was rejected because zero affected traces correlated; no sustained blocking correlated. Database scaling was deferred, not attempted. Acquire separate phase timing; the cause and recovery remain unknown."
                : "Checkout p95 initially reached 2800 milliseconds. The reporting-query hypothesis was rejected after zero affected trace correlations, and scaling was deferred, not attempted. Phase timing later separated acquisition 1850 milliseconds from SQL execution 140 milliseconds. A configuration comparison discovered the earlier pool reduction from 100 to 20; it became known only in session 3. The recorded simulated recovery and stable observation support pool exhaustion for this episode, not a universal diagnosis.",
        },
        {
            id: "guards",
            role: "guard",
            heading: "Guards and authority",
            body: "Use the normal reviewed configuration deployment path, not direct production edits or blind database scaling. Recorded rehearsal approval grants no future live approval. A pool size of 100 is not a universal recommendation. Stop and escalate when evidence or approval is missing.",
        },
        {
            id: "verification",
            role: "verification",
            heading: "Verification",
            body: early
                ? "No verified recovery is recorded in this checkpoint. Verify latency, errors, connection waits, timeout exceptions and workload/server health over an approved window after any future reviewed change."
                : "In the recorded rehearsal, p95 was 460 milliseconds and errors were 0.2 percent after simulated restoration. Connection waits returned to baseline and timeouts stopped. Twenty minutes of healthy observation justified incident closure, not project completion.",
        },
        {
            id: "recovery",
            role: "recovery",
            heading: "Recovery and escalation",
            body: early
                ? "Do not prescribe a confirmed fix: recovery evidence is missing. Preserve prior configuration for rollback and escalate to the service or database owner. No automatic rollback or live command is authorized."
                : "The fixture records a simulated approved restoration to the prior pool value 100 through normal configuration deployment. It changed no live resource and grants no future approval. Preserve previous configuration for rollback; if a reviewed restoration fails, reopen server-pressure and query investigation.",
        },
        {
            id: "reuse",
            role: "context",
            heading: "Reuse and open work",
            body:
                checkpoint === "followup"
                    ? "The earlier recovery remains valid. A later peak-load rehearsal reached the workload-memory warning level at pool 100; measured workload headroom is required before selecting a target. Capacity validation is blocked pending service-owner review, with no automatic pool increases or skill publication."
                    : "Incident recovery does not complete peak-load capacity validation or owner sign-off. Treat attempted or rejected hypotheses as investigation history, not mandatory fixes. Future cases require fresh evidence.",
        },
    ];
    const citations = input.inputs.map((source) => ({
        sourceId: source.sourceId,
        revisionId: source.revisionId,
        locator: `chars:0-${source.content.length}`,
        excerpt: source.content,
    }));
    return {
        content: {
            kind: "troubleshootingGuide",
            title: "Conditional checkout latency diagnosis",
            sections,
            citations,
        },
        relationships: sections.flatMap((section) =>
            citations.map((citation, index) => ({
                id: `${section.id}-support-${index}`,
                predicate: "supportedBy" as const,
                from: {
                    kind: "section" as const,
                    viewId: input.definition.viewId,
                    sectionId: section.id,
                },
                to: {
                    kind: "source" as const,
                    sourceId: citation.sourceId,
                    revisionId: citation.revisionId,
                },
                citations: [citation],
            })),
        ),
        outcome: early ? "diagnosticOnly" : "verifiedRecovery",
        missingEvidence: early
            ? ["Cause and verified recovery are unknown"]
            : [],
    };
}

function controlledSupport(output: ViewSynthesisOutput): ViewSupportReport {
    return {
        supported: true,
        missingContext: [],
        reasons: [],
        sections: output.content.sections.map((section) => ({
            sectionId: section.id,
            supported: true,
            reason: "Controlled offline fixture assessment",
        })),
        relationships: output.relationships.map((edge) => ({
            edgeId: edge.id,
            supported: true,
            reason: "Controlled offline fixture assessment",
        })),
    };
}

test("complete real synthetic sources: early, eight-document closure, then two exact replacements", async () => {
    const root = await mkdtemp(
        path.join(os.tmpdir(), "memory-distillation-checkpoints-"),
    );
    let checkpoint: "early" | "full" | "followup" = "early";
    const observed: ViewBuildSnapshot[] = [];
    const service = new FileMemoryService(root, {
        viewDrafts: true,
        indexFactory: (_id, directory) =>
            new FakeProcedureCorpusIndex(directory),
        viewSynthesisAdapter: {
            identity: "offline-checkpoint-model",
            generate: async (input) => {
                observed.push(input);
                return controlledGuide(input, checkpoint);
            },
            validate: async (_input, output) => controlledSupport(output),
        },
    });
    try {
        const corpus = await service.createCorpus(
            "Synthetic October distillation",
        );
        const sources = new Map<
            string,
            { sourceId: string; revisionId: string }
        >();
        async function ingest(
            file: string,
            phase: "baseline" | "followup",
        ): Promise<void> {
            const markdown = await readFile(
                path.join(fixtures, phase, file),
                "utf8",
            );
            const sourceId = /^source_id: "([^"]+)"/m.exec(markdown)?.[1];
            const capturedAt = /^available_at: "([^"]+)"/m.exec(markdown)?.[1];
            if (!sourceId || !capturedAt)
                throw new Error("Synthetic source metadata missing");
            const previous = sources.get(sourceId);
            const result = await service.ingestDocument({
                corpusId: corpus.corpusId,
                source: {
                    sourceId,
                    sourceType: "markdown",
                    title: file,
                    markdown,
                    capturedAt,
                },
                ...(previous
                    ? {
                          pipeline: {
                              updatePolicy: "retainRevisionHistory",
                              expectedActiveRevisionId: previous.revisionId,
                          },
                      }
                    : {}),
            });
            expect((await waitForMemoryJob(service, result.jobId)).state).toBe(
                "complete",
            );
            sources.set(sourceId, { sourceId, revisionId: result.revisionId });
        }
        async function build(): Promise<ViewBuildJob> {
            const current = await service.listViews(corpus.corpusId);
            let job = await service.buildViews({
                corpusId: corpus.corpusId,
                publication: false,
                expectedHead: current.head,
                bounds: {
                    learnedBefore:
                        checkpoint === "early"
                            ? "2026-10-05T12:00:00Z"
                            : checkpoint === "full"
                              ? "2026-10-06T11:00:00Z"
                              : "2026-10-07T10:00:00Z",
                },
                targets: [
                    {
                        expectedVersion: current.views[0]?.version ?? 0,
                        definition: {
                            viewId: "checkout-guide",
                            kind: "troubleshootingGuide",
                            selector: {
                                kind: "sources",
                                sources: [...sources.values()],
                            },
                        },
                    },
                ],
            });
            for (
                let tries = 0;
                job.state === "running" && tries < 1000;
                tries++
            ) {
                await new Promise<void>((resolve) => setTimeout(resolve, 10));
                job = (await service.getViewBuild(job))!;
            }
            expect(job.state).toBe("complete");
            return job;
        }
        for (const file of earlyFiles) await ingest(file, "baseline");
        const early = await build();
        expect(early.results[0].missingEvidence).toContain(
            "Cause and verified recovery are unknown",
        );
        expect(observed[0].inputs).toHaveLength(5);
        const earlyPrompt = JSON.stringify(observed[0]);
        expect(earlyPrompt).not.toContain("S04-dream-config-discovered");
        expect(earlyPrompt).not.toContain("S04-dream-recovery-recorded");
        checkpoint = "full";
        for (const file of lateFiles) await ingest(file, "baseline");
        const full = await build();
        expect(observed[1].inputs).toHaveLength(8);
        expect(full.results[0].snapshot.fingerprint).not.toBe(
            early.results[0].snapshot.fingerprint,
        );
        const fullView = (await service.listViews(corpus.corpusId)).views[0];
        const fullBody = fullView.content.sections
            .map((section) => section.body)
            .join("\n");
        for (const required of [
            "1850",
            "140",
            "460",
            "0.2 percent",
            "simulated",
            "not project completion",
            "rejected",
            "deferred, not attempted",
        ])
            expect(fullBody).toContain(required);
        const sessions = new Set(
            fullView.relationships
                .flatMap((edge) =>
                    edge.origin === "system" || edge.to.kind !== "source"
                        ? []
                        : [edge.to.sourceId],
                )
                .filter((id) => id.startsWith("dream-session-")),
        );
        expect(sessions.size).toBe(4);
        checkpoint = "followup";
        const oldRevision = sources.get("dream-session-04")!.revisionId;
        await ingest("session-04.md", "followup");
        await ingest("status-review.md", "followup");
        expect(sources.size).toBe(8);
        expect(sources.get("dream-session-04")!.revisionId).not.toBe(
            oldRevision,
        );
        await build();
        const final = (await service.listViews(corpus.corpusId)).views[0];
        expect(
            final.content.sections.find((section) => section.id === "reuse")!
                .body,
        ).toContain("earlier recovery remains valid");
        expect(
            final.content.sections.find((section) => section.id === "reuse")!
                .body,
        ).toContain("blocked pending");
        expect(
            final.generation?.input?.inputs.find(
                (input) => input.sourceId === "dream-session-04",
            )!.revisionId,
        ).toBe(sources.get("dream-session-04")!.revisionId);
        for (const input of observed) {
            expect(JSON.stringify(input)).not.toMatch(
                /authoring-cases|expectations\.json/,
            );
        }
    } finally {
        await service.close();
        await rm(root, { recursive: true, force: true });
    }
});
