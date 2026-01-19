// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as vscode from "vscode";
import { ActionResult } from "./helpers";
import { handleWorkbenchActions } from "./handleWorkBenchActions";
import { handleDebugActions } from "./handleDebugActions";
import { handleExtensionActions } from "./handleExtensionActions";
import { handleEditorCodeActions } from "./handleEditorCodeActions";

async function execChangeEditorColumns(actionData: any): Promise<ActionResult> {
    let actionResult: ActionResult = {
        handled: true,
        message: "Ok",
    };

    if (actionData && actionData.columnCount) {
        switch (actionData.columnCount) {
            case "single":
                vscode.commands.executeCommand(
                    "workbench.action.editorLayoutSingle",
                );
                break;
            case "double":
                vscode.commands.executeCommand(
                    "workbench.action.editorLayoutTwoColumns",
                );
                break;
            case "three":
                vscode.commands.executeCommand(
                    "workbench.action.editorLayoutThreeColumns",
                );
                break;
            default:
                actionResult.message = "Editor layout: Unknown column count";
                actionResult.handled = false;
                return actionResult;
        }

        actionResult.message =
            "Changed editor columns to: " + actionData.columnCount;
        return actionResult;
    }

    actionResult.message = "Did not understand the request!";
    actionResult.handled = false;
    return actionResult;
}

export async function handleDisplayKBActions(
    action: any,
): Promise<ActionResult> {
    let actionResult: ActionResult = {
        handled: true,
        message: "Ok",
    };

    const actionName =
        action.actionName ?? action.fullActionName.split(".").at(-1);

    switch (actionName) {
        case "toggleFullScreen": {
            vscode.commands.executeCommand("workbench.action.toggleFullScreen");
            actionResult.message = "Toggled full screen";
            break;
        }
        case "toggleEditorLayout": {
            vscode.commands.executeCommand(
                "workbench.action.toggleEditorLayout",
            );
            actionResult.message = "Toggled editor layout";
            break;
        }
        case "zoomIn": {
            for (let i = 0; i < 5; i++) {
                vscode.commands.executeCommand("editor.action.fontZoomIn");
            }
            actionResult.message = "Zoomed in";
            break;
        }
        case "fontZoomReset": {
            vscode.commands.executeCommand("editor.action.fontZoomReset");
            actionResult.message = "Zoom reset";
            break;
        }
        case "zoomOut": {
            for (let i = 0; i < 5; i++) {
                vscode.commands.executeCommand("editor.action.fontZoomOut");
            }
            actionResult.message = "Zoomed out";
            break;
        }
        case "showExplorer": {
            vscode.commands.executeCommand("workbench.view.explorer");
            actionResult.message = "Showing explorer";
            break;
        }
        case "showSearch": {
            vscode.commands.executeCommand("workbench.view.search");
            actionResult.message = "Showing search";
            break;
        }
        case "showSourceControl": {
            vscode.commands.executeCommand("workbench.view.scm");
            actionResult.message = "Showing source control";
            break;
        }
        case "showOutputPanel": {
            vscode.commands.executeCommand(
                "workbench.action.output.toggleOutput",
            );
            actionResult.message = "Showing output panel";
            break;
        }
        case "toggleSearchDetails": {
            vscode.commands.executeCommand("search.action.toggleQueryDetails");
            actionResult.message = "Toggled search details";
            break;
        }
        case "replaceInFiles": {
            vscode.commands.executeCommand("workbench.action.replaceInFiles");
            actionResult.message = "Replace in files";
            break;
        }
        case "openMarkdownPreview": {
            vscode.commands.executeCommand("markdown.showPreview");
            actionResult.message = "Opened markdown preview";
            break;
        }
        case "openMarkdownPreviewToSide": {
            vscode.commands.executeCommand("markdown.showPreviewToSide");
            actionResult.message = "Opened markdown preview to side";
            break;
        }
        case "zenMode": {
            vscode.commands.executeCommand("workbench.action.toggleZenMode");
            actionResult.message = "Toggled zen mode";
            break;
        }
        case "closeEditor": {
            vscode.commands.executeCommand(
                "workbench.action.closeActiveEditor",
            );
            actionResult.message = "Closed editor";
            break;
        }
        case "openSettings": {
            vscode.commands.executeCommand("workbench.action.openSettings");
            actionResult.message = "Opened settings";
            break;
        }
        default: {
            actionResult.message = `Did not understand the request for action: "${actionName}"`;
            actionResult.handled = false;
        }
    }

    return actionResult;
}

