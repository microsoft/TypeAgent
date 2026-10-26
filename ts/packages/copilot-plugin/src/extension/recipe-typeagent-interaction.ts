// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    RecipeBindingScope,
    RecipeCallContext,
} from "@typeagent/copilot-macros/recipeCore";
import type { StructuredActionResponse } from "@typeagent/dispatcher-types";
import {
    captureNativeRecipeBinding,
    normalizeNativeRecipeResult,
    sameNativeRecipeBinding,
    type NativeRecipeSession,
} from "./recipe-native-host.js";
import type { TypeAgentRecipeInteraction } from "./recipe-typeagent-host.js";

function assertReadOnlyConfirmation(prompt: object): void {
    if (
        !("contract" in prompt) ||
        !prompt.contract ||
        typeof prompt.contract !== "object" ||
        !("policy" in prompt.contract) ||
        !prompt.contract.policy ||
        typeof prompt.contract.policy !== "object" ||
        !("effects" in prompt.contract.policy) ||
        prompt.contract.policy.effects !== "read-only"
    )
        throw new Error(
            "The pending action is not read-only. No confirmation response was sent.",
        );
}

/** Only the native user's answer can produce a continuation, never guest code. */
export function createNativeTypeAgentInteraction(
    session: NativeRecipeSession,
    binding: RecipeBindingScope,
): TypeAgentRecipeInteraction {
    return async (text, context) => {
        const prompt: unknown = JSON.parse(text);
        if (!prompt || typeof prompt !== "object" || !("type" in prompt))
            throw new Error(
                "Malformed TypeAgent interaction; do not replay the action.",
            );
        let choices: string[];
        let response: (index: number) => StructuredActionResponse;
        switch (prompt.type) {
            case "confirmation":
                assertReadOnlyConfirmation(prompt);
                choices = ["Approve this action", "Decline this action"];
                response = (index) => ({
                    type: "confirmation",
                    approved: index === 0,
                });
                break;
            case "question": {
                if (
                    !("choices" in prompt) ||
                    !Array.isArray(prompt.choices) ||
                    !prompt.choices.length ||
                    prompt.choices.length > 32 ||
                    !prompt.choices.every(
                        (choice) => typeof choice === "string",
                    )
                )
                    throw new Error(
                        "Unsupported TypeAgent question; do not replay the action.",
                    );
                choices = prompt.choices.map(
                    (choice, index) => `${index + 1}. ${choice}`,
                );
                response = (selected) => ({ type: "question", selected });
                break;
            }
            case "yesNo":
                choices = ["Yes", "No"];
                response = (index) => ({ type: "yesNo", value: index === 0 });
                break;
            default:
                throw new Error(
                    "This TypeAgent interaction requires a richer host UI. No response was invented; do not replay the action.",
                );
        }
        choices.push("Cancel this action");
        await assertBinding(session, binding, context);
        const { tools } = await session.rpc.tools.getCurrentMetadata();
        const matches = (tools ?? []).filter(
            (tool) => !tool.mcpServerName && tool.name === "ask_user",
        );
        if (matches.length !== 1)
            throw new Error(
                "Native user input is unavailable; the action remains paused. Do not replay.",
            );
        // This uses the normal host UI, hooks and tool dispatch, not model text.
        const result = await session.rpc.tools.execute({
            name: matches[0].name,
            arguments: { question: text, choices, allowFreeform: false },
            toolCallId: `${context.callId}:user-input`,
        });
        await assertBinding(session, binding, context);
        if (
            !result ||
            typeof result !== "object" ||
            !("resultType" in result) ||
            result.resultType !== "success"
        )
            throw new Error(
                "Native user input did not complete; no TypeAgent response was sent.",
            );
        const value = normalizeNativeRecipeResult(result);
        const answer =
            typeof value === "string"
                ? value
                : value && typeof value === "object" && !Array.isArray(value)
                  ? value.answer
                  : undefined;
        const selected = choices.findIndex((choice) => choice === answer);
        if (selected < 0)
            throw new Error(
                "Native user input did not identify an exact choice; no default was used.",
            );
        return selected === choices.length - 1
            ? { source: "user", cancelled: true }
            : { source: "user", response: response(selected) };
    };
}

async function assertBinding(
    session: NativeRecipeSession,
    binding: RecipeBindingScope,
    context: RecipeCallContext,
) {
    context.signal.throwIfAborted();
    if (
        !sameNativeRecipeBinding(binding, context.binding) ||
        !sameNativeRecipeBinding(
            binding,
            await captureNativeRecipeBinding(session, binding.profileId),
        )
    )
        throw new Error(
            "Native user interaction binding changed; no answer was dispatched.",
        );
}
