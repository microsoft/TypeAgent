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
import {
    WorkspaceCommandRunner,
    WorkspaceCommandResult,
} from "./workspaceCommandRunner";
import { validateFocusedWorkspaceCommand } from "./workspaceCommandPolicy";

const workspaceCommandRunner = new WorkspaceCommandRunner();

type WorkspaceCommandParameters = {
    command?: unknown;
    workspaceFolder?: unknown;
    workingDirectory?: unknown;
    commandRiskLevel?: unknown;
    timeoutMs?: unknown;
    executionId?: unknown;
    allowPendingCancellation?: unknown;
};

function workspaceCommandResponse(
    result:
        | WorkspaceCommandResult
        | {
              success: boolean;
              error?: string;
              executionId?: string;
              cancelled?: boolean;
              pendingCancellation?: boolean;
          },
): ActionResult {
    if ("exitCode" in result) {
        return { handled: true, message: JSON.stringify(result) };
    }
    return {
        handled: true,
        message: JSON.stringify({
            success: result.success,
            error: result.error,
            exitCode: null,
            durationMs: 0,
            stdout: { text: "", truncated: false, totalBytes: 0 },
            stderr: { text: "", truncated: false, totalBytes: 0 },
            timedOut: false,
            cancelled: result.cancelled ?? false,
            pendingCancellation: result.pendingCancellation ?? false,
            executionId: result.executionId,
        }),
    };
}

export function workspaceCommandError(
    error: string,
    executionId?: string,
): ActionResult {
    return workspaceCommandResponse({ success: false, error, executionId });
}

const workspaceCommandActionNames = new Set([
    "runWorkspaceCommand",
    "cancelWorkspaceCommand",
]);

// Only these actions answer with the structured command-result shape. Every
// other action keeps the plain ActionResult contract.
export function isWorkspaceCommandAction(actionName: string): boolean {
    return workspaceCommandActionNames.has(actionName);
}

function validateWorkspaceCommandPaths(
    parameters: WorkspaceCommandParameters,
): string | undefined {
    for (const parameter of ["workspaceFolder", "workingDirectory"] as const) {
        const value = parameters[parameter];
        if (
            value !== undefined &&
            (typeof value !== "string" || value.trim().length === 0)
        ) {
            return `${parameter} must be a non-empty string.`;
        }
    }
    return undefined;
}

function selectWorkspaceFolder(
    workspaceFolders: readonly vscode.WorkspaceFolder[],
    requestedWorkspaceFolder: string | undefined,
): vscode.WorkspaceFolder | { error: string } {
    if (requestedWorkspaceFolder !== undefined) {
        const requestedPath = path.resolve(requestedWorkspaceFolder);
        const workspaceFolder = workspaceFolders.find(
            (folder) =>
                folder.name === requestedWorkspaceFolder ||
                path.resolve(folder.uri.fsPath) === requestedPath,
        );
        return (
            workspaceFolder ?? {
                error: `No open workspace root matches '${requestedWorkspaceFolder}'.`,
            }
        );
    }
    const activeUri = vscode.window.activeTextEditor?.document.uri;
    const activeWorkspaceFolder = activeUri
        ? vscode.workspace.getWorkspaceFolder(activeUri)
        : undefined;
    if (activeWorkspaceFolder !== undefined) {
        return activeWorkspaceFolder;
    }
    if (workspaceFolders.length === 1) {
        return workspaceFolders[0];
    }
    return {
        error: "Multiple workspace roots are open. Specify workspaceFolder by name or absolute path.",
    };
}

function resolveWorkspaceChildDirectory(
    root: string,
    workingDirectory: string | undefined,
): string | { error: string } {
    const cwd =
        workingDirectory !== undefined
            ? path.resolve(root, workingDirectory)
            : root;
    const relativePath = path.relative(root, cwd);
    if (
        (workingDirectory !== undefined && path.isAbsolute(workingDirectory)) ||
        relativePath === ".." ||
        relativePath.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relativePath)
    ) {
        return {
            error: "workingDirectory must stay within the selected workspace root.",
        };
    }
    return cwd;
}

