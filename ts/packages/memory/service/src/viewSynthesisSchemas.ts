// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    JsonSchemaType,
    StructuredOutputJsonSchema,
} from "@typeagent/aiclient";
import {
    factKinds,
    factStatuses,
    sourceDispositions,
} from "./viewInventory.js";
import type { ViewKind } from "./viewTypes.js";
import { projectBriefRoles } from "./projectBrief.js";
import { wikiTaxonomy } from "./wiki.js";
import type { WikiSubjectIdentity } from "./viewMaintenanceTypes.js";

const text: JsonSchemaType = { type: "string" };
const boolean: JsonSchemaType = { type: "boolean" };
function object(properties: Record<string, JsonSchemaType>): JsonSchemaType {
    return {
        type: "object",
        properties,
        required: Object.keys(properties),
        additionalProperties: false,
    };
}
function array(items: JsonSchemaType): JsonSchemaType {
    return { type: "array", items };
}
function choice(values: readonly string[]): JsonSchemaType {
    return { type: "string", enum: [...values] };
}
const referenceChoices = new WeakSet<object>();
function reference(values: readonly string[]): JsonSchemaType {
    if (!values.length) return text;
    const result = choice(values);
    referenceChoices.add(result);
    return result;
}
function boundedEnums(root: JsonSchemaType): JsonSchemaType {
    const references: Array<{ schema: JsonSchemaType; count: number }> = [];
    let enumCount = 0;
    const copy = (value: unknown): unknown => {
        if (Array.isArray(value)) return value.map(copy);
        if (value === null || typeof value !== "object") return value;
        const result = Object.fromEntries(
            Object.entries(value).map(([key, child]) => [key, copy(child)]),
        );
        if (Array.isArray(result.enum)) {
            enumCount += result.enum.length;
            if (referenceChoices.has(value))
                references.push({ schema: result, count: result.enum.length });
        }
        return result;
    };
    const result = copy(root) as JsonSchemaType;
    // Identity membership is also checked during hydration. Preserve structural
    // enums and relax only identity hints when the provider's schema budget is exceeded.
    references.sort((a, b) => b.count - a.count);
    for (const entry of references) {
        if (enumCount <= 1000) break;
        enumCount -= entry.count;
        delete entry.schema.enum;
    }
    if (enumCount > 1000)
        throw new Error(
            "View structured output schema exceeds the enum budget",
        );
    return result;
}
function schema(
    name: string,
    properties: Record<string, JsonSchemaType>,
): StructuredOutputJsonSchema {
    return { name, strict: true, schema: boundedEnums(object(properties)) };
}
export function createViewInventorySchema(
    passageIds: string[],
    sourceIds: string[],
): StructuredOutputJsonSchema {
    return schema("memory_source_fact_inventory", {
        items: array(
            object({
                key: text,
                kind: choice(factKinds),
                status: choice(factStatuses),
                statement: text,
                measurements: array(
                    object({ quantity: text, unit: text, context: text }),
                ),
                occurredAt: text,
                learnedAt: text,
                passageIds: array(reference(passageIds)),
            }),
        ),
        sourceDecisions: array(
            object({
                sourceId: reference(sourceIds),
                passageIds: array(reference(passageIds)),
                disposition: choice(sourceDispositions),
                itemKeys: array(text),
                reason: {
                    type: "string",
                    description:
                        "Required nonempty explanation for every disposition, including represented and metadata.",
                },
            }),
        ),
    });
}
export function createViewInventoryCheckSchema(
    itemIds: string[],
    decisionIds: string[],
    passageIds: string[],
    sourceIds: string[],
): StructuredOutputJsonSchema {
    return schema("memory_source_inventory_check", {
        supported: boolean,
        items: array(
            object({
                itemId: reference(itemIds),
                supported: boolean,
                reason: {
                    type: "string",
                    description:
                        "Required nonempty explanation, including when supported is true.",
                },
            }),
        ),
        decisions: array(
            object({
                decisionId: reference(decisionIds),
                supported: boolean,
                reason: {
                    type: "string",
                    description:
                        "Required nonempty explanation, including when supported is true.",
                },
            }),
        ),
        missingFacts: array(
            object({
                sourceId: reference(sourceIds),
                passageIds: array(reference(passageIds)),
                description: text,
            }),
        ),
        reasons: array(text),
    });
}
export function createInventoryConstructionSchema(
    itemIds: string[],
    kind: ViewKind = "troubleshootingGuide",
    recordIds: string[] = [],
    subjects?: WikiSubjectIdentity[],
): StructuredOutputJsonSchema {
    if (kind === "wiki")
        return schema("memory_wiki_construction", {
            content: object({
                title: text,
                summary: text,
                pages: array(
                    subjects?.length
                        ? {
                              anyOf: subjects.map((subject) =>
                                  object({
                                      id: choice([subject.pageId]),
                                      title: choice([subject.title]),
                                      taxonomy: choice([subject.taxonomy]),
                                      prose: text,
                                      inventoryIds: array(reference(itemIds)),
                                  }),
                              ),
                          }
                        : object({
                              id: text,
                              title: text,
                              taxonomy: choice(wikiTaxonomy),
                              prose: text,
                              inventoryIds: array(reference(itemIds)),
                          }),
                ),
            }),
            relationships: array(
                object({
                    from: text,
                    to: text,
                    predicate: choice(["relatedTo", "contradicts"]),
                }),
            ),
            outcome: choice(["knowledgePages"]),
            missingEvidence: array(text),
        });
    if (kind === "timeline")
        return schema("memory_timeline_construction", {
            content: object({
                title: text,
                summary: text,
                records: array(
                    object({
                        recordId: reference(recordIds),
                        prose: text,
                        inventoryIds: array(reference(itemIds)),
                    }),
                ),
            }),
            corrections: array(
                object({
                    from: reference(recordIds),
                    to: reference(recordIds),
                    predicate: choice(["corrects", "supersedes"]),
                }),
            ),
            outcome: choice(["chronology"]),
            missingEvidence: array(text),
        });
    const ids = array(reference(itemIds));
    const itemReference = { inventoryId: reference(itemIds) };
    const nullableText: JsonSchemaType = { anyOf: [text, { type: "null" }] };
    const details: JsonSchemaType = {
        anyOf: [
            object({ kind: choice(["goalsScope"]), inventoryIds: ids }),
            object({
                kind: choice(["owners"]),
                assignments: array(
                    object({
                        ...itemReference,
                        responsibility: text,
                        state: choice(["known", "unknown", "unassigned"]),
                        owner: nullableText,
                    }),
                ),
            }),
            object({
                kind: choice(["status"]),
                project: choice(["unknown", "active", "blocked", "complete"]),
                incident: choice([
                    "unknown",
                    "open",
                    "closed",
                    "notApplicable",
                ]),
                capacity: choice([
                    "unknown",
                    "pendingOwnerReview",
                    "validated",
                    "notApplicable",
                ]),
                inventoryIds: ids,
            }),
            object({
                kind: choice(["milestones"]),
                items: array(
                    object({
                        ...itemReference,
                        status: choice([
                            "proposed",
                            "confirmed",
                            "blocked",
                            "deferred",
                            "unknown",
                        ]),
                        date: nullableText,
                    }),
                ),
            }),
            object({
                kind: choice(["decisions"]),
                items: array(
                    object({ ...itemReference, status: choice(factStatuses) }),
                ),
            }),
            object({
                kind: choice(["risks"]),
                items: array(
                    object({
                        ...itemReference,
                        status: choice([
                            "open",
                            "blocked",
                            "resolved",
                            "unknown",
                        ]),
                    }),
                ),
            }),
            object({
                kind: choice(["context"]),
                asOf: nullableText,
                basis: choice(["unknown", "recordEvidence"]),
                inventoryIds: ids,
            }),
        ],
    };
    return schema(
        kind === "projectBrief"
            ? "memory_project_brief_construction"
            : "memory_inventory_guide_construction",
        {
            content: object({
                title: text,
                summary: text,
                sections: array(
                    object({
                        id: text,
                        role: choice(
                            kind === "projectBrief"
                                ? projectBriefRoles
                                : [
                                      "description",
                                      "prerequisites",
                                      "diagnostic",
                                      "guard",
                                      "verification",
                                      "recovery",
                                      "context",
                                  ],
                        ),
                        heading: text,
                        prose: text,
                        inventoryIds: array(reference(itemIds)),
                        ...(kind === "projectBrief" ? { details } : {}),
                    }),
                ),
            }),
            exclusions: array(
                object({
                    itemId: reference(itemIds),
                    reason: choice(["duplicate", "outsideScope"]),
                    duplicateOf: text,
                    justification: text,
                }),
            ),
            outcome: choice(
                kind === "projectBrief"
                    ? ["projectSummary"]
                    : ["diagnosticOnly", "verifiedRecovery"],
            ),
            missingEvidence: array(text),
        },
    );
}
export function createInventorySupportSchema(
    sectionIds: string[],
    edgeIds: string[],
    exclusionIds: string[],
): StructuredOutputJsonSchema {
    return schema("memory_inventory_artifact_support", {
        supported: boolean,
        sections: array(
            object({
                sectionId: reference(sectionIds),
                supported: boolean,
                reason: text,
            }),
        ),
        relationships: array(
            object({
                edgeId: reference(edgeIds),
                supported: boolean,
                reason: text,
            }),
        ),
        exclusions: array(
            object({
                itemId: reference(exclusionIds),
                supported: boolean,
                reason: text,
            }),
        ),
        missingContext: array(text),
        reasons: array(text),
    });
}
