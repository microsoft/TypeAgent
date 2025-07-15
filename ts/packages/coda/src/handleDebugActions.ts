import * as vscode from "vscode";
import { ActionResult, findMatchingFiles } from "./helpers";

async function handleStartDebuggingAction(action: any): Promise<ActionResult> {
    const parameters = action?.parameters ?? {};
    const configName = parameters.configurationName?.toLowerCase();
    const noDebug = parameters.noDebug ?? false;
    const folder = vscode.workspace.workspaceFolders?.[0];

    const launchConfig = vscode.workspace.getConfiguration(
        "launch",
        folder?.uri,
    );
    const configurations: vscode.DebugConfiguration[] =
        launchConfig.get("configurations") ?? [];

    if (!configurations.length) {
        const msg = "❌ No debug configurations found in launch.json.";
        vscode.window.showErrorMessage(msg);
        return { handled: false, message: msg };
    }

    let selectedConfig: vscode.DebugConfiguration | undefined;

    if (configName) {
        const matches = configurations.filter((cfg) =>
            cfg.name?.toLowerCase().includes(configName),
        );

        if (matches.length === 1) {
            selectedConfig = matches[0];
        } else if (matches.length > 1) {
            const pick = await vscode.window.showQuickPick(
                matches.map((cfg) => ({ label: cfg.name, config: cfg })),
                {
                    placeHolder: `Multiple debug configs match '${configName}'. Select one to launch:`,
                },
            );
            if (!pick) {
                const msg = "⚠️ Debug launch canceled.";
                return { handled: false, message: msg };
            }
            selectedConfig = pick.config;
        } else {
            const msg = `❌ No debug configurations matching '${configName}' found.`;
            vscode.window.showErrorMessage(msg);
            return { handled: false, message: msg };
        }
    } else {
        // No name provided; fallback to default (first or prelaunch)
        selectedConfig = configurations[0];
    }

    const started = await vscode.debug.startDebugging(folder, selectedConfig, {
        noDebug,
    });
    if (started) {
        return {
            handled: true,
            message: `✅ Debugging started${selectedConfig ? ` with '${selectedConfig.name}'` : ""}.`,
        };
    } else {
        const msg = `❌ Failed to start debugging${selectedConfig ? ` with '${selectedConfig.name}'` : ""}.`;
        vscode.window.showErrorMessage(msg);
        return { handled: false, message: msg };
    }
}

export async function handleSetBreakpointAction(
    action: any,
): Promise<ActionResult> {
    const parameters = action?.parameters;
    if (!parameters || typeof parameters.line !== "number") {
        return {
            handled: false,
            message: "Missing or invalid 'line' parameter.",
        };
    }

    const { line, fileName } = parameters;
    let uri: vscode.Uri | undefined;

    if (fileName) {
        const matches = await findMatchingFiles(fileName, {
            extensions: undefined,
            matchStrategy: "fuzzy",
            includeGenerated: false,
            maxResults: 10,
        });

        if (matches.length === 0) {
            return {
                handled: false,
                message: `No matching file found for '${fileName}'.`,
            };
        }

        if (matches.length === 1) {
            uri = matches[0];
        } else {
            const pick = await vscode.window.showQuickPick(
                matches.map((m) => ({
                    label: vscode.workspace.asRelativePath(m),
                    uri: m,
                })),
                {
                    placeHolder: `Multiple matches for '${fileName}', select one:`,
                },
            );
            if (!pick) {
                return {
                    handled: false,
                    message: "User cancelled file selection.",
                };
            }
            uri = pick.uri;
        }
    } else {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return {
                handled: false,
                message: "No active editor and no fileName provided.",
            };
        }
        uri = editor.document.uri;
    }

    try {
        const doc = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(doc, { preview: false });

        const position = new vscode.Position(line - 1, 0);
        const location = new vscode.Location(uri, position);
        const breakpoint = new vscode.SourceBreakpoint(location, true);

        vscode.debug.addBreakpoints([breakpoint]);

        const msg = `✅ Breakpoint set at line ${line} in ${vscode.workspace.asRelativePath(uri)}`;
        return { handled: true, message: msg };
    } catch (error) {
        return {
            handled: false,
            message: `❌ Failed to open file or set breakpoint: ${error instanceof Error ? error.message : String(error)}`,
        };
    }
}

