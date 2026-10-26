// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { StructuredOutputJsonSchema } from "@typeagent/aiclient";
import {
    hydrateInformational,
    informationalSchema,
} from "./informationalWiki.js";
import { projectBriefRoles, parseProjectBriefDetails } from "./projectBrief.js";
import { parseIndexedLocator } from "./indexedFragments.js";
import { assertViewIdentifier, viewSourceKey } from "./viewContent.js";
import { factStatuses } from "./viewInventory.js";
import {
    evidenceArray,
    evidenceRecord,
    evidenceText,
} from "./viewSynthesisEvidence.js";
import type {
    ProjectBriefContent,
    ProjectBriefDetails,
    ViewBuildSnapshot,
    ViewSynthesisOutput,
    ViewDefinitionInput,
} from "./viewTypes.js";

export function informationalProject(content: {
    kind: string;
    construction?: string;
}): boolean {
    return (
        content.kind === "projectBrief" &&
        content.construction === "informational-project-summary-v1"
    );
}

export function validateProjectSelector(definition: ViewDefinitionInput): void {
    const selector = definition.projectSummary;
    if (!selector) {
        if (definition.kind === "projectBrief")
            throw new Error(
                "Project construction requires informational-project-summary-v1",
            );
        return;
    }
    if (
        definition.kind !== "projectBrief" ||
        definition.maintenance ||
        definition.wiki ||
        selector.construction !== "informational-project-summary-v1" ||
        Object.keys(selector).some(
            (key) =>
                ![
                    "construction",
                    "query",
                    "aliases",
                    "excludedSourceIds",
                ].includes(key),
        ) ||
        !selector.query?.trim() ||
        selector.query.length > 200 ||
        !Array.isArray(selector.aliases) ||
        selector.aliases.length > 7 ||
        selector.aliases.some(
            (alias) =>
                typeof alias !== "string" ||
                !alias.trim() ||
                alias.length > 200,
        ) ||
        !Array.isArray(selector.excludedSourceIds) ||
        selector.excludedSourceIds.length > 32 ||
        selector.excludedSourceIds.some(
            (id) => typeof id !== "string" || !/^[A-Za-z0-9_-]+$/.test(id),
        ) ||
        new Set(selector.excludedSourceIds).size !==
            selector.excludedSourceIds.length
    )
        throw new Error("Invalid informational project-summary selector");
}

export function projectSummarySchema(
    ids: string[],
): StructuredOutputJsonSchema {
    const common = informationalSchema(ids);
    const properties = {
        title: { type: "string" },
        summary: { type: "string" },
        completeness: {
            type: "string",
            enum: ["partial", "sufficient"],
        },
        ...Object.fromEntries(
            projectBriefRoles.map((role) => [role, { type: "string" }]),
        ),
        limits: { type: "string" },
        citationIds: { type: "array", items: { type: "string", enum: ids } },
        projectState: {
            type: "string",
            enum: ["unknown", "active", "blocked", "complete"],
        },
        incidentState: {
            type: "string",
            enum: ["unknown", "open", "closed", "notApplicable"],
        },
        capacityState: {
            type: "string",
            enum: [
                "unknown",
                "pendingOwnerReview",
                "validated",
                "notApplicable",
            ],
        },
        assignments: {
            type: "array",
            items: {
                type: "object",
                additionalProperties: false,
                properties: {
                    id: { type: "string" },
                    responsibility: { type: "string" },
                    state: {
                        type: "string",
                        enum: ["known", "unknown", "unassigned"],
                    },
                    owner: {
                        anyOf: [{ type: "string" }, { type: "null" }],
                    },
                },
                required: ["id", "responsibility", "state", "owner"],
            },
        },
        milestoneItems: {
            type: "array",
            items: {
                type: "object",
                additionalProperties: false,
                properties: {
                    id: { type: "string" },
                    status: {
                        type: "string",
                        enum: [
                            "proposed",
                            "confirmed",
                            "blocked",
                            "deferred",
                            "unknown",
                        ],
                    },
                    date: {
                        anyOf: [{ type: "string" }, { type: "null" }],
                    },
                },
                required: ["id", "status", "date"],
            },
        },
        decisionItems: {
            type: "array",
            items: {
                type: "object",
                additionalProperties: false,
                properties: {
                    id: { type: "string" },
                    status: {
                        type: "string",
                        enum: [...factStatuses],
                    },
                },
                required: ["id", "status"],
            },
        },
        openQuestions: {
            type: "array",
            items: { type: "string" },
        },
        riskItems: {
            type: "array",
            items: {
                type: "object",
                additionalProperties: false,
                properties: {
                    id: { type: "string" },
                    status: {
                        type: "string",
                        enum: ["open", "blocked", "resolved", "unknown"],
                    },
                },
                required: ["id", "status"],
            },
        },
    };
    return {
        ...common,
        name: "informational_project_summary",
        schema: {
            type: "object",
            additionalProperties: false,
            properties,
            required: Object.keys(properties),
        },
    };
}

function parseStructuredItems(items: unknown): Array<Record<string, unknown>> {
    const seen = new Set<string>();
    return evidenceArray(items, 128).map((item) => {
        const entry = { ...evidenceRecord(item) };
        if (typeof entry.id !== "string")
            throw new Error("Invalid informational project item id");
        assertViewIdentifier("project item", entry.id);
        if (seen.has(entry.id))
            throw new Error("Duplicate informational project item id");
        seen.add(entry.id);
        return entry;
    });
}

