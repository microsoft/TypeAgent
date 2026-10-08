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
export const viewContextTopics = [
    "goalApplicability",
    "prerequisites",
    "diagnosticTrajectory",
    "attemptedRejectedDeferred",
    "causalEvidence",
    "verificationRecovery",
    "authoritySimulation",
    "rollbackEscalation",
    "reuseProjectStatus",
    "temporalUncertainty",
] as const;

function references(passageIds: string[]): JsonSchemaType {
    return array(object({ passageId: { type: "string", enum: passageIds } }));
}

export function createViewConstructionSchema(
    passageIds: string[],
): StructuredOutputJsonSchema {
    const citations = references(passageIds);
    return {
        name: "memory_troubleshooting_construction",
        strict: true,
        schema: object({
            content: object({
                kind: { type: "string", enum: ["troubleshootingGuide"] },
                title: text,
                summary: text,
                sections: array(section),
                citations,
            }),
            relationships: array(
                object({ id: text, sectionId: text, citations }),
            ),
            outcome: {
                type: "string",
                enum: ["diagnosticOnly", "verifiedRecovery"],
            },
            missingEvidence: array(text),
        }),
    };
}

export function createViewSupportSchema(
    passageIds: string[],
    sourceIds: string[],
    guidePassageIds: string[],
): StructuredOutputJsonSchema {
    return {
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
            sourceChecks: array(
                object({
                    sourceId: { type: "string", enum: sourceIds },
                    reason: text,
                    requiredFindings: array(
                        object({
                            passageId: { type: "string", enum: passageIds },
                            claim: text,
                            covered: boolean,
                            sectionIds: array(text),
                            guidePassageIds: array({
                                type: "string",
                                enum: guidePassageIds,
                            }),
                        }),
                    ),
                }),
            ),
            contextChecks: array(
                object({
                    topic: { type: "string", enum: [...viewContextTopics] },
                    supported: boolean,
                    reason: text,
                    citations: references(passageIds),
                    sectionIds: array(text),
                    guidePassageIds: array({
                        type: "string",
                        enum: guidePassageIds,
                    }),
                }),
            ),
            missingContext: array(text),
            reasons: array(text),
        }),
    };
}
