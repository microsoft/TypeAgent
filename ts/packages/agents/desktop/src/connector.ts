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

interface ActionResult {
    id?: string;
    success: boolean;
    message: string;
    data?: unknown;
}

// Pending request map for correlating stdin writes with stdout responses
const pendingRequests = new Map<
    string,
    { resolve: (result: ActionResult) => void; reject: (err: Error) => void }
>();
// Buffer for incomplete lines from stdout
let stdoutBuffer = "";

const autoShellPath = resolveAutoShellPath();

function resolveAutoShellPath(): URL {
    // Allow override via environment variable
    const envPath = process.env.AUTOSHELL_PATH;
    if (envPath) {
        return new URL(`file://${path.resolve(envPath)}`);
    }

    // Search relative to the compiled JS output (dist/)
    const baseDir = path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        "../../../../../dotnet/autoShell/bin",
    );
    for (const config of ["Debug", "Release"]) {
        const candidate = path.join(baseDir, config, "autoShell.exe");
        if (fs.existsSync(candidate)) {
            return new URL(`file://${candidate}`);
        }
    }

    // Fallback to Debug path (will fail at spawn time with a clear error)
    return new URL(
        "../../../../../dotnet/autoShell/bin/Debug/autoShell.exe",
        import.meta.url,
    );
}

// Load known action names from .pas.json schema files for runtime validation.
// The compiled JS and .pas.json files both live in dist/.
const knownActionNames = loadKnownActionNames();

function loadKnownActionNames(): Set<string> {
    const names = new Set<string>();
    try {
        const distDir = path.dirname(fileURLToPath(import.meta.url));
        const schemaFiles = fs
            .readdirSync(distDir)
            .filter((f) => f.endsWith(".pas.json"));

        for (const file of schemaFiles) {
            try {
                const content = JSON.parse(
                    fs.readFileSync(path.join(distDir, file), "utf-8"),
                );
                if (content.types) {
                    for (const typeDef of Object.values(
                        content.types,
                    ) as any[]) {
                        const actionField = typeDef?.type?.fields?.actionName;
                        const typeEnum = actionField?.type?.typeEnum;
                        if (Array.isArray(typeEnum)) {
                            for (const name of typeEnum) {
                                names.add(name);
                            }
                        }
                    }
                }
            } catch {
                // Skip malformed schema files
            }
        }
    } catch {
        debug("Could not load .pas.json schema files for validation.");
    }
    debug(`Loaded ${names.size} known action names from schemas.`);
    return names;
}

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
        // Reject any pending requests
        for (const [id, pending] of pendingRequests) {
            pending.reject(new Error(`autoShell exited with code ${code}`));
            pendingRequests.delete(id);
        }
        stdoutBuffer = "";
    });

    // Route stdout lines to pending requests by id
    child.stdout?.on("data", (data) => {
        stdoutBuffer += data.toString();
        let newlineIndex: number;
        while ((newlineIndex = stdoutBuffer.indexOf("\n")) !== -1) {
            const line = stdoutBuffer.substring(0, newlineIndex).trim();
            stdoutBuffer = stdoutBuffer.substring(newlineIndex + 1);
            if (!line) continue;

            try {
                const response: ActionResult = JSON.parse(line);
                debugData(`Response: ${line}`);

                if (
                    response.id !== undefined &&
                    pendingRequests.has(response.id)
                ) {
                    const pending = pendingRequests.get(response.id)!;
                    pendingRequests.delete(response.id);
                    pending.resolve(response);
                } else {
                    debug(`Unmatched response (id=${response.id}): ${line}`);
                }
            } catch {
                debug(`Non-JSON stdout: ${line}`);
            }
        }
    });

    child.stderr?.on("data", (data) => {
        debugError(`Process error: ${data.toString()}`);
    });

    agentContext.desktopProcess = child;
    return child;
}

const SEND_ACTION_TIMEOUT_MS = 30000;