export async function handleGeneralKBActions(
    action: any,
): Promise<ActionResult> {
    let actionResult: ActionResult = {
        handled: true,
        message: "Ok",
    };

    const actionName =
        action.actionName ?? action.fullActionName.split(".").at(-1);

    switch (actionName) {
        case "showCommandPalette": {
            vscode.commands.executeCommand("workbench.action.showCommands");
            actionResult.message = "Showing command palette";
            break;
        }
        case "gotoFileOrLineOrSymbol": {
            const editor = vscode.window.activeTextEditor;
            if (action.parameters.goto === "file") {
                let fileName = action.parameters.ref;
                if (!fileName) {
                    vscode.commands.executeCommand(
                        "workbench.action.quickOpen",
                    );
                    actionResult.message = "Quick file open";
                    actionResult.message = "Opened the quick file open dialog";
                } else {
                    const files = await vscode.workspace.findFiles(
                        `**/${fileName}`,
                        "**/node_modules/**",
                        10,
                    );
                    if (files.length === 0) {
                        vscode.window.showInformationMessage(
                            `No file named ${fileName} found`,
                        );
                        actionResult.message = `No file named ${fileName} found`;
                    }

                    const fileUri = files[0]; // If multiple files, you can modify to let user select one
                    const document =
                        await vscode.workspace.openTextDocument(fileUri);
                    await vscode.window.showTextDocument(document);
                }
            } else if (
                editor &&
                action.parameters.goto === "line" &&
                action.parameters.ref
            ) {
                const line = parseInt(action.parameters.ref, 10) - 1;
                if (
                    isNaN(line) ||
                    line < 0 ||
                    line >= editor.document.lineCount
                ) {
                    vscode.window.showErrorMessage("Invalid line number");
                    actionResult.message = "Invalid line number";
                }

                const range = editor.document.lineAt(line).range;
                editor.selection = new vscode.Selection(
                    range.start,
                    range.start,
                );
                editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
                actionResult.message = `Goto line ${line + 1}`;
            }
            break;
        }
        case "newWindowFromApp": {
            vscode.commands.executeCommand("workbench.action.newWindow");
            actionResult.message = "New window";
            break;
        }
        case "showUserSettings": {
            vscode.commands.executeCommand("workbench.action.openSettings");
            actionResult.message = "Showing user settings";
            break;
        }
        case "showKeyboardShortcuts": {
            vscode.commands.executeCommand(
                "workbench.action.openGlobalKeybindings",
            );
            actionResult.message = "Showing keyboard shortcuts";
            break;
        }

        default: {
            actionResult.message = `Did not understand the request for action: "${actionName}"`;
            actionResult.handled = false;
        }
    }
    return actionResult;
}

