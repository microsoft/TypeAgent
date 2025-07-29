// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ActionResult,
    findMatchingFiles,
    findMatchingFolders,
} from "./helpers";
import * as path from "path";
import * as vscode from "vscode";
import * as fs from "fs/promises";
import { aliasManager } from "./commandAliasMgr";

async function handleOpenFileAction(action: any): Promise<ActionResult> {
    let actionResult: ActionResult = {
        handled: true,
        message: "Ok",
    };

    const parameters = action?.parameters;
    if (!parameters || typeof parameters.fileName !== "string") {
        vscode.window.showErrorMessage(
            "Invalid action: 'fileName' is required.",
        );
        actionResult.handled = false;
        actionResult.message = "Invalid action: 'fileName' is required.";
        return actionResult;
    }

    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        vscode.window.showErrorMessage(
            "No workspace or folder is currently open.",
        );
        actionResult.handled = false;
        actionResult.message;
        return actionResult;
    }

    const {
        fileName,
        matchStrategy = "exact",
        extensions,
        includeGenerated = false,
    }: {
        fileName: string;
        matchStrategy?: "exact" | "fuzzy";
        extensions?: string[];
        includeGenerated?: boolean;
    } = parameters;

    const matches = await findMatchingFiles(fileName, {
        matchStrategy,
        extensions,
        includeGenerated,
        maxResults: 5,
    });

    if (matches.length === 0) {
        vscode.window.showWarningMessage(
            `No matching file found for "${fileName}".`,
        );
        actionResult.handled = false;
        actionResult.message = `No matching file found for "${fileName}".`;
        return actionResult;
    }

    const targetUri = matches[0];
    try {
        const doc = await vscode.workspace.openTextDocument(targetUri);
        await vscode.window.showTextDocument(doc);
    } catch (err) {
        //vscode.window.showErrorMessage(`Failed to open file: ${err}`);
    }

    return actionResult;
}

async function handleCreateFolderFromExplorer(
    action: any,
): Promise<ActionResult> {
    const parameters = action?.parameters;
    if (!parameters || typeof parameters.folderName !== "string") {
        const msg = "❌ Missing or invalid 'folderName' parameter.";
        vscode.window.showErrorMessage(msg);
        return { handled: false, message: msg };
    }

    const { folderName, relativeTo } = parameters;
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
        const msg = "❌ No workspace folder is open.";
        vscode.window.showErrorMessage(msg);
        return { handled: false, message: msg };
    }

    let parentDir: vscode.Uri;

    if (relativeTo) {
        const matches = await findMatchingFolders(relativeTo);

        if (matches.length === 0) {
            const msg = `❌ No folders named '${relativeTo}' found.`;
            vscode.window.showErrorMessage(msg);
            return { handled: false, message: msg };
        } else if (matches.length === 1) {
            parentDir = matches[0];
        } else {
            const pick = await vscode.window.showQuickPick(
                matches.map((uri) => ({
                    label: vscode.workspace.asRelativePath(uri),
                    uri,
                })),
                {
                    placeHolder: `Multiple folders named '${relativeTo}' found. Select where to create '${folderName}':`,
                },
            );
            if (!pick) {
                const msg = "⚠️ Folder creation cancelled by user.";
                vscode.window.showInformationMessage(msg);
                return { handled: false, message: msg };
            }
            parentDir = pick.uri;
        }
    } else {
        parentDir = vscode.Uri.file(workspaceRoot);
    }

    const targetPath = path.join(parentDir.fsPath, folderName);

    try {
        await fs.access(targetPath);
        const msg = `⚠️ Folder already exists: ${vscode.workspace.asRelativePath(targetPath)}`;
        vscode.window.showWarningMessage(msg);
        return { handled: true, message: msg };
    } catch {
        try {
            await fs.mkdir(targetPath, { recursive: true });
            const msg = `✅ Folder created: ${vscode.workspace.asRelativePath(targetPath)}`;
            //vscode.window.showInformationMessage(msg);
            return { handled: true, message: msg };
        } catch (err) {
            const msg = `❌ Failed to create folder: ${err}`;
            vscode.window.showErrorMessage(msg);
            return { handled: false, message: msg };
        }
    }
}

