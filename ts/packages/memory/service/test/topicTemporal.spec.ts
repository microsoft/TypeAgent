// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { indexedTopicOccurrence } from "../src/topicIncidence.js";
import {
    initialTopicNodes,
    queryTopicSnapshot,
    validateTopicSnapshot,
} from "../src/topicSnapshot.js";
import type { TopicSnapshot } from "../src/topicTypes.js";
import { createConfiguredTopicGenerator } from "../src/topicGeneration.js";
import type { ViewBuildSnapshot } from "../src/viewTypes.js";
import type { ChatModel } from "@typeagent/aiclient";

test("complete indexed topic evidence includes distant tails without splitting surrogate pairs", () => {
    const text = `${"x".repeat(1999)}\u{1F680}${"z".repeat(10001)}governing exception`;
    const occurrence = indexedTopicOccurrence(
        {
            sourceId: "source",
            revisionId: "r1",
            blockOrdinal: 0,
            text,
            score: 1,
        },
        "command versus lease",
        0,
    );
    expect(
        occurrence.citations.map((citation) => citation.excerpt).join(""),
    ).toBe(text);
    expect(
        occurrence.citations.every(
            (citation) => citation.excerpt.length <= 2000,
        ),
    ).toBe(true);
    expect(
        occurrence.citations.every(
            (citation) =>
                !/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/.test(citation.excerpt),
        ),
    ).toBe(true);
});