export function hydrateProjectSummary(
    input: ViewBuildSnapshot,
    value: unknown,
): ViewSynthesisOutput & { content: ProjectBriefContent } {
    if (!value || typeof value !== "object" || Array.isArray(value))
        throw new Error("Invalid informational project-summary response");
    const raw = evidenceRecord(value);
    const requiredStringKeys = [
        "title",
        "summary",
        "completeness",
        ...projectBriefRoles,
        "limits",
        "projectState",
        "incidentState",
        "capacityState",
    ];
    const allowedKeys = [
        ...requiredStringKeys,
        "citationIds",
        "assignments",
        "milestoneItems",
        "decisionItems",
        "openQuestions",
        "riskItems",
    ];
    if (
        Object.keys(raw).some((key) => !allowedKeys.includes(key)) ||
        requiredStringKeys.some((key) => {
            const field = raw[key];
            return typeof field !== "string" || !field.trim();
        }) ||
        (raw.summary !== undefined &&
            (typeof raw.summary !== "string" ||
                !raw.summary.trim() ||
                raw.summary.length > 4000)) ||
        (raw.completeness !== undefined &&
            raw.completeness !== "partial" &&
            raw.completeness !== "sufficient")
    )
        throw new Error("Invalid informational project-summary fields");
    const base = hydrateInformational(input, {
        title: raw.title,
        summary: raw.summary,
        status: raw.completeness,
        prose: raw.goalsScope,
        limits: raw.limits,
        citationIds: raw.citationIds,
    });
    const owners = parseProjectBriefDetails({
        kind: "owners",
        assignments: parseStructuredItems(raw.assignments),
    });
    const status = parseProjectBriefDetails({
        kind: "status",
        project: raw.projectState,
        incident: raw.incidentState,
        capacity: raw.capacityState,
    });
    const milestones = parseProjectBriefDetails({
        kind: "milestones",
        items: parseStructuredItems(raw.milestoneItems),
    });
    const decisions = parseProjectBriefDetails({
        kind: "decisions",
        items: parseStructuredItems(raw.decisionItems),
    });
    const openQuestions = evidenceArray(raw.openQuestions, 128).map((entry) =>
        evidenceText(entry),
    );
    const risks = parseProjectBriefDetails({
        kind: "risks",
        items: parseStructuredItems(raw.riskItems),
        ...(openQuestions !== undefined ? { openQuestions } : {}),
    });
    const details: Record<
        (typeof projectBriefRoles)[number],
        ProjectBriefDetails
    > = {
        goalsScope: { kind: "goalsScope" },
        owners,
        status,
        milestones,
        decisions,
        risks,
        context: {
            kind: "context",
            asOf: null,
            basis: "unknown",
        },
    };
    const content: ProjectBriefContent = {
        kind: "projectBrief",
        construction: "informational-project-summary-v1",
        status: base.content.status,
        coverageNote: base.content.coverageNote,
        title: base.content.title,
        summary: base.content.summary!,
        sections: projectBriefRoles.map((role) => ({
            id: `${input.definition.viewId}:${role}`,
            role,
            heading: role,
            body: evidenceText(raw[role]),
            details: details[role],
        })),
        citations: base.content.citations,
    };
    return {
        content,
        outcome: "projectSummary",
        missingEvidence: base.missingEvidence,
        relationships: content.sections.flatMap((section, position) =>
            base.relationships.map((edge) => ({
                ...edge,
                id: `section:${position}:${edge.id}`,
                from: { ...edge.from, sectionId: section.id },
            })),
        ),
    };
}

export function validateInformationalProjectContent(
    content: ProjectBriefContent,
): void {
    if (
        content.coverageNote !== undefined &&
        (typeof content.coverageNote !== "string" ||
            content.coverageNote.length > 4000)
    )
        throw new Error("Invalid informational coverage note");
    if (
        !informationalProject(content) ||
        content.sections.length !== 7 ||
        new Set(content.sections.map((section) => section.role)).size !== 7 ||
        projectBriefRoles.some(
            (role) =>
                !content.sections.some((section) => section.role === role),
        ) ||
        typeof content.summary !== "string" ||
        !content.summary.trim() ||
        content.summary.length > 4000 ||
        (content.status !== undefined &&
            content.status !== "partial" &&
            content.status !== "sufficient")
    )
        throw new Error("Invalid informational project-summary content");
    for (const section of content.sections) {
        const details = parseProjectBriefDetails(section.details);
        if (details.kind !== section.role)
            throw new Error(
                "Project summary section role and typed details must match",
            );
    }
}

export function validateInformationalProjectOutput(
    input: ViewBuildSnapshot,
    output: ViewSynthesisOutput,
): void {
    if (
        input.pipeline !== "informational-project-summary-v1" ||
        output.content.kind !== "projectBrief" ||
        output.outcome !== "projectSummary" ||
        output.inventory ||
        output.inventoryAudit ||
        output.coverage
    )
        throw new Error(
            "Informational project summary cannot use legacy inventory contracts",
        );
    validateInformationalProjectContent(output.content);
    const passages = input.inputs.flatMap((entry) => entry.passages ?? []);
    if (!output.content.citations.length)
        throw new Error("Project summary requires indexed evidence");
    for (const citation of [
        ...output.content.citations,
        ...output.relationships.flatMap((edge) => edge.citations),
    ]) {
        parseIndexedLocator(citation.locator);
        if (
            !passages.some(
                (passage) =>
                    viewSourceKey(passage) === viewSourceKey(citation) &&
                    passage.locator === citation.locator &&
                    passage.excerpt === citation.excerpt,
            )
        )
            throw new Error(
                "Project summary citation is not an exact supplied indexed fragment",
            );
    }
}