async function verifyWorkspaceDirectory(
    cwd: string,
    workspaceRoot: string,
): Promise<{ cwd: string; workspaceRoot: string } | { error: string }> {
    try {
        if (!(await fs.stat(cwd)).isDirectory()) {
            return { error: `workingDirectory is not a directory: ${cwd}` };
        }
        const [realCwd, realWorkspaceRoot] = await Promise.all([
            fs.realpath(cwd),
            fs.realpath(workspaceRoot),
        ]);
        const relativePath = path.relative(realWorkspaceRoot, realCwd);
        if (
            relativePath === ".." ||
            relativePath.startsWith(`..${path.sep}`) ||
            path.isAbsolute(relativePath)
        ) {
            return {
                error: "workingDirectory must stay within the selected workspace root.",
            };
        }
        return { cwd: realCwd, workspaceRoot: realWorkspaceRoot };
    } catch (error) {
        return {
            error: `workingDirectory does not exist: ${
                error instanceof Error ? error.message : String(error)
            }`,
        };
    }
}

async function resolveWorkspaceCommandDirectory(
    parameters: WorkspaceCommandParameters,
): Promise<{ cwd: string; workspaceRoot: string } | { error: string }> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        return { error: "No workspace or repository is currently open." };
    }
    const pathError = validateWorkspaceCommandPaths(parameters);
    if (pathError !== undefined) {
        return { error: pathError };
    }
    const workspaceFolder = selectWorkspaceFolder(
        workspaceFolders,
        parameters.workspaceFolder as string | undefined,
    );
    if ("error" in workspaceFolder) {
        return workspaceFolder;
    }
    if (workspaceFolder.uri.scheme !== "file") {
        return {
            error: `Workspace root '${workspaceFolder.name}' is not a local filesystem folder.`,
        };
    }

    const workingDirectory =
        typeof parameters.workingDirectory === "string"
            ? parameters.workingDirectory
            : undefined;
    const root = workspaceFolder.uri.fsPath;
    const cwd = resolveWorkspaceChildDirectory(root, workingDirectory);
    if (typeof cwd !== "string") {
        return cwd;
    }
    return verifyWorkspaceDirectory(cwd, root);
}

export async function handleRunWorkspaceCommand(action: {
    parameters?: WorkspaceCommandParameters;
}): Promise<ActionResult> {
    const parameters = action.parameters ?? {};
    const executionId =
        typeof parameters.executionId === "string"
            ? parameters.executionId
            : undefined;
    if (typeof parameters.command !== "string") {
        return workspaceCommandError("command must be a string.", executionId);
    }
    if (
        parameters.timeoutMs !== undefined &&
        typeof parameters.timeoutMs !== "number"
    ) {
        return workspaceCommandError(
            "timeoutMs must be a number.",
            executionId,
        );
    }
    if (
        parameters.executionId !== undefined &&
        (typeof parameters.executionId !== "string" ||
            parameters.executionId.trim().length === 0 ||
            parameters.executionId.length > 128)
    ) {
        return workspaceCommandError(
            "executionId must be a non-empty string no longer than 128 characters.",
        );
    }
    if (
        executionId !== undefined &&
        workspaceCommandRunner.consumePendingCancellation(executionId)
    ) {
        return workspaceCommandResponse({
            success: false,
            exitCode: null,
            durationMs: 0,
            command: parameters.command,
            cwd: "",
            stdout: { text: "", truncated: false, totalBytes: 0 },
            stderr: { text: "", truncated: false, totalBytes: 0 },
            timedOut: false,
            cancelled: true,
            executionId,
        });
    }
    const declaredRiskLevel =
        parameters.commandRiskLevel === undefined
            ? "low"
            : parameters.commandRiskLevel;
    if (
        declaredRiskLevel !== "low" &&
        declaredRiskLevel !== "medium" &&
        declaredRiskLevel !== "high"
    ) {
        return workspaceCommandError(
            "commandRiskLevel must be low, medium, or high.",
            executionId,
        );
    }
    const directory = await resolveWorkspaceCommandDirectory(parameters);
    if ("error" in directory) {
        return workspaceCommandError(directory.error, executionId);
    }

    if (declaredRiskLevel === "high") {
        return workspaceCommandError(
            "Command execution blocked due to high risk.",
            executionId,
        );
    }
    const commandPolicyError = validateFocusedWorkspaceCommand(
        parameters.command,
        directory.cwd,
        directory.workspaceRoot,
    );
    if (commandPolicyError !== undefined) {
        return workspaceCommandError(commandPolicyError, executionId);
    }
    const result = await workspaceCommandRunner.run({
        command: parameters.command,
        cwd: directory.cwd,
        ...(parameters.timeoutMs === undefined
            ? {}
            : { timeoutMs: parameters.timeoutMs }),
        ...(parameters.executionId === undefined
            ? {}
            : { executionId: parameters.executionId }),
    });
    return "error" in result
        ? workspaceCommandError(result.error, executionId)
        : workspaceCommandResponse(result);
}

