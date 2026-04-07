// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import child_process from "node:child_process";
import { fileURLToPath } from "node:url";
import { ProgramNameIndex, loadProgramNameIndex } from "./programNameIndex.js";
import { Storage } from "@typeagent/agent-sdk";
import registerDebug from "debug";
import { AllDesktopActions } from "./allActionsSchema.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { downloadImage } from "typechat-utils";
import { randomUUID } from "crypto";

const debug = registerDebug("typeagent:desktop");
const debugData = registerDebug("typeagent:desktop:data");
const debugError = registerDebug("typeagent:desktop:error");

export type DesktopActionContext = {
    desktopProcess: child_process.ChildProcess | undefined;
    programNameIndex: ProgramNameIndex | undefined;
    backupProgramNameTable: string[] | undefined;
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
    action: AllDesktopActions,
    agentContext: DesktopActionContext,
    sessionStorage: Storage,
    schemaName?: string, // Schema name for disambiguation (e.g., "desktop-display", "desktop-taskbar")
) {
    let confirmationMessage = "OK";
    const actionName = action.actionName;

    // Log schema name for debugging duplicate action resolution
    if (schemaName) {
        debug(`Executing action '${actionName}' from schema '${schemaName}'`);
    }

    // Preprocess actions that need TS-side work (mutate parameters in-place)
    // and generate user-facing confirmation messages.
    switch (actionName) {
        case "SetWallpaper": {
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
                    action.parameters.filePath = file;
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
                        action.parameters.filePath = path.join(
                            rootTypeAgentDir,
                            files[0] as string,
                        );
                    } else {
                        action.parameters.filePath = file;
                    }
                }
            } else {
                confirmationMessage = "Unknown wallpaper location.";
                break;
            }

            confirmationMessage =
                "Set wallpaper to " + action.parameters.filePath;
            break;
        }
        case "LaunchProgram": {
            action.parameters.name = await mapInputToAppName(
                action.parameters.name,
                agentContext,
            );
            confirmationMessage = "Launched " + action.parameters.name;
            break;
        }
        case "CloseProgram": {
            action.parameters.name = await mapInputToAppName(
                action.parameters.name,
                agentContext,
            );
            confirmationMessage = "Closed " + action.parameters.name;
            break;
        }
        case "Maximize": {
            action.parameters.name = await mapInputToAppName(
                action.parameters.name,
                agentContext,
            );
            confirmationMessage = "Maximized " + action.parameters.name;
            break;
        }
        case "Minimize": {
            action.parameters.name = await mapInputToAppName(
                action.parameters.name,
                agentContext,
            );
            confirmationMessage = "Minimized " + action.parameters.name;
            break;
        }
        case "SwitchTo": {
            action.parameters.name = await mapInputToAppName(
                action.parameters.name,
                agentContext,
            );
            confirmationMessage = "Switched to " + action.parameters.name;
            break;
        }
        case "Tile": {
            action.parameters.leftWindow = await mapInputToAppName(
                action.parameters.leftWindow,
                agentContext,
            );
            action.parameters.rightWindow = await mapInputToAppName(
                action.parameters.rightWindow,
                agentContext,
            );
            confirmationMessage = `Tiled ${action.parameters.leftWindow} on the left and ${action.parameters.rightWindow} on the right`;
            break;
        }
        case "MoveWindowToDesktop": {
            action.parameters.name = await mapInputToAppName(
                action.parameters.name,
                agentContext,
            );
            confirmationMessage = `Moving ${action.parameters.name} to desktop ${action.parameters.desktopId}`;
            break;
        }
        case "CursorTrail": {
            const minTrail = 2;
            const maxTrail = 12;
            let trailLength = action.parameters.length;
            let trailNote = "";
            if (trailLength !== undefined) {
                if (trailLength < minTrail || trailLength > maxTrail) {
                    const requested = trailLength;
                    trailLength = Math.max(
                        minTrail,
                        Math.min(maxTrail, trailLength),
                    );
                    trailNote = ` (requested ${requested}, adjusted to ${trailLength} — valid range is ${minTrail}–${maxTrail})`;
                    action.parameters.length = trailLength;
                }
            }
            confirmationMessage = action.parameters.enable
                ? `Cursor trail enabled${trailNote || (trailLength ? ` with length ${trailLength}` : "")}`
                : `Cursor trail disabled`;
            break;
        }
        case "Volume":
            confirmationMessage = `Volume set to ${action.parameters.targetVolume}%`;
            break;
        case "Mute":
            confirmationMessage = `${action.parameters.on ? "Muted" : "Unmuted"}`;
            break;
        case "RestoreVolume":
            confirmationMessage = `Volume restored`;
            break;
        case "SetThemeMode":
            confirmationMessage = `Changed theme to '${action.parameters.mode}'`;
            break;
        case "ConnectWifi":
            confirmationMessage = `Connecting to WiFi network '${action.parameters.ssid}'`;
            break;
        case "DisconnectWifi":
            confirmationMessage = `Disconnecting from current WiFi network`;
            break;
        case "ToggleAirplaneMode":
            confirmationMessage = `Turning airplane mode ${action.parameters.enable ? "on" : "off"}`;
            break;
        case "CreateDesktop":
            confirmationMessage = `Creating new desktop`;
            break;
        case "PinWindow":
            confirmationMessage = `Pinning '${action.parameters.name}' to all desktops`;
            break;
        case "SwitchDesktop":
            confirmationMessage = `Switching to desktop ${action.parameters.desktopId}`;
            break;
        case "NextDesktop":
            confirmationMessage = `Switching to next desktop`;
            break;
        case "PreviousDesktop":
            confirmationMessage = `Switching to previous desktop`;
            break;
        case "ToggleNotifications":
            confirmationMessage = `Toggling Action Center ${action.parameters.enable ? "on" : "off"}`;
            break;
        case "Debug":
            confirmationMessage = `Debug action executed`;
            break;
        case "SetTextSize":
            confirmationMessage = `Set text size to ${action.parameters.size}%`;
            break;
        case "SetScreenResolution":
            confirmationMessage = `Set screen resolution to ${action.parameters.width}x${action.parameters.height}`;
            break;
        case "BluetoothToggle":
            confirmationMessage = `Bluetooth ${action.parameters.enableBluetooth !== false ? "enabled" : "disabled"}`;
            break;
        case "EnableWifi":
            confirmationMessage = `WiFi ${action.parameters.enable ? "enabled" : "disabled"}`;
            break;
        case "EnableMeteredConnections":
            confirmationMessage = `Metered connections ${action.parameters.enable ? "enabled" : "disabled"}`;
            break;
        case "AdjustScreenBrightness":
            confirmationMessage = `Screen brightness ${action.parameters.brightnessLevel}d`;
            break;
        case "EnableBlueLightFilterSchedule":
            confirmationMessage = `Night Light schedule ${action.parameters.nightLightScheduleDisabled ? "disabled" : "enabled"}`;
            break;
        case "AdjustColorTemperature":
            confirmationMessage = `Color temperature adjusted`;
            break;
        case "DisplayScaling":
            confirmationMessage = `Display scaling set to ${action.parameters.sizeOverride}%`;
            break;
        case "AdjustScreenOrientation":
            confirmationMessage = `Screen orientation set to ${action.parameters.orientation}`;
            break;
        case "RotationLock":
            confirmationMessage = `Rotation lock ${action.parameters.enable !== false ? "enabled" : "disabled"}`;
            break;
        case "EnableTransparency":
            confirmationMessage = `Transparency effects ${action.parameters.enable ? "enabled" : "disabled"}`;
            break;
        case "ApplyColorToTitleBar":
            confirmationMessage = `Title bar color ${action.parameters.enableColor ? "enabled" : "disabled"}`;
            break;
        case "HighContrastTheme":
            confirmationMessage = `Opening high contrast theme settings`;
            break;
        case "AutoHideTaskbar":
            confirmationMessage = `Taskbar auto-hide ${action.parameters.hideWhenNotUsing ? "enabled" : "disabled"}`;
            break;
        case "TaskbarAlignment":
            confirmationMessage = `Taskbar aligned to ${action.parameters.alignment}`;
            break;
        case "TaskViewVisibility":
            confirmationMessage = `Task View button ${action.parameters.visibility ? "shown" : "hidden"}`;
            break;
        case "ToggleWidgetsButtonVisibility":
            confirmationMessage = `Widgets button ${action.parameters.visibility}`;
            break;
        case "ShowBadgesOnTaskbar":
            confirmationMessage = `Taskbar badges ${action.parameters.enableBadging !== false ? "enabled" : "disabled"}`;
            break;
        case "DisplayTaskbarOnAllMonitors":
            confirmationMessage = `Taskbar on all monitors ${action.parameters.enable !== false ? "enabled" : "disabled"}`;
            break;
        case "DisplaySecondsInSystrayClock":
            confirmationMessage = `Seconds in clock ${action.parameters.enable !== false ? "shown" : "hidden"}`;
            break;
        case "MouseCursorSpeed":
            confirmationMessage = `Mouse cursor speed set to ${action.parameters.speedLevel}`;
            break;
        case "MouseWheelScrollLines":
            confirmationMessage = `Mouse wheel scroll lines set to ${action.parameters.scrollLines}`;
            break;
        case "SetPrimaryMouseButton":
            confirmationMessage = `Primary mouse button set to ${action.parameters.primaryButton}`;
            break;
        case "EnhancePointerPrecision":
            confirmationMessage = `Enhanced pointer precision ${action.parameters.enable !== false ? "enabled" : "disabled"}`;
            break;
        case "AdjustMousePointerSize":
            confirmationMessage = `Mouse pointer size adjusted`;
            break;
        case "MousePointerCustomization":
            confirmationMessage = `Mouse pointer customized`;
            break;
        case "EnableTouchPad":
            confirmationMessage = `Touchpad ${action.parameters.enable ? "enabled" : "disabled"}`;
            break;
        case "TouchpadCursorSpeed":
            confirmationMessage = `Touchpad cursor speed adjusted`;
            break;
        case "ManageMicrophoneAccess":
            confirmationMessage = `Microphone access set to ${action.parameters.accessSetting}`;
            break;
        case "ManageCameraAccess":
            confirmationMessage = `Camera access set to ${action.parameters.accessSetting ?? "allow"}`;
            break;
        case "ManageLocationAccess":
            confirmationMessage = `Location access set to ${action.parameters.accessSetting ?? "allow"}`;
            break;
        case "BatterySaverActivationLevel":
            confirmationMessage = `Battery saver threshold set to ${action.parameters.thresholdValue}%`;
            break;
        case "SetPowerModePluggedIn":
            confirmationMessage = `Power mode when plugged in set to ${action.parameters.powerMode}`;
            break;
        case "SetPowerModeOnBattery":
            confirmationMessage = `Power mode on battery adjusted`;
            break;
        case "EnableGameMode":
            confirmationMessage = `Opening Game Mode settings`;
            break;
        case "EnableNarratorAction":
            confirmationMessage = `Narrator ${action.parameters.enable !== false ? "enabled" : "disabled"}`;
            break;
        case "EnableMagnifier":
            confirmationMessage = `Magnifier ${action.parameters.enable !== false ? "enabled" : "disabled"}`;
            break;
        case "EnableStickyKeys":
            confirmationMessage = `Sticky Keys ${action.parameters.enable ? "enabled" : "disabled"}`;
            break;
        case "EnableFilterKeysAction":
            confirmationMessage = `Filter Keys ${action.parameters.enable !== false ? "enabled" : "disabled"}`;
            break;
        case "MonoAudioToggle":
            confirmationMessage = `Mono audio ${action.parameters.enable !== false ? "enabled" : "disabled"}`;
            break;
        case "ShowFileExtensions":
            confirmationMessage = `File extensions ${action.parameters.enable !== false ? "shown" : "hidden"}`;
            break;
        case "ShowHiddenAndSystemFiles":
            confirmationMessage = `Hidden files ${action.parameters.enable !== false ? "shown" : "hidden"}`;
            break;
        case "AutomaticTimeSettingAction":
            confirmationMessage = `Automatic time sync ${action.parameters.enableAutoTimeSync ? "enabled" : "disabled"}`;
            break;
        case "AutomaticDSTAdjustment":
            confirmationMessage = `Automatic DST adjustment ${action.parameters.enable !== false ? "enabled" : "disabled"}`;
            break;
        case "EnableQuietHours":
            confirmationMessage = `Focus Assist settings opened`;
            break;
        case "RememberWindowLocations":
            confirmationMessage = `Remember window locations ${action.parameters.enable ? "enabled" : "disabled"}`;
            break;
        case "MinimizeWindowsOnMonitorDisconnectAction":
            confirmationMessage = `Minimize windows on disconnect ${action.parameters.enable !== false ? "enabled" : "disabled"}`;
            break;
        default:
            throw new Error(`Unknown action: ${actionName}`);
    }

    // Send the original action JSON directly to autoShell
    const desktopProcess = await ensureAutomationProcess(agentContext);
    desktopProcess.stdin?.write(JSON.stringify(action) + "\r\n");

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
        let message = { actionName: "ListAppNames", parameters: {} };

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
    backupProgramNameTable?: string[],
): Promise<string | undefined> {
    try {
        let matchedNames = await programNameIndex.search(input, 1);
        if (matchedNames && matchedNames.length > 0) {
            return matchedNames[0].item.value;
        }
    } catch (e: any) {
        if (backupProgramNameTable !== undefined) {
            let stringMatches = searchTable(input, backupProgramNameTable, 1);

            if (stringMatches && stringMatches.length > 0) {
                return stringMatches[0];
            }
        }
    }

    return undefined;
}

