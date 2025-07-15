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
        // fallback to currently active file
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return {
                handled: false,
                message: "No active editor and no fileName provided.",
            };
        }
        uri = editor.document.uri;
    }

    const position = new vscode.Position(line - 1, 0); // lineNumber is 1-based
    const location = new vscode.Location(uri, position);
    const breakpoint = new vscode.SourceBreakpoint(location, true);

    vscode.debug.addBreakpoints([breakpoint]);

    return {
        handled: true,
        message: `✅ Breakpoint set at line ${line} in ${vscode.workspace.asRelativePath(uri)}`,
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
            vscode.commands.executeCommand(
                "editor.debug.action.toggleBreakpoint",
            );
            actionResult.message = "Toggled breakpoint";
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
        default: {
            actionResult.message = `Did not understand the request for action: "${actionName}"`;
            actionResult.handled = false;
        }
    }

    return actionResult;
}
