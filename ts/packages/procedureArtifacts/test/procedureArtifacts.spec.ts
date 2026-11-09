// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createHash } from "node:crypto";
import { jest } from "@jest/globals";
import type { CopilotToolMacro, MacroStep } from "@typeagent/copilot-macros";
import type {
    ProcedureDocument,
    ProcedureVersion,
} from "@typeagent/memory-service";
import type { CatalogEntry, SkillPackageInput } from "@typeagent/skill-catalog";
import {
    createMacroDraft,
    createSkillPackage,
    ProcedureArtifactCoordinator,
    type ProcedureLineage,
} from "../src/index.js";

function sortJson(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(sortJson);
    if (value !== null && typeof value === "object") {
        return Object.fromEntries(
            Object.entries(value as Record<string, unknown>)
                .sort(([left], [right]) => left.localeCompare(right))
                .map(([key, child]) => [key, sortJson(child)]),
        );
    }
    return value;
}

function hash(value: string): string {
    return createHash("sha256").update(value).digest("hex");
}

function procedure(
    changes: Partial<ProcedureVersion> = {},
    documentChanges: Partial<ProcedureDocument> = {},
): ProcedureVersion {
    const document: ProcedureDocument = {
        title: "Deploy the service",
        summary: "Deploy a reviewed service release.",
        steps: ["Build the release.", "Deploy it to staging."],
        citations: [
            {
                sourceId: "runbook",
                revisionId: "revision-7",
                locator: "section 4",
                excerpt: "Use the reviewed release.",
            },
        ],
        ...documentChanges,
    };
    const canonicalJson = `${JSON.stringify(sortJson(document), undefined, 2)}\n`;
    const markdown = "# Deploy the service\n";
    return {
        corpusId: "operations",
        procedureId: "deploy-service",
        version: 3,
        state: "saved",
        document,
        canonicalJson,
        markdown,
        createdAt: "2026-09-22T00:00:00.000Z",
        jsonHash: hash(canonicalJson),
        markdownHash: hash(markdown),
        basedOnCandidateId: "candidate-1",
        previousVersion: 2,
        ...changes,
    };
}

function macro(stepOverrides: Partial<MacroStep> = {}): CopilotToolMacro {
    return {
        schemaVersion: 1,
        macroId: "deploy-service",
        version: 4,
        name: "Deploy service",
        description: "Deploy through the reviewed tool call.",
        state: "approved",
        executionClass: "replayable",
        inputs: [],
        steps: [
            {
                id: "deploy",
                toolName: "deploy",
                mcpServerName: "operations",
                arguments: {
                    kind: "literal",
                    value: { environment: "staging" },
                },
                executionClass: "replayable",
                sourceToolCallId: "reviewed-call-1",
                ...stepOverrides,
            },
        ],
        sourceTraceId: "untrusted-source",
        createdAt: "2026-09-22T00:00:00.000Z",
        warnings: [],
    };
}

function withAutomation(value: unknown): ProcedureVersion {
    return procedure(
        {},
        {
            additionalSections: [
                {
                    heading: "Automation",
                    content: `\`\`\`json\n${JSON.stringify(value)}\n\`\`\``,
                },
            ],
        },
    );
}

describe("createSkillPackage", () => {
    it("creates an Agent Skills package with exact frontmatter and lineage", () => {
        const result = createSkillPackage(procedure(), {
            identity: {
                scope: "user",
                origin: "memory",
                name: "deploy-service",
            },
        });
        expect(result.description).toBe("Deploy a reviewed service release.");
        expect(result.schemaFingerprint).toBe(procedure().jsonHash);
        expect(result.files).toHaveLength(1);
        const skill = result.files[0].content;
        expect(typeof skill).toBe("string");
        expect(skill).toContain(
            'name: deploy-service\ndescription: "Deploy a reviewed service release."\n',
        );
        expect(skill).toContain('typeagent-procedure-id: "deploy-service"');
        expect(skill).toContain("1. Build the release.");
        expect(skill).toContain("`runbook@revision-7` (section 4)");
        expect(skill).toContain("> Use the reviewed release.");
    });

    it("includes optional schema and grammar artifacts with a schema hash", () => {
        const schema = '{"type":"object"}';
        const result = createSkillPackage(procedure(), {
            identity: {
                scope: "project",
                origin: "C:\\project",
                name: "deploy-service",
            },
            description: "Exact caller-provided description.",
            schema: { content: schema },
            grammar: {
                path: "routing/deploy.ag.json",
                content: '{"rules":[]}',
            },
        });
        expect(result.schemaFingerprint).toBe(hash(schema));
        expect(result.files.map((file) => file.path)).toEqual([
            "SKILL.md",
            "artifacts/schema.json",
            "routing/deploy.ag.json",
        ]);
        expect(result.files[0].content).toContain(
            'description: "Exact caller-provided description."',
        );
    });

    it.each([
        ["stale source", { state: "stale" as const }, /must be in saved state/],
        ["changed JSON", { canonicalJson: "{}\n" }, /does not match/],
        ["changed hash", { markdownHash: "invalid" }, /manifest validation/],
    ])("rejects %s", (_name, changes, expected) => {
        expect(() =>
            createSkillPackage(procedure(changes), {
                identity: {
                    scope: "user",
                    origin: "memory",
                    name: "deploy-service",
                },
            }),
        ).toThrow(expected);
    });

    it("rejects invalid Agent Skills names and artifact paths", () => {
        expect(() =>
            createSkillPackage(procedure(), {
                identity: {
                    scope: "user",
                    origin: "memory",
                    name: "Deploy Service",
                },
            }),
        ).toThrow(/Agent Skill name/);
        expect(() =>
            createSkillPackage(procedure(), {
                identity: {
                    scope: "user",
                    origin: "memory",
                    name: "deploy-service",
                },
                schema: { path: "../schema.json", content: "{}" },
            }),
        ).toThrow(/Unsafe skill file path/);
    });
});

