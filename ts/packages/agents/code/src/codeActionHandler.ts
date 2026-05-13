// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { WebSocketMessageV2 } from "websocket-utils";
import { CodeAgentWebSocketServer } from "./codeAgentWebSocketServer.js";
import {
    ActionContext,
    AppAction,
    AppAgent,
    ReadinessReport,
    SessionContext,
} from "@typeagent/agent-sdk";
import Database from "better-sqlite3";
import path from "path";
import { exec } from "child_process";
import { fileURLToPath } from "url";
import os from "os";
import registerDebug from "debug";
import chalk from "chalk";
import {
    ChoiceManager,
    createActionResult,
    createActionResultFromError,
} from "@typeagent/agent-sdk/helpers/action";
import {
    evaluateCodeReadiness,
    resolveCodePortOverride,
    setupCode,
    whichExists,
} from "./readiness.js";

const debug = registerDebug("typeagent:code");

// Shared WebSocket server that bridges this code agent to the Coda VS Code
// extension (ts/packages/coda). Created on first session-enable, closed when
// the last session disables. Storing it per-session caused "No websocket
// connection" errors when an action ran on a session different from the one
// that originally created the server (e.g. after schema enable on a different
// conversation), and also masked EADDRINUSE failures from a second bind
// attempt on the configured port.
//
// Port allocation: by default the OS picks a free ephemeral port (port=0).
// Each session that uses the shared server registers it under its own
// `sessionContextId`, so the PortRegistrar's `closeSessionContext` backstop
// auto-releases per-session entries and `lookup("code")` keeps returning the
// shared port as long as ≥1 session has it enabled. `CODE_WEBSOCKET_PORT`
// remains an explicit override (useful for back-compat with installed Coda
// extensions that dial 8082).
let sharedWebSocketServer: CodeAgentWebSocketServer | undefined;
let sharedStartingPromise: Promise<CodeAgentWebSocketServer> | undefined;
let sharedClosingPromise: Promise<void> | undefined;
let sharedWebSocketRefCount = 0;
const sharedPendingCalls: Map<
    number,
    {
        resolve: (value?: undefined) => void;
        context?: ActionContext<CodeActionContext> | undefined;
    }
> = new Map();
// Global call-id counter. The pending-calls map is module-scoped (one
// websocket server is shared across all sessions), so the id space must
// also be global — per-session counters would collide on 0,1,2,... and
// route a response to the wrong session's pending call.
let nextSharedCallId = 0;

export function instantiate(): AppAgent {
    return {
        initializeAgentContext: initializeCodeContext,
        updateAgentContext: updateCodeContext,
        executeAction: executeCodeAction,
        checkReadiness: checkCodeReadiness,
        setup: (actionContext) => {
            const ctx = (actionContext as ActionContext<CodeActionContext>)
                .sessionContext.agentContext;
            // Prefer the actual bound port (set once updateAgentContext has
            // brought up the shared server); fall back to the static
            // override for messaging on the first probe.
            const port =
                getSharedCodePort() ?? resolveCodePortOverride(process.env);
            return setupCode(
                actionContext,
                ctx.choiceManager,
                () => ctx.webSocketServer?.isConnected() === true,
                port,
            );
        },
        handleChoice: async (choiceId, response, context) => {
            const ctx = (context as ActionContext<CodeActionContext>)
                .sessionContext.agentContext;
            return ctx.choiceManager.handleChoice(choiceId, response, context);
        },
    };
}

type CodeActionContext = {
    enabled: Set<string>;
    webSocketServer?: CodeAgentWebSocketServer | undefined;
    pendingCall: Map<
        number,
        {
            resolve: (value?: undefined) => void;
            context?: ActionContext<CodeActionContext> | undefined;
        }
    >;
    // Manages yes/no choice callbacks (currently only the setup-flow card).
    // Hooked up via the AppAgent.handleChoice in instantiate() above.
    choiceManager: ChoiceManager;
    // Handle returned by sessionContext.registerPort, kept so we can release
    // exactly this session's registration on disable. The
    // closeSessionContext backstop will also release it if the disable path
    // is skipped.
    portRegistration?: { release: () => void };
};

async function initializeCodeContext(): Promise<CodeActionContext> {
    return {
        enabled: new Set(),
        webSocketServer: undefined,
        pendingCall: new Map(),
        choiceManager: new ChoiceManager(),
    };
}

