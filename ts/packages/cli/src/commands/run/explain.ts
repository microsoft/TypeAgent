// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Args, Command, Flags } from "@oclif/core";
import chalk from "chalk";
import { createLimiter, getElapsedString } from "common-utils";
import {
    RequestAction,
    Actions,
    printProcessRequestActionResult,
} from "agent-cache";
import {
    getCacheFactory,
    getSchemaNamesFromDefaultAppAgentProviders,
    initializeCommandHandlerContext,
    closeCommandHandlerContext,
    getDefaultAppAgentProviders,
} from "agent-dispatcher/internal";
import { createConsoleClientIO } from "agent-dispatcher/helpers/console";

// Default test case, that include multiple phrase action name (out of order) and implicit parameters (context)
const testRequest = new RequestAction(
    "do some player blah",
    Actions.fromJSON({
        fullActionName: "player.do",
        parameters: {
            value: "blah",
            context: "now",
        },
    }),
);
export default class ExplainCommand extends Command {
    static args = {
        request: Args.string({
            description: "Request and action to get an explanation for",
        }),
    };

    static flags = {
        translator: Flags.string({
            description: "Translator names",
            options: getSchemaNamesFromDefaultAppAgentProviders(),
            multiple: true,
        }),
        explainer: Flags.string({
            description:
                "Explainer name (defaults to the explainer associated with the translator)",
            options: getCacheFactory().getExplainerNames(),
        }),
        repeat: Flags.integer({
            description: "Number of times to repeat the explanation",
            default: 1,
        }),
        concurrency: Flags.integer({
            description: "Number of concurrent requests",
            default: 5,
        }),
        filter: Flags.string({
            description: "Filter for the explanation",
            options: ["refvalue", "reflist"],
            multiple: true,
            required: false,
        }),
    };

    static description = "Explain a request and action";
    static example = [
        `$ <%= config.bin %> <%= command.id %> 'play me some bach => play({"ItemType":"song","Artist":"bach"})'`,
    ];

    async run(): Promise<void> {
        const { args, flags } = await this.parse(ExplainCommand);
        const schemas = flags.translator
            ? Object.fromEntries(flags.translator.map((name) => [name, true]))
            : undefined;
        const context = await initializeCommandHandlerContext(
            "cli run explain",
            {
                appAgentProviders: getDefaultAppAgentProviders(),
                schemas,
                actions: null, // We don't need any actions
                commands: null,
                explainer: {
                    name: flags.explainer,
                },
                cache: { enabled: false },
                clientIO:
                    flags.repeat > 1 ? undefined : createConsoleClientIO(),
            },
        );

        if (args.request === undefined) {
            console.log(chalk.yellow("Request not specified, using default."));
        }

        const requestAction = args.request
            ? RequestAction.fromString(args.request)
            : testRequest;

        const options = {
            valueInRequest: flags.filter?.includes("refvalue") ?? false,
            noReferences: flags.filter?.includes("reflist") ?? false,
        };
        console.log(chalk.grey(`Generate explanation for '${requestAction}'`));
        if (flags.repeat > 1) {
            console.log(
                `Repeating ${flags.repeat} times with concurrency ${flags.concurrency}...`,
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
                        console.log(`Iteration #${current} started.`);
                        const result =
                            await context.agentCache.processRequestAction(
                                requestAction,
                                false,
                                { concurrent: true, ...options },
                            );
                        console.log(
                            result.explanationResult.explanation.success
                                ? chalk.green(
                                      `Iteration #${current} succeeded. [${getElapsedString(result.explanationResult.elapsedMs)}]`,
                                  )
                                : chalk.red(
                                      `Iteration #${current} failed. [${getElapsedString(result.explanationResult.elapsedMs)}]`,
                                  ),
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
            console.log(
                `Result: ${successCount} (${(successCount / flags.repeat).toFixed(3)}), ${attemptCount} attempts (${(attemptCount / successCount).toFixed(3)})`,
            );
            console.log(`Total elapsed Time: ${getElapsedString(elapsedMs)}`);
            console.log(
                `Actual elapsed Time: ${getElapsedString(actualElapsedMs)}`,
            );
        } else {
            const result = await context.agentCache.processRequestAction(
                requestAction,
                false,
                options,
            );

            printProcessRequestActionResult(result);
        }
        await closeCommandHandlerContext(context);
    }
}
