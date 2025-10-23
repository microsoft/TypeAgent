// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ActionContext,
    AppAgent,
    ActionResult,
    TypeAgentAction,
} from "@typeagent/agent-sdk";
import { createActionResult, createActionResultFromHtmlDisplayWithScript } from "@typeagent/agent-sdk/helpers/action";
import {
    SettingsAction,
} from "./settingsActionSchemaV2.js";
import { spawn } from "child_process";
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

type SettingsAgentContext = {
    store: undefined;
};

export function instantiate(): AppAgent {
    return {
        executeAction: executeSettingsAction,
    };
}

async function executeSettingsAction(
    action: TypeAgentAction<SettingsAction>,
    context: ActionContext<SettingsAgentContext>,
) {
    let result = await handleSettingsAction(action, context);
    return result;
}

async function handleSettingsAction(
    action: SettingsAction,
    settingsContext: ActionContext<SettingsAgentContext>,
) {

    if (process.platform !== "win32") {
        return createActionResult("This command is only supported on Windows!");
    }

    let result: ActionResult | undefined = undefined;
    switch (action.actionName) {
        case "AdjustMultiMonitorLayout":
            const file = getPackageFilePath('settings/cards/adjustMultiMonitorLayout.html');
            result = createActionResultFromHtmlDisplayWithScript(readFileSync(file, 'utf8'));
            break;
        default: {
            result = createActionResult(`TODO: call settings MCP server with '${action.parameters.originalUserRequest}'`);

            if (action.parameters.uri) {
                
                const child = spawn('start', [action.parameters.uri], {
                shell: true,       // Required for 'start' to work
                detached: true,
                stdio: 'ignore'
                });

                child.unref();

            }

            break;
        }
        // default:
        //     throw new Error(`Unknown action: ${action.actionName}`);
    }
    return result;
}

const packageRoot = path.join("..", "..");
export function getPackageFilePath(packageRootRelativePath: string) {
    if (path.isAbsolute(packageRootRelativePath)) {
        return packageRootRelativePath;
    }
    return fileURLToPath(
        new URL(
            path.join(packageRoot, packageRootRelativePath),
            import.meta.url,
        ),
    );
}
