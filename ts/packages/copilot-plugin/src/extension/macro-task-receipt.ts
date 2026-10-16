// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { defineTool } from "@github/copilot-sdk";
import type { RecordingState } from "@typeagent/copilot-macros";

/**
 * Records the caller's success attestation, not an independent correctness
 * judgment. The assembler must bind the actual root tool-completion event and
 * subsequent final answer to this token; idle alone is not a success receipt.
 */
export function createMacroTaskReceiptTool(
    getRecordingState: () => Promise<RecordingState>,
) {
    return defineTool<{ summary: string }>(
        "typeagent_recorded_task_succeeded",
        {
            description:
                "Attest that the selected recorded learning task succeeded. " +
                "Call exactly once, only after successful completion and before " +
                "the final answer. This records your attestation; it does not " +
                "independently verify task correctness or perform any business action.",
            parameters: {
                type: "object",
                properties: {
                    summary: {
                        type: "string",
                        minLength: 1,
                        maxLength: 1024,
                        description:
                            "Brief success summary without credentials or sensitive details.",
                    },
                },
                required: ["summary"],
                additionalProperties: false,
            },
            handler: async (input, invocation) => {
                if (
                    typeof input !== "object" ||
                    input === null ||
                    typeof input.summary !== "string" ||
                    input.summary.trim().length === 0 ||
                    input.summary.length > 1024 ||
                    Object.keys(input).some((key) => key !== "summary")
                ) {
                    throw new Error(
                        "Success receipt requires only a nonempty summary of at most 1024 characters.",
                    );
                }
                invocation.signal?.throwIfAborted();
                const state = await getRecordingState();
                invocation.signal?.throwIfAborted();
                const token = state.token;
                if (
                    state.status !== "claimed" ||
                    token?.status !== "claimed" ||
                    token.learning !== true ||
                    token.sessionId !== invocation.sessionId ||
                    typeof token.id !== "string" ||
                    token.id.trim().length === 0 ||
                    typeof token.promptHash !== "string" ||
                    token.promptHash.trim().length === 0
                ) {
                    throw new Error(
                        "Success receipt requires this session's claimed learning token with a prompt hash.",
                    );
                }
                return {
                    resultType: "success",
                    textResultForLlm: JSON.stringify({
                        status: "succeeded",
                        recordingTokenId: token.id,
                        promptHash: token.promptHash,
                    }),
                };
            },
        },
    );
}
