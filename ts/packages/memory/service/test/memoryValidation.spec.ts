// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { FileMemoryService, type IngestionJobStatus } from "../src/index.js";

const fixtureDirectory = path.resolve("test", "data", "memory-validation");

const fixtureDefinitions = [
    {
        fileName: "smoke-alpha.md",
        title: "Aurora-7 telemetry incident report AR-204",
        canonicalUri: "https://memory.test/incidents/AR-204",
        tags: ["incident", "aurora-7", "atlas"],
        metadata: { recordType: "incident", ticket: "ENG-4821" },
        capturedAt: "2026-09-14T02:25:00.000Z",
        sourceModifiedAt: "2026-09-14T04:10:00.000Z",
    },
    {
        fileName: "smoke-beta.md",
        title: "Meridian shift handoff MH-88",
        canonicalUri: "https://memory.test/handoffs/MH-88",
        tags: ["handoff", "aurora-7", "meridian"],
        metadata: { recordType: "handoff", relatedIncident: "AR-204" },
        capturedAt: "2026-09-14T21:40:00.000Z",
        sourceModifiedAt: "2026-09-14T22:05:00.000Z",
    },
    {
        fileName: "numbered-positive.md",
        title: "Aurora-7 field calibration runbook",
        canonicalUri: "https://memory.test/runbooks/OPS-A7-12",
        tags: ["runbook", "aurora-7", "approved"],
        metadata: { recordType: "runbook", runbookId: "OPS-A7-12" },
        capturedAt: "2026-09-15T09:00:00.000Z",
        sourceModifiedAt: "2026-09-15T09:00:00.000Z",
    },
    {
        fileName: "checklist-positive.md",
        title: "Relay R-17 firmware release record",
        canonicalUri: "https://memory.test/changes/ENG-4821",
        tags: ["checklist", "relay-r17", "release"],
        metadata: { recordType: "change", ticket: "ENG-4821" },
        capturedAt: "2026-09-16T16:30:00.000Z",
        sourceModifiedAt: "2026-09-16T16:30:00.000Z",
    },
    {
        fileName: "bullets-negative.md",
        title: "Aurora-7 diagnostic field notes",
        canonicalUri: "https://memory.test/notes/AR-204-diagnostics",
        tags: ["reference", "aurora-7", "diagnostics"],
        metadata: { recordType: "field-notes", relatedIncident: "AR-204" },
        capturedAt: "2026-09-14T03:00:00.000Z",
        sourceModifiedAt: "2026-09-14T03:00:00.000Z",
    },
    {
        fileName: "single-step-negative.md",
        title: "Shift acknowledgement policy",
        canonicalUri: "https://memory.test/policies/shift-acknowledgement",
        tags: ["policy", "aurora-7"],
        metadata: { recordType: "policy" },
        capturedAt: "2026-09-15T12:00:00.000Z",
        sourceModifiedAt: "2026-09-15T12:00:00.000Z",
    },
] as const;

const terminalJobStates = new Set([
    "complete",
    "partial",
    "failed",
    "cancelled",
]);

