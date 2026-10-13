// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { StructuredOutputJsonSchema } from "@typeagent/aiclient";
import {
    hydrateInformational,
    informationalSchema,
} from "./informationalWiki.js";
import { projectBriefRoles, parseProjectBriefDetails } from "./projectBrief.js";
import { parseIndexedLocator } from "./indexedFragments.js";
import { viewSourceKey } from "./viewContent.js";
import { evidenceRecord, evidenceText } from "./viewSynthesisEvidence.js";
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

export function hydrateProjectSummary(
    input: ViewBuildSnapshot,
    value: unknown,
): ViewSynthesisOutput {
    if (!value || typeof value !== "object" || Array.isArray(value))
        throw new Error("Invalid informational project-summary response");
    const raw = evidenceRecord(value);
    const keys = [
        "title",
        ...projectBriefRoles,
        "limits",
        "citationIds",
        "projectState",
        "incidentState",
        "capacityState",
    ];
    if (
        Object.keys(raw).some((key) => !keys.includes(key)) ||
        keys
            .filter((key) => key !== "citationIds")
            .some((key) => {
                const field = raw[key];
                return typeof field !== "string" || !field.trim();
            })
    )
        throw new Error("Invalid informational project-summary fields");
    const base = hydrateInformational(input, {
        title: raw.title,
        prose: raw.goalsScope,
        limits: raw.limits,
        citationIds: raw.citationIds,
    });
    const status = parseProjectBriefDetails({
        kind: "status",
        project: raw.projectState,
        incident: raw.incidentState,
        capacity: raw.capacityState,
    });
    const details: Record<
        (typeof projectBriefRoles)[number],
        ProjectBriefDetails
    > = {
        goalsScope: { kind: "goalsScope" },
        owners: { kind: "owners", assignments: [] },
        status,
        milestones: { kind: "milestones", items: [] },
        decisions: { kind: "decisions", items: [] },
        risks: { kind: "risks", items: [] },
        context: {
            kind: "context",
            asOf: null,
            basis: "unknown",
        },
    };
    const content: ProjectBriefContent = {
        kind: "projectBrief",
        construction: "informational-project-summary-v1",
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
        !informationalProject(content) ||
        content.sections.length !== 7 ||
        new Set(content.sections.map((section) => section.role)).size !== 7 ||
        projectBriefRoles.some(
            (role) =>
                !content.sections.some((section) => section.role === role),
        ) ||
        !content.summary?.startsWith(
            "Limited summary: selected indexed fragments only;",
        )
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
