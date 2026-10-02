// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import {
    agentEditionContentHash,
    canonicalizeProcedure,
    getProcedureEvidenceReferences,
    normalizeAgentEditionDocument,
    prepareAgentEditionSave,
    validateAgentEdition,
    validateReviewedAgentEdition,
    validateRunbookCatalogBindings,
    validateRunbookBinding,
    type AgentEdition,
    type RunbookBindingValidator,
} from "../src/agentEdition.js";
import {
    PersonalHowToStore,
    procedureFromMarkdown,
    procedureToMarkdown,
} from "../src/personalHowToStore.js";
import {
    redactRunbookText,
    redactRunbookValue,
} from "../src/runbookRedaction.js";
import type { ProcedureDocument, ProcedureVersion } from "../src/types.js";

const citation = {
    sourceId: "guide",
    revisionId: "rev-1",
    locator: "lines 4-5",
    excerpt: "Inspect the panel.",
};

function edition(): AgentEdition {
    return {
        schemaVersion: 1,
        goal: "Diagnose restarts",
        applicability: ["Worker restarts"],
        inputs: [
            {
                id: "namespace",
                description: "Namespace",
                type: "string",
                required: true,
                secret: false,
            },
        ],
        preconditions: ["On-call access"],
        steps: [
            {
                id: "inspect",
                title: "Inspect panel",
                humanText: "Inspect the panel.",
                agentInstruction: "Ask the user to inspect the panel.",
                binding: {
                    kind: "manual",
                    accepted: true,
                    reason: "Screenshot-only instruction",
                },
                safety: "readOnly",
                condition: "If the exit code is 137",
                citations: [citation],
                assets: [
                    {
                        sourceId: "guide",
                        revisionId: "rev-1",
                        assetId: "figure-1",
                        description: "Restart panel with a red marker",
                    },
                ],
                verification: "Confirm the counter",
                rollback: "No change to undo",
            },
        ],
        verification: ["Record the observed count"],
        rollback: ["No rollback required"],
        synthesis: {
            sourceReferences: [citation],
            linkedDocuments: [{ sourceId: "reference", revisionId: "rev-3" }],
            model: "fixture",
            promptVersion: "v1",
        },
        review: { state: "draft" },
    };
}

function document(): ProcedureDocument {
    return {
        title: "Investigate restarts",
        summary: "Keep the original guide.",
        steps: ["Inspect the panel."],
        citations: [citation],
        additionalSections: [
            { heading: "Owner notes", content: "Human edits stay here." },
        ],
        agentEdition: edition(),
    };
}

function version(doc: ProcedureDocument, number = 1): ProcedureVersion {
    return {
        corpusId: "ops",
        procedureId: "restart",
        version: number,
        state: "saved",
        document: doc,
        canonicalJson: canonicalizeProcedure(doc),
        markdown: procedureToMarkdown(doc),
        createdAt: "2026-10-02T00:00:00.000Z",
        jsonHash: "",
        markdownHash: "",
    };
}

