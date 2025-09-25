// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { WebSocketMessageV2 } from "common-utils";
import { CodeAgentWebSocketServer } from "./codeAgentWebSocketServer.js";
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
import { createActionResultFromError } from "@typeagent/agent-sdk/helpers/action";

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
    webSocketServer?: CodeAgentWebSocketServer | undefined;
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
        webSocketServer: undefined,
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
        if (agentContext.webSocketServer?.isConnected()) {
            return;
        }

        if (!context.agentContext.webSocketServer) {
            const port = parseInt(process.env["CODE_WEBSOCKET_PORT"] || "8082");
            const webSocketServer = new CodeAgentWebSocketServer(port);
            agentContext.webSocketServer = webSocketServer;
            agentContext.pendingCall = new Map();

            webSocketServer.onMessage = (message: string) => {
                try {
                    const data = JSON.parse(message) as WebSocketMessageV2;

                    if (data.id !== undefined && data.result !== undefined) {
                        const pendingCall = agentContext.pendingCall.get(
                            Number(data.id),
                        );

                        if (pendingCall) {
                            agentContext.pendingCall.delete(Number(data.id));
                            const { resolve, context } = pendingCall;
                            if (context?.actionIO) {
                                context.actionIO.setDisplay(data.result);
                            }
                            resolve();
                        }
                    }
                } catch (error) {
                    debug("Error parsing WebSocket message:", error);
                }
            };
        } else {
            agentContext.enabled.delete(schemaName);
            if (agentContext.enabled.size === 0) {
                const webSocketServer = context.agentContext.webSocketServer;
                if (webSocketServer) {
                    webSocketServer.close();
                }

                delete context.agentContext.webSocketServer;
            }
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

async function sendPingToCodaExtension(
    agentContext: CodeActionContext,
): Promise<boolean> {
    const server = agentContext.webSocketServer;
    if (!server || !server.isConnected()) return false;

    const callId = agentContext.nextCallId++;
    return new Promise((resolve) => {
        const timeout = setTimeout(() => {
            agentContext.pendingCall.delete(callId);
            resolve(false);
        }, 1000);

        agentContext.pendingCall.set(callId, {
            resolve: () => {
                clearTimeout(timeout);
                resolve(true);
            },
            context: undefined as any,
        });

        server.broadcast(
            JSON.stringify({
                id: callId,
                method: "code/ping",
                params: {},
            }),
        );
    });
}

type ActiveFile = {
    filePath: string;
    languageId: string;
    isUntitled: boolean;
    isDirty: boolean;
};

export async function getActiveFileFromVSCode(
    agentContext: CodeActionContext,
    timeoutMs = 2000,
): Promise<ActiveFile | undefined> {
    const server = agentContext.webSocketServer;

    if (!server || !server.isConnected()) {
        return undefined;
    }

    const callId = agentContext.nextCallId++;

    return new Promise<ActiveFile | undefined>((resolve) => {
        // Hard timeout so we never hang
        const t = setTimeout(() => {
            agentContext.pendingCall.delete(callId);
            resolve(undefined);
        }, timeoutMs);

        // NOTE: pendingCall entry has no ActionContext because this isn’t a UI action
        agentContext.pendingCall.set(callId, {
            resolve: (value?: any) => {
                clearTimeout(t);
                resolve(value as ActiveFile | undefined);
            },
            context: undefined as any,
        });

        try {
            server.broadcast(
                JSON.stringify({
                    id: callId,
                    method: "code/getActiveFile",
                    params: {},
                }),
            );
        } catch {
            clearTimeout(t);
            agentContext.pendingCall.delete(callId);
            resolve(undefined);
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
    const webSocketServer = agentContext.webSocketServer;

    if (webSocketServer && webSocketServer.isConnected()) {
        try {
            const isExtensionAlive =
                await sendPingToCodaExtension(agentContext);
            if (!isExtensionAlive) {
                return createActionResultFromError(
                    "❌ Coda VSCode extension is not connected.",
                );
            }

            const callId = agentContext.nextCallId++;
            return new Promise<undefined>((resolve) => {
                agentContext.pendingCall.set(callId, {
                    resolve,
                    context,
                });
                webSocketServer.broadcast(
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
