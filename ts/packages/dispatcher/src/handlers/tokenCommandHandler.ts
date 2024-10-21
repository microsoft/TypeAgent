// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { CommandHandlerNoParams, CommandHandlerTable } from "@typeagent/agent-sdk/helpers/command";
import { CommandHandlerContext } from "./common/commandHandlerContext.js";
import { ActionContext } from "@typeagent/agent-sdk";
import { displayStatus, displaySuccess } from "@typeagent/agent-sdk/helpers/display";
import { TokenCounter, openai } from "aiclient";

class TokenSummaryCommandHandler implements CommandHandlerNoParams {
    public readonly description =
        "Get overall LLM usage statistics.";

    public async run(context: ActionContext<CommandHandlerContext>) {
        displayStatus(`Selecting random request...`, context);

        const total: openai.CompletionUsageStats = TokenCounter.getInstance().total;
        const avg: openai.CompletionUsageStats = TokenCounter.getInstance().average;

        displaySuccess([ `Total Token Count\n------------------\nPrompt Tokens: ${total.prompt_tokens}\nCompletion Tokens: ${total.completion_tokens}\nTotal: ${total.total_tokens}\n`, 
            `Token Averages\n------------------\n Prompt: ${avg.prompt_tokens}\nCompletion: ${avg.completion_tokens}\nTotal: ${avg.total_tokens}`], 
        context);

    }
}


export function getTokenCommandHandlers(): CommandHandlerTable {
    return {
        description: "Get LLM token usage statistics for this session.",
        defaultSubCommand: new TokenSummaryCommandHandler(),
        commands: {
            summary: new TokenSummaryCommandHandler(),
        },
    };
}