function searchTable(
    text: string,
    names: string[],
    max: number,
): string[] | undefined {
    const lowerText = text.toLowerCase();

    // Score each name based on match quality (lower is better)
    const scored = names
        .map((name) => {
            const lowerName = name.toLowerCase();
            let score: number;

            if (lowerName === lowerText) {
                // Exact match (case insensitive)
                score = 0;
            } else if (lowerName.startsWith(lowerText)) {
                // Starts with the search text
                score = 1;
            } else if (lowerName.includes(lowerText)) {
                // Contains the search text
                score = 2;
            } else if (
                lowerText.split(/\s+/).every((word) => lowerName.includes(word))
            ) {
                // All words from search text appear in name
                score = 3;
            } else {
                // No match
                score = -1;
            }

            return { name, score };
        })
        .filter((item) => item.score >= 0)
        .sort((a, b) => a.score - b.score);

    if (scored.length === 0) {
        return undefined;
    }

    return scored.slice(0, max).map((item) => item.name);
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
            agentContext.backupProgramNameTable,
        );
        if (matchedNames === undefined && (await finishRefresh(agentContext))) {
            matchedNames = await mapInputToAppNameFromIndex(
                input,
                programNameIndex,
                agentContext.backupProgramNameTable,
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

        agentContext.backupProgramNameTable = programs;
    }
    await storage?.write(
        programNameIndexPath,
        JSON.stringify(programNameIndex.toJSON()),
    );
    debug("Finish refreshing installed apps");
    agentContext.abortRefresh = undefined;
}