export async function handleBaseEditorActions(
    action: any,
): Promise<ActionResult> {
    let actionResult: ActionResult = {
        handled: true,
        message: "Ok",
    };

    let actionData = action.parameters;
    const actionName =
        action.actionName ?? action.fullActionName.split(".").at(-1);

    switch (actionName) {
        case "newFile": {
            const document = await vscode.workspace.openTextDocument({
                language: actionData.language,
                content: actionData.content,
            });
            await vscode.window.showTextDocument(document);
            actionResult.message = "New file created";
            break;
        }

        case "changeColorScheme": {
            let currentTheme = await vscode.workspace
                .getConfiguration()
                .get("workbench.colorTheme");
            if (currentTheme && currentTheme === actionData.theme) {
                actionResult.message =
                    "Theme is already set to " + actionData.theme;
                break;
            }
            await vscode.workspace
                .getConfiguration()
                .update(
                    "workbench.colorTheme",
                    actionData.theme,
                    vscode.ConfigurationTarget.Global,
                );
            actionResult.message = "Changed theme to " + actionData.theme;
            break;
        }

        case "splitEditor": {
            console.log(
                `[splitEditor] Starting with actionData:`,
                JSON.stringify(actionData),
            );
            // Find the target editor to split
            let targetEditor: vscode.TextEditor | undefined;
            const editorPosition = actionData?.editorPosition;
            const fileName = actionData?.fileName;
            console.log(
                `[splitEditor] editorPosition=${editorPosition}, fileName=${fileName}`,
            );

            if (fileName || editorPosition !== undefined) {
                // Find target editor by fileName or editorPosition
                // Use visibleTextEditors to get all currently visible editors
                const allEditors = vscode.window.visibleTextEditors;
                console.log(
                    `[splitEditor] Found ${allEditors.length} visible editors:`,
                    allEditors.map((e) => e.document.fileName),
                );

                if (fileName) {
                    // Search by file name (case-insensitive, partial match)
                    const pattern = fileName.toLowerCase();
                    console.log(
                        `[splitEditor] Searching for pattern: ${pattern}`,
                    );

                    // First try visible editors
                    targetEditor = allEditors.find((editor) =>
                        editor.document.fileName
                            .toLowerCase()
                            .includes(pattern),
                    );

                    // If not found in visible editors, search all open tabs
                    if (!targetEditor) {
                        console.log(
                            `[splitEditor] Not found in visible editors, searching all tabs...`,
                        );
                        for (const tabGroup of vscode.window.tabGroups.all) {
                            for (const tab of tabGroup.tabs) {
                                const input = tab.input as any;
                                if (input?.uri) {
                                    const filePath =
                                        input.uri.fsPath || input.uri.path;
                                    if (
                                        filePath.toLowerCase().includes(pattern)
                                    ) {
                                        console.log(
                                            `[splitEditor] Found tab with matching file: ${filePath}`,
                                        );
                                        // Open the document to make it an editor
                                        const document =
                                            await vscode.workspace.openTextDocument(
                                                input.uri,
                                            );
                                        targetEditor =
                                            await vscode.window.showTextDocument(
                                                document,
                                                {
                                                    viewColumn:
                                                        tabGroup.viewColumn,
                                                    preserveFocus: false,
                                                },
                                            );
                                        break;
                                    }
                                }
                            }
                            if (targetEditor) break;
                        }
                    }

                    if (!targetEditor) {
                        console.log(
                            `[splitEditor] No editor or tab found with pattern: ${pattern}`,
                        );
                        actionResult.handled = false;
                        actionResult.message = `No editor found with file: ${fileName}`;
                        break;
                    }
                    console.log(
                        `[splitEditor] Found target editor: ${targetEditor.document.fileName}`,
                    );
                } else if (editorPosition !== undefined) {
                    // Search by position
                    if (typeof editorPosition === "number") {
                        targetEditor = allEditors[editorPosition];
                        if (!targetEditor) {
                            actionResult.handled = false;
                            actionResult.message = `No editor at position: ${editorPosition}`;
                            break;
                        }
                    } else if (editorPosition === "first") {
                        // Sort by viewColumn to get leftmost editor
                        const sortedEditors = [...allEditors].sort(
                            (a, b) => (a.viewColumn || 0) - (b.viewColumn || 0),
                        );
                        targetEditor = sortedEditors[0];
                    } else if (editorPosition === "last") {
                        // Sort by viewColumn to get rightmost editor
                        const sortedEditors = [...allEditors].sort(
                            (a, b) => (a.viewColumn || 0) - (b.viewColumn || 0),
                        );
                        targetEditor = sortedEditors[sortedEditors.length - 1];
                    } else if (editorPosition === "active") {
                        targetEditor = vscode.window.activeTextEditor;
                    }

                    if (!targetEditor) {
                        actionResult.handled = false;
                        actionResult.message = `No editor found at position: ${editorPosition}`;
                        break;
                    }
                }

                // Focus the target editor temporarily (only if it's not already active)
                if (targetEditor !== vscode.window.activeTextEditor) {
                    console.log(
                        `[splitEditor] Focusing target editor: ${targetEditor!.document.fileName}`,
                    );
                    await vscode.window.showTextDocument(
                        targetEditor!.document,
                        {
                            viewColumn:
                                targetEditor!.viewColumn ??
                                vscode.ViewColumn.One,
                            preserveFocus: false,
                        },
                    );
                }
            }

            // Execute the split command
            const direction = actionData?.direction;
            if (direction) {
                switch (direction) {
                    case "right": {
                        await vscode.commands.executeCommand(
                            "workbench.action.splitEditorRight",
                        );
                        break;
                    }
                    case "left": {
                        await vscode.commands.executeCommand(
                            "workbench.action.splitEditorLeft",
                        );
                        break;
                    }
                    case "up": {
                        await vscode.commands.executeCommand(
                            "workbench.action.splitEditorUp",
                        );
                        break;
                    }
                    case "down": {
                        await vscode.commands.executeCommand(
                            "workbench.action.splitEditorDown",
                        );
                        break;
                    }
                }
            } else {
                await vscode.commands.executeCommand(
                    "workbench.action.splitEditor",
                );
            }

            // Build result message
            const targetInfo = fileName
                ? ` (${fileName})`
                : editorPosition !== undefined
                  ? ` (${editorPosition})`
                  : "";
            actionResult.message =
                `Split editor${targetInfo} ${direction || ""}`.trim();
            console.log(
                `[splitEditor] Completed successfully: ${actionResult.message}`,
            );
            break;
        }

        case "changeEditorLayout": {
            actionResult = await execChangeEditorColumns(actionData);
            break;
        }

        default: {
            actionResult.message = `Did not understand the request for action: "${actionName}"`;
            actionResult.handled = false;
            break;
        }
    }
    return actionResult;
}

export async function handleVSCodeActions(action: any) {
    let actionResult: ActionResult = {
        handled: true,
        message: "OK",
    };

    const actionName =
        action.actionName ?? action.fullActionName.split(".").at(-1);

    if (actionName) {
        const handlers = [
            handleBaseEditorActions,
            handleGeneralKBActions,
            handleDisplayKBActions,
            handleDebugActions,
            handleWorkbenchActions,
            handleExtensionActions,
            handleEditorCodeActions,
        ];

        const results = await Promise.all(
            handlers.map((handler: any) => handler(action)),
        );

        const handledResult = results.find((result: any) => result.handled);
        if (handledResult !== undefined) {
            actionResult = handledResult;
        } else {
            actionResult.handled = false;
            actionResult.message = `Did not handle the action: "${actionName}"`;
        }
    }

    return actionResult.message;
}