async function sendAction(
    desktopProcess: child_process.ChildProcess,
    action: object,
): Promise<ActionResult> {
    const id = randomUUID();
    const payload = JSON.stringify({ ...action, id });

    return new Promise<ActionResult>((resolve, reject) => {
        const timeout = setTimeout(() => {
            pendingRequests.delete(id);
            reject(
                new Error(
                    `sendAction timed out after ${SEND_ACTION_TIMEOUT_MS}ms for: ${payload}`,
                ),
            );
        }, SEND_ACTION_TIMEOUT_MS);

        pendingRequests.set(id, {
            resolve: (result) => {
                clearTimeout(timeout);
                resolve(result);
            },
            reject: (err) => {
                clearTimeout(timeout);
                reject(err);
            },
        });

        desktopProcess.stdin?.write(payload + "\n");
    });
}

export async function runDesktopActions(
    action: AllDesktopActions,
    agentContext: DesktopActionContext,
    sessionStorage: Storage,
    schemaName?: string, // Schema name for disambiguation (e.g., "desktop-display", "desktop-taskbar")
) {
    const actionName = action.actionName;

    // Log schema name for debugging duplicate action resolution
    if (schemaName) {
        debug(`Executing action '${actionName}' from schema '${schemaName}'`);
    }

    // Warn if an action name isn't in the known set (type system should prevent this,
    // but guards against runtime mismatches or future schema drift)
    if (!knownActionNames.has(actionName)) {
        debugError(
            `Unknown action '${actionName}' — not in known schema set. Forwarding to autoShell anyway.`,
        );
    }

    // Preprocess actions that need TS-side work before sending to autoShell
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
                    return {
                        success: false,
                        message: "Failed to download the requested image.",
                    };
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
                return {
                    success: false,
                    message: "Unknown wallpaper location.",
                };
            }
            break;
        }
        case "LaunchProgram":
        case "CloseProgram":
        case "Maximize":
        case "Minimize":
        case "SwitchTo":
        case "PinWindow":
        case "MoveWindowToDesktop":
            action.parameters.name = await mapInputToAppName(
                action.parameters.name,
                agentContext,
            );
            break;
        case "Tile":
            action.parameters.leftWindow = await mapInputToAppName(
                action.parameters.leftWindow,
                agentContext,
            );
            action.parameters.rightWindow = await mapInputToAppName(
                action.parameters.rightWindow,
                agentContext,
            );
            break;
        case "CursorTrail": {
            const minTrail = 2;
            const maxTrail = 12;
            let trailLength = action.parameters.length;
            if (trailLength !== undefined) {
                if (trailLength < minTrail || trailLength > maxTrail) {
                    trailLength = Math.max(
                        minTrail,
                        Math.min(maxTrail, trailLength),
                    );
                    action.parameters.length = trailLength;
                }
            }
            break;
        }
    }

    // Send to autoShell and return its response
    const desktopProcess = await ensureAutomationProcess(agentContext);
    return sendAction(desktopProcess, action);
}

async function fetchInstalledApps(desktopProcess: child_process.ChildProcess) {
    try {
        const result = await sendAction(desktopProcess, {
            actionName: "ListAppNames",
            parameters: {},
        });
        if (result.success && Array.isArray(result.data)) {
            return result.data as string[];
        }
        debugError(`Failed to fetch installed apps: ${result.message}`);
        return undefined;
    } catch (e: any) {
        debugError(`Error fetching installed apps: ${e.message}`);
        return undefined;
    }
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
        let matchedName = await mapInputToAppNameFromIndex(
            input,
            programNameIndex,
            agentContext.backupProgramNameTable,
        );
        if (matchedName === undefined && (await finishRefresh(agentContext))) {
            matchedName = await mapInputToAppNameFromIndex(
                input,
                programNameIndex,
                agentContext.backupProgramNameTable,
            );
        }
        if (matchedName !== undefined) {
            return matchedName;
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
