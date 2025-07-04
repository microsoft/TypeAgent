// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import child_process from "node:child_process";
import { fileURLToPath } from "node:url";
import { ProgramNameIndex, loadProgramNameIndex } from "./programNameIndex.js";
import { Storage } from "@typeagent/agent-sdk";
import registerDebug from "debug";
import { DesktopActions } from "./actionsSchema.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { downloadImage } from "common-utils";
import { randomUUID } from "crypto";

const debug = registerDebug("typeagent:desktop");
const debugData = registerDebug("typeagent:desktop:data");
const debugError = registerDebug("typeagent:desktop:error");

export type DesktopActionContext = {
    desktopProcess: child_process.ChildProcess | undefined;
    programNameIndex: ProgramNameIndex | undefined;
    refreshPromise: Promise<void> | undefined;
    abortRefresh: AbortController | undefined;
};

const autoShellPath = new URL(
    "../../../../../dotnet/autoShell/bin/Debug/autoShell.exe",
    import.meta.url,
);

async function spawnAutomationProcess() {
    return new Promise<child_process.ChildProcess>((resolve, reject) => {
        const child = child_process.spawn(fileURLToPath(autoShellPath));
        child.on("error", (err) => {
            reject(err);
        });
        child.on("spawn", () => {
            resolve(child);
        });
    });
}

async function ensureAutomationProcess(agentContext: DesktopActionContext) {
    if (agentContext.desktopProcess !== undefined) {
        return agentContext.desktopProcess;
    }

    const child = await spawnAutomationProcess();
    child.on("exit", (code) => {
        debug(`Child exited with code ${code}`);
        agentContext.desktopProcess = undefined;
    });

    // For tracing
    child.stdout?.on("data", (data) => {
        debugData(`Process data: ${data.toString()}`);
    });

    child.stderr?.on("error", (data) => {
        debugError(`Process error: ${data.toString()}`);
    });

    agentContext.desktopProcess = child;
    return child;
}

export async function runDesktopActions(
    action: DesktopActions,
    agentContext: DesktopActionContext,
    sessionStorage: Storage,
) {
    let confirmationMessage = "OK";
    let actionData = "";
    const actionName = action.actionName;
    switch (actionName) {
        case "setWallpaper": {
            let file = action.parameters.filePath;
            const rootTypeAgentDir = path.join(os.homedir(), ".typeagent");

            // if the requested image is a URL, then download it
            if (action.parameters.url !== undefined) {
                // Remove any query parameters from the url and get just the file name
                const parsedUrl = new URL(action.parameters.url);
                const urlPath = parsedUrl.pathname;
                const urlFileName = urlPath.substring(
                    urlPath.lastIndexOf("/") + 1,
                );

                // Download the file and store it with a unique file name
                const id = randomUUID();
                file = `../downloaded_images/${id.toString()}${path.extname(urlFileName)}`;
                if (path.extname(file).length == 0) {
                    file += ".png";
                }
                if (
                    await downloadImage(
                        action.parameters.url,
                        file,
                        sessionStorage!,
                    )
                ) {
                    file = file.substring(3);
                } else {
                    confirmationMessage =
                        "Failed to download the requested image.";
                    break;
                }
            }

            if (file !== undefined) {
                if (
                    file.startsWith("/") ||
                    file.indexOf(":") == 2 ||
                    fs.existsSync(file)
                ) {
                    actionData = file;
                } else {
                    // if the file path is relative we'll have to search for the image since we don't have root storage dir
                    // TODO: add shared agent storage or known storage location (requires permissions, trusted agents, etc.)
                    const files = fs
                        .readdirSync(rootTypeAgentDir, { recursive: true })
                        .filter((allFilesPaths) =>
                            (allFilesPaths as string).endsWith(
                                path.basename(file),
                            ),
                        );

                    if (files.length > 0) {
                        actionData = path.join(
                            rootTypeAgentDir,
                            files[0] as string,
                        );
                    } else {
                        actionData = file;
                    }
                }
            } else {
                confirmationMessage = "Unknown wallpaper location.";
                break;
            }

            confirmationMessage = "Set wallpaper to " + actionData;
            break;
        }
        case "launchProgram": {
            actionData = await mapInputToAppName(
                action.parameters.name,
                agentContext,
            );
            confirmationMessage = "Launched " + action.parameters.name;
            break;
        }
        case "closeProgram": {
            actionData = await mapInputToAppName(
                action.parameters.name,
                agentContext,
            );
            confirmationMessage = "Closed " + action.parameters.name;
            break;
        }
        case "maximize": {
            actionData = await mapInputToAppName(
                action.parameters.name,
                agentContext,
            );
            confirmationMessage = "Maximized " + action.parameters.name;
            break;
        }
        case "minimize": {
            actionData = await mapInputToAppName(
                action.parameters.name,
                agentContext,
            );
            confirmationMessage = "Minimized " + action.parameters.name;
            break;
        }
        case "switchTo": {
            actionData = await mapInputToAppName(
                action.parameters.name,
                agentContext,
            );
            confirmationMessage = "Switched to " + action.parameters.name;
            break;
        }
        case "tile": {
            const left = await mapInputToAppName(
                action.parameters.leftWindow,
                agentContext,
            );
            const right = await mapInputToAppName(
                action.parameters.rightWindow,
                agentContext,
            );
            actionData = `${left},${right}`;
            confirmationMessage = `Tiled ${left} on the left and ${right} on the right`;
            break;
        }
        case "volume": {
            actionData = action.parameters.targetVolume.toString();
            break;
        }
        case "restoreVolume": {
            actionData = "";
            break;
        }
        case "mute": {
            actionData = String(action.parameters.on);
            break;
        }
    }

    // send message to child process
    let message: Record<string, string> = {};
    message[actionName] = actionData;

    const desktopProcess = await ensureAutomationProcess(agentContext);
    desktopProcess.stdin?.write(JSON.stringify(message) + "\r\n");

    return confirmationMessage;
}

