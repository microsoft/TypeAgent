// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ActionContext, ActionResult, AppAction } from "@typeagent/agent-sdk";
import { createActionResultNoDisplay } from "@typeagent/agent-sdk/helpers/action";
import { runHelp } from "@typeagent/selfhelp/help";
import type { CommandHandlerContext } from "../../commandHandlerContext.js";
import { getAgentSchemas } from "../describe/agentSchemaInfo.js";
import {
    describeAction,
    describeAgentOrAction,
    resolveAgent,
} from "../describe/describeCore.js";
import type { HelpAction } from "../schema/helpActionSchema.js";

// The built-in help capability (system.help). "Answer a TypeAgent question"
// (command lookup + concept/setup) reuses the merged selfhelp grounding library
// (catalog + docs in one call); describing a specific agent/action uses the live
// describeCore engine so it reflects the current, real agent set. When
// describeAgent names something that isn't an installed agent (a concept like
// "translation"), we fall back to the merged answer instead of dead-ending with
// "No agent named ...".
export async function executeHelpAction(
    action: AppAction,
    context: ActionContext<CommandHandlerContext>,
): Promise<ActionResult> {
    const helpAction = action as unknown as HelpAction;
    const systemContext = context.sessionContext.agentContext;
    switch (helpAction.actionName) {
        case "answerTypeAgentQuestion":
            return runHelp(helpAction.parameters.question, context);
        case "describeAgent": {
            const { agentName, all } = helpAction.parameters;
            const schemas = await getAgentSchemas(systemContext, undefined, {
                includeSchemaless: true,
            });
            if (resolveAgent(schemas, agentName).kind !== "found") {
                // Not a real installed agent - answer it as a concept question.
                return runHelp(agentName, context);
            }
            const markdown = await describeAgentOrAction(
                systemContext,
                agentName,
                all ?? false,
            );
            context.actionIO.appendDisplay({
                type: "markdown",
                content: markdown,
            });
            return createActionResultNoDisplay(
                `Described the "${agentName}" agent.`,
            );
        }
        case "describeAction": {
            const { actionName, agentName } = helpAction.parameters;
            const markdown = await describeAction(
                systemContext,
                actionName,
                agentName,
            );
            context.actionIO.appendDisplay({
                type: "markdown",
                content: markdown,
            });
            return createActionResultNoDisplay(
                `Described the "${actionName}" action.`,
            );
        }
        default:
            throw new Error(
                `Invalid help action: ${(action as { actionName: string }).actionName}`,
            );
    }
}