describe("canonical agent editions", () => {
    it.each(["query", "_query", '["metrics","query"]'])(
        "round-trips opaque native MCP name %s without interpreting it as a tuple",
        (targetId) => {
            const binding = {
                kind: "mcp",
                accepted: true,
                serverId: "_metrics / local",
                targetId,
                version: "v1",
                fingerprint: "schema-1",
            };
            validateRunbookBinding(binding);
            const doc = document();
            doc.agentEdition!.steps[0].binding = binding;
            expect(procedureFromMarkdown(procedureToMarkdown(doc))).toEqual(
                doc,
            );
            expect(() =>
                validateRunbookBinding({
                    ...binding,
                    targetId: "query\n",
                }),
            ).toThrow("control characters");
            expect(() =>
                validateRunbookBinding({
                    ...binding,
                    targetId: "x".repeat(4097),
                }),
            ).toThrow("bounded text");
        },
    );

    it("round-trips old guides and unknown sections without adding an edition", () => {
        const old = document();
        delete old.agentEdition;
        old.additionalSections!.push({
            heading: "Agent Edition",
            content:
                '```json\n{"schemaVersion":1,"note":"Legacy owner notes, not an edition"}\n```',
        });
        expect(procedureFromMarkdown(procedureToMarkdown(old))).toEqual(old);
    });

    it("round-trips new human/agent content, stable IDs, alternatives and provenance", () => {
        const doc = document();
        doc.agentEdition!.steps.push({
            ...structuredClone(doc.agentEdition!.steps[0]),
            id: "confirm",
            title: "Confirm",
            humanText: "Confirm the panel.",
        });
        doc.agentEdition!.steps[0].alternatives = [
            { condition: "If not 137", stepId: "confirm" },
        ];
        expect(procedureFromMarkdown(procedureToMarkdown(doc))).toEqual(doc);
        expect(
            canonicalizeProcedure(
                procedureFromMarkdown(procedureToMarkdown(doc)),
            ),
        ).toBe(canonicalizeProcedure(doc));
        expect(agentEditionContentHash(doc)).toBe(
            agentEditionContentHash(
                procedureFromMarkdown(procedureToMarkdown(doc)),
            ),
        );
    });

    it("collects all immutable evidence dependencies without mutating edition references", () => {
        const doc = document();
        const references = getProcedureEvidenceReferences(doc);
        expect(references.citations).toEqual([
            citation,
            { sourceId: "reference", revisionId: "rev-3" },
        ]);
        expect(references.assets).toEqual(doc.agentEdition!.steps[0].assets);
        references.assets[0].description = "Changed clone";
        expect(doc.agentEdition!.steps[0].assets![0].description).toBe(
            "Restart panel with a red marker",
        );
    });

    it("preserves opaque JSON extensions during Markdown edits while honoring optional-section removal", () => {
        const previous: ProcedureDocument & { custom: { owner: string } } = {
            ...document(),
            custom: { owner: "Human metadata" },
        };
        const edited = { ...document(), title: "Edited title" };
        expect(
            procedureFromMarkdown(procedureToMarkdown(edited), previous),
        ).toEqual({
            ...edited,
            custom: { owner: "Human metadata" },
        });
        const minimal = { ...edited };
        delete minimal.summary;
        delete minimal.additionalSections;
        delete minimal.agentEdition;
        const parsed = procedureFromMarkdown(
            procedureToMarkdown(minimal),
            previous,
        );
        expect(parsed).toEqual({
            ...minimal,
            custom: { owner: "Human metadata" },
        });
        expect(previous).toHaveProperty("summary");
        expect(previous).toHaveProperty("agentEdition");
    });

    it("round-trips multiline copied human steps without interpreting embedded headings or list numbers", () => {
        const doc = document();
        doc.steps = [
            "Inspect the panel.\n\n## Original heading\n1. Copied instruction\n| table | value |",
        ];
        doc.agentEdition!.steps[0].humanText = doc.steps[0];
        expect(procedureFromMarkdown(procedureToMarkdown(doc))).toEqual(doc);
    });

    it("retains exact canonical JSON for an unchanged Markdown editor buffer", () => {
        const doc = {
            ...document(),
            title: "  Human title  ",
            steps: ["  Human step  "],
        };
        expect(procedureFromMarkdown(procedureToMarkdown(doc), doc)).toEqual(
            doc,
        );
    });

    it("keeps unknown section metadata and untouched section text during unrelated Markdown edits", () => {
        const previous = {
            ...document(),
            additionalSections: [
                {
                    heading: "  Owner notes  ",
                    content: "  Human edits stay here.  ",
                    legacy: { owner: "Section metadata" },
                },
            ],
        };
        const edited = { ...previous, title: "Edited title" };
        expect(
            procedureFromMarkdown(procedureToMarkdown(edited), previous),
        ).toEqual(edited);
    });

    it("requires explicit safety review and ignores incoming model review stamps", async () => {
        const doc = await prepareAgentEditionSave(
            document(),
            { reviewAgentEdition: true, safetyConfirmed: true },
            1,
        );
        expect(doc.agentEdition!.review.state).toBe("reviewed");
        const forged = await prepareAgentEditionSave(doc, {}, 2);
        expect(forged.agentEdition!.review.state).toBe("draft");
        await expect(
            prepareAgentEditionSave(
                document(),
                { reviewAgentEdition: true },
                1,
            ),
        ).rejects.toThrow("safety confirmation");
        validateReviewedAgentEdition(version(doc));
        expect(() => validateReviewedAgentEdition(version(doc, 2))).toThrow(
            "exact saved version",
        );
        const invalidIntent = JSON.parse(
            '{"reviewAgentEdition":"true","safetyConfirmed":true}',
        ) as { reviewAgentEdition: boolean; safetyConfirmed: boolean };
        await expect(
            prepareAgentEditionSave(document(), invalidIntent, 1),
        ).rejects.toThrow("must be boolean");
    });

    it("retains review only for unchanged trusted saved content and clears it on any edit", async () => {
        const doc = await prepareAgentEditionSave(
            document(),
            { reviewAgentEdition: true, safetyConfirmed: true },
            1,
        );
        const previous = version(doc);
        const unchanged = await prepareAgentEditionSave(doc, {}, 2, previous);
        expect(unchanged.agentEdition!.review).toMatchObject({
            state: "reviewed",
            procedureVersion: 2,
        });
        const edits = [
            { ...doc, title: "Edited title" },
            { ...doc, steps: ["Human edit"] },
            {
                ...doc,
                additionalSections: [
                    { heading: "Owner notes", content: "Edited notes" },
                ],
            },
            {
                ...doc,
                agentEdition: { ...doc.agentEdition!, goal: "Edited goal" },
            },
        ];
        for (const edited of edits) {
            expect(
                (await prepareAgentEditionSave(edited, {}, 2, previous))
                    .agentEdition!.review.state,
            ).toBe("draft");
        }
        expect(
            (
                await prepareAgentEditionSave(doc, {}, 2, {
                    ...previous,
                    state: "stale",
                })
            ).agentEdition!.review.state,
        ).toBe("draft");
    });

    it("requires a real catalog resolver and exact accepted immutable targets", async () => {
        const doc = document();
        doc.agentEdition!.steps[0].binding = {
            kind: "mcp",
            accepted: true,
            serverId: "metrics",
            targetId: "query",
            version: "v1",
            fingerprint: "sha256:abc",
        };
        const request = { reviewAgentEdition: true, safetyConfirmed: true };
        await expect(prepareAgentEditionSave(doc, request, 1)).rejects.toThrow(
            "validation unavailable",
        );
        const accepted: RunbookBindingValidator = async (bindings) =>
            bindings.map((binding) => ({
                binding,
                status: "accepted",
                argumentsValidated: true,
            }));
        expect(
            (
                await prepareAgentEditionSave(
                    doc,
                    request,
                    1,
                    undefined,
                    accepted,
                )
            ).agentEdition!.review.state,
        ).toBe("reviewed");
        const drifted: RunbookBindingValidator = async (bindings) =>
            bindings.map((binding) => ({ binding, status: "drifted" }));
        await expect(
            prepareAgentEditionSave(doc, request, 1, undefined, drifted),
        ).rejects.toThrow("drifted");
        const forged: RunbookBindingValidator = async (bindings) =>
            bindings.map((binding) => ({
                binding: { ...binding, fingerprint: "different" },
                status: "accepted",
            }));
        await expect(
            validateRunbookCatalogBindings(doc.agentEdition!, forged),
        ).rejects.toThrow("drifted");
        const missing: RunbookBindingValidator = async () => [];
        await expect(
            validateRunbookCatalogBindings(doc.agentEdition!, missing),
        ).rejects.toThrow("unavailable");
    });

    it("rejects unsupported versions, unstable IDs, unsafe asset payloads, unknown alternative targets and secret defaults", () => {
        const unsupported = { ...edition(), schemaVersion: 2 };
        expect(() => validateAgentEdition(unsupported)).toThrow(
            "schema version",
        );
        const bad = edition();
        bad.steps[0].alternatives = [
            { condition: "Otherwise", stepId: "missing" },
        ];
        expect(() => validateAgentEdition(bad)).toThrow(
            "unknown stable step ID",
        );
        expect(() =>
            validateAgentEdition({
                ...edition(),
                steps: [edition().steps[0], edition().steps[0]],
            }),
        ).toThrow("Duplicate step");
        const unsafe = edition();
        Object.assign(unsafe.steps[0].assets![0], { path: "C:\\secret.png" });
        expect(() => validateAgentEdition(unsafe)).toThrow(
            "unsupported fields",
        );
        const secret = edition();
        secret.inputs[0] = {
            ...secret.inputs[0],
            secret: true,
            defaultValue: "literal",
        };
        expect(() => validateAgentEdition(secret)).toThrow("Secret inputs");
    });

    it("round-trips argument templates and hashes argument-only edits as whole-version changes", async () => {
        const doc = document();
        doc.agentEdition!.steps[0].binding = {
            kind: "mcp",
            accepted: true,
            serverId: "metrics",
            targetId: "query",
            version: "v1",
            fingerprint: "schema-1",
            arguments: { namespace: { $input: "namespace" }, limit: 10 },
        };
        const accepted: RunbookBindingValidator = async (bindings, context) => {
            expect(context.inputs.map((input) => input.id)).toEqual([
                "namespace",
            ]);
            return bindings.map((binding) => ({
                binding,
                status: "accepted",
                argumentsValidated: true,
            }));
        };
        const reviewed = await prepareAgentEditionSave(
            doc,
            { reviewAgentEdition: true, safetyConfirmed: true },
            1,
            undefined,
            accepted,
        );
        expect(procedureFromMarkdown(procedureToMarkdown(reviewed))).toEqual(
            reviewed,
        );
        const edited = structuredClone(reviewed);
        const binding = edited.agentEdition!.steps[0].binding;
        if (binding?.kind !== "mcp") throw new Error("Expected MCP fixture");
        binding.arguments!.limit = 11;
        expect(agentEditionContentHash(edited)).not.toBe(
            agentEditionContentHash(reviewed),
        );
        expect(
            (await prepareAgentEditionSave(edited, {}, 2, version(reviewed)))
                .agentEdition!.review.state,
        ).toBe("draft");
        expect(
            version(reviewed).document.agentEdition!.steps[0].binding,
        ).toMatchObject({ arguments: { limit: 10 } });
    });

    it("requires explicit actual-schema attestation and exact argument echoes, including omitted arguments", async () => {
        const doc = document();
        doc.agentEdition!.steps[0].binding = {
            kind: "macro",
            accepted: true,
            targetId: "approved-query",
            version: 1,
            fingerprint: "schema-1",
        };
        doc.agentEdition!.inputs[0].defaultValue = "not-a-schema-proxy";
        doc.agentEdition!.inputs[0].examples = ["not-a-schema-proxy"];
        const identityOnly: RunbookBindingValidator = async (
            bindings,
            { inputs },
        ) => {
            expect(inputs[0]).not.toHaveProperty("defaultValue");
            expect(inputs[0]).not.toHaveProperty("examples");
            return bindings.map((binding) => ({ binding, status: "accepted" }));
        };
        await expect(
            validateRunbookCatalogBindings(doc.agentEdition!, identityOnly),
        ).rejects.toThrow("argument schema validation unavailable");
        const missingRequired: RunbookBindingValidator = async (bindings) =>
            bindings.map((binding) => ({
                binding,
                status: "rejected",
                reason: "Missing required target arguments",
            }));
        await expect(
            validateRunbookCatalogBindings(doc.agentEdition!, missingRequired),
        ).rejects.toThrow("rejected");
        const changed: RunbookBindingValidator = async (bindings) =>
            bindings.map((binding) => ({
                binding: { ...binding, arguments: { invented: 1 } },
                status: "accepted",
                argumentsValidated: true,
            }));
        await expect(
            validateRunbookCatalogBindings(doc.agentEdition!, changed),
        ).rejects.toThrow("drifted");
    });

    it("does not retain or publish legacy identity-only catalog reviews until explicitly re-reviewed", async () => {
        const doc = document();
        doc.agentEdition!.steps[0].binding = {
            kind: "flow",
            accepted: true,
            targetId: "approved-flow",
            version: "1",
            fingerprint: "schema-1",
        };
        const accepted: RunbookBindingValidator = async (bindings) =>
            bindings.map((binding) => ({
                binding,
                status: "accepted",
                argumentsValidated: true,
            }));
        const reviewed = await prepareAgentEditionSave(
            doc,
            { reviewAgentEdition: true, safetyConfirmed: true },
            1,
            undefined,
            accepted,
        );
        if (reviewed.agentEdition!.review.state !== "reviewed")
            throw new Error("Expected reviewed fixture");
        delete reviewed.agentEdition!.review.argumentsValidation;
        expect(() => validateReviewedAgentEdition(version(reviewed))).toThrow(
            "argument templates require schema validation",
        );
        expect(
            (await prepareAgentEditionSave(reviewed, {}, 2, version(reviewed)))
                .agentEdition!.review.state,
        ).toBe("draft");
    });

    it("preserves declared secret references while making redacted literal arguments unaccepted and attention-required", () => {
        const doc = document();
        doc.agentEdition!.inputs.push({
            id: "credential",
            description: "Runtime credential",
            type: "string",
            required: true,
            secret: true,
        });
        doc.agentEdition!.steps[0].binding = {
            kind: "mcp",
            accepted: true,
            serverId: "metrics",
            targetId: "query",
            version: "v1",
            fingerprint: "schema-1",
            arguments: {
                password: { $input: "credential" },
                apiKey: "private-value",
            },
        };
        const normalized = normalizeAgentEditionDocument(doc);
        expect(normalized.agentEdition!.steps[0]).toMatchObject({
            binding: {
                accepted: false,
                arguments: {
                    password: { $input: "credential" },
                    apiKey: "[REDACTED]",
                },
            },
            needsAttention: true,
        });
        expect(JSON.stringify(normalized)).not.toContain("private-value");
        expect(doc.agentEdition!.steps[0].binding.accepted).toBe(true);
    });

    it("redacts textual commands/examples without executing and flags missing evidence", async () => {
        const doc = document();
        doc.agentEdition!.steps[0].binding = {
            kind: "command",
            accepted: true,
            text: "curl --password private-value https://localhost; token=another-value",
        };
        doc.agentEdition!.inputs.push({
            id: "credential",
            description: "Request secret inputs at runtime",
            type: "string",
            required: true,
            secret: true,
            defaultValue: "private-value",
            examples: ["another-value"],
        });
        const normalized = normalizeAgentEditionDocument(doc);
        expect(JSON.stringify(normalized)).not.toContain("private-value");
        expect(JSON.stringify(normalized)).not.toContain("another-value");
        expect(normalized.agentEdition!.inputs[1]).not.toHaveProperty(
            "defaultValue",
        );
        expect(normalized.agentEdition!.inputs[1]).not.toHaveProperty(
            "examples",
        );
        expect(
            redactRunbookText(
                "Bearer sensitive secret inputs password='quoted secret'",
            ),
        ).toBe("[REDACTED] secret inputs [REDACTED]");
        expect(
            redactRunbookValue({ authorization: "value", secret: true }),
        ).toEqual({ authorization: "[REDACTED]", secret: true });
        expect(redactRunbookValue({ secret: "value" })).toEqual({
            secret: "[REDACTED]",
        });
        expect(redactRunbookText("Basic YWxhZGRpbjpvcGVuc2VzYW1l")).toBe(
            "[REDACTED]",
        );
        expect(redactRunbookText("Authorization: Basic dXNlcjpwYXNz")).toBe(
            "[REDACTED]",
        );
        expect(
            redactRunbookText("Basic troubleshooting and secret inputs"),
        ).toBe("Basic troubleshooting and secret inputs");
        expect(redactRunbookText("Basic metric19")).toBe("Basic metric19");
        expect(redactRunbookText("https://user:private-value@localhost")).toBe(
            "[REDACTED]localhost",
        );
        expect(redactRunbookText("AWS_SECRET_ACCESS_KEY=private-value")).toBe(
            "[REDACTED]",
        );
        expect(() => redactRunbookText("a".repeat(1_000_001))).toThrow("limit");
        normalized.agentEdition!.steps[0].citations = [];
        const flagged = normalizeAgentEditionDocument(normalized);
        expect(flagged.agentEdition!.steps[0]).toMatchObject({
            needsAttention: true,
            attentionReasons: ["Missing source citations"],
        });
        await expect(
            prepareAgentEditionSave(
                flagged,
                { reviewAgentEdition: true, safetyConfirmed: true },
                1,
            ),
        ).rejects.toThrow("evidence");
    });
});

