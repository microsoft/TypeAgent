// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ingestRequestSchema,
    revisionSchema,
    searchRequestSchema,
    procedureSaveRequestSchema,
    procedureDocumentSchema,
    runbookBindingArgumentsSchema,
    runbookSynthesisRequestSchema,
    runbookJobResultSchema,
} from "@typeagent/memory-client";
import type { ProcedureDocument } from "@typeagent/memory-service";

const source = {
    sourceType: "markdown",
    title: "Service X recovery",
    markdown: "# Recovery\nInspect database connection limits.",
};

const revision = {
    revisionId: "revision-1",
    sourceId: "source-1",
    contentHash: "fixture",
    mimeType: "text/markdown",
    pipelineVersion: "1",
    state: "ready",
};

const agentDocument: ProcedureDocument = {
    title: "Recovery",
    steps: ["Inspect connections."],
    citations: [{ sourceId: "guide", revisionId: "rev-1" }],
    additionalSections: [{ heading: "Owner notes", content: "Human edit" }],
    agentEdition: {
        schemaVersion: 1,
        goal: "Recover service",
        applicability: ["Connection errors"],
        inputs: [],
        preconditions: ["Read access"],
        steps: [
            {
                id: "inspect",
                title: "Inspect",
                humanText: "Inspect connections.",
                agentInstruction: "Ask the human for the count.",
                safety: "readOnly",
                citations: [{ sourceId: "guide", revisionId: "rev-1" }],
                binding: {
                    kind: "manual",
                    accepted: true,
                    reason: "Human observation",
                },
                assets: [
                    {
                        sourceId: "guide",
                        revisionId: "rev-1",
                        assetId: "figure-1",
                    },
                ],
            },
        ],
        verification: ["Confirm count"],
        rollback: [],
        synthesis: {
            sourceReferences: [{ sourceId: "guide", revisionId: "rev-1" }],
        },
        review: { state: "draft" },
    },
};

