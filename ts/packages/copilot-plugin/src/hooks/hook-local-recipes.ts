// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    UserPromptSubmittedInput,
    UserPromptSubmittedOutput,
} from "@typeagent/agent-harness-hooks/copilot-cli";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { callLocalRecipe } from "../shared/recipe-transport.js";

const matchOutcome = z.discriminatedUnion("status", [
    z.object({ status: z.literal("miss") }),
    z.object({ status: z.literal("ambiguous"), message: z.string() }),
    z.object({
        status: z.literal("handled"),
        result: z
            .object({
                status: z.enum(["completed", "failed", "cancelled"]),
                run: z
                    .object({ runId: z.string(), status: z.string() })
                    .passthrough(),
            })
            .passthrough(),
    }),
]);

export async function handleLocalRecipes(
    input: UserPromptSubmittedInput,
    signal: AbortSignal,
): Promise<UserPromptSubmittedOutput> {
    signal.throwIfAborted();
    const runId = randomUUID();
    const cancel = () => {
        void callLocalRecipe(input.cwd, input.sessionId, "cancelMacroRun", [
            runId,
        ]).catch((error) =>
            console.error(
                `[recipe] Cancellation ${runId} could not be confirmed: ${String(error)}`,
            ),
        );
    };
    signal.addEventListener("abort", cancel, { once: true });
    try {
        const outcome = matchOutcome.parse(
            await callLocalRecipe(input.cwd, input.sessionId, "matchAndRun", [
                input.prompt,
                runId,
            ]),
        );
        if (outcome.status === "miss") return {};
        return {
            handled: true,
            handledBy: "typeagent",
            responseContent:
                outcome.status === "ambiguous"
                    ? outcome.message
                    : JSON.stringify(outcome.result, null, 2),
        };
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT")
            return {
                additionalContext:
                    "The plugin-local recipe owner is not connected to this native session. No saved recipe was accepted. Continue the task natively; recipe matching and learning are unavailable until the native extension is restarted.",
            };
        return {
            handled: true,
            handledBy: "typeagent",
            responseContent: `Local recipe routing failed. Do not repeat the task automatically; reconcile run ${runId}. ${error instanceof Error ? error.message : String(error)}`,
        };
    } finally {
        signal.removeEventListener("abort", cancel);
    }
}
