// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { MacroLearningMode } from "@typeagent/copilot-macros";
import type { AgentServerConnection } from "@typeagent/agent-server-client";
import { connectToAgentServer } from "./typeagent-client.js";

export function parseLearningMode(value: string): MacroLearningMode {
    switch (value.trim().toLowerCase()) {
        case "off":
            return "off";
        case "prepare":
            return "prepare";
        case "read-only":
            return "read-only";
        case "all":
            return "all";
        default:
            throw new Error(
                "Macro learning must be off, prepare, read-only, or all.",
            );
    }
}

export async function learningSetting(
    cwd: string,
    value?: string,
): Promise<string> {
    const connection = await connectToAgentServer();
    try {
        const preference = value?.trim()
            ? await connection.setMacroLearningPreference({
                  cwd,
                  mode: parseLearningMode(value),
              })
            : await connection.getMacroLearningPreference(cwd);
        return `Macro learning: ${preference.mode} (${preference.cwd}). Approval of a saved macro does not grant tool permissions.`;
    } finally {
        await connection.close();
    }
}

export async function cancelMacroWork(
    sessionId: string,
    connect: () => Promise<
        Pick<
            AgentServerConnection,
            | "getMacroRecordingState"
            | "cancelMacroLearningJob"
            | "cancelMacroRecording"
            | "close"
        >
    > = connectToAgentServer,
): Promise<string> {
    const connection = await connect();
    try {
        const state = await connection.getMacroRecordingState(sessionId);
        const job = state.learningJob;
        if (job && !["ready", "failed", "cancelled"].includes(job.status)) {
            await connection.cancelMacroLearningJob(job.jobId);
        }
        await connection.cancelMacroRecording(sessionId);
        return "Macro recording/preparation cancelled. Approved macros are unchanged.";
    } finally {
        await connection.close();
    }
}
