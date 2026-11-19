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
import { projectBriefSectionHeading } from "./viewText.js";
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
    ViewCitation,
} from "./viewTypes.js";

export const projectSummaryRules = `Every project role requires nonempty prose. When its information is absent, write "Unknown in supplied record." rather than an empty string or invented facts.
Supply citationIds.article and citationIds.<sectionRole> for every role. Select only fragments that support that section, include them in citationIds.article, and use [] when the section makes no source-grounded claim.
Empty citation lists do not permit empty role prose. Never copy every citation to every section.`;

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
        title: { type: "string", minLength: 1, pattern: "\\S" },
        summary: {
            type: "string",
            minLength: 1,
            maxLength: 4000,
            pattern: "\\S",
        },
        completeness: {
            type: "string",
            enum: ["partial", "sufficient"],
        },
        ...Object.fromEntries(
            projectBriefRoles.map((role) => [
                role,
                { type: "string", minLength: 1, pattern: "\\S" },
            ]),
        ),
        limits: {
            anyOf: [
                {
                    type: "string",
                    minLength: 1,
                    maxLength: 4000,
                    pattern: "\\S",
                },
                { type: "null" },
            ],
        },
        citationIds: {
            type: "object",
            additionalProperties: false,
            properties: {
                article: {
                    type: "array",
                    items: { type: "string", enum: ids },
                },
                ...Object.fromEntries(
                    projectBriefRoles.map((role) => [
                        role,
                        { type: "array", items: { type: "string", enum: ids } },
                    ]),
                ),
            },
            required: ["article", ...projectBriefRoles],
        },
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
        "projectState",
        "incidentState",
        "capacityState",
    ];
    const allowedKeys = [
        ...requiredStringKeys,
        "limits",
        "citationIds",
        "sectionCitationIds",
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
    const citationBindings = Array.isArray(raw.citationIds)
        ? undefined
        : evidenceRecord(raw.citationIds);
    const base = hydrateInformational(input, {
        title: raw.title,
        summary: raw.summary,
        status: raw.completeness,
        prose: raw.goalsScope,
        limits: raw.limits,
        citationIds: citationBindings
            ? citationBindings.article
            : raw.citationIds,
    });
    const sectionCitationIds = citationBindings
        ? undefined
        : evidenceRecord(raw.sectionCitationIds);
    if (
        sectionCitationIds &&
        (Object.keys(sectionCitationIds).length !== projectBriefRoles.length ||
            Object.keys(sectionCitationIds).some(
                (role) =>
                    !projectBriefRoles.some((expected) => expected === role),
            ))
    )
        throw new Error("Invalid project section citation inventory");
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
            heading: projectBriefSectionHeading(role),
            body: evidenceText(raw[role]),
            details: details[role],
        })),
        citations: base.content.citations,
    };
    const sectionCitations = bindProjectSectionCitations(
        input,
        citationBindings ?? { article: raw.citationIds, ...sectionCitationIds },
        base.content.citations,
    );
    return {
        content,
        outcome: "projectSummary",
        missingEvidence: base.missingEvidence,
        relationships: content.sections.flatMap((section, position) =>
            base.relationships.flatMap((edge) => {
                const selected = sectionCitations.get(section.role);
                if (!selected)
                    throw new Error("Missing project section support binding");
                const citations = edge.citations.filter((citation) =>
                    selected.includes(citation),
                );
                return citations.length
                    ? [
                          {
                              ...edge,
                              id: `section:${position}:${edge.id}`,
                              from: { ...edge.from, sectionId: section.id },
                              citations,
                          },
                      ]
                    : [];
            }),
        ),
    };
}

function bindProjectSectionCitations(
    input: ViewBuildSnapshot,
    value: unknown,
    selected: ViewCitation[],
): Map<string, ViewCitation[]> {
    const bindings = evidenceRecord(value);
    if (
        Object.keys(bindings).length !== projectBriefRoles.length + 1 ||
        Object.keys(bindings).some(
            (role) =>
                role !== "article" &&
                !projectBriefRoles.some((known) => known === role),
        )
    )
        throw new Error(
            "Project support requires exactly the supplied section roles",
        );
    const fragments = input.inputs.flatMap((source) => source.passages ?? []);
    return new Map(
        projectBriefRoles.map((role) => [
            role,
            evidenceArray(bindings[role], fragments.length).map((id) => {
                if (typeof id !== "string" || !/^f(0|[1-9]\d*)$/.test(id))
                    throw new Error("Unknown project section fragment ID");
                const fragment = fragments[Number(id.slice(1))];
                if (!fragment || !selected.includes(fragment))
                    throw new Error(
                        "Project section fragment is not selected in citationIds",
                    );
                return fragment;
            }),
        ]),
    );
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
