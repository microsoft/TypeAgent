// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    CommandHandlerNoParams,
    CommandHandlerTable,
} from "@typeagent/agent-sdk/helpers/command";
import { CommandHandlerContext } from "./common/commandHandlerContext.js";
import { ActionContext } from "@typeagent/agent-sdk";
import {
    displayStatus,
    displaySuccess,
} from "@typeagent/agent-sdk/helpers/display";
import { TokenCounter, openai } from "aiclient";
import { CompletionUsageStats } from "../../../aiclient/dist/openai.js";

class TokenSummaryCommandHandler implements CommandHandlerNoParams {
    public readonly description = "Get overall LLM usage statistics.";

    public async run(context: ActionContext<CommandHandlerContext>) {
        const total: openai.CompletionUsageStats =
            TokenCounter.getInstance().total;
        const avg: openai.CompletionUsageStats =
            TokenCounter.getInstance().average;
        const max: openai.CompletionUsageStats =
            TokenCounter.getInstance().maximum;

        displaySuccess(
            [
                `Total [in-process] Token Count\n------------------\nPrompt Tokens: ${total.prompt_tokens}\nCompletion Tokens: ${total.completion_tokens}\nTotal: ${total.total_tokens}\n`,
                `Token Averages\n------------------\nPrompt: ${avg.prompt_tokens.toFixed(0)}\nCompletion: ${avg.completion_tokens.toFixed(0)}\nTotal: ${avg.total_tokens.toFixed(0)}\n`,
                `Largest LLM Call\n------------------\nPrompt: ${max.prompt_tokens}\nCompletion: ${max.completion_tokens}\nTotal: ${max.total_tokens}`,
                `\n'@token details' for more.`,
            ],
            context,
        );
    }
}

class TokenDetailsCommandHandler implements CommandHandlerNoParams {
    public readonly description = "Gets detailed LLM usage statistics.";

    public async run(context: ActionContext<CommandHandlerContext>) {
        let retValue: string[] = [];
        TokenCounter.getInstance().tags.map((t) => {
            const tokens: CompletionUsageStats =
                TokenCounter.getInstance().getTokenUsage(t)!;
            retValue.push(
                `#${t}\n------------------\nPrompt: ${tokens.prompt_tokens}\nCompletion: ${tokens.completion_tokens}\nTotal: ${tokens.total_tokens}\n`,
            );
        });

        displaySuccess(retValue, context);
    }
}

export function getTokenCommandHandlers(): CommandHandlerTable {
    return {
        description: "Get LLM token usage statistics for this session.",
        defaultSubCommand: new TokenSummaryCommandHandler(),
        commands: {
            summary: new TokenSummaryCommandHandler(),
            details: new TokenDetailsCommandHandler(),
        },
    };
}