describe("canonical memory processing protocol", () => {
    test("requires an exact synthesis revision and preserves durable job outcomes rather than inventing candidates", () => {
        const request = {
            corpusId: "ops",
            sourceId: "guide",
            revisionId: "rev-1",
        };
        expect(runbookSynthesisRequestSchema.parse(request)).toEqual(request);
        expect(
            runbookSynthesisRequestSchema.safeParse({
                corpusId: "ops",
                sourceId: "guide",
            }).success,
        ).toBe(false);
        expect(
            runbookSynthesisRequestSchema.safeParse({
                ...request,
                execute: true,
            }).success,
        ).toBe(false);
        const job = {
            ...request,
            jobId: "job-1",
            state: "failed",
            createdAt: "2026-10-02",
            updatedAt: "2026-10-02",
            reason: "Model unavailable",
            candidateIds: [],
            warnings: [],
        };
        expect(runbookJobResultSchema.parse(job)).toEqual(job);
    });

    test("preserves revision-owned asset metadata but rejects raw uploads without a wire contract", () => {
        const asset = {
            sourceId: "source-1",
            revisionId: "revision-1",
            assetId: "figure-1",
            mimeType: "image/png",
            name: "Panel",
            size: 12,
            hash: "sha256",
            description: "Restart panel",
            instructionBearing: true,
        };
        expect(
            revisionSchema.parse({ ...revision, assets: [asset] }).assets,
        ).toEqual([asset]);
        expect(
            ingestRequestSchema.safeParse({
                corpusId: "ops",
                source: {
                    ...source,
                    assets: [
                        {
                            name: "Panel",
                            mimeType: "image/png",
                            bytes: [137, 80],
                        },
                    ],
                },
            }).success,
        ).toBe(false);
    });

    test("round-trips edition fields and explicit review intent through public MCP schemas", () => {
        const request = {
            corpusId: "ops",
            procedureId: "recovery",
            expectedVersion: 1,
            document: agentDocument,
            reviewAgentEdition: true,
            safetyConfirmed: true,
        };
        expect(procedureSaveRequestSchema.parse(request)).toEqual(request);
        const old = { ...agentDocument };
        delete old.agentEdition;
        expect(procedureDocumentSchema.parse(old)).toEqual(old);
    });

    test("uses shared edition validation for unsafe references, duplicate steps and secret literals", () => {
        const unsafe = structuredClone(agentDocument);
        Object.assign(unsafe.agentEdition!.steps[0].assets![0], {
            bytes: "not-allowed",
        });
        expect(procedureDocumentSchema.safeParse(unsafe).success).toBe(false);
        const duplicate = structuredClone(agentDocument);
        duplicate.agentEdition!.steps.push(
            structuredClone(duplicate.agentEdition!.steps[0]),
        );
        expect(procedureDocumentSchema.safeParse(duplicate).success).toBe(
            false,
        );
        const secret = structuredClone(agentDocument);
        secret.agentEdition!.inputs.push({
            id: "password",
            description: "Credential",
            type: "string",
            required: true,
            secret: true,
            examples: ["literal"],
        });
        expect(procedureDocumentSchema.safeParse(secret).success).toBe(false);
    });

    test("preserves arguments and section extensions while rejecting unknown symbolic inputs and unsafe JSON", () => {
        const doc = structuredClone(agentDocument);
        doc.agentEdition!.inputs.push({
            id: "namespace",
            description: "Namespace",
            type: "string",
            required: true,
            secret: false,
        });
        doc.agentEdition!.steps[0].binding = {
            kind: "mcp",
            accepted: true,
            serverId: "metrics",
            targetId: "query",
            version: "v1",
            fingerprint: "schema-1",
            arguments: {
                namespace: { $input: "namespace" },
                query: "up",
                nested: [{ $literal: { $input: "literal" } }],
            },
        };
        Object.assign(doc.additionalSections![0], {
            custom: { owner: "Human metadata" },
        });
        expect(procedureDocumentSchema.parse(doc)).toEqual(doc);
        doc.agentEdition!.inputs = [];
        expect(procedureDocumentSchema.safeParse(doc).success).toBe(false);
        expect(
            runbookBindingArgumentsSchema.safeParse(
                JSON.parse('{"__proto__":true}'),
            ).success,
        ).toBe(false);
        expect(
            runbookBindingArgumentsSchema.safeParse({
                value: "x".repeat(65_537),
            }).success,
        ).toBe(false);
    });
    test("preserves ISO capture-date search predicates and rejects invalid dates", () => {
        const request = {
            corpusId: "corpus-1",
            query: "target",
            dateFrom: "2026-01-01T00:00:00.000Z",
            dateTo: "2026-12-31T23:59:59+00:00",
        };
        expect(searchRequestSchema.parse(request)).toEqual(request);
        expect(
            searchRequestSchema.safeParse({
                ...request,
                dateFrom: "2026-01-01",
            }).success,
        ).toBe(false);
        expect(
            searchRequestSchema.safeParse({
                ...request,
                dateTo: "2026-02-30T00:00:00Z",
            }).success,
        ).toBe(false);
    });

    test("accepts the content pipeline, optional mode, and advanced chunk sizing", () => {
        expect(
            ingestRequestSchema.parse({ corpusId: "corpus-1", source }),
        ).toEqual({ corpusId: "corpus-1", source });
        expect(
            ingestRequestSchema.parse({
                corpusId: "corpus-1",
                source,
                pipeline: { maxCharsPerChunk: 8_000 },
            }).pipeline,
        ).toEqual({ maxCharsPerChunk: 8_000 });
        expect(
            ingestRequestSchema.parse({
                corpusId: "corpus-1",
                source,
                pipeline: { mode: "content", maxCharsPerChunk: 8_000 },
            }).pipeline,
        ).toEqual({ mode: "content", maxCharsPerChunk: 8_000 });
        expect(
            revisionSchema.parse({
                ...revision,
                pipeline: { mode: "content", maxCharsPerChunk: 8_000 },
            }).pipeline,
        ).toEqual({ mode: "content", maxCharsPerChunk: 8_000 });
    });

    test.each(["basic", "summary", "full"])(
        "rejects the removed %s mode rather than mapping it to another pipeline",
        (mode) => {
            expect(
                ingestRequestSchema.safeParse({
                    corpusId: "corpus-1",
                    source,
                    pipeline: { mode },
                }).success,
            ).toBe(false);
            expect(
                revisionSchema.safeParse({
                    ...revision,
                    pipeline: { mode },
                }).success,
            ).toBe(false);
        },
    );
});