export async function handleToggleBreakpointAction(
    action: any,
): Promise<ActionResult> {
    const parameters = action?.parameters;
    if (!parameters || typeof parameters.line !== "number") {
        return {
            handled: false,
            message: "Missing or invalid 'line' parameter.",
        };
    }

    const { line, fileName, folderName } = parameters;
    let uri: vscode.Uri | undefined;

    // Find the file if fileName is provided
    if (fileName) {
        const matches = await findMatchingFiles(fileName, {
            extensions: undefined,
            matchStrategy: "fuzzy",
            includeGenerated: false,
            maxResults: 10,
        });

        const filtered = folderName
            ? matches.filter((m) =>
                  vscode.workspace.asRelativePath(m).includes(folderName),
              )
            : matches;

        if (filtered.length === 0) {
            return {
                handled: false,
                message: `No matching file found for '${fileName}'${folderName ? ` in '${folderName}'` : ""}.`,
            };
        }

        if (filtered.length === 1) {
            uri = filtered[0];
        } else {
            const pick = await vscode.window.showQuickPick(
                filtered.map((m) => ({
                    label: vscode.workspace.asRelativePath(m),
                    uri: m,
                })),
                {
                    placeHolder: `Multiple matches for '${fileName}', select one:`,
                },
            );
            if (!pick) {
                return {
                    handled: false,
                    message: "User cancelled file selection.",
                };
            }
            uri = pick.uri;
        }
    } else {
        // Fallback to active file
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return {
                handled: false,
                message: "No active editor and no fileName provided.",
            };
        }
        uri = editor.document.uri;
    }

    try {
        const doc = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(doc, { preview: false });

        const position = new vscode.Position(line - 1, 0);
        const existing = vscode.debug.breakpoints.find(
            (bp) =>
                bp instanceof vscode.SourceBreakpoint &&
                bp.location.uri.toString() === uri!.toString() &&
                bp.location.range.start.line === position.line,
        );

        if (existing) {
            vscode.debug.removeBreakpoints([existing]);
            return {
                handled: true,
                message: `⛔ Breakpoint removed at line ${line} in ${vscode.workspace.asRelativePath(uri)}`,
            };
        } else {
            const location = new vscode.Location(uri, position);
            const breakpoint = new vscode.SourceBreakpoint(location, true);
            vscode.debug.addBreakpoints([breakpoint]);
            return {
                handled: true,
                message: `✅ Breakpoint added at line ${line} in ${vscode.workspace.asRelativePath(uri)}`,
            };
        }
    } catch (err) {
        return {
            handled: false,
            message: `❌ Failed to toggle breakpoint: ${err instanceof Error ? err.message : String(err)}`,
        };
    }
}

