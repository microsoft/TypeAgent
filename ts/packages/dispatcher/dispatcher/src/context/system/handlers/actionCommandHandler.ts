// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ActionContext,
    AppAction,
    CompletionGroup,
    ParsedCommandParams,
    PartialParsedCommandParams,
    SessionContext,
    TypeAgentAction,
} from "@typeagent/agent-sdk";
import { CommandHandler } from "@typeagent/agent-sdk/helpers/command";
import { CommandHandlerContext } from "../../commandHandlerContext.js";
import { getParameterNames, validateAction } from "@typeagent/action-schema";
import { executeActions } from "../../../execute/actionHandlers.js";
import {
    FullAction,
    toExecutableActions,
    RequestAction,
    ProcessRequestActionResult,
    printProcessRequestActionResult,
} from "agent-cache";
import {
    DeepPartialUndefined,
    getObjectProperty,
} from "@typeagent/common-utils";
import { getActionParamCompletion } from "../../../translation/requestCompletion.js";
import { getActionSchema } from "../../../translation/actionSchemaUtils.js";
import { tryGetActionSchema } from "../../../translation/actionSchemaFileCache.js";
import { getActivityNamespaceSuffix } from "../../../translation/matchRequest.js";
import { DispatcherName } from "../../dispatcher/dispatcherUtils.js";
import chalk from "chalk";
import registerDebug from "debug";

const debugExplain = registerDebug("typeagent:action:explain");

export class ActionCommandHandler implements CommandHandler {
    public readonly description = "Execute an action";
    public readonly parameters = {
        args: {
            schemaName: {
                description: "Action schema name",
            },
            actionName: {
                description: "Action name",
            },
        },
        flags: {
            parameters: {
                description: "Action parameter",
                optional: true,
                type: "json",
            },
            naturalLanguage: {
                description:
                    "Natural language phrase to associate with this action for cache population",
                optional: true,
                type: "string",
            },
        },
    } as const;
    public async run(
        context: ActionContext<CommandHandlerContext>,
        params: ParsedCommandParams<typeof this.parameters>,
    ) {
        const systemContext = context.sessionContext.agentContext;
        const { schemaName, actionName } = params.args;
        const actionSchemaFile =
            systemContext.agents.tryGetActionSchemaFile(schemaName);
        if (actionSchemaFile === undefined) {
            throw new Error(`Invalid schema name ${schemaName}`);
        }

        const actionSchema = getActionSchema(actionSchemaFile, actionName);
        const action: AppAction = {
            schemaName: schemaName,
            actionName,
        };

        if (params.flags.parameters !== undefined) {
            action.parameters = params.flags.parameters;
        }

        validateAction(actionSchema, action, true);

        // Execute the action
        await executeActions(
            toExecutableActions([action as FullAction]),
            undefined,
            context,
        );

        // If naturalLanguage parameter is provided, populate cache
        const naturalLanguage = params.flags.naturalLanguage;
        if (naturalLanguage !== undefined && naturalLanguage.trim() !== "") {
            await this.populateCache(
                systemContext,
                naturalLanguage,
                action as FullAction,
            );
        }
    }