export async function checkTasksJsonExists(): Promise<boolean> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        console.error("❌ No workspace or folder is open.");
        return false;
    }

    for (const folder of workspaceFolders) {
        const tasksJsonUri = vscode.Uri.joinPath(
            folder.uri,
            ".vscode",
            "tasks.json",
        );
        try {
            await vscode.workspace.fs.stat(tasksJsonUri);
            console.log(`✅ Found tasks.json in: ${folder.uri.fsPath}`);
            return true;
        } catch {
            continue;
        }
    }

    console.warn("⚠️ No tasks.json found in any workspace folders.");
    return false;
}

export async function handleFolderBuildRelatedTaskAction(
    action: any,
): Promise<ActionResult> {
    const { parameters } = action;
    const { folderName, taskSelection, task } = parameters ?? {};

    let taskCommand:
        | "workbench.action.tasks.build"
        | "workbench.action.tasks.clean"
        | "workbench.action.tasks.rebuild";
    let actionLabel: string;

    switch (task) {
        case "build":
            taskCommand = "workbench.action.tasks.build";
            actionLabel = "Build";
            break;
        case "clean":
            taskCommand = "workbench.action.tasks.clean";
            actionLabel = "Clean";
            break;
        case "rebuild":
            taskCommand = "workbench.action.tasks.rebuild";
            actionLabel = "Rebuild";
            break;
        default:
            const msg = `❌ Unsupported task type: ${task}`;
            vscode.window.showErrorMessage(msg);
            return { handled: false, message: msg };
    }

    // Reveal folder in Explorer if provided (context only, does not affect VSCode task detection)
    if (folderName) {
        const matches = await findMatchingFolders(path.basename(folderName));
        if (matches.length === 0) {
            const msg = `❌ No folders found matching '${folderName}'.`;
            vscode.window.showErrorMessage(msg);
            return { handled: false, message: msg };
        }

        let targetFolder: vscode.Uri;
        if (matches.length === 1) {
            targetFolder = matches[0];
        } else {
            const pick = await vscode.window.showQuickPick(
                matches.map((uri) => ({
                    label: vscode.workspace.asRelativePath(uri),
                    uri,
                })),
                {
                    placeHolder: `Multiple folders found. Select which folder to reveal for ${actionLabel.toLowerCase()}:`,
                },
            );
            if (!pick) {
                const msg = `⚠️ ${actionLabel} cancelled by user.`;
                vscode.window.showInformationMessage(msg);
                return { handled: false, message: msg };
            }
            targetFolder = pick.uri;
        }

        await vscode.commands.executeCommand("revealInExplorer", targetFolder);
    }

    // Handle explicit taskSelection if provided
    if (taskSelection !== undefined) {
        try {
            const tasks = await vscode.tasks.fetchTasks();
            let selectedTask: vscode.Task | undefined;

            if (typeof taskSelection === "number") {
                if (taskSelection >= 0 && taskSelection < tasks.length) {
                    selectedTask = tasks[taskSelection];
                } else {
                    const msg = `❌ Task index ${taskSelection} is out of range (${tasks.length} tasks available).`;
                    vscode.window.showErrorMessage(msg);
                    return { handled: false, message: msg };
                }
            } else if (typeof taskSelection === "string") {
                selectedTask = tasks.find(
                    (t) =>
                        t.name === taskSelection ||
                        t.definition.label === taskSelection,
                );
                if (!selectedTask) {
                    const msg = `❌ No task found with label '${taskSelection}'.`;
                    vscode.window.showErrorMessage(msg);
                    return { handled: false, message: msg };
                }
            }

            if (selectedTask) {
                await vscode.tasks.executeTask(selectedTask);
                const msg = `✅ ${actionLabel} task '${selectedTask.name}' triggered successfully.`;
                //vscode.window.showInformationMessage(msg);
                return { handled: true, message: msg };
            }
        } catch (err) {
            const msg = `❌ Failed to execute ${actionLabel} task using selection: ${err}`;
            vscode.window.showErrorMessage(msg);
            return { handled: false, message: msg };
        }
    }

    // Default: mimic Ctrl+Shift+B behavior with native VSCode fallback
    try {
        await vscode.commands.executeCommand(taskCommand);
        const msg = `✅ ${actionLabel} triggered via VSCode Tasks (${folderName ?? "workspace"}).`;
        //vscode.window.showInformationMessage(msg);
        return { handled: true, message: msg };
    } catch (err) {
        const msg = `❌ Failed to execute ${actionLabel}: ${err}`;
        vscode.window.showErrorMessage(msg);
        return { handled: false, message: msg };
    }
}