async function waitForTerminalJob(
    service: FileMemoryService,
    jobId: string,
): Promise<IngestionJobStatus> {
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
        const job = await service.getJob(jobId);
        if (job !== undefined && terminalJobStates.has(job.state)) {
            return job;
        }
        await new Promise<void>((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(`Memory validation job '${jobId}' did not finish`);
}

async function ingestFixture(
    service: FileMemoryService,
    corpusId: string,
    fileName: string,
): Promise<IngestionJobStatus> {
    const fixture = fixtureDefinitions.find(
        (definition) => definition.fileName === fileName,
    );
    if (fixture === undefined) {
        throw new Error(`Unknown memory validation fixture '${fileName}'`);
    }
    const markdown = await readFile(
        path.join(fixtureDirectory, fileName),
        "utf8",
    );
    const accepted = await service.ingestDocument({
        corpusId,
        source: {
            sourceId: fileName.replace(/\.md$/, ""),
            sourceType: "markdown",
            title: fixture.title,
            canonicalUri: fixture.canonicalUri,
            tags: [...fixture.tags],
            metadata: fixture.metadata,
            capturedAt: fixture.capturedAt,
            sourceModifiedAt: fixture.sourceModifiedAt,
            markdown,
        },
        pipeline: {
            mode: "basic",
            updatePolicy: "skipIfUnchanged",
            maxCharsPerChunk: 8_000,
        },
    });
    return waitForTerminalJob(service, accepted.jobId);
}

describe("memory validation acceptance", () => {
    test("composes durable retrieval, management, procedures, and restart", async () => {
        const rootDirectory = await mkdtemp(
            path.join(os.tmpdir(), "typeagent-memory-validation-"),
        );
        let service = new FileMemoryService(rootDirectory);
        try {
            const corpus = await service.createCorpus(
                "Deterministic memory validation",
            );
            const fixtureNames = fixtureDefinitions.map(
                (fixture) => fixture.fileName,
            );
            for (const fixtureName of fixtureNames) {
                const job = await ingestFixture(
                    service,
                    corpus.corpusId,
                    fixtureName,
                );
                if (job.state !== "complete") {
                    throw new Error(
                        `${fixtureName} ingestion ${job.state}: ${job.error ?? "no error"}; warnings=${job.warnings.join(" | ")}`,
                    );
                }
            }

            const alphaSearch = await service.search({
                corpusId: corpus.corpusId,
                query: "Aurora-7 telemetry dropout cobalt-orchid-731",
                limit: 4,
            });
            expect(alphaSearch.matches[0]).toMatchObject({
                sourceId: "smoke-alpha",
                title: "Aurora-7 telemetry incident report AR-204",
                canonicalUri: "https://memory.test/incidents/AR-204",
                sourceType: "markdown",
                capturedAt: "2026-09-14T02:25:00.000Z",
                score: 1,
            });
            expect(alphaSearch.matches[0].snippet).toContain(
                "cobalt-orchid-731",
            );
            expect(alphaSearch.matches.map((match) => match.sourceId)).toEqual(
                expect.arrayContaining(["smoke-alpha", "smoke-beta"]),
            );
            expect(alphaSearch.capabilitiesUsed).toContain("structured-search");
            const incidentOnly = await service.search({
                corpusId: corpus.corpusId,
                query: "Aurora-7 ENG-4821",
                tags: ["incident"],
            });
            expect(incidentOnly.matches).toEqual([
                expect.objectContaining({ sourceId: "smoke-alpha" }),
            ]);
            const alphaSource = await service.getSource(
                corpus.corpusId,
                "smoke-alpha",
            );
            expect(alphaSource).toMatchObject({
                title: "Aurora-7 telemetry incident report AR-204",
                canonicalUri: "https://memory.test/incidents/AR-204",
                tags: ["incident", "aurora-7", "atlas"],
                metadata: { recordType: "incident", ticket: "ENG-4821" },
            });
            const alphaContent = await service.getSourceContent({
                corpusId: corpus.corpusId,
                sourceId: "smoke-alpha",
                revisionId: alphaSource!.activeRevisionId,
                maxChars: 240,
            });
            expect(alphaContent).toMatchObject({
                offset: 0,
                truncated: true,
                nextOffset: 240,
            });
            const alphaContentRemainder = await service.getSourceContent({
                corpusId: corpus.corpusId,
                sourceId: "smoke-alpha",
                revisionId: alphaSource!.activeRevisionId,
                offset: alphaContent.nextOffset!,
                maxChars: 2_000,
            });
            expect(alphaContentRemainder.content).toContain(
                "cobalt-orchid-731",
            );

            const answer = await service.answer({
                corpusId: corpus.corpusId,
                question: "Aurora-7 telemetry dropout Valparaiso",
                sourceIds: ["smoke-beta"],
            });
            expect(answer).toMatchObject({
                grounded: true,
                citations: [
                    expect.objectContaining({
                        sourceId: "smoke-beta",
                        title: "Meridian shift handoff MH-88",
                    }),
                ],
            });
            expect(answer.answer).toContain("Meridian");

            const candidates = await service.listProcedureCandidates(
                corpus.corpusId,
            );
            expect(candidates).toHaveLength(2);
            expect(candidates).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        title: "How to calibrate the Aurora-7 validation sensor",
                        steps: expect.arrayContaining([
                            "Confirm that relay R-17 is unlatched and record the gateway sequence number.",
                            "Attach the cobalt reference cell and wait for three stable samples.",
                            "Record the final calibration reading and both bus sequence numbers in the maintenance record.",
                        ]),
                    }),
                    expect.objectContaining({
                        title: "Pre-deployment verification checklist",
                        steps: expect.arrayContaining([
                            "Run the focused memory service tests against an isolated data root.",
                            "Verify that the Aurora-7 runbook cites the active AR-204 source revision.",
                            "Record the validation commit and test transcript in ENG-4821.",
                        ]),
                    }),
                ]),
            );

            const sourceCountBeforeReplay = (
                await service.listSources(corpus.corpusId)
            ).length;
            expect(
                (
                    await ingestFixture(
                        service,
                        corpus.corpusId,
                        "numbered-positive.md",
                    )
                ).state,
            ).toBe("complete");
            expect(
                await service.listProcedureCandidates(corpus.corpusId),
            ).toEqual(candidates);
            expect((await service.listSources(corpus.corpusId)).length).toBe(
                sourceCountBeforeReplay,
            );

            const numberedCandidate = candidates.find(
                (candidate) =>
                    candidate.title ===
                    "How to calibrate the Aurora-7 validation sensor",
            );
            expect(numberedCandidate).toBeDefined();
            const saved = await service.saveProcedure({
                corpusId: corpus.corpusId,
                procedureId: "calibrate-validation-sensor",
                candidateId: numberedCandidate!.candidateId,
                expectedVersion: 0,
            });
            expect(saved).toMatchObject({ version: 1, state: "saved" });
            expect(
                await service.searchProcedures({
                    corpusId: corpus.corpusId,
                    query: "cobalt reference cell",
                }),
            ).toEqual([
                expect.objectContaining({
                    procedure: expect.objectContaining({
                        procedureId: "calibrate-validation-sensor",
                    }),
                }),
            ]);

            const settings = await service.updatePersonalHowToSettings(
                corpus.corpusId,
                { expectedRevision: 0, detectCandidates: false },
            );
            await expect(
                service.updatePersonalHowToSettings(corpus.corpusId, {
                    expectedRevision: 0,
                    detectCandidates: true,
                }),
            ).rejects.toThrow("settings revision conflict");

            const originalAlphaRevision = alphaSource!.activeRevisionId;
            const replacement = await service.replaceSource({
                corpusId: corpus.corpusId,
                sourceId: "smoke-alpha",
                expectedActiveRevisionId: originalAlphaRevision,
                source: {
                    sourceType: "markdown",
                    title: "smoke-alpha.md",
                    markdown:
                        "# Atlas replacement\n\nThe replacement phrase is indigo-summit-946.",
                },
            });
            const replacementJob = await waitForTerminalJob(
                service,
                replacement.jobId,
            );
            if (replacementJob.state !== "complete") {
                throw new Error(
                    `replacement ${replacementJob.state}: ${replacementJob.error ?? "no error"}; warnings=${replacementJob.warnings.join(" | ")}; trace=${JSON.stringify(replacementJob.trace)}`,
                );
            }
            expect(
                (
                    await service.search({
                        corpusId: corpus.corpusId,
                        query: "indigo-summit-946",
                    })
                ).matches,
            ).toEqual([expect.objectContaining({ sourceId: "smoke-alpha" })]);
            expect(
                (
                    await service.search({
                        corpusId: corpus.corpusId,
                        query: "cobalt-orchid-731",
                    })
                ).matches,
            ).toEqual([]);

            const staleReplacement = await service.replaceSource({
                corpusId: corpus.corpusId,
                sourceId: "smoke-alpha",
                expectedActiveRevisionId: originalAlphaRevision,
                source: {
                    sourceType: "markdown",
                    title: "stale.md",
                    markdown: "This stale replacement must not publish.",
                },
            });
            expect(
                (await waitForTerminalJob(service, staleReplacement.jobId))
                    .state,
            ).toBe("failed");

            const procedureAfterSourceChange = await service.getProcedure(
                corpus.corpusId,
                "calibrate-validation-sensor",
            );
            expect(procedureAfterSourceChange).toMatchObject({
                version: 1,
                state: "saved",
            });

            const numberedSource = await service.getSource(
                corpus.corpusId,
                "numbered-positive",
            );
            const numberedReplacement = await service.replaceSource({
                corpusId: corpus.corpusId,
                sourceId: "numbered-positive",
                expectedActiveRevisionId: numberedSource!.activeRevisionId,
                source: {
                    sourceType: "markdown",
                    title: "numbered-positive.md",
                    markdown:
                        "# Revised sensor guide\n\nThe cited procedure source changed.",
                },
            });
            expect(
                (await waitForTerminalJob(service, numberedReplacement.jobId))
                    .state,
            ).toBe("complete");
            expect(
                await service.getProcedure(
                    corpus.corpusId,
                    "calibrate-validation-sensor",
                ),
            ).toMatchObject({ version: 2, state: "stale" });
            expect(
                await service.getProcedure(
                    corpus.corpusId,
                    "calibrate-validation-sensor",
                    1,
                ),
            ).toMatchObject({ version: 1, state: "saved" });

            const archived = await service.archiveProcedure(
                corpus.corpusId,
                "calibrate-validation-sensor",
                2,
            );
            expect(archived).toMatchObject({
                version: 3,
                previousVersion: 2,
                state: "archived",
            });

            const betaPreview = await service.previewForgetSource(
                corpus.corpusId,
                "smoke-beta",
            );
            await expect(
                service.forgetSource({
                    corpusId: corpus.corpusId,
                    sourceId: "smoke-beta",
                    confirmationToken: "invalid-token",
                }),
            ).rejects.toThrow("confirmation");
            await service.forgetSource({
                corpusId: corpus.corpusId,
                sourceId: "smoke-beta",
                confirmationToken: betaPreview.confirmationToken,
            });
            expect(
                await service.getSource(corpus.corpusId, "smoke-beta"),
            ).toBeUndefined();
            expect(
                (
                    await service.search({
                        corpusId: corpus.corpusId,
                        query: "quartz-harbor-284",
                    })
                ).matches,
            ).toEqual([]);

            const reindexed = await service.reindexCorpus(corpus.corpusId);
            expect(reindexed.sourceCount).toBe(fixtureNames.length - 1);

            await service.close();
            service = new FileMemoryService(rootDirectory);

            expect(
                await service.getPersonalHowToSettings(corpus.corpusId),
            ).toEqual(settings);
            expect(
                (
                    await service.search({
                        corpusId: corpus.corpusId,
                        query: "indigo-summit-946",
                    })
                ).matches,
            ).toEqual([expect.objectContaining({ sourceId: "smoke-alpha" })]);
            expect(
                await service.getProcedure(
                    corpus.corpusId,
                    "calibrate-validation-sensor",
                ),
            ).toMatchObject({ version: 3, state: "archived" });
            expect(
                await service.listProcedureCandidates(corpus.corpusId),
            ).toHaveLength(2);
        } finally {
            await service.close();
            await rm(rootDirectory, { recursive: true, force: true });
        }
    }, 60_000);
});
