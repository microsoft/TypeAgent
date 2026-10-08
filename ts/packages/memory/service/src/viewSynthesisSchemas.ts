// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    JsonSchemaType,
    StructuredOutputJsonSchema,
} from "@typeagent/aiclient";

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
const citation = object({
    sourceId: text,
    revisionId: text,
    locator: text,
    excerpt: text,
});
const section = object({
    id: text,
    role: {
        type: "string",
        enum: [
            "description",
            "prerequisites",
            "diagnostic",
            "guard",
            "verification",
            "recovery",
            "context",
        ],
    },
    heading: text,
    body: text,
});
const relationship = object({
    id: text,
    predicate: { type: "string", enum: ["supportedBy"] },
    from: object({
        kind: { type: "string", enum: ["section"] },
        viewId: text,
        sectionId: text,
    }),
    to: object({
        kind: { type: "string", enum: ["source"] },
        sourceId: text,
        revisionId: text,
    }),
    citations: array(citation),
});

export const viewConstructionSchema: StructuredOutputJsonSchema = {
    name: "memory_troubleshooting_construction",
    strict: true,
    schema: object({
        content: object({
            kind: { type: "string", enum: ["troubleshootingGuide"] },
            title: text,
            summary: text,
            sections: array(section),
            citations: array(citation),
        }),
        relationships: array(relationship),
        outcome: {
            type: "string",
            enum: ["diagnosticOnly", "verifiedRecovery"],
        },
        missingEvidence: array(text),
    }),
};

export const viewSupportSchema: StructuredOutputJsonSchema = {
    name: "memory_troubleshooting_evidence_audit",
    strict: true,
    schema: object({
        supported: boolean,
        sections: array(
            object({ sectionId: text, supported: boolean, reason: text }),
        ),
        relationships: array(
            object({ edgeId: text, supported: boolean, reason: text }),
        ),
        missingContext: array(text),
        reasons: array(text),
    }),
};