async function resolveCommandToExecute(
    commandToExecute: string,
    commandRiskLevel: "low" | "medium" | "high",
    cwd: string | undefined,
): Promise<{ resolvedCommand?: string; result?: ActionResult }> {
    if (commandRiskLevel === "high") {
        const msg = `⚠️ Command execution blocked due to high risk: '${commandToExecute}'.`;
        vscode.window.showWarningMessage(msg);
        return { result: { handled: false, message: msg } };
    }

    const contextFolder = cwd ? vscode.Uri.file(cwd) : undefined;
    let resolvedCommand = await aliasManager.resolveCommandWithArgs(
        commandToExecute,
        contextFolder,
    );

    if (!resolvedCommand) {
        const msg = `⚠️ No alias found for '${commandToExecute}', using raw input.`;
        vscode.window.showWarningMessage(msg);
        resolvedCommand = commandToExecute;
    }

    return { resolvedCommand };
}

export async function handleOpenInIntegratedTerminal(
    action: any,
): Promise<ActionResult> {
    const parameters = action?.parameters ?? {};
    const folderName = parameters.folderName;
    const commandToExecute = parameters.commandToExecute;
    const commandRiskLevel: "low" | "medium" | "high" =
        parameters.commandRiskLevel ?? "low";
    const reuseExistingTerminal = parameters.reuseExistingTerminal ?? true;

    await aliasManager.ready;
    let cwd: string | undefined;

    if (folderName) {
        const matches = await findMatchingFolders(path.basename(folderName));
        if (matches.length === 0) {
            const msg = `❌ No folders found matching '${folderName}'.`;
            vscode.window.showErrorMessage(msg);
            return { handled: false, message: msg };
        }

        const targetFolder =
            matches.length === 1
                ? matches[0]
                : (
                      await vscode.window.showQuickPick(
                          matches.map((uri) => ({
                              label: vscode.workspace.asRelativePath(uri),
                              uri,
                          })),
                          {
                              placeHolder: `Multiple folders found. Select where to open the terminal:`,
                          },
                      )
                  )?.uri;

        if (!targetFolder) {
            const msg = "⚠️ Terminal opening cancelled by user.";
            vscode.window.showInformationMessage(msg);
            return { handled: false, message: msg };
        }

        cwd = targetFolder.fsPath;
    } else {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders && workspaceFolders.length > 0) {
            cwd = workspaceFolders[0].uri.fsPath;
        }
    }

    let resolvedCommand: string | undefined;
    if (commandToExecute) {
        const { resolvedCommand: cmd, result } = await resolveCommandToExecute(
            commandToExecute,
            commandRiskLevel,
            cwd,
        );

        if (result) {
            return result;
        }
        resolvedCommand = cmd;
    }

    // If the resolved command is a VSCode command, execute it directly
    if (
        resolvedCommand &&
        !resolvedCommand.includes(" ") &&
        resolvedCommand.includes(".")
    ) {
        try {
            await vscode.commands.executeCommand(resolvedCommand);
            const msg = `✅ Executed VSCode command: ${resolvedCommand}.`;
            vscode.window.showInformationMessage(msg);
            return { handled: true, message: msg };
        } catch (err) {
            const msg = `❌ Failed to execute VSCode command: ${resolvedCommand}. ${err}`;
            vscode.window.showErrorMessage(msg);
            return { handled: false, message: msg };
        }
    }

    // Otherwise, open the terminal and send the command
    let terminal: vscode.Terminal;
    try {
        if (reuseExistingTerminal && vscode.window.activeTerminal) {
            terminal = vscode.window.activeTerminal;
        } else {
            terminal = cwd
                ? vscode.window.createTerminal({
                      name: folderName ? `Terminal: ${folderName}` : `Terminal`,
                      cwd: vscode.Uri.file(cwd),
                  })
                : vscode.window.createTerminal(
                      folderName ? `Terminal: ${folderName}` : `Terminal`,
                  );
        }

        terminal.show();
        if (resolvedCommand) {
            terminal.sendText(resolvedCommand);
        }
    } catch (error) {
        console.error("❌ Failed to create or show terminal:", error);
        const msg = `❌ Failed to open terminal: ${error instanceof Error ? error.message : String(error)}`;
        vscode.window.showErrorMessage(msg);
        return { handled: false, message: msg };
    }

    const msg = `✅ Opened integrated terminal${folderName ? ` in '${folderName}'` : ""}${resolvedCommand ? ` and executed '${resolvedCommand}'` : ""}.`;
    return { handled: true, message: msg };
}