export async function handleRemoveBreakpointAction(
    action: any,
): Promise<ActionResult> {
    const parameters = action?.parameters;
    if (!parameters || typeof parameters.line !== "number") {
        return {
            handled: false,
            message: "Missing or invalid 'line' parameter.",
        };
    }

    const { line, fileName, folderName } = parameters;
    let uri: vscode.Uri | undefined;

    if (fileName) {
        const matches = await findMatchingFiles(fileName, {
            extensions: undefined,
            matchStrategy: "fuzzy",
            includeGenerated: false,
            maxResults: 10,
        });

        const filtered = folderName
            ? matches.filter((m) =>
                  vscode.workspace.asRelativePath(m).includes(folderName),
              )
            : matches;

        if (filtered.length === 0) {
            return {
                handled: false,
                message: `No matching file found for '${fileName}'${folderName ? ` in '${folderName}'` : ""}.`,
            };
        }

        if (filtered.length === 1) {
            uri = filtered[0];
        } else {
            const pick = await vscode.window.showQuickPick(
                filtered.map((m) => ({
                    label: vscode.workspace.asRelativePath(m),
                    uri: m,
                })),
                {
                    placeHolder: `Multiple matches for '${fileName}', select one:`,
                },
            );
            if (!pick) {
                return {
                    handled: false,
                    message: "User cancelled file selection.",
                };
            }
            uri = pick.uri;
        }
    } else {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return {
                handled: false,
                message: "No active editor and no fileName provided.",
            };
        }
        uri = editor.document.uri;
    }

    const position = new vscode.Position(line - 1, 0);

    const matching = vscode.debug.breakpoints.filter(
        (bp) =>
            bp instanceof vscode.SourceBreakpoint &&
            bp.location.uri.toString() === uri!.toString() &&
            bp.location.range.start.line === position.line,
    );

    if (matching.length === 0) {
        return {
            handled: false,
            message: `⚠️ No breakpoint found at line ${line} in ${vscode.workspace.asRelativePath(uri)}`,
        };
    }

    vscode.debug.removeBreakpoints(matching);

    return {
        handled: true,
        message: `🧹 Removed breakpoint at line ${line} in ${vscode.workspace.asRelativePath(uri)}`,
    };
}

export async function handleRemoveAllBreakpointsAction(
    action: any,
): Promise<ActionResult> {
    const allBreakpoints = vscode.debug.breakpoints;

    if (allBreakpoints.length === 0) {
        return {
            handled: true,
            message: "ℹ️ There are no breakpoints to remove.",
        };
    }

    vscode.debug.removeBreakpoints(allBreakpoints);

    return {
        handled: true,
        message: `🧹 Removed all ${allBreakpoints.length} breakpoint(s).`,
    };
}

export async function handleDebugActions(action: any): Promise<ActionResult> {
    let actionResult: ActionResult = {
        handled: true,
        message: "Ok",
    };

    const actionName =
        action.actionName ?? action.fullActionName.split(".").at(-1);

    switch (actionName) {
        case "showDebugPanel": {
            vscode.commands.executeCommand("workbench.view.debug");
            actionResult.message = "Showing debug panel";
            break;
        }
        case "startDebugging": {
            actionResult = await handleStartDebuggingAction(action);
            //vscode.commands.executeCommand("workbench.action.debug.start");
            //actionResult.message = "Started debugging";
            break;
        }
        case "stopDebugging": {
            vscode.commands.executeCommand("workbench.action.debug.stop");
            actionResult.message = "Stopped debugging";
            break;
        }
        case "toggleBreakpoint": {
            actionResult = await handleToggleBreakpointAction(action);
            break;
        }
        case "step": {
            if (action.parameters.stepType === "into") {
                vscode.commands.executeCommand("editor.debug.action.stepInto");
                actionResult.message = "Stepped into";
            } else if (action.parameters.stepType === "out") {
                vscode.commands.executeCommand("editor.debug.action.stepOut");
                actionResult.message = "Stepped out";
            } else if (action.parameters.stepType === "over") {
                vscode.commands.executeCommand("editor.debug.action.stepOver");
                actionResult.message = "Stepped over";
            } else {
                actionResult.message = "Did not understand the step type";
                actionResult.handled = false;
            }
            break;
        }
        case "showHover": {
            vscode.commands.executeCommand(
                "editor.debug.action.showDebugHover",
            );
            actionResult.message = "Showing hover";
            break;
        }
        case "setBreakpoint": {
            actionResult = await handleSetBreakpointAction(action);
            break;
        }
        case "removeBreakpoint": {
            actionResult = await handleRemoveBreakpointAction(action);
            break;
        }
        case "removeAllBreakpoints": {
            actionResult = await handleRemoveAllBreakpointsAction(action);
            break;
        }
        default: {
            actionResult.message = `Did not understand the request for action: "${actionName}"`;
            actionResult.handled = false;
        }
    }

    return actionResult;
}
