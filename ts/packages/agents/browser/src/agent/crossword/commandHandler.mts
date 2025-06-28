// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ActionContext, ParsedCommandParams } from "@typeagent/agent-sdk";
import { BrowserActionContext } from "../actionHandler.mjs";
import { getBoardSchema } from "./actionHandler.mjs";
import { CommandHandlerTable } from "@typeagent/agent-sdk/helpers/command";
import { clearCachedSchemas, deleteCachedSchema } from "./cachedSchema.mjs";

const schemaClearCommandParameters = {
    args: {
        url: {
            type: "string",
            description:
                "The URL of the crossword page to clear the schema for. If not provided, all cached schemas will be cleared.",
            multiple: false,
            optional: true,
        },
    },
} as const;
export const getCrosswordCommandHandlerTable = (): CommandHandlerTable => {
    return {
        description: "Crossword commands",
        commands: {
            schema: {
                description: "Crossword schema commands",
                commands: {
                    clear: {
                        description: "Clear the crossword schema",
                        parameters: schemaClearCommandParameters,
                        run: async (
                            context: ActionContext<BrowserActionContext>,
                            parameters: ParsedCommandParams<
                                typeof schemaClearCommandParameters
                            >,
                        ) => {
                            const urls = parameters.args.url;
                            if (urls !== undefined) {
                                for (const url of urls) {
                                    await deleteCachedSchema(
                                        context.sessionContext,
                                        url,
                                    );
                                }
                                context.actionIO.setDisplay(
                                    `Cleared cached crossword schema for ${urls.length} urls.`,
                                );
                                return;
                            }
                            clearCachedSchemas(context.sessionContext);
                            context.actionIO.setDisplay(
                                `Cleared all cached crossword schema`,
                            );
                        },
                    },
                },
            },
            state: {
                description: "Crossword state commands",
                commands: {
                    init: {
                        description: "Initialize the crossword state",
                        run: async (
                            context: ActionContext<BrowserActionContext>,
                        ) => {
                            const state = await getBoardSchema(
                                context.sessionContext,
                            );
                            context.sessionContext.agentContext.crossWordState =
                                state;

                            context.actionIO.setDisplay(
                                state
                                    ? "Crossword state initialized."
                                    : "Failed to initialize crossword state.",
                            );
                        },
                    },
                    show: {
                        description: "Show the crossword state",
                        run: async (
                            context: ActionContext<BrowserActionContext>,
                        ) => {
                            const crosswordState =
                                context.sessionContext.agentContext
                                    .crossWordState;
                            if (crosswordState === undefined) {
                                throw new Error("No crossword state.");
                            }
                            context.actionIO.setDisplay(
                                JSON.stringify(crosswordState, null, 2),
                            );
                        },
                    },
                    clear: {
                        description: "Clear the crossword state",
                        run: async (
                            context: ActionContext<BrowserActionContext>,
                        ) => {
                            context.sessionContext.agentContext.crossWordState =
                                undefined;

                            context.actionIO.setDisplay(
                                "Crossword state cleared.",
                            );
                        },
                    },
                },
            },
        },
    };
};