// Cheap readiness probe — checks (1) whether any client is connected to
// the WebSocket server, and (2) whether the `code` CLI is on PATH. (2)
// is the cheap proxy for "VS Code is installed at all" so we can
// distinguish a real configuration gap from the common transient case
// of VS Code just being closed. See evaluateCodeReadiness for the
// branching messages.
//
// The `webSocketServer` field is undefined until updateAgentContext
// fires (on first enable), so initial probes can show setup-required
// even when the agent is healthy. The dispatcher's post-handleChoice
// readiness refresh + explicit `@config agent refresh code` are the
// recovery paths.
async function checkCodeReadiness(
    context: SessionContext<CodeActionContext>,
): Promise<ReadinessReport> {
    const clientConnected =
        context.agentContext?.webSocketServer?.isConnected() === true;
    // Skip the PATH probe when we already know the answer is "ready" —
    // saves a subprocess on every refresh of a healthy agent.
    const vsCodeCliInstalled = clientConnected
        ? true
        : await whichExists("code");
    return evaluateCodeReadiness({
        clientConnected,
        vsCodeCliInstalled,
        port: getSharedCodePort() ?? resolveCodePortOverride(process.env),
    });
}

// Bind hint for the shared server. Returns the explicit override if
// CODE_WEBSOCKET_PORT is set (handy for back-compat with installed Coda
// extensions that still dial 8082); otherwise 0 so the OS picks a free
// port and the registrar/discovery channel publishes it.
function getCodeBindPort(): number {
    const raw = process.env["CODE_WEBSOCKET_PORT"];
    if (raw === undefined) return 0;
    const n = parseInt(raw, 10);
    if (!Number.isFinite(n) || n < 0) {
        debug(
            `Ignoring invalid CODE_WEBSOCKET_PORT=${raw}; falling back to OS-assigned port`,
        );
        return 0;
    }
    return n;
}

