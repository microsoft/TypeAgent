// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { CommandHandlerContext } from "../../commandHandlerContext.js";
import { openai as ai } from "aiclient";
import {
    ActionContext,
    CompletionDirection,
    CompletionGroups,
    ParsedCommandParams,
    SessionContext,
} from "@typeagent/agent-sdk";
import { CommandHandler } from "@typeagent/agent-sdk/helpers/command";
import { displayResult } from "@typeagent/agent-sdk/helpers/display";
import { getColorElapsedString } from "@typeagent/common-utils";
import { translateRequest } from "../../../translation/translateRequest.js";
import { requestCompletion } from "../../../translation/requestCompletion.js";
import { createHistoryContext } from "../../../translation/interpretRequest.js";

export class TranslateCommandHandler implements CommandHandler {
    public readonly description = "Translate a request";
    public readonly parameters = {
        args: {
            request: {
                description: "Request to translate",
                implicitQuotes: true,
            },
        },
        flags: {
            history: {
                description: "Use history in translation",
                default: false,
            },
        },
    } as const;
    public async run(
        context: ActionContext<CommandHandlerContext>,
        params: ParsedCommandParams<typeof this.parameters>,
    ) {
        const tokenUsage: ai.CompletionUsageStats = {
            completion_tokens: 0,
            prompt_tokens: 0,
            total_tokens: 0,
        };

        const usageCallback = (usage: ai.CompletionUsageStats) => {
            tokenUsage.completion_tokens += usage.completion_tokens;
            tokenUsage.prompt_tokens += usage.prompt_tokens;
            tokenUsage.total_tokens += usage.total_tokens;
        };
        const translationResult = await translateRequest(
            context,
            params.args.request,
            params.flags.history
                ? createHistoryContext(context.sessionContext.agentContext)
                : undefined,
            undefined,
            undefined,
            undefined,
            usageCallback,
        );

        const elapsedStr = getColorElapsedString(translationResult.elapsedMs);
        const usageStr = tokenUsage
            ? `(Tokens: ${tokenUsage.prompt_tokens} + ${tokenUsage.completion_tokens} = ${tokenUsage.total_tokens})`
            : "";
        displayResult(
            `${translationResult.requestAction} ${elapsedStr}${usageStr}\n\nJSON:\n${JSON.stringify(
                translationResult.requestAction.actions,
                undefined,
                2,
            )}`,
            context,
        );
    }
    public async getCompletion(
        context: SessionContext<CommandHandlerContext>,
        params: ParsedCommandParams<typeof this.parameters>,
        names: string[],
        direction?: CompletionDirection,
    ): Promise<CompletionGroups> {
        const result: CompletionGroups = { groups: [] };
        for (const name of names) {
            if (name === "request") {
                const input = params.args.request ?? "";
                const requestResult = await requestCompletion(
                    input,
                    context.agentContext,
                    direction,
                );
                result.groups.push(...requestResult.groups);
                result.matchedPrefixLength = requestResult.matchedPrefixLength;
                result.closedSet = requestResult.closedSet;
                result.directionSensitive = requestResult.directionSensitive;
                result.afterWildcard = requestResult.afterWildcard;
            }
        }
        return result;
    }
}
