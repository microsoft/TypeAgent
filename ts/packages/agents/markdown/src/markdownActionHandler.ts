// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ActionContext,
    AppAction,
    AppAgent,
    SessionContext,
    ActionResult,
} from "@typeagent/agent-sdk";
import { createActionResult } from "@typeagent/agent-sdk/helpers/action";
import { MarkdownAction } from "./markdownActionSchema.js";
import { createMarkdownAgent } from "./translator.js";

export function instantiate(): AppAgent {
    return {
        initializeAgentContext: initializeMarkdownContext,
        updateAgentContext: updateMarkdownContext,
        executeAction: executeMarkdownAction,
        validateWildcardMatch: markdownValidateWildcardMatch,
    };
}

type MarkdownActionContext = {
    currentFileName: string | undefined;
};

async function executeMarkdownAction(
    action: AppAction,
    context: ActionContext<MarkdownActionContext>,
) {
    let result = await handleMarkdownAction(action as MarkdownAction, context);
    return result;
}

async function markdownValidateWildcardMatch(
    action: AppAction,
    context: SessionContext<MarkdownActionContext>,
) {
    return true;
}

async function initializeMarkdownContext() {
    return {};
}

async function updateMarkdownContext(
    enable: boolean,
    context: SessionContext<MarkdownActionContext>,
): Promise<void> {
    if (enable) {
        if (!context.agentContext.currentFileName) {
            context.agentContext.currentFileName = "live.md";
        }

        if (
            !context.sessionStorage?.exists(
                context.agentContext.currentFileName,
            )
        ) {
        }
    }
}

async function handleMarkdownAction(
    action: MarkdownAction,
    actionContext: ActionContext<MarkdownActionContext>,
) {
    let result: ActionResult | undefined = undefined;
    const agent = await createMarkdownAgent("GPT_4o");
    const storage = actionContext.sessionContext.sessionStorage;

    switch (action.actionName) {
        case "createDocument": {
            if (!action.parameters.name) {
                result = createActionResult(
                    "Document could not be created: no name was provided",
                );
            } else {
                result = createActionResult("Creating document ...");

                const newFileName = action.parameters.name.trim() + ".md";
                actionContext.sessionContext.agentContext.currentFileName =
                    newFileName;

                if (!(await storage?.exists(newFileName))) {
                    await storage?.write(newFileName, "");
                    console.log(`File ${newFileName} created.`);
                }
            }
            break;
        }
        case "updateDocument": {
            result = createActionResult("Updating document ...");

            const filePath = `${actionContext.sessionContext.agentContext.currentFileName}`;
            let markdownContent;
            if (await storage?.exists(filePath)) {
                markdownContent = await storage?.read(filePath, "utf8");
            }
            const response = await agent.updateDocument(
                markdownContent,
                action.parameters.originalRequest,
            );

            if (response.success) {
                const mdResult = response.data;

                // write to file
                if (mdResult.content) {
                    await storage?.write(filePath, mdResult.content);
                }
                if (mdResult.operationSummary) {
                    result = createActionResult(mdResult.operationSummary);
                } else {
                    result = createActionResult("Updated document");
                }
            } else {
                console.error(response.message);
            }
            break;
        }
        default:
            throw new Error(`Unknown action: ${action.actionName}`);
    }
    return result;
}
