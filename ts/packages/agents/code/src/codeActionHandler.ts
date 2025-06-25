// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { WebSocketMessageV2, createWebSocket } from "common-utils";
import { WebSocket } from "ws";
import {
    ActionContext,
    AppAction,
    AppAgent,
    SessionContext,
} from "@typeagent/agent-sdk";
import Database from "better-sqlite3";
import path from "path";
import { exec } from "child_process";
import { fileURLToPath } from "url";
import os from "os";
import registerDebug from "debug";
import chalk from "chalk";

const debug = registerDebug("typeagent:code");

export function instantiate(): AppAgent {
    return {
        initializeAgentContext: initializeCodeContext,
        updateAgentContext: updateCodeContext,
        executeAction: executeCodeAction,
    };
}

type CodeActionContext = {
    enabled: Set<string>;
    webSocket: WebSocket | undefined;
    nextCallId: number;
    pendingCall: Map<
        number,
        {
            resolve: (value?: undefined) => void;
            context: ActionContext<CodeActionContext>;
        }
    >;
};

async function initializeCodeContext(): Promise<CodeActionContext> {
    return {
        enabled: new Set(),
        webSocket: undefined,
        nextCallId: 0,
        pendingCall: new Map(),
    };
}

async function updateCodeContext(
    enable: boolean,
    context: SessionContext<CodeActionContext>,
    schemaName: string,
): Promise<void> {
    const agentContext = context.agentContext;
    if (enable) {
        agentContext.enabled.add(schemaName);
        if (agentContext.webSocket?.readyState === WebSocket.OPEN) {
            return;
        }

        const webSocket = await createWebSocket("code", "dispatcher");
        if (webSocket) {
            agentContext.webSocket = webSocket;
            agentContext.pendingCall = new Map();
            webSocket.onclose = (event: Object) => {
                console.error("Code webSocket connection closed.");
                debug(chalk.yellow("Code webSocket connection closed."));
                agentContext.webSocket = undefined;
            };
            webSocket.onmessage = async (event: any) => {
                const text = event.data.toString();
                const data = JSON.parse(text) as WebSocketMessageV2;

                if (data.id !== undefined && data.result !== undefined) {
                    const pendingCall = agentContext.pendingCall.get(
                        Number(data.id),
                    );

                    if (pendingCall) {
                        agentContext.pendingCall.delete(Number(data.id));
                        const { resolve, context } = pendingCall;
                        context.actionIO.setDisplay(data.result);
                        resolve();
                    }
                }
            };
        }
    } else {
        agentContext.enabled.delete(schemaName);
        if (agentContext.enabled.size === 0) {
            const webSocket = context.agentContext.webSocket;
            if (webSocket) {
                webSocket.onclose = null;
                webSocket.close();
            }

            context.agentContext.webSocket = undefined;
        }
    }
}

function getVSCodeStoragePath(): string {
    const platform = os.platform();
    if (platform === "darwin")
        return path.join(os.homedir(), "Library/Application Support/Code");
    if (platform === "win32")
        return path.join(process.env.APPDATA || "", "Code");
    return path.join(os.homedir(), ".config/Code");
}

function getLastOpenedFolder(): string | undefined {
    try {
        const dbPath = path.join(
            getVSCodeStoragePath(),
            "User/globalStorage/state.vscdb",
        );
        const db = new Database(dbPath, { readonly: true });

        const result = db
            .prepare(
                `SELECT value FROM ItemTable WHERE key = 'history.recentlyOpenedPathsList'`,
            )
            .get() as { value?: string } | undefined;

        if (!result?.value) return undefined;

        const history = JSON.parse(result.value);
        const entries = history.entries || [];

        for (const entry of entries) {
            const uri = entry.folderUri || entry.workspace;
            if (uri?.startsWith("file://")) {
                try {
                    const fullPath = fileURLToPath(uri);
                    return fullPath;
                } catch (err) {
                    debug(
                        chalk.yellowBright(`⚠️ Skipping malformed URI: ${uri}`),
                    );
                }
            }
        }
    } catch (err) {
        debug(
            chalk.redBright(
                `❌ Failed to extract last opened folder from VS Code history: ${err}`,
            ),
        );
    }
}

async function ensureVSCodeProcess(): Promise<void> {
    const folder = getLastOpenedFolder();
    const command =
        folder !== undefined
            ? `code --new-window "${folder}"`
            : `code --new-window`;

    exec(command, (error, stdout, stderr) => {
        if (error) {
            debug(
                chalk.redBright(`❌ Failed to launch VSCode:${error.message}`),
            );
        } else {
            debug(
                chalk.greenBright(
                    `✅ VSCode launched${folder ? ` with: ${folder}` : ""}`,
                ),
            );
        }
    });
}

async function executeCodeAction(
    action: AppAction,
    context: ActionContext<CodeActionContext>,
) {
    if (action.actionName === "launchVSCode") {
        await ensureVSCodeProcess();
        return undefined;
    }

    const agentContext = context.sessionContext.agentContext;
    const webSocketEndpoint = agentContext.webSocket;
    if (webSocketEndpoint) {
        try {
            const callId = agentContext.nextCallId++;
            return new Promise<undefined>((resolve) => {
                agentContext.pendingCall.set(callId, {
                    resolve,
                    context,
                });
                webSocketEndpoint.send(
                    JSON.stringify({
                        id: callId,
                        method: `code/${action.actionName}`,
                        params: action.parameters,
                    }),
                );
            });
        } catch {
            throw new Error("Unable to contact code backend.");
        }
    } else {
        throw new Error("No websocket connection.");
    }
}