export async function handleOpenFolderInExplorer(
    action: any,
): Promise<ActionResult> {
    const parameters = action?.parameters;
    if (!parameters || !parameters.folderName) {
        return {
            handled: false,
            message: "❌ Missing 'folderName' parameter.",
        };
    }

    const {
        folderName,
        folderRelativeTo,
        includeGenerated = false,
    } = parameters;
    let matches: vscode.Uri[] = [];

    try {
        if (folderRelativeTo) {
            const parentFolders = await findMatchingFolders(
                folderRelativeTo,
                includeGenerated,
            );
            for (const parent of parentFolders) {
                const childUri = vscode.Uri.joinPath(parent, folderName);
                try {
                    const stat = await vscode.workspace.fs.stat(childUri);
                    if (stat.type === vscode.FileType.Directory) {
                        matches.push(childUri);
                    }
                } catch {
                    // continue if child folder doesn't exist
                }
            }
        } else {
            matches = await findMatchingFolders(folderName, includeGenerated);
        }

        if (matches.length === 0) {
            return {
                handled: false,
                message: `❌ Folder '${folderName}' not found.`,
            };
        }

        let selectedUri: vscode.Uri;
        if (matches.length === 1) {
            selectedUri = matches[0];
        } else {
            const pick = await vscode.window.showQuickPick(
                matches.map((uri) => ({
                    label: vscode.workspace.asRelativePath(uri),
                    uri,
                })),
                {
                    placeHolder: `Multiple matches for '${folderName}', select one to open:`,
                },
            );

            if (!pick) {
                return {
                    handled: false,
                    message: "⚠️ Folder selection cancelled by user.",
                };
            }
            selectedUri = pick.uri;
        }

        await vscode.commands.executeCommand("revealInExplorer", selectedUri);

        return {
            handled: true,
            message: `📁 Opened folder '${folderName}' in Explorer.`,
        };
    } catch (error) {
        return {
            handled: false,
            message: `❌ Error opening folder: ${error instanceof Error ? error.message : String(error)}`,
        };
    }
}

export async function handleWorkbenchActions(
    action: any,
): Promise<ActionResult> {
    let actionResult: ActionResult = {
        handled: true,
        message: "Ok",
    };

    const actionName =
        action.actionName ?? action.fullActionName.split(".").at(-1);

    switch (actionName) {
        case "workbenchOpenFile":
            actionResult = await handleOpenFileAction(action);
            break;
        case "workbenchOpenFolder":
            actionResult = await handleOpenFolderInExplorer(action);
            break;
        case "workbenchCreateFolderFromExplorer":
            actionResult = await handleCreateFolderFromExplorer(action);
            break;
        case "workbenchBuildRelatedTask":
            actionResult = await handleFolderBuildRelatedTaskAction(action);
            break;
        case "openInIntegratedTerminal":
            actionResult = await handleOpenInIntegratedTerminal(action);
            break;
        default: {
            actionResult.message = `Did not understand the request for action: "${actionName}"`;
            actionResult.handled = false;
        }
    }

    return actionResult;
}
