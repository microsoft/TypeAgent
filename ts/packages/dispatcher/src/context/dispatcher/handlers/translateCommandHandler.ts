// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { CommandHandlerContext } from "../../commandHandlerContext.js";
import {
    ActionContext,
    CompletionGroup,
    ParsedCommandParams,
    SessionContext,
} from "@typeagent/agent-sdk";
import { CommandHandler } from "@typeagent/agent-sdk/helpers/command";
import { displayResult } from "@typeagent/agent-sdk/helpers/display";
import { getColorElapsedString } from "common-utils";
import { translateRequest } from "../../../translation/translateRequest.js";
import { requestCompletion } from "../../../translation/requestCompletion.js";

export class TranslateCommandHandler implements CommandHandler {
    public readonly description = "Translate a request";
    public readonly parameters = {
        args: {
            request: {
                description: "Request to translate",
                implicitQuotes: true,
            },
        },
    } as const;
    public async run(
        context: ActionContext<CommandHandlerContext>,
        params: ParsedCommandParams<typeof this.parameters>,
    ) {
        const translationResult = await translateRequest(
            params.args.request,
            context,
        );

        const elapsedStr = getColorElapsedString(translationResult.elapsedMs);
        const usageStr = translationResult.tokenUsage
            ? `(Tokens: ${translationResult.tokenUsage.prompt_tokens} + ${translationResult.tokenUsage.completion_tokens} = ${translationResult.tokenUsage.total_tokens})`
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
    ): Promise<CompletionGroup[]> {
        const completions: CompletionGroup[] = [];
        for (const name of names) {
            if (name === "request") {
                const requestPrefix = params.args.request;
                completions.push(
                    ...(await requestCompletion(
                        requestPrefix,
                        context.agentContext,
                    )),
                );
            }
        }
        return completions;
    }
}
