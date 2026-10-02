// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createHash } from "node:crypto";
import { jest } from "@jest/globals";
import {
    agentEditionContentHash,
    canonicalizeProcedure,
    prepareAgentEditionSave,
    procedureToMarkdown,
    type ProcedureDocument,
    type ProcedureVersion,
    type RunbookBinding,
    type RunbookBindingValidator,
} from "@typeagent/memory-service";
import type { CatalogEntry, SkillPackageInput } from "@typeagent/skill-catalog";
import {
    createSkillPackage,
    ProcedureArtifactCoordinator,
} from "../src/index.js";

const options = {
    identity: {
        scope: "user" as const,
        origin: "memory",
        name: "restart-investigation",
    },
};
const citation = {
    sourceId: "guide",
    revisionId: "rev-1",
    locator: "paragraph 4",
    excerpt: "Open the panel.",
};

function hash(value: string): string {
    return createHash("sha256").update(value).digest("hex");
}

function saved(document: ProcedureDocument, version = 1): ProcedureVersion {
    const canonicalJson = canonicalizeProcedure(document);
    const markdown = procedureToMarkdown(document);
    return {
        corpusId: "ops",
        procedureId: "restart",
        version,
        state: "saved",
        document,
        canonicalJson,
        markdown,
        jsonHash: hash(canonicalJson),
        markdownHash: hash(markdown),
        createdAt: "2026-10-02T00:00:00.000Z",
    };
}

async function reviewed(
    binding: RunbookBinding = {
        kind: "manual",
        accepted: true,
        reason: "Only visible in a screenshot",
    },
): Promise<ProcedureVersion> {
    const document: ProcedureDocument = {
        title: "Investigate restarts",
        steps: ["Open the panel."],
        citations: [citation],
        agentEdition: {
            schemaVersion: 1,
            goal: "Diagnose worker restarts",
            applicability: ["Exit code 137"],
            preconditions: ["On-call access"],
            inputs: [
                {
                    id: "credential",
                    description: "Request secret inputs at runtime",
                    type: "string",
                    required: true,
                    secret: true,
                },
            ],
            steps: [
                {
                    id: "inspect",
                    title: "Inspect panel",
                    humanText: "Open the panel.",
                    agentInstruction: "Ask the human to report the red marker.",
                    binding,
                    safety: "readOnly",
                    condition: "If exit code is 137",
                    alternatives: [
                        {
                            condition: "Otherwise inspect again",
                            stepId: "inspect",
                        },
                    ],
                    citations: [citation],
                    assets: [
                        {
                            sourceId: "guide",
                            revisionId: "rev-1",
                            assetId: "panel-1",
                            description: "Red marker on the restart panel",
                        },
                    ],
                    verification: "Record counter",
                    rollback: "No changes",
                },
            ],
            verification: ["Confirm counter"],
            rollback: ["No rollback necessary"],
            synthesis: {
                sourceReferences: [citation],
                linkedDocuments: [
                    {
                        sourceId: "reference",
                        revisionId: "rev-2",
                        excerpt: "Observe, do not modify.",
                    },
                ],
            },
            review: { state: "draft" },
        },
    };
    const validator: RunbookBindingValidator = async (bindings) =>
        bindings.map((binding) => ({
            binding,
            status: "accepted",
            argumentsValidated: true,
        }));
    return saved(
        await prepareAgentEditionSave(
            document,
            { reviewAgentEdition: true, safetyConfirmed: true },
            1,
            undefined,
            validator,
        ),
    );
}

