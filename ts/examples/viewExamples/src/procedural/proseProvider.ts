// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { readFile } from "node:fs/promises";
import type { ChatModel } from "@typeagent/aiclient";
import {
    viewExtensionDigest,
    type ViewExtensionProvider,
    type ViewJsonValue,
} from "@typeagent/memory-service";
import { hostContext } from "./provider.js";
import { procedurePayloadSchema, ProcedureContractError } from "./contract.js";
import {
    jsonCandidate,
    parseAssessment,
    parseExtraction,
    proseOutputSchema,
    prosePacket,
    ProcedureExtractionRejection,
    renderProseProcedure,
    validateProseContent,
    structuredProseSchema,
} from "./proseContract.js";

export const proseProviderId = "typeagent-support-procedure-prose";

function isChatModel(value: unknown): value is ChatModel {
    return (
        !!value &&
        typeof value === "object" &&
        "complete" in value &&
        typeof value.complete === "function" &&
        "completionSettings" in value &&
        !!value.completionSettings &&
        typeof value.completionSettings === "object"
    );
}

function approvedModel(value: unknown): {
    model: ChatModel;
    modelIdentity: string;
} {
    if (
        !value ||
        typeof value !== "object" ||
        !("approvedModelWork" in value) ||
        value.approvedModelWork !== true ||
        !("model" in value) ||
        !isChatModel(value.model) ||
        !("modelIdentity" in value) ||
        typeof value.modelIdentity !== "string" ||
        !/^[a-f0-9]{64}$/.test(value.modelIdentity)
    )
        throw new Error(
            "Prose provider requires explicit model-work approval, injected model and pinned model identity",
        );
    return {
        model: value.model,
        modelIdentity: value.modelIdentity,
    };
}

export async function createProseProcedureProvider(
    context: unknown,
): Promise<ViewExtensionProvider> {
    const host = hostContext(context);
    const approved = approvedModel(context);
    const assets = [
        "proseProvider.js",
        "proseContract.js",
        "provider.js",
        "contract.js",
        "extractionSchema.ts",
        "proseRecipe.txt",
    ];
    const bytes = await Promise.all(
        assets.map((asset) =>
            readFile(new URL(`./${asset}`, import.meta.url), "utf8"),
        ),
    );
    const schema = bytes[4];
    const recipe = bytes[5];
    const outputSchema = proseOutputSchema(procedurePayloadSchema);
    if (
        outputSchema.type !== "object" ||
        outputSchema.properties.extraction.type !== "object"
    )
        throw new Error(
            "Prose output schema requires a bounded extraction proof",
        );
    const proofSchema = outputSchema.properties.extraction;
    const extractionSchema = structuredProseSchema(
        "ProcedureExtraction",
        proofSchema.properties.candidate,
    );
    const assessmentSchema = structuredProseSchema(
        "ProcedureAssessment",
        proofSchema.properties.assessment,
    );
    const provider: ViewExtensionProvider = {
        model: approved.model,
        descriptor: {
            apiVersion: 1,
            label: "Source-grounded procedure from prose (approved model work)",
            modelIdentity: approved.modelIdentity,
            identity: {
                providerId: proseProviderId,
                version: "1",
                implementationDigest: viewExtensionDigest(bytes.slice(0, 4)),
                inputContract: "procedure-prose-passages-v1",
                outputContract: "support-procedure-graph-v6",
                schemaDigest: viewExtensionDigest(outputSchema),
                recipeDigest: viewExtensionDigest([schema, recipe]),
            },
            outputSchema,
            definitions: [
                {
                    id: "support-procedure",
                    eligibilityVersion: "1",
                    mode: "static",
                },
            ],
            limits: {
                maxSources: 1,
                maxInputChars: 120000,
                maxOutputChars: 1000000,
                maxModelCalls: 4,
                timeoutMs: 600000,
            },
        },
        authorize: async (snapshot, operation) =>
            snapshot.corpusId === host.corpusId &&
            snapshot.inputs.length === 1 &&
            host.sourceIds.includes(snapshot.inputs[0].sourceId) &&
            (await host.authorize(snapshot, operation)),
        evaluateEligibility: async (snapshot) => {
            prosePacket(snapshot);
            return {
                disposition: "eligible",
                reason: "Complete retained prose admitted; static eligibility uses no model",
            };
        },
        prepare: async (snapshot) => jsonCandidate(prosePacket(snapshot)),
        generate: async (snapshot, _prepared, execution) => {
            const packet = prosePacket(snapshot);
            let feedback: ViewJsonValue = null;
            for (let round = 0; round < 2; round++) {
                await execution.assertEligible?.();
                const output = await execution.complete(
                    `procedure-extraction-${round}`,
                    [
                        {
                            role: "system",
                            content: `${recipe}\nReturn ProcedureExtraction.\n${schema}`,
                        },
                        {
                            role: "user",
                            content: JSON.stringify({
                                packet,
                                repairFeedback: feedback,
                            }),
                        },
                    ],
                    extractionSchema,
                );
                await execution.recordCandidate?.(
                    `procedure-extraction-response-${round}`,
                    { output },
                );
                try {
                    const candidate = parseExtraction(
                        JSON.parse(output),
                        packet,
                    );
                    await execution.recordCandidate?.(
                        `procedure-extraction-candidate-${round}`,
                        jsonCandidate(candidate),
                    );
                    const checked = await execution.complete(
                        `procedure-check-${round}`,
                        [
                            {
                                role: "system",
                                content: `${recipe}\nIndependently check the candidate against the original packet. Return ProcedureAssessment.\n${schema}`,
                            },
                            {
                                role: "user",
                                content: JSON.stringify({ packet, candidate }),
                            },
                        ],
                        assessmentSchema,
                    );
                    await execution.recordCandidate?.(
                        `procedure-check-response-${round}`,
                        { output: checked },
                    );
                    const assessment = parseAssessment(
                        JSON.parse(checked),
                        packet,
                    );
                    const content = renderProseProcedure(
                        snapshot,
                        provider.descriptor.identity,
                        candidate,
                        assessment,
                    );
                    await execution.checkpoint("procedure-model-accepted", {
                        inputFingerprint: snapshot.fingerprint,
                        candidateDigest: viewExtensionDigest(candidate),
                        assessmentDigest: viewExtensionDigest(assessment),
                        humanReview: "pending",
                    });
                    return content;
                } catch (error) {
                    if (
                        !(
                            error instanceof SyntaxError ||
                            error instanceof ProcedureContractError ||
                            error instanceof ProcedureExtractionRejection
                        )
                    )
                        throw error;
                    feedback = {
                        reason: error.message,
                        previousOutput: output,
                    };
                    await execution.checkpoint(
                        `procedure-rejected-${round}`,
                        feedback,
                    );
                    if (round === 1)
                        throw new ProcedureExtractionRejection(
                            `Bounded procedure repair exhausted: ${error.message}`,
                        );
                }
            }
            throw new Error("Unreachable procedure extraction state");
        },
        validateContent: (snapshot, content) =>
            validateProseContent(
                snapshot,
                provider.descriptor.identity,
                content,
            ),
    };
    return provider;
}
