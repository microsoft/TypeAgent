// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { CommandHandlerContext } from "../../commandHandlerContext.js";
import {
    ActionContext,
    CompletionDirection,
    CompletionGroups,
    ParsedCommandParams,
    SessionContext,
} from "@typeagent/agent-sdk";
import { CommandHandler } from "@typeagent/agent-sdk/helpers/command";
import {
    displayError,
    displayResult,
} from "@typeagent/agent-sdk/helpers/display";
import { getColorElapsedString } from "@typeagent/common-utils";
import { matchRequest } from "../../../translation/matchRequest.js";
import { requestCompletion } from "../../../translation/requestCompletion.js";

export class MatchCommandHandler implements CommandHandler {
    public readonly description = "Match a request";
    public readonly parameters = {
        args: {
            request: {
                description: "Request to match",
                implicitQuotes: true,
            },
        },
    } as const;
    public async run(
        context: ActionContext<CommandHandlerContext>,
        params: ParsedCommandParams<typeof this.parameters>,
    ) {
        const matchResult = await matchRequest(context, params.args.request);
        if (matchResult) {
            const elapsedStr = getColorElapsedString(matchResult.elapsedMs);

            displayResult(
                `${matchResult.requestAction} ${elapsedStr}\n\nJSON:\n${JSON.stringify(
                    matchResult.requestAction.actions,
                    undefined,
                    2,
                )}`,
                context,
            );
        } else {
            displayError("No match found for the request.", context);
        }
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