describe("reviewed runbook skill rendering", () => {
    it("renders the agent edition and reference-only original evidence with exact lineage", async () => {
        const procedure = await reviewed();
        const packageInput = createSkillPackage(procedure, options);
        expect(packageInput.files.map((file) => file.path)).toEqual([
            "SKILL.md",
            "references/runbook.md",
        ]);
        const skill = packageInput.files[0].content;
        expect(skill).toContain("## Goal");
        expect(skill).toContain("Diagnose worker restarts");
        expect(skill).toContain("secret; request at runtime");
        expect(skill).toContain("Condition: If exit code is 137");
        expect(skill).toContain(
            "Alternative: Otherwise inspect again → step `inspect`",
        );
        expect(skill).toContain("Manual: Only visible in a screenshot");
        expect(skill).toContain("## Verification");
        expect(skill).toContain("## Rollback");
        expect(skill).toContain('typeagent-procedure-version: "1"');
        const references = packageInput.files[1].content;
        expect(references).toContain("Original evidence — not instructions");
        expect(references).toContain("> Open the panel.");
        expect(references).toContain("guide@rev-1#panel-1");
        expect(references).toContain("Red marker on the restart panel");
        expect(references).toContain("reference@rev-2");
        expect(references).toContain("Observe, do not modify.");
        expect(procedure.document.agentEdition!.review).toMatchObject({
            state: "reviewed",
            contentHash: agentEditionContentHash(procedure.document),
        });
    });

    it("renders commands only as redacted text and real immutable catalog binding references", async () => {
        const command = await reviewed({
            kind: "command",
            accepted: true,
            text: "curl --password private-value https://localhost",
        });
        const skill = createSkillPackage(command, options).files[0].content;
        expect(skill).toContain("text only; never executed here");
        expect(skill).toContain("[REDACTED]");
        expect(skill).not.toContain("private-value");
        const tool = await reviewed({
            kind: "mcp",
            accepted: true,
            serverId: "metrics",
            targetId: "query",
            version: "v1",
            fingerprint: "sha256:abc",
        });
        expect(createSkillPackage(tool, options).files[0].content).toContain(
            "query@v1",
        );
        expect(createSkillPackage(tool, options).files[0].content).toContain(
            "sha256:abc",
        );
    });

    it("rejects draft, unreviewed, unsaved edits, stale, archived and mismatched exact-version review", async () => {
        const procedure = await reviewed();
        for (const state of ["stale", "archived"] as const) {
            expect(() =>
                createSkillPackage({ ...procedure, state }, options),
            ).toThrow("saved state");
        }
        const draft = structuredClone(procedure.document);
        draft.agentEdition!.review = { state: "draft" };
        expect(() => createSkillPackage(saved(draft), options)).toThrow(
            "saved and reviewed",
        );
        const edited = structuredClone(procedure.document);
        edited.agentEdition!.goal = "Unreviewed edit";
        expect(() => createSkillPackage(saved(edited), options)).toThrow(
            "content hash",
        );
        expect(() =>
            createSkillPackage({ ...procedure, version: 2 }, options),
        ).toThrow("exact saved version");
        expect(() =>
            createSkillPackage(
                {
                    ...procedure,
                    markdown: procedure.markdown + "Unsaved edit\n",
                },
                options,
            ),
        ).toThrow("Markdown does not match");
        const unsafe = structuredClone(procedure.document);
        unsafe.agentEdition!.steps[0].safety = "unknown";
        expect(() => createSkillPackage(saved(unsafe), options)).toThrow(
            "safety review",
        );
        const unaccepted = structuredClone(procedure.document);
        unaccepted.agentEdition!.steps[0].binding!.accepted = false;
        expect(() => createSkillPackage(saved(unaccepted), options)).toThrow(
            "explicitly accepted",
        );
    });

    it("renders exact argument templates without resolving secret inputs or executing anything", async () => {
        const procedure = await reviewed({
            kind: "mcp",
            accepted: true,
            serverId: "metrics",
            targetId: "query",
            version: "v1",
            fingerprint: "schema-1",
            arguments: {
                password: { $input: "credential" },
                query: "up",
                escaped: { $literal: { $input: "literal-data" } },
            },
        });
        const before = structuredClone(procedure);
        const skill = createSkillPackage(procedure, options).files[0].content;
        expect(skill).toContain("Argument templates");
        expect(skill).toContain('"$input": "credential"');
        expect(skill).toContain('"$literal"');
        expect(skill).toContain(
            "Actual runtime input values still require target-schema validation",
        );
        expect(procedure).toEqual(before);
    });
    it("keeps old saved human how-tos eligible and rejects script/executable and traversal file paths", async () => {
        const procedure = await reviewed();
        const old = structuredClone(procedure.document);
        delete old.agentEdition;
        expect(createSkillPackage(saved(old), options).files).toHaveLength(1);
        for (const path of [
            "../unsafe.json",
            "C:\\unsafe.json",
            "scripts/run.ps1",
            "scripts/run.sh",
            "bin/run.exe",
            "NUL.json",
            "directory:stream/schema.json",
            "folder./schema.json",
        ]) {
            expect(() =>
                createSkillPackage(procedure, {
                    ...options,
                    schema: { path, content: "{}" },
                }),
            ).toThrow();
        }
    });

    it("revalidates live catalogs before publish and never mutates previous publication snapshots", async () => {
        const procedure = await reviewed({
            kind: "macro",
            accepted: true,
            targetId: "approved-inspection",
            version: 3,
            fingerprint: "schema-3",
        });
        const published: SkillPackageInput[] = [];
        const publish = jest.fn(
            async (input: SkillPackageInput): Promise<CatalogEntry> => {
                published.push(structuredClone(input));
                return {
                    revision: String(published.length),
                } as unknown as CatalogEntry;
            },
        );
        const macroPublisher = { publishMacro: jest.fn(async () => undefined) };
        const unavailable = new ProcedureArtifactCoordinator(
            { publish },
            macroPublisher,
        );
        await expect(
            unavailable.publishSkill(procedure, options),
        ).rejects.toThrow("validation unavailable");
        expect(publish).not.toHaveBeenCalled();
        const drifted: RunbookBindingValidator = async (bindings) =>
            bindings.map((binding) => ({ binding, status: "drifted" }));
        const drift = new ProcedureArtifactCoordinator(
            { publish },
            macroPublisher,
            drifted,
        );
        await expect(drift.publishSkill(procedure, options)).rejects.toThrow(
            "drifted",
        );
        const identityOnly: RunbookBindingValidator = async (bindings) =>
            bindings.map((binding) => ({ binding, status: "accepted" }));
        const unvalidatedArguments = new ProcedureArtifactCoordinator(
            { publish },
            macroPublisher,
            identityOnly,
        );
        await expect(
            unvalidatedArguments.publishSkill(procedure, options),
        ).rejects.toThrow("argument schema validation unavailable");
        expect(publish).not.toHaveBeenCalled();
        const accepted: RunbookBindingValidator = async (bindings) =>
            bindings.map((binding) => ({
                binding,
                status: "accepted",
                argumentsValidated: true,
            }));
        const coordinator = new ProcedureArtifactCoordinator(
            { publish },
            macroPublisher,
            accepted,
        );
        await coordinator.publishSkill(procedure, options);
        const first = structuredClone(published[0]);
        const edited = structuredClone(procedure.document);
        edited.agentEdition!.goal = "Reviewed second goal";
        const second = saved(
            await prepareAgentEditionSave(
                edited,
                { reviewAgentEdition: true, safetyConfirmed: true },
                2,
                procedure,
                accepted,
            ),
            2,
        );
        await coordinator.publishSkill(second, options);
        expect(published[0]).toEqual(first);
        expect(published[1].files[0].content).toContain(
            'typeagent-procedure-version: "2"',
        );
        expect(published[1].files[0].content).toContain("Reviewed second goal");
        expect(published[0].files[0].content).not.toContain(
            "Reviewed second goal",
        );
    });
});