const fixtureRoot = process.env.TYPEAGENT_TOPIC_FIXTURES;
if (fixtureRoot) {
    test("actual P0 distant governing tail reaches configured topic orchestration as original evidence", async () => {
        const model: ChatModel = {
            completionSettings: {},
            complete: async (messages) => {
                const content = Array.isArray(messages)
                    ? messages[messages.length - 1].content
                    : messages;
                if (typeof content !== "string")
                    throw new Error("Unexpected offline topic prompt");
                const raw: unknown = JSON.parse(content);
                if (Array.isArray(raw))
                    return {
                        success: true as const,
                        data: JSON.stringify({ parents: [], related: [] }),
                    };
                if (
                    !raw ||
                    typeof raw !== "object" ||
                    !("evidence" in raw) ||
                    !Array.isArray(raw.evidence)
                )
                    throw new Error(
                        "Offline topic summary lacks original evidence",
                    );
                const evidence: unknown[] = raw.evidence;
                const citation = evidence.find(
                    (entry) =>
                        !!entry &&
                        typeof entry === "object" &&
                        "excerpt" in entry &&
                        typeof entry.excerpt === "string" &&
                        entry.excerpt.includes("Governing tail exception:"),
                );
                if (
                    !citation ||
                    typeof citation !== "object" ||
                    !("excerpt" in citation) ||
                    typeof citation.excerpt !== "string" ||
                    !("id" in citation) ||
                    typeof citation.id !== "number"
                )
                    throw new Error(
                        "Actual governing tail was omitted from topic generation evidence",
                    );
                const start = citation.excerpt.indexOf(
                    "Governing tail exception:",
                );
                return {
                    success: true as const,
                    data: JSON.stringify({
                        summary: citation.excerpt.slice(start, start + 822),
                        evidenceIds: [citation.id],
                    }),
                };
            },
        };
        for (const [index, stage] of ["initial", "t1", "t2"].entries()) {
            const content = await readFile(
                path.join(
                    fixtureRoot,
                    "memory-import-second-brain-maintenance",
                    "content-only",
                    stage,
                    "document-020.md",
                ),
                "utf8",
            );
            const revisionId = `r${index + 1}`;
            const occurrence = indexedTopicOccurrence(
                {
                    sourceId: "worksheet",
                    revisionId,
                    blockOrdinal: 0,
                    text: content,
                    score: 1,
                },
                "command lifetime versus lease",
                0,
            );
            const captured: ViewBuildSnapshot = {
                corpusId: "fixture",
                actor: "local-owner",
                definition: {
                    kind: "wiki",
                    viewId: "topic-snapshot",
                    selector: { kind: "sources", sources: [] },
                },
                expectedVersion: 0,
                bounds: {},
                inputs: [],
                influenceSources: [{ sourceId: "worksheet", revisionId }],
                pipeline: "topics-v1",
                model: "offline-original-evidence",
                fingerprint: `input${index}`,
                topicInput: { occurrences: [occurrence] },
            };
            const generated = await createConfiguredTopicGenerator(
                undefined,
                model,
            )(captured, new AbortController().signal);
            expect(generated.nodes[0].summaryState).toBe("ready");
            expect(generated.nodes[0].summary).toContain(
                "Governing tail exception:",
            );
            expect(
                generated.nodes[0].citations.every(
                    (citation) => citation.revisionId === revisionId,
                ),
            ).toBe(true);
            expect(
                generated.occurrences[0].citations
                    .map((citation) => citation.excerpt)
                    .join(""),
            ).toBe(content);
        }
    });
    test("actual P0 worksheet initial/T1/T2 rebuilds preserve all original evidence and replace incidence", async () => {
        let prior: TopicSnapshot | undefined;
        const receipts = [];
        for (const [index, stage] of ["initial", "t1", "t2"].entries()) {
            const text = await readFile(
                path.join(
                    fixtureRoot,
                    "memory-import-second-brain-maintenance",
                    "content-only",
                    stage,
                    "document-020.md",
                ),
                "utf8",
            );
            expect(text.length).toBeGreaterThan(24000);
            const occurrence = indexedTopicOccurrence(
                {
                    sourceId: "worksheet",
                    revisionId: `r${index + 1}`,
                    blockOrdinal: 0,
                    text,
                    score: 1,
                },
                "command versus held lease",
                0,
            );
            const snapshot: TopicSnapshot = {
                schemaVersion: 1,
                corpusId: "fixture",
                generation: `generation${index}`,
                inputFingerprint: `input${index}`,
                recipe: "offline-P0",
                generatedAt: new Date().toISOString(),
                occurrences: [occurrence],
                influenceSources: [
                    { sourceId: "worksheet", revisionId: `r${index + 1}` },
                ],
                nodes: initialTopicNodes("fixture", [occurrence]),
                parents: [],
                related: [],
                limits: [
                    "Deterministic offline extractor; not model qualification.",
                ],
            };
            validateTopicSnapshot(snapshot);
            expect(
                snapshot.occurrences[0].citations
                    .map((citation) => citation.excerpt)
                    .join(""),
            ).toBe(text);
            expect(snapshot.occurrences[0].citations.length).toBeGreaterThan(
                12,
            );
            if (prior) {
                expect(snapshot.nodes[0].id).toBe(prior.nodes[0].id);
                expect(snapshot.occurrences[0].id).not.toBe(
                    prior.occurrences[0].id,
                );
                expect(
                    snapshot.occurrences.some(
                        (entry) => entry.revisionId === `r${index}`,
                    ),
                ).toBe(false);
            }
            const page = queryTopicSnapshot(snapshot, {
                corpusId: "fixture",
                pageSize: 1,
            });
            expect(page.nodes[0].omittedCitations).toBeGreaterThan(0);
            expect(
                snapshot.occurrences[0].citations
                    .map((citation) => citation.excerpt)
                    .join(""),
            ).toBe(text);
            receipts.push({
                stage,
                sourceUtf16: text.length,
                citations: occurrence.citations.length,
                snapshotBytes: Buffer.byteLength(JSON.stringify(snapshot)),
                responseBytes: Buffer.byteLength(JSON.stringify(page)),
            });
            prior = snapshot;
        }
        process.stdout.write(
            `P4 actual P0 incidence receipts ${JSON.stringify(receipts)}\n`,
        );
    });
}
