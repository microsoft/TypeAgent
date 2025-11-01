// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ActionContext,
    AppAgent,
    ActionResult,
    TypeAgentAction,
} from "@typeagent/agent-sdk";
import {
    createActionResult,
    createActionResultFromHtmlDisplayWithScript,
} from "@typeagent/agent-sdk/helpers/action";
import { SettingsAction } from "./settingsActionSchema.js";
import path from "path";
import { fileURLToPath } from "url";
import { readFileSync } from "fs";

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
    let result: ActionResult | undefined = undefined;
    switch (action.actionName) {
        case "adjustMultiMonitorLayoutAction":
            const file = getPackageFilePath(
                "settings/cards/adjustMultiMonitorLayout.html",
            );
            result = createActionResultFromHtmlDisplayWithScript(
                readFileSync(file, "utf8"),
            );
            break;
        default: {
            result = createActionResult(
                `TODO: apply this setting to the local system. '${action.parameters.originalRequest}'`,
            );
            break;
        }
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
