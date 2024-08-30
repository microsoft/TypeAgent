// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ChildProcess, spawn } from "child_process";
import { fileURLToPath } from "node:url";
import {
    ProgramNameIndex,
    createProgramNameIndex,
} from "./programNameIndex.js";

import {
    WebSocketMessage,
    createWebSocket,
    keepWebSocketAlive,
} from "common-utils";

import WebSocket from "ws";
import dotenv from "dotenv";
import findConfig from "find-config";
import assert from "assert";
import { processRequests } from "typechat/interactive";


const envPath = findConfig(".env");
assert(envPath, ".env file not found!");
dotenv.config({ path: envPath });

let desktopProcess: ChildProcess | null;
let webSocket: any = null;
let programNameIndex: ProgramNameIndex;

function spawnAutomationProcess() {
    const autoShellPath = new URL(
        "../../../../../dotnet/autoShell/bin/Debug/autoShell.exe",
        import.meta.url,
    );
    const child = spawn(fileURLToPath(autoShellPath));

    resetEventHandlers(child);

    child.on("exit", (code) => {
        console.log(`Child exited with code ${code}`);
        desktopProcess = null;
    });

    return child;
}

function resetEventHandlers(child: ChildProcess) {
    child.stdout?.on("data", (data) => {
        console.log(data.toString());
    });

    child.stderr?.on("error", (data) => {
        console.error(data.toString());
    });
}

async function ensureWebsocketConnected() {
    if (webSocket && webSocket.readyState === WebSocket.OPEN) {
        return;
    }

    webSocket = await createWebSocket();
    if (!webSocket) {
        return;
    }

    webSocket.binaryType = "blob";
    keepWebSocketAlive(webSocket, "desktop");

    webSocket.onmessage = async (event: any) => {
        const text = event.data.toString();
        const data = JSON.parse(text) as WebSocketMessage;
        if (data.target == "desktop") {
            if (data.messageType == "desktopActionRequest") {
                const message = await runDesktopActions(data.body);

                webSocket.send(
                    JSON.stringify({
                        source: data.target,
                        target: data.source,
                        messageType: "desktopActionResponse",
                        id: data.id,
                        body: message,
                    }),
                );
            }

            console.log(`Desktop websocket client received message: ${text}`);
        }
    };

    webSocket.onclose = (event: any) => {
        console.log("websocket connection closed");
        webSocket = undefined;
        reconnectWebSocket();
    };
}

export function reconnectWebSocket() {
    const connectionCheckIntervalId = setInterval(async () => {
        if (webSocket && webSocket.readyState === WebSocket.OPEN) {
            console.log("Clearing reconnect retry interval");
            clearInterval(connectionCheckIntervalId);
        } else {
            console.log("Retrying connection");
            await ensureWebsocketConnected();
        }
    }, 5 * 1000);
}

async function runDesktopActions(action: any) {
    let confirmationMessage = "OK";
    if (!desktopProcess) {
        desktopProcess = spawnAutomationProcess();
    }

    let actionData = "";
    const actionName =
        action.actionName ?? action.fullActionName.split(".").at(-1);
    switch (actionName) {
        case "launchProgram": {
            actionData = await mapInputToAppName(action.parameters.name);
            confirmationMessage = "Launched " + action.parameters.name;
            break;
        }
        case "closeProgram": {
            actionData = await mapInputToAppName(action.parameters.name);
            confirmationMessage = "Closed " + action.parameters.name;
            break;
        }
        case "maximize": {
            actionData = await mapInputToAppName(action.parameters.name);
            confirmationMessage = "Maximized " + action.parameters.name;
            break;
        }
        case "minimize": {
            actionData = await mapInputToAppName(action.parameters.name);
            confirmationMessage = "Minimized " + action.parameters.name;
            break;
        }
        case "switchTo": {
            actionData = await mapInputToAppName(action.parameters.name);
            confirmationMessage = "Switched to " + action.parameters.name;
            break;
        }
        case "tile": {
            const left = await mapInputToAppName(action.parameters.leftWindow);
            const right = await mapInputToAppName(
                action.parameters.rightWindow,
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
        case "unknown": {
            confirmationMessage = `Did not understand the request "${action.parameters.text}"`;
            break;
        }
    }

    // send message to child process
    let message: Record<string, string> = {};
    message[actionName] = actionData;
    desktopProcess.stdin?.write(JSON.stringify(message) + "\r\n");

    return confirmationMessage;
}

async function fetchInstalledApps() {
    let timeoutHandle: NodeJS.Timeout;

    const timeoutPromise = new Promise<undefined>((_resolve, reject) => {
        timeoutHandle = setTimeout(() => reject(undefined), 3000);
    });

    const appsPromise = new Promise<string[] | undefined>((resolve, reject) => {
        if (!desktopProcess) {
            resolve(undefined);
            return;
        }

        let message: Record<string, string> = {};
        message["listAppNames"] = "";

        let allOutput = "";
        desktopProcess.stdout?.on("data", (data) => {
            allOutput += data.toString();
            try {
                const programs = JSON.parse(allOutput);
                resolve(programs);
            } catch {}
        });

        desktopProcess.stderr?.on("error", (data) => {
            console.error(data.toString());
            resolve(undefined);
        });

        desktopProcess.stdin?.write(JSON.stringify(message) + "\r\n");
    });

    return Promise.race([appsPromise, timeoutPromise]).then((result) => {
        clearTimeout(timeoutHandle);
        return result;
    });
}

async function mapInputToAppName(input: string): Promise<string> {
    const matchedNames = await programNameIndex.search(input, 1);
    if (matchedNames && matchedNames.length > 0) {
        return matchedNames[0].item.value;
    }

    return input;
}

// Setup
const initializeApp = async () => {
    const vals = {};
    dotenv.config({ path: envPath, processEnv: vals });
    programNameIndex = createProgramNameIndex(vals);
    desktopProcess = spawnAutomationProcess();
    const programs = await fetchInstalledApps();
    if (programs) {
        for (const element of programs) {
            await programNameIndex.addOrUpdate(element);
        }
    }

    resetEventHandlers(desktopProcess);

    await ensureWebsocketConnected();
    if (!webSocket) {
        console.log("Websocket service not found. Will retry in 5 seconds");
        reconnectWebSocket();
    }
};

initializeApp();

processRequests("🖥️> ", process.argv[2], async (request) => {
    if (request.toLowerCase() === "websocket on") {
        await ensureWebsocketConnected();
        if (!webSocket) {
            reconnectWebSocket();
        }
    }
});