async function fetchInstalledApps(desktopProcess: child_process.ChildProcess) {
    let timeoutHandle: NodeJS.Timeout;

    const timeoutPromise = new Promise<undefined>((_resolve, reject) => {
        timeoutHandle = setTimeout(() => {
            debugError("Timeout while fetching installed apps");
            reject(undefined);
        }, 60000);
    });

    const appsPromise = new Promise<string[] | undefined>((resolve, reject) => {
        let message: Record<string, string> = {};
        message["listAppNames"] = "";

        let allOutput = "";
        const dataCallBack = (data: any) => {
            allOutput += data.toString();
            try {
                const programs = JSON.parse(allOutput);
                desktopProcess.stdout?.off("data", dataCallBack);
                desktopProcess.stderr?.off("error", errorCallback);
                resolve(programs);
            } catch {}
        };

        const errorCallback = (data: any) => {
            desktopProcess.stdout?.off("data", dataCallBack);
            desktopProcess.stderr?.off("error", errorCallback);
            reject(data.toString());
        };

        desktopProcess.stdout?.on("data", dataCallBack);
        desktopProcess.stderr?.on("error", errorCallback);

        desktopProcess.stdin?.write(JSON.stringify(message) + "\r\n");
    });

    return Promise.race([appsPromise, timeoutPromise]).then((result) => {
        clearTimeout(timeoutHandle);
        return result;
    });
}

async function finishRefresh(agentContext: DesktopActionContext) {
    if (agentContext.refreshPromise !== undefined) {
        await agentContext.refreshPromise;
        agentContext.refreshPromise = undefined;
        return true;
    }
    return false;
}

async function mapInputToAppNameFromIndex(
    input: string,
    programNameIndex: ProgramNameIndex,
): Promise<string | undefined> {
    let matchedNames = await programNameIndex.search(input, 1);
    if (matchedNames && matchedNames.length > 0) {
        return matchedNames[0].item.value;
    }
    return undefined;
}

async function mapInputToAppName(
    input: string,
    agentContext: DesktopActionContext,
): Promise<string> {
    const programNameIndex = agentContext.programNameIndex;
    if (programNameIndex) {
        let matchedNames = await mapInputToAppNameFromIndex(
            input,
            programNameIndex,
        );
        if (matchedNames === undefined && (await finishRefresh(agentContext))) {
            matchedNames = await mapInputToAppNameFromIndex(
                input,
                programNameIndex,
            );
        }
    }
    return input;
}

const programNameIndexPath = "programNameIndex.json";

async function readProgramNameIndex(storage?: Storage) {
    if (storage !== undefined) {
        try {
            if (await storage.exists(programNameIndexPath)) {
                const index = await storage.read(programNameIndexPath, "utf8");
                return index ? JSON.parse(index) : undefined;
            }
        } catch (e: any) {
            debugError(`Unable to read program name index ${e.message}`);
        }
    }
    return undefined;
}

async function ensureProgramNameIndex(
    agentContext: DesktopActionContext,
    storage?: Storage,
) {
    if (agentContext.programNameIndex === undefined) {
        const json = await readProgramNameIndex(storage);
        const programNameIndex = loadProgramNameIndex(process.env, json);
        agentContext.programNameIndex = programNameIndex;
        agentContext.refreshPromise = refreshInstalledApps(
            agentContext,
            programNameIndex,
            storage,
        );
    }
}

export async function setupDesktopActionContext(
    agentContext: DesktopActionContext,
    storage?: Storage,
) {
    await ensureAutomationProcess(agentContext);
    return ensureProgramNameIndex(agentContext, storage);
}

export async function disableDesktopActionContext(
    agentContext: DesktopActionContext,
) {
    if (agentContext.desktopProcess) {
        agentContext.desktopProcess.kill();
    }
    if (agentContext.abortRefresh) {
        agentContext.abortRefresh?.abort();
    }
    if (agentContext.refreshPromise) {
        await agentContext.refreshPromise;
        agentContext.refreshPromise = undefined;
    }
}

async function refreshInstalledApps(
    agentContext: DesktopActionContext,
    programNameIndex: ProgramNameIndex,
    storage?: Storage,
) {
    if (agentContext.abortRefresh !== undefined) {
        return;
    }

    const abortRefresh = new AbortController();
    agentContext.abortRefresh = abortRefresh;
    debug("Refreshing installed apps");

    const desktopProcess = await ensureAutomationProcess(agentContext);
    const programs = await fetchInstalledApps(desktopProcess);
    if (programs) {
        for (const element of programs) {
            if (abortRefresh.signal.aborted) {
                return;
            }
            await programNameIndex.addOrUpdate(element);
        }
    }
    await storage?.write(
        programNameIndexPath,
        JSON.stringify(programNameIndex.toJSON()),
    );
    debug("Finish refreshing installed apps");
    agentContext.abortRefresh = undefined;
}
