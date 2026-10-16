// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import path from "node:path";
import type {
    MacroChildCapture,
    MacroLearningMode,
    RecordedInteractionTrace,
    RecordingToken,
} from "./contracts.js";
import { assertLearningTrace } from "./macroLearningValidation.js";
import { sealRecipeAuthoringContext } from "./recipeAuthoring.js";

export function sealMacroChildCapture(
    traceId: string,
    trace: RecordedInteractionTrace,
    token: RecordingToken,
    boundary: MacroChildCapture,
    mode: MacroLearningMode,
    retainedTrace = trace,
) {
    assertLearningTrace(trace);
    for (const value of Object.values(boundary))
        if (typeof value !== "string" || !value.trim() || value.length > 4096)
            throw new Error(
                "Explicit selected task/output event identities are required.",
            );
    if (
        boundary.firstEventId === boundary.successEventId ||
        boundary.successEventId === boundary.outputEventId ||
        boundary.recordingTokenId !== token.id ||
        boundary.taskId !== `${trace.sessionId}:${boundary.firstEventId}`
    )
        throw new Error(
            "The successful output does not correlate to the selected task.",
        );
    const scope = {
        workspaceId: path.resolve(trace.cwd).toLowerCase(),
        profileId: "typeagent",
    };
    const outputId = `${traceId}:final-output`;
    return sealRecipeAuthoringContext(
        {
            capture: {
                captureId: traceId,
                tokenId: token.id,
                sessionId: trace.sessionId,
                taskId: boundary.taskId,
                boundary: {
                    firstEventId: boundary.firstEventId,
                    lastEventId: boundary.outputEventId,
                },
                origin: "task",
                outcome: "succeeded",
                scope,
                mode,
                request: retainedTrace.prompt,
                decisionSummary:
                    "The parent explicitly attested task success in a token-bound receipt, followed by a final answer; all captured calls completed successfully. Author from explicit evidence; no hidden reasoning is assumed.",
                contextArtifacts: retainedTrace.toolCalls.flatMap((call) =>
                    [call.resultArtifact, call.modelResultArtifact].flatMap(
                        (reference) =>
                            reference
                                ? [
                                      {
                                          reference,
                                          scope,
                                          taskId: boundary.taskId,
                                      },
                                  ]
                                : [],
                    ),
                ),
                omissions: [
                    "No hidden reasoning or inherited conversation is included.",
                ],
                outputEvidenceIds: [outputId],
                calls: trace.toolCalls.map((call) => ({
                    callId: call.toolCallId,
                    executionOwner: "host",
                })),
            },
            constraints: [
                "No business tools, credentials or recursive authorship.",
                "Return only the requested bounded candidate; TypeAgent validates and publishes it.",
            ],
            messages: [
                {
                    eventId: boundary.firstEventId,
                    role: "user",
                    content: retainedTrace.prompt,
                },
                ...retainedTrace.toolCalls.map((call) => ({
                    eventId: `${traceId}:tool:${call.toolCallId}`,
                    role: "tool" as const,
                    callId: call.toolCallId,
                    content: JSON.stringify({
                        toolCallId: call.toolCallId,
                        name: call.name,
                        mcpServerName: call.mcpServerName,
                        arguments: call.arguments,
                        status: call.status,
                        resultArtifact: call.resultArtifact,
                        modelResultArtifact: call.modelResultArtifact,
                    }),
                })),
                {
                    eventId: boundary.successEventId,
                    role: "tool",
                    content: {
                        status: "succeeded",
                        recordingTokenId: token.id,
                    },
                },
                {
                    eventId: boundary.outputEventId,
                    role: "assistant",
                    content: retainedTrace.response,
                },
            ],
            workingCode: [],
            capabilities: [],
            outputs: [
                {
                    id: outputId,
                    eventId: boundary.outputEventId,
                    evidence: { modelVisible: retainedTrace.response },
                },
            ],
            omissions: [
                {
                    material: "Hidden reasoning and earlier unrelated turns",
                    reason: "Not supported or needed.",
                    required: false,
                },
                {
                    material: "Working source code",
                    reason: "This MCP recording contains operations/results, not retained source. Generate and validate a program.",
                    required: false,
                },
                {
                    material: "Tool schemas",
                    reason: "TypeAgent supplies freshly inspected schemas in the scoped program-authoring request.",
                    required: false,
                },
            ],
        },
        {
            token,
            taskId: boundary.taskId,
            selectedTaskId: boundary.taskId,
            sessionId: trace.sessionId,
            origin: "task",
            outcome: "succeeded",
            successEventId: boundary.successEventId,
            now: trace.completedAt,
        },
    );
}
