// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ActionContext,
    AppAction,
    ParsedCommandParams,
    PartialParsedCommandParams,
    SessionContext,
} from "@typeagent/agent-sdk";
import { CommandHandler } from "@typeagent/agent-sdk/helpers/command";
import { CommandHandlerContext } from "../../commandHandlerContext.js";
import {
    getParameterNames,
    getParameterType,
    validateAction,
} from "action-schema";
import { executeActions } from "../../../execute/actionHandlers.js";
import { FullAction, toExecutableActions } from "agent-cache";
import { getActionSchema } from "../../../internal.js";
import { getObjectProperty } from "common-utils";
import { getActionCompletion } from "../../../translation/actionTemplate.js";

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

        const actionSchema =
            actionSchemaFile.parsedActionSchema.actionSchemas.get(actionName);
        if (actionSchema === undefined) {
            throw new Error(
                `Invalid action name ${actionName} for schema ${schemaName}`,
            );
        }

        const action: AppAction = {
            schemaName: schemaName,
            actionName,
        };

        if (params.flags.parameters !== undefined) {
            action.parameters = params.flags.parameters;
        }

        validateAction(actionSchema, action, true);

        return executeActions(
            toExecutableActions([action as FullAction]),
            undefined,
            context,
        );
    }
    public async getCompletion(
        context: SessionContext<CommandHandlerContext>,
        params: PartialParsedCommandParams<typeof this.parameters>,
        names: string[],
    ): Promise<string[]> {
        const systemContext = context.agentContext;
        const completions: string[] = [];
        for (const name of names) {
            if (name === "schemaName") {
                const schemaNames = systemContext.agents.getActiveSchemas();
                completions.push(...schemaNames);
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
                completions.push(
                    ...actionSchemaFile.parsedActionSchema.actionSchemas.keys(),
                );
                continue;
            }

            if (name === "--parameters.") {
                // complete the flag name for json properties
                const action = {
                    schemaName: params.args?.schemaName,
                    actionName: params.args?.actionName,
                    parameters: params.flags?.parameters,
                };
                const actionInfo = getActionSchema(
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
                completions.push(
                    ...parameterNames
                        .filter((p) => getCurrentValue(p) === undefined)
                        .map((p) => `--${p}`),
                );
                continue;
            }

            if (name.startsWith("--parameters.")) {
                // complete the flag values for json properties

                const action = {
                    schemaName: params.args?.schemaName,
                    actionName: params.args?.actionName,
                    parameters: params.flags?.parameters,
                };

                const actionSchema = getActionSchema(
                    action,
                    systemContext.agents,
                );
                if (actionSchema === undefined) {
                    continue;
                }
                const propertyName = name.substring(2);
                const fieldType = getParameterType(actionSchema, propertyName);
                if (fieldType?.type === "string-union") {
                    completions.push(...fieldType.typeEnum);
                    continue;
                }

                completions.push(
                    ...(await getActionCompletion(
                        systemContext,
                        action as Partial<AppAction>,
                        propertyName,
                    )),
                );

                continue;
            }
        }
        return completions;
    }
}
