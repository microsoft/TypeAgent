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
import type { ViewKind, ViewFactInventory } from "./viewTypes.js";
import { projectBriefRoles, projectFieldStates } from "./projectBrief.js";
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
function ownerResponsibilityChoices(
    item: ViewFactInventory["items"][number],
): string[] {
    const quoted = [...item.statement.matchAll(/[`"]([^`"\r\n]+)[`"]/g)]
        .map((match) => match[1])
        .filter((phrase) =>
            item.citations.some((citation) =>
                citation.excerpt.includes(phrase),
            ),
        );
    if (quoted.length) return [...new Set(quoted)].slice(0, 16);
    const words = [...item.statement.matchAll(/\S+/g)];
    for (let size = 5; size >= 1; size--) {
        const choices = words.flatMap((word, i) => {
            const last = words[i + size - 1];
            if (!last) return [];
            const phrase = item.statement
                .slice(word.index, last.index + last[0].length)
                .replace(/^[`"'(]+|[`"',.;:!)]+$/g, "");
            return /\p{L}/u.test(phrase) &&
                item.citations.some((citation) =>
                    citation.excerpt.includes(phrase),
                )
                ? [phrase]
                : [];
        });
        if (choices.length) return [...new Set(choices)].slice(0, 16);
    }
    throw new Error(
        "Checked owner fact has no exact shared responsibility phrase",
    );
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
    inventory?: ViewFactInventory,
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
    const referenceKind = (
        kind: ViewFactInventory["items"][number]["kind"],
    ) => ({
        inventoryId: reference(
            inventory?.items
                .filter((item) => item.kind === kind)
                .map((item) => item.id) ?? itemIds,
        ),
    });
    const hasAsOf = inventory?.items.some(
        (item) => item.kind === "projectAsOf" && item.status === "confirmed",
    );
    const ownerFacts = inventory?.items.filter((item) => item.kind === "owner");
    const ownerSchemas = ownerFacts?.length
        ? ownerFacts.map((item) => {
              const unassigned =
                  item.status === "confirmed" &&
                  [
                      item.statement,
                      ...item.citations.map((citation) => citation.excerpt),
                  ].some((value) =>
                      /\b(?:owner(?:ship)?(?:\s+is|\s*:)?\s+unassigned|no owner(?:\s+is)?\s+assigned|has no owner)\b/i.test(
                          value,
                      ),
                  );
              const names = [
                  ...item.statement.matchAll(
                      /\b[A-Z][\p{L}'-]+(?: [A-Z][\p{L}'-]+){1,3}\b|<[^<>\s]+>/gu,
                  ),
              ]
                  .map((match) => match[0])
                  .filter((name) =>
                      item.citations.some((citation) =>
                          citation.excerpt.includes(name),
                      ),
                  );
              const known = item.status === "confirmed" && !unassigned;
              if (known && !names.length)
                  throw new Error(
                      "Confirmed owner fact requires an exact recorded person or accountable role",
                  );
              return object({
                  inventoryId: reference([item.id]),
                  responsibility: choice(ownerResponsibilityChoices(item)),
                  state: choice([
                      known ? "known" : unassigned ? "unassigned" : "unknown",
                  ]),
                  owner: known
                      ? names.length
                          ? choice([...new Set(names)])
                          : text
                      : { type: "null" },
              });
          })
        : undefined;
    const nullableText: JsonSchemaType = { anyOf: [text, { type: "null" }] };
    const stateChoice = (
        kind: "projectStatus" | "incidentStatus" | "capacity",
        states: readonly string[],
    ) => {
        const supported = inventory
            ? projectFieldStates(inventory.items, kind, states)
            : [];
        return choice(supported.length ? supported : states);
    };
    const details: JsonSchemaType = {
        anyOf: [
            object({ kind: choice(["goalsScope"]), inventoryIds: ids }),
            object({
                kind: choice(["owners"]),
                assignments: array({
                    anyOf: ownerSchemas ?? [
                        object({
                            ...referenceKind("owner"),
                            responsibility: text,
                            state: choice(["known"]),
                            owner: text,
                        }),
                        object({
                            ...referenceKind("owner"),
                            responsibility: text,
                            state: choice(["unknown", "unassigned"]),
                            owner: { type: "null" },
                        }),
                    ],
                }),
            }),
            object({
                kind: choice(["status"]),
                project: stateChoice("projectStatus", [
                    "unknown",
                    "active",
                    "blocked",
                    "complete",
                ]),
                incident: stateChoice("incidentStatus", [
                    "unknown",
                    "open",
                    "closed",
                    "notApplicable",
                ]),
                capacity: stateChoice("capacity", [
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
                        ...referenceKind("milestone"),
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
                    object({
                        ...referenceKind("decision"),
                        status: choice(factStatuses),
                    }),
                ),
            }),
            object({
                kind: choice(["risks"]),
                items: array(
                    object({
                        ...referenceKind("risk"),
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
                asOf:
                    inventory && !hasAsOf
                        ? { type: "null" }
                        : hasAsOf
                          ? text
                          : nullableText,
                basis: choice(
                    inventory
                        ? [hasAsOf ? "recordEvidence" : "unknown"]
                        : ["unknown", "recordEvidence"],
                ),
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
