// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { CommandHandlerContext } from "../../commandHandlerContext.js";
import { ActionContext, ParsedCommandParams } from "@typeagent/agent-sdk";
import { CommandHandler } from "@typeagent/agent-sdk/helpers/command";
import { displayResult } from "@typeagent/agent-sdk/helpers/display";
import { getColorElapsedString } from "common-utils";
import { translateRequest } from "../../../translation/translateRequest.js";

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
        if (translationResult) {
            displayResult(
                `${translationResult.requestAction} ${getColorElapsedString(translationResult.elapsedMs)}\n\nJSON:\n${JSON.stringify(
                    translationResult.requestAction.actions,
                    undefined,
                    2,
                )}`,
                context,
            );
        }
    }
}