describe("createMacroDraft", () => {
    it("does not infer automation from prose", () => {
        expect(createMacroDraft(procedure())).toMatchObject({
            status: "notAvailable",
            reason: expect.stringContaining("no explicit"),
        });
    });

    it("parses, validates, forces draft state, and preserves lineage", () => {
        const result = createMacroDraft(withAutomation(macro()));
        expect(result.status).toBe("ready");
        if (result.status !== "ready") throw new Error("Expected ready draft");
        expect(result.macro.state).toBe("draft");
        expect(result.macro.sourceTraceId).toBe(
            `procedure:operations:deploy-service:v3:${result.lineage.jsonHash}`,
        );
        expect(result.lineage).toMatchObject({
            corpusId: "operations",
            procedureId: "deploy-service",
            version: 3,
            basedOnCandidateId: "candidate-1",
            previousVersion: 2,
        });
        expect(result.validation.valid).toBe(true);
    });

    it("returns actionable parser and macro validator errors", () => {
        const malformed = procedure(
            {},
            {
                additionalSections: [
                    { heading: "Automation", content: "{ definitely not json" },
                ],
            },
        );
        expect(createMacroDraft(malformed)).toMatchObject({
            status: "invalid",
            errors: [{ code: "invalidAutomationJson" }],
        });

        const invalidMacro = createMacroDraft(
            withAutomation(
                macro({ arguments: { kind: "input", name: "missing" } }),
            ),
        );
        expect(invalidMacro).toMatchObject({
            status: "invalid",
            errors: [
                {
                    code: "invalidExpression",
                    message: "Unknown input: missing",
                    path: "deploy",
                },
            ],
            validation: { valid: false },
        });
    });

    it("rejects duplicate and structurally invalid automation sections", () => {
        const duplicate = procedure(
            {},
            {
                additionalSections: [
                    { heading: "Automation", content: "{}" },
                    { heading: " automation ", content: "{}" },
                ],
            },
        );
        expect(createMacroDraft(duplicate)).toMatchObject({
            status: "invalid",
            errors: [{ code: "duplicateAutomation" }],
        });
        expect(createMacroDraft(withAutomation([]))).toMatchObject({
            status: "invalid",
            errors: [{ code: "invalidAutomationShape" }],
        });
        expect(
            createMacroDraft(
                withAutomation({
                    ...macro(),
                    steps: [{ id: 7, arguments: { kind: "invented" } }],
                }),
            ),
        ).toMatchObject({
            status: "invalid",
            errors: [{ code: "invalidStep", path: "steps[0]" }],
        });
    });
});

describe("ProcedureArtifactCoordinator", () => {
    it("delegates persistence without owning catalog storage", async () => {
        const catalog = {
            publish: jest.fn(
                async (_input: SkillPackageInput) =>
                    ({ state: "draft" }) as CatalogEntry,
            ),
        };
        const publisher = {
            publishMacro: jest.fn(
                async (_macro: CopilotToolMacro, _lineage: ProcedureLineage) =>
                    "macro-reference",
            ),
        };
        const coordinator = new ProcedureArtifactCoordinator(
            catalog,
            publisher,
        );
        await coordinator.publishSkill(procedure(), {
            identity: {
                scope: "user",
                origin: "memory",
                name: "deploy-service",
            },
        });
        const published = await coordinator.publishMacro(
            withAutomation(macro()),
        );
        expect(catalog.publish).toHaveBeenCalledTimes(1);
        expect(publisher.publishMacro).toHaveBeenCalledTimes(1);
        expect(published).toMatchObject({
            status: "published",
            published: "macro-reference",
        });
    });

    it("does not invoke a macro publisher when automation is absent", async () => {
        const publisher = {
            publishMacro: jest.fn(
                async (_macro: CopilotToolMacro, _lineage: ProcedureLineage) =>
                    undefined,
            ),
        };
        const coordinator = new ProcedureArtifactCoordinator(
            {
                publish: jest.fn(
                    async (_input: SkillPackageInput) =>
                        ({ state: "draft" }) as CatalogEntry,
                ),
            },
            publisher,
        );
        expect(await coordinator.publishMacro(procedure())).toMatchObject({
            status: "notAvailable",
        });
        expect(publisher.publishMacro).not.toHaveBeenCalled();
    });
});
