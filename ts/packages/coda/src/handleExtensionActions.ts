// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ActionResult } from "./helpers";
import * as vscode from "vscode";

export async function handleExtensionActions(
    action: any,
): Promise<ActionResult> {
    let actionResult: ActionResult = {
        handled: true,
        message: "Ok",
    };

    const actionName =
        action.actionName ?? action.fullActionName.split(".").at(-1);

    switch (actionName) {
        case "showExtensions": {
            vscode.commands.executeCommand("workbench.view.extensions");
            actionResult.message = "Showing extensions";
            break;
        }

        default: {
            actionResult.message = `Did not understand the request for action: "${actionName}"`;
            actionResult.handled = false;
        }
    }

    return actionResult;
}
