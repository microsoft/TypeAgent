// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
import { ActionContext, ParsedCommandParams } from "@typeagent/agent-sdk";
import { CommandHandler } from "@typeagent/agent-sdk/helpers/command";
import { displayResult } from "@typeagent/agent-sdk/helpers/display";
import { CommandHandlerContext } from "../../commandHandlerContext.js";
import { RequestAction, printProcessRequestActionResult } from "agent-cache";
import { createLimiter, getElapsedString } from "common-utils";
import chalk from "chalk";

export class ExplainCommandHandler implements CommandHandler {
    public readonly description = "Explain a translated request with action";
    public readonly parameters = {
        args: {
            requestAction: {
                description: "Request to explain",
                implicitQuotes: true,
            },
        },
        flags: {
            repeat: {
                description: "Number of times to repeat the explanation",
                default: 1,
            },
            filterValueInRequest: {
                description: "Filter reference value for the explanation",
                default: false,
            },
            filterReference: {
                description: "Filter reference words",
                default: false,
            },
            concurrency: {
                description: "Number of concurrent requests",
                default: 5,
            },
        },
    } as const;
    public async run(
        context: ActionContext<CommandHandlerContext>,
        params: ParsedCommandParams<typeof this.parameters>,
    ) {
        const { args, flags } = params;

        const options = {
            valueInRequest: flags.filterValueInRequest,
            noReferences: flags.filterReference,
        };
        const requestAction = RequestAction.fromString(args.requestAction);
        displayResult(`Generating explanation for '${requestAction}'`, context);
        const systemContext = context.sessionContext.agentContext;

        if (flags.repeat > 1) {
            displayResult(
                `Repeating ${flags.repeat} times with concurrency ${flags.concurrency}...`,
                context,
            );
            const limiter = createLimiter(
                flags.concurrency > 0 ? flags.concurrency : 1,
            );
            const startTime = performance.now();
            const promises = [];
            let iteration = 1;
            for (let i = 0; i < flags.repeat; i++) {
                promises.push(
                    limiter(async () => {
                        const current = iteration++;
                        displayResult(
                            `Iteration #${current} started.`,
                            context,
                        );
                        const result =
                            await systemContext.agentCache.processRequestAction(
                                requestAction,
                                false,
                                { concurrent: true, ...options },
                            );
                        displayResult(
                            result.explanationResult.explanation.success
                                ? chalk.green(
                                      `Iteration #${current} succeeded. [${getElapsedString(result.explanationResult.elapsedMs)}]`,
                                  )
                                : chalk.red(
                                      `Iteration #${current} failed. [${getElapsedString(result.explanationResult.elapsedMs)}]`,
                                  ),
                            context,
                        );

                        return result;
                    }),
                );
            }
            const results = await Promise.all(promises);

            const actualElapsedMs = performance.now() - startTime;
            let successCount = 0;
            let correctionCount = 0;
            let elapsedMs = 0;
            for (const result of results) {
                if (result.explanationResult.explanation.success) {
                    successCount++;
                }
                correctionCount +=
                    result.explanationResult.explanation.corrections?.length ??
                    0;
                elapsedMs += result.explanationResult.elapsedMs;
            }
            const attemptCount = correctionCount + flags.repeat;
            displayResult(
                `Result: ${successCount} (${(successCount / flags.repeat).toFixed(3)}), ${attemptCount} attempts (${(attemptCount / successCount).toFixed(3)})`,
                context,
            );
            displayResult(
                `Total elapsed Time: ${getElapsedString(elapsedMs)}`,
                context,
            );
            displayResult(
                `Actual elapsed Time: ${getElapsedString(actualElapsedMs)}`,
                context,
            );
        } else {
            const result = await systemContext.agentCache.processRequestAction(
                requestAction,
                false,
                options,
            );

            displayResult((log) => {
                printProcessRequestActionResult(result, log);
            }, context);
        }
    }
}