    private async populateCache(
        context: CommandHandlerContext,
        naturalLanguage: string,
        action: FullAction,
    ): Promise<void> {
        // Check if explanation/cache is enabled
        if (!context.session.explanation) {
            debugExplain(
                `Cache population skipped: explanation disabled for natural language "${naturalLanguage}"`,
            );
            return;
        }

        // Check if caching is enabled for this schema
        if (
            context.agents.getActionConfig(action.schemaName).cached === false
        ) {
            debugExplain(
                `Cache population skipped: caching disabled for schema "${action.schemaName}"`,
            );
            return;
        }

        // Create a RequestAction for cache population
        const requestAction: RequestAction = {
            request: naturalLanguage,
            actions: [{ action }],
        };

        // Get explainer options similar to requestCommandHandler
        const { list, value, translate } =
            context.session.getConfig().explainer.filter.reference;

        const options = {
            namespaceSuffix: getActivityNamespaceSuffix(
                context,
                requestAction.history?.activityContext,
            ),
            checkExplainable: translate
                ? async (requestAction: RequestAction) => {
                      if (requestAction.history === undefined) {
                          return;
                      }
                      // For @action commands, we skip the context-less translation check
                      // since we don't have history context
                      return;
                  }
                : undefined,
            valueInRequest: value,
            noReferences: list,
        };

        try {
            const requestId = context.requestId;
            debugExplain(
                `Populating cache for natural language: "${naturalLanguage}" -> ${action.schemaName}.${action.actionName}`,
            );

            const processRequestActionP =
                context.agentCache.processRequestAction(
                    requestAction,
                    true,
                    options,
                );

            if (context.explanationAsynchronousMode) {
                processRequestActionP
                    .then((result: ProcessRequestActionResult) => {
                        const explanationResult =
                            result.explanationResult.explanation;
                        const error = explanationResult.success
                            ? undefined
                            : explanationResult?.message;

                        context.clientIO.notify(
                            "explained",
                            requestId,
                            {
                                time: new Date().toLocaleTimeString(),
                                fromCache: false,
                                fromUser: false,
                                error,
                            },
                            DispatcherName,
                        );

                        if (explanationResult.success) {
                            debugExplain(
                                `Cache population succeeded for "${naturalLanguage}"`,
                            );
                        } else {
                            debugExplain(
                                `Cache population failed for "${naturalLanguage}": ${error}`,
                            );
                        }
                    })
                    .catch((e) => {
                        debugExplain(
                            `Cache population error for "${naturalLanguage}": ${e.message}`,
                        );
                        context.clientIO.notify(
                            "explained",
                            requestId,
                            {
                                time: new Date().toLocaleTimeString(),
                                fromCache: false,
                                fromUser: false,
                                error: e.message,
                            },
                            DispatcherName,
                        );
                    });
            } else {
                console.log(
                    chalk.grey(
                        `Generating explanation for action: '${naturalLanguage}'`,
                    ),
                );
                const result = await processRequestActionP;

                const explanationResult = result.explanationResult.explanation;
                const error = explanationResult.success
                    ? undefined
                    : explanationResult?.message;

                context.clientIO.notify(
                    "explained",
                    requestId,
                    {
                        time: new Date().toLocaleTimeString(),
                        fromCache: false,
                        fromUser: false,
                        error,
                    },
                    DispatcherName,
                );

                printProcessRequestActionResult(result);

                if (explanationResult.success) {
                    debugExplain(
                        `Cache population succeeded for "${naturalLanguage}"`,
                    );
                } else {
                    debugExplain(
                        `Cache population failed for "${naturalLanguage}": ${error}`,
                    );
                }
            }
        } catch (e: any) {
            debugExplain(
                `Exception during cache population for "${naturalLanguage}": ${e.message}`,
            );
            // Don't throw - cache population failure shouldn't fail the action execution
        }
    }
    public async getCompletion(
        context: SessionContext<CommandHandlerContext>,
        params: PartialParsedCommandParams<typeof this.parameters>,
        names: string[],
    ): Promise<CompletionGroup[]> {
        const systemContext = context.agentContext;
        const completions: CompletionGroup[] = [];
        for (const name of names) {
            if (name === "schemaName") {
                const schemaNames = systemContext.agents.getActiveSchemas();
                completions.push({
                    name,
                    completions: schemaNames,
                });
                continue;
            }

            if (name === "actionName") {
                const schemaName = params.args?.schemaName;
                if (schemaName === undefined) {
                    continue;
                }
                const actionSchemaFile =
                    systemContext.agents.tryGetActionSchemaFile(schemaName);
                if (actionSchemaFile === undefined) {
                    continue;
                }
                completions.push({
                    name,
                    completions: Array.from(
                        actionSchemaFile.parsedActionSchema.actionSchemas.keys(),
                    ),
                });
                continue;
            }

            if (name === "--parameters.") {
                // complete the flag name for json properties
                const action = {
                    schemaName: params.args?.schemaName,
                    actionName: params.args?.actionName,
                    parameters: params.flags?.parameters,
                };
                const actionInfo = tryGetActionSchema(
                    action,
                    systemContext.agents,
                );
                if (actionInfo === undefined) {
                    continue;
                }

                const getCurrentValue = (name: string) =>
                    getObjectProperty(action, name);
                const parameterNames = getParameterNames(
                    actionInfo,
                    getCurrentValue,
                );
                completions.push({
                    name,
                    completions: parameterNames
                        .filter((p) => getCurrentValue(p) === undefined)
                        .map((p) => `--${p}`),
                });
                continue;
            }

            if (name.startsWith("--parameters.")) {
                // complete the flag values for json properties

                const action: DeepPartialUndefined<TypeAgentAction> = {
                    schemaName: params.args?.schemaName,
                    actionName: params.args?.actionName,
                    parameters: params.flags?.parameters,
                };

                const parameterCompletion = await getActionParamCompletion(
                    systemContext,
                    action,
                    name.substring("--parameters.".length),
                );

                if (parameterCompletion) {
                    completions.push({
                        name,
                        ...parameterCompletion,
                    });
                }

                continue;
            }
        }
        return completions;
    }
}