// Wire the shared server's onMessage handler. Module-scoped because the
// server itself is module-scoped — all sessions route their pending-call
// completions through the same handler.
function attachSharedOnMessage(server: CodeAgentWebSocketServer): void {
    server.onMessage = (message: string) => {
        try {
            const data = JSON.parse(message) as WebSocketMessageV2;

            if (data.id !== undefined && data.result !== undefined) {
                const pendingCall = sharedPendingCalls.get(Number(data.id));

                if (pendingCall) {
                    sharedPendingCalls.delete(Number(data.id));
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
}

// Start (or attach to an in-flight start of) the shared WebSocket server.
// Concurrent enables from different sessions can race; serialize via
// sharedStartingPromise so only one bind attempt is in flight.
async function ensureSharedServer(): Promise<CodeAgentWebSocketServer> {
    // If a previous teardown is still releasing the port (matters under
    // CODE_WEBSOCKET_PORT override), await it before binding again.
    if (sharedClosingPromise !== undefined) {
        await sharedClosingPromise;
    }
    if (sharedWebSocketServer !== undefined) {
        return sharedWebSocketServer;
    }
    if (sharedStartingPromise !== undefined) {
        return sharedStartingPromise;
    }
    sharedStartingPromise = (async () => {
        try {
            const server =
                await CodeAgentWebSocketServer.start(getCodeBindPort());
            attachSharedOnMessage(server);
            sharedWebSocketServer = server;
            return server;
        } finally {
            sharedStartingPromise = undefined;
        }
    })();
    return sharedStartingPromise;
}

async function updateCodeContext(
    enable: boolean,
    context: SessionContext<CodeActionContext>,
    schemaName: string,
): Promise<void> {
    const agentContext = context.agentContext;
    if (enable) {
        if (agentContext.enabled.has(schemaName)) {
            return;
        }
        const isFirstSchemaForSession = agentContext.enabled.size === 0;
        agentContext.enabled.add(schemaName);
        try {
            const server = await ensureSharedServer();
            agentContext.webSocketServer = server;
            agentContext.pendingCall = sharedPendingCalls;
            if (isFirstSchemaForSession) {
                // Per-session registration: the registrar allows multiple
                // entries for `(code, default)` across sessions and lookup
                // returns the most recent, so each active session
                // independently keeps the shared port discoverable. The
                // backstop in closeSessionContext releases ours if disable
                // is skipped.
                agentContext.portRegistration = context.registerPort(
                    "default",
                    server.port,
                );
                sharedWebSocketRefCount++;
            }
        } catch (e) {
            // Roll back the per-session schema bookkeeping so a subsequent
            // retry sees a clean slate. Don't touch shared module state —
            // the bind itself failed, so we never incremented the refcount
            // or registered.
            agentContext.enabled.delete(schemaName);
            throw e;
        }
    } else {
        if (!agentContext.enabled.has(schemaName)) {
            return;
        }
        agentContext.enabled.delete(schemaName);
        if (agentContext.enabled.size === 0) {
            agentContext.webSocketServer = undefined;
            // Release this session's registration before potentially closing
            // the server. Release is idempotent and a no-op if already
            // released by the backstop.
            agentContext.portRegistration?.release();
            delete agentContext.portRegistration;

            sharedWebSocketRefCount = Math.max(0, sharedWebSocketRefCount - 1);
            if (sharedWebSocketRefCount === 0 && sharedWebSocketServer) {
                const server = sharedWebSocketServer;
                sharedWebSocketServer = undefined;
                sharedPendingCalls.clear();
                // Track the in-flight close so a rapid re-enable awaits
                // port release under a fixed-port override.
                sharedClosingPromise = server.close().finally(() => {
                    sharedClosingPromise = undefined;
                });
                await sharedClosingPromise;
            }
        }
    }
}

// Exposed for readiness/setup messaging — undefined when the shared server
// isn't bound yet, otherwise the actual bound port. Lets readiness messages
// always reflect the real listener.
export function getSharedCodePort(): number | undefined {
    return sharedWebSocketServer?.port;
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

    const callId = nextSharedCallId++;
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

    const callId = nextSharedCallId++;

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

import { VSCodeConversationActions } from "./vscode/vscodeConversationActionsSchema.js";

async function executeConversationAction(
    action: VSCodeConversationActions,
    context: ActionContext<CodeActionContext>,
) {
    context.actionIO.takeAction("vscode-shell-action" as any, {
        actionName: action.actionName,
        parameters: action.parameters,
    });
    switch (action.actionName) {
        case "newConversation":
            return createActionResult(
                action.parameters.name
                    ? `Creating conversation "${action.parameters.name}".`
                    : "Creating a new conversation.",
            );
        case "renameConversation":
            return createActionResult(
                `Renamed current conversation to "${action.parameters.newName}".`,
            );
        case "switchConversation":
            return createActionResult(
                action.parameters.name
                    ? `Switching to conversation "${action.parameters.name}".`
                    : "Switching conversation.",
            );
        case "deleteConversation":
            return createActionResult(
                action.parameters.name
                    ? `Deleting conversation "${action.parameters.name}".`
                    : "Deleting conversation.",
            );
        default: {
            const _exhaustive: never = action;
            throw new Error(
                `Unhandled conversation action: ${(_exhaustive as VSCodeConversationActions).actionName}`,
            );
        }
    }
}

async function executeCodeAction(
    action: AppAction,
    context: ActionContext<CodeActionContext>,
) {
    if (action.actionName === "launchVSCode") {
        await ensureVSCodeProcess();
        return undefined;
    }

    // Conversation-management actions (code-vscode-shell sub-schema) are
    // handled locally and routed back to the originating extension webview
    // via takeAction. All other code sub-schemas are forwarded to the Coda
    // VS Code extension over the WebSocket bridge below.
    //
    // Note: sub-schema names are dot-prefixed with the parent agent name by
    // the dispatcher (see actionConfig.collectActionConfigs), so the runtime
    // schemaName here is "code.code-vscode-shell", not "code-vscode-shell".
    if (action.schemaName === "code.code-vscode-shell") {
        return executeConversationAction(
            action as VSCodeConversationActions,
            context,
        );
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

            const callId = nextSharedCallId++;
            return new Promise<undefined>((resolve) => {
                const timeoutMs = 5000;
                const timeoutHandle = setTimeout(() => {
                    if (agentContext.pendingCall.has(callId)) {
                        agentContext.pendingCall.delete(callId);
                        if (context.actionIO) {
                            context.actionIO.setDisplay(
                                `No connected coda extension handled action "${action.actionName}". If multiple VS Code windows are open, reload the others (Ctrl+Shift+P → Developer: Reload Window) so they pick up the latest coda bundle.`,
                            );
                        }
                        resolve(undefined);
                    }
                }, timeoutMs);
                agentContext.pendingCall.set(callId, {
                    resolve: (value?: undefined) => {
                        clearTimeout(timeoutHandle);
                        resolve(value);
                    },
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
