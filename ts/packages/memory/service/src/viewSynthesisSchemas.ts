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
function schema(
    name: string,
    properties: Record<string, JsonSchemaType>,
): StructuredOutputJsonSchema {
    return { name, strict: true, schema: object(properties) };
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
                passageIds: array(choice(passageIds)),
            }),
        ),
        sourceDecisions: array(
            object({
                sourceId: choice(sourceIds),
                passageIds: array(choice(passageIds)),
                disposition: choice(sourceDispositions),
                itemKeys: array(text),
                reason: text,
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
                itemId: choice(itemIds),
                supported: boolean,
                reason: text,
            }),
        ),
        decisions: array(
            object({
                decisionId: choice(decisionIds),
                supported: boolean,
                reason: text,
            }),
        ),
        missingFacts: array(
            object({
                sourceId: choice(sourceIds),
                passageIds: array(choice(passageIds)),
                description: text,
            }),
        ),
        reasons: array(text),
    });
}
export function createInventoryConstructionSchema(
    itemIds: string[],
): StructuredOutputJsonSchema {
    return schema("memory_inventory_guide_construction", {
        content: object({
            title: text,
            summary: text,
            sections: array(
                object({
                    id: text,
                    role: choice([
                        "description",
                        "prerequisites",
                        "diagnostic",
                        "guard",
                        "verification",
                        "recovery",
                        "context",
                    ]),
                    heading: text,
                    prose: text,
                    inventoryIds: array(choice(itemIds)),
                }),
            ),
        }),
        exclusions: array(
            object({
                itemId: choice(itemIds),
                reason: choice(["duplicate", "outsideScope"]),
                duplicateOf: text,
                justification: text,
            }),
        ),
        outcome: choice(["diagnosticOnly", "verifiedRecovery"]),
        missingEvidence: array(text),
    });
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
                sectionId: choice(sectionIds),
                supported: boolean,
                reason: text,
            }),
        ),
        relationships: array(
            object({
                edgeId: choice(edgeIds),
                supported: boolean,
                reason: text,
            }),
        ),
        exclusions: array(
            object({
                itemId: exclusionIds.length ? choice(exclusionIds) : text,
                supported: boolean,
                reason: text,
            }),
        ),
        missingContext: array(text),
        reasons: array(text),
    });
}