describe("stored version-specific review", () => {
    const root = resolve("test", ".agent-edition-store");
    beforeEach(async () => rm(root, { recursive: true, force: true }));
    afterEach(async () => rm(root, { recursive: true, force: true }));
    const store = () => new PersonalHowToStore(root, async () => "index-1");

    it.each(["query", "_query", '["operations","query"]'])(
        "persists native MCP name %s and argument templates with declared input context across exact-version review",
        async (targetId) => {
            const doc = document();
            doc.agentEdition!.steps[0].binding = {
                kind: "mcp",
                accepted: true,
                serverId: "operations",
                targetId,
                version: "actual-schema",
                fingerprint: "actual-schema",
                arguments: { namespace: { $input: "namespace" }, limit: 10 },
            };
            let validations = 0;
            const validator: RunbookBindingValidator = async (
                bindings,
                context,
            ) => {
                validations++;
                expect(context.inputs).toEqual(doc.agentEdition!.inputs);
                expect(bindings).toEqual([doc.agentEdition!.steps[0].binding]);
                return bindings.map((binding) => ({
                    binding,
                    status: "accepted",
                    argumentsValidated: true,
                }));
            };
            const storage = new PersonalHowToStore(
                root,
                async () => "index-1",
                validator,
            );
            const draft = await storage.save({
                corpusId: "ops",
                procedureId: "restart",
                document: doc,
            });
            expect(validations).toBe(0);
            const reviewed = await storage.save({
                corpusId: "ops",
                procedureId: "restart",
                expectedVersion: 1,
                document: draft.document,
                reviewAgentEdition: true,
                safetyConfirmed: true,
            });
            expect(validations).toBe(1);
            validateReviewedAgentEdition(reviewed);
            expect(reviewed.document.agentEdition!.review).toMatchObject({
                state: "reviewed",
                procedureVersion: 2,
                argumentsValidation: "accepted",
            });
            const reopened = await new PersonalHowToStore(
                root,
                async () => "index-1",
                validator,
            ).get("ops", "restart", 2);
            expect(reopened?.document.agentEdition!.steps[0].binding).toEqual(
                doc.agentEdition!.steps[0].binding,
            );
            expect(procedureFromMarkdown(reviewed.markdown)).toEqual(
                reviewed.document,
            );
            expect(await storage.get("ops", "restart", 1)).toEqual(draft);
        },
    );

    it("persists immutable reviewed versions and invalidates stale linked-source and asset dependencies", async () => {
        const storage = store();
        const first = await storage.save({
            corpusId: "ops",
            procedureId: "restart",
            expectedVersion: 0,
            document: document(),
            reviewAgentEdition: true,
            safetyConfirmed: true,
        });
        validateReviewedAgentEdition(first);
        expect(first.document.agentEdition!.review).toMatchObject({
            state: "reviewed",
            procedureVersion: 1,
            contentHash: agentEditionContentHash(first.document),
        });
        const second = await storage.save({
            corpusId: "ops",
            procedureId: "restart",
            expectedVersion: 1,
            document: { ...first.document, summary: "A human edit" },
        });
        expect(second.document.agentEdition!.review.state).toBe("draft");
        expect((await storage.get("ops", "restart", 1))!.document).toEqual(
            first.document,
        );
        await expect(
            storage.save({
                corpusId: "ops",
                procedureId: "restart",
                expectedVersion: 1,
                document: document(),
            }),
        ).rejects.toThrow("version conflict");
        await storage.markStale("ops", "reference", "rev-4");
        const stale = (await storage.get("ops", "restart"))!;
        expect(stale.state).toBe("stale");
        expect(stale.document.agentEdition!.review.state).toBe("draft");
        expect(() => validateReviewedAgentEdition(stale)).toThrow(
            "saved and reviewed",
        );
        const archived = await storage.archive("ops", "restart", stale.version);
        expect(archived.document.agentEdition!.review.state).toBe("draft");
    });

    it("never trusts candidate review stamps and preserves evidence through candidate save", async () => {
        const storage = store();
        const reviewed = await prepareAgentEditionSave(
            document(),
            { reviewAgentEdition: true, safetyConfirmed: true },
            10,
        );
        const candidate = await storage.createCandidate({
            ...reviewed,
            corpusId: "ops",
            candidateId: "candidate-1",
        });
        expect(candidate.agentEdition!.review.state).toBe("draft");
        const saved = await storage.save({
            corpusId: "ops",
            candidateId: candidate.candidateId,
        });
        expect(saved.document.agentEdition!.steps[0].humanText).toBe(
            "Inspect the panel.",
        );
        expect(saved.document.agentEdition!.review.state).toBe("draft");
        expect(saved.basedOnCandidateId).toBe("candidate-1");
    });

    it("keeps opaque canonical JSON metadata on a Markdown save and invalidates whole-version review", async () => {
        const storage = store();
        const initial: ProcedureDocument & { custom: { owner: string } } = {
            ...document(),
            custom: { owner: "Human metadata" },
        };
        const first = await storage.save({
            corpusId: "ops",
            procedureId: "restart",
            document: initial,
            reviewAgentEdition: true,
            safetyConfirmed: true,
        });
        const edited = { ...first.document, title: "Edited title" };
        const next = await storage.save({
            corpusId: "ops",
            procedureId: "restart",
            expectedVersion: 1,
            markdown: procedureToMarkdown(edited),
        });
        expect(next.document).toMatchObject({
            custom: { owner: "Human metadata" },
        });
        expect(next.document.agentEdition!.review.state).toBe("draft");
        expect(next.document.additionalSections).toEqual(
            initial.additionalSections,
        );
        expect(next.document.citations).toEqual(initial.citations);
    });
});