export function handleCancelWorkspaceCommand(action: {
    parameters?: WorkspaceCommandParameters;
}): ActionResult {
    const executionId = action.parameters?.executionId;
    if (typeof executionId !== "string" || executionId.trim().length === 0) {
        return workspaceCommandError("executionId must be a non-empty string.");
    }
    const cancellation = workspaceCommandRunner.cancel(
        executionId,
        action.parameters?.allowPendingCancellation === true,
    );
    const cancelled = cancellation === "cancelled";
    return workspaceCommandResponse({
        success: cancellation !== "notFound",
        cancelled,
        pendingCancellation: cancellation === "pending",
        executionId,
        ...(cancellation !== "notFound"
            ? {}
            : { error: "No active command has that executionId." }),
    });
}

export function cancelWorkspaceCommands(): void {
    workspaceCommandRunner.cancelAll();
}

async function handleOpenFileAction(action: any): Promise<ActionResult> {
    const actionResult: ActionResult = {
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

async function resolveTerminalDirectory(
    folderName: string | undefined,
): Promise<string | ActionResult | undefined> {
    if (!folderName) {
        return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    }
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
    return targetFolder.fsPath;
}

async function executeVsCodeTerminalCommand(
    resolvedCommand: string | undefined,
): Promise<ActionResult | undefined> {
    if (
        !resolvedCommand ||
        resolvedCommand.includes(" ") ||
        !resolvedCommand.includes(".")
    ) {
        return undefined;
    }
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

function createOrReuseTerminal(
    reuseExistingTerminal: boolean,
    cwd: string | undefined,
    folderName: string | undefined,
): vscode.Terminal {
    if (reuseExistingTerminal && vscode.window.activeTerminal) {
        return vscode.window.activeTerminal;
    }
    const name = folderName ? `Terminal: ${folderName}` : "Terminal";
    return cwd
        ? vscode.window.createTerminal({ name, cwd: vscode.Uri.file(cwd) })
        : vscode.window.createTerminal(name);
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
    const directoryResult = await resolveTerminalDirectory(folderName);
    if (directoryResult && typeof directoryResult !== "string") {
        return directoryResult;
    }
    const cwd = directoryResult;

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

    const vsCodeCommandResult =
        await executeVsCodeTerminalCommand(resolvedCommand);
    if (vsCodeCommandResult !== undefined) {
        return vsCodeCommandResult;
    }

    // Otherwise, open the terminal and send the command
    let terminal: vscode.Terminal;
    try {
        terminal = createOrReuseTerminal(
            reuseExistingTerminal,
            cwd,
            folderName,
        );

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
        case "runWorkspaceCommand":
            actionResult = await handleRunWorkspaceCommand(action);
            break;
        case "cancelWorkspaceCommand":
            actionResult = handleCancelWorkspaceCommand(action);
            break;
        default: {
            actionResult.message = `Did not understand the request for action: "${actionName}"`;
            actionResult.handled = false;
        }
    }

    return actionResult;
}
