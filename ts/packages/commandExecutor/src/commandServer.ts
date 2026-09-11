// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod/v4";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
    connectDispatcher,
    connectAgentServer,
    AgentServerConnection,
    AGENT_SERVER_DEFAULT_URL,
    StructuredActionClient,
} from "@typeagent/agent-server-client";
import { discoverPort } from "@typeagent/agent-server-client/discovery";
import type {
    ActionContractResult,
    ClientIO,
    IAgentMessage,
    RequestId,
    StructuredActionExecutionResult,
    TemplateEditConfig,
} from "@typeagent/dispatcher-types";
import type { Dispatcher } from "@typeagent/dispatcher-types";
import { awaitCommand } from "@typeagent/dispatcher-types";
import { DisplayAppendMode } from "@typeagent/agent-sdk";
import {
    getStructuredFallback,
    isStructuredContent,
} from "@typeagent/agent-sdk/helpers/display";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { randomUUID } from "crypto";
import { convert } from "html-to-text";
import { loadConfig, type ResolvedAgentServerConfig } from "./config/index.js";
import {
    CancelWorkspaceCommandInput,
    CancelWorkspaceCommandInputSchema,
    CancelWorkspaceCommandResultSchema,
    WorkspaceCommandInput,
    WorkspaceCommandInputSchema,
    WorkspaceCommandResultSchema,
    WorkspaceCommandToolResultSchema,
} from "./workspaceCommandMcpSchema.js";
import {
    invokeStructuredAction,
    registerStructuredActionTools,
    structuredToolResult,
    type StructuredActionClient as StructuredActionToolClient,
} from "./structuredActionTools.js";

// ── Zod schemas ───────────────────────────────────────────────────────────────

function executeCommandRequestSchema() {
    return {
        request: z.string(),
        cacheCheck: z.boolean().optional(),
        confirmed: z.boolean().optional(),
    };
}
const ExecuteCommandRequestSchema = z.object(executeCommandRequestSchema());
export type ExecuteCommandRequest = z.infer<typeof ExecuteCommandRequestSchema>;

// ── Utilities ─────────────────────────────────────────────────────────────────

function toolResult(result: string, rawData?: unknown): CallToolResult {
    const out: CallToolResult = { content: [{ type: "text", text: result }] };
    if (rawData !== undefined) {
        // MCP structuredContent must be Record<string, unknown>; wrap arrays.
        out.structuredContent = Array.isArray(rawData)
            ? ({ data: rawData } as Record<string, unknown>)
            : (rawData as Record<string, unknown>);
    }
    return out;
}

// One shape for every result where the command never actually ran, so the
// failure and pre-dispatch-cancellation paths cannot drift apart.
function unexecutedWorkspaceCommandResult(
    fields: { error: string; cancelled: boolean },
    executionId: string,
): CallToolResult {
    const result = {
        success: false,
        error: fields.error,
        exitCode: null,
        durationMs: 0,
        stdout: { text: "", truncated: false, totalBytes: 0 },
        stderr: { text: "", truncated: false, totalBytes: 0 },
        timedOut: false,
        cancelled: fields.cancelled,
        executionId,
    };
    return toolResult(JSON.stringify(result, null, 2), result);
}

function workspaceCommandFailure(
    error: string,
    executionId: string,
): CallToolResult {
    return unexecutedWorkspaceCommandResult(
        { error, cancelled: false },
        executionId,
    );
}

function cancelledWorkspaceCommandResult(executionId: string): CallToolResult {
    return unexecutedWorkspaceCommandResult(
        {
            error: "The command request was cancelled before it was dispatched.",
            cancelled: true,
        },
        executionId,
    );
}

function cancellationFailure(
    error: string,
    executionId: string,
): CallToolResult {
    const failure = {
        success: false,
        error,
        cancelled: false,
        pendingCancellation: false,
        executionId,
    };
    return toolResult(JSON.stringify(failure, null, 2), failure);
}

function stripAnsi(text: string): string {
    return text.replace(/\x1b\[[0-9;]*m/g, "");
}

function htmlToPlainText(html: string): string {
    return convert(html, {
        wordwrap: false,
        preserveNewlines: true,
        selectors: [
            { selector: "img", format: "skip" },
            { selector: "a", options: { ignoreHref: true } },
        ],
    });
}

async function processHtmlContent(content: string): Promise<string> {
    return htmlToPlainText(content);
}

// ── Logger ────────────────────────────────────────────────────────────────────

class Logger {
    private logFilePath: string;
    private logStream: fs.WriteStream;

    constructor() {
        const logDir = path.join(os.homedir(), ".tmp", "typeagent-mcp");
        if (!fs.existsSync(logDir)) {
            fs.mkdirSync(logDir, { recursive: true });
        }
        this.logFilePath = path.join(logDir, `mcp-server-${Date.now()}.log`);
        this.logStream = fs.createWriteStream(this.logFilePath, { flags: "a" });
        this.log(`Log file created at: ${this.logFilePath}`);
    }

    private format(level: string, message: string): string {
        return `[${new Date().toISOString()}] [${level}] ${message}`;
    }

    log(message: string): void {
        const s = this.format("INFO", message);
        // stdout is reserved for the MCP JSON-RPC stream; logs go to stderr.
        console.error(s);
        this.logStream.write(s + "\n");
    }

    error(message: string, error?: unknown): void {
        const detail = error
            ? ` - ${error instanceof Error ? error.message : String(error)}`
            : "";
        const s = this.format("ERROR", message + detail);
        console.error(s);
        this.logStream.write(s + "\n");
        if (error instanceof Error && error.stack) {
            this.logStream.write(error.stack + "\n");
        }
    }

    close(): void {
        this.logStream.end();
    }
}

// ── ClientIO ──────────────────────────────────────────────────────────────────

function createMcpClientIO(
    logger: Logger,
    responseCollector: { messages: string[]; rawData?: unknown },
    getConfirmedFlag: () => boolean,
): ClientIO {
    return {
        clear(): void {},
        exit(): void {},
        shutdown(): void {},
        setUserRequest(): void {},
        setDisplayInfo(): void {},
        setDisplay(message: IAgentMessage): void {
            logger.log(`ClientIO: setDisplay() - ${JSON.stringify(message)}`);
            if (typeof message === "object" && "message" in message) {
                const msg = message.message;
                if (
                    typeof msg === "object" &&
                    msg &&
                    "kind" in msg &&
                    msg.kind === "info"
                ) {
                    return;
                }
                if (typeof msg === "string") {
                    responseCollector.messages.push(stripAnsi(msg));
                } else if (isStructuredContent(msg)) {
                    responseCollector.messages.push(
                        stripAnsi(String(getStructuredFallback(msg, "text"))),
                    );
                    if (msg.rawData !== undefined) {
                        responseCollector.rawData = msg.rawData;
                    }
                } else if (typeof msg === "object" && msg && "content" in msg) {
                    responseCollector.messages.push(
                        stripAnsi(String(msg.content)),
                    );
                }
            }
        },
        appendDisplay(message: IAgentMessage, mode: DisplayAppendMode): void {
            logger.log(
                `ClientIO: appendDisplay(mode=${mode}) - ${JSON.stringify(message)}`,
            );
            if (
                mode === "block" &&
                typeof message === "object" &&
                "message" in message
            ) {
                const msg = message.message;
                if (
                    typeof msg === "object" &&
                    msg &&
                    "kind" in msg &&
                    msg.kind === "info"
                ) {
                    return;
                }
                if (typeof msg === "string") {
                    responseCollector.messages.push(stripAnsi(msg));
                } else if (isStructuredContent(msg)) {
                    responseCollector.messages.push(
                        stripAnsi(String(getStructuredFallback(msg, "text"))),
                    );
                    if (msg.rawData !== undefined) {
                        responseCollector.rawData = msg.rawData;
                    }
                } else if (typeof msg === "object" && msg && "content" in msg) {
                    responseCollector.messages.push(
                        stripAnsi(String(msg.content)),
                    );
                }
            }
        },
        appendDiagnosticData(requestId: RequestId, data: unknown): void {
            logger.log(
                `ClientIO: appendDiagnosticData(requestId=${JSON.stringify(requestId)}) - ${JSON.stringify(data)}`,
            );
        },
        setDynamicDisplay(): void {},
        async question(
            _requestId: RequestId | undefined,
            message: string,
            choices: string[],
            defaultId?: number,
        ): Promise<number> {
            // For Yes/No, check the auto-confirm flag (backward compat with askYesNo).
            if (
                choices.length === 2 &&
                choices[0] === "Yes" &&
                choices[1] === "No"
            ) {
                if (getConfirmedFlag()) {
                    logger.log(
                        `ClientIO: question - "${message}" (auto-approved)`,
                    );
                    return 0; // "Yes"
                }
                throw new Error(`USER_CONFIRMATION_REQUIRED: ${message}`);
            }
            logger.log(
                `ClientIO: question - "${message}" choices=[${choices.join(", ")}] (defaulting to ${defaultId ?? 0})`,
            );
            return defaultId ?? 0;
        },
        async proposeAction(
            _requestId: RequestId,
            actionTemplates: TemplateEditConfig,
            source: string,
        ): Promise<unknown> {
            logger.log(
                `ClientIO: proposeAction(source=${source}) - ${JSON.stringify(actionTemplates)}`,
            );
            return undefined;
        },
        notify(
            _requestId: RequestId,
            event: string,
            data: unknown,
            source: string,
        ): void {
            logger.log(
                `ClientIO: notify(event=${event}, source=${source}) - ${JSON.stringify(data)}`,
            );
        },
        async openLocalView(_requestId: RequestId, port: number) {
            logger.log(`ClientIO: openLocalView(port=${port})`);
        },
        async closeLocalView(_requestId: RequestId, port: number) {
            logger.log(`ClientIO: closeLocalView(port=${port})`);
        },
        requestChoice(): void {},
        requestForm(): void {},
        requestInteraction(): void {},
        interactionResolved(): void {},
        interactionCancelled(): void {},
        takeAction(_requestId: RequestId, action: string, data: unknown): void {
            logger.log(
                `ClientIO: takeAction(action=${action}) - ${JSON.stringify(data)}`,
            );
        },
    };
}

// ── CommandServer ─────────────────────────────────────────────────────────────

/**
 * MCP server that exposes TypeAgent capabilities to Claude Code.
 *
 * Tools:
 *   execute_command      - natural-language pass-through to dispatcher
 *   discover_agents      - search structured action summaries
 *   get_action_contract  - fetch one closed structured contract
 *   execute_action       - execute an exact contract
 *   continue_action      - answer a pending interaction
 *   cancel_action        - cancel a pending operation
 *
 * Lifecycle: spawned fresh per Claude Code session; connects to the persistent
 * TypeAgent agentServer via WebSocket.
 */
export class CommandServer {
    public server: McpServer;
    private dispatcher: Dispatcher | null = null;
    private agentServerUrl: string;
    // Set when this instance runs in its own dedicated conversation (see
    // `conversationName`). Owns the whole connection and the created
    // conversation so `close()` can tear both down.
    private connection: AgentServerConnection | null = null;
    // Conversation name to create/join instead of the shared default. When
    // undefined, the instance joins the default conversation as before.
    private conversationName: string | undefined;
    // Id of the conversation this instance created; reused across reconnects
    // and deleted on close.
    private ownedConversationId: string | null = null;
    private reconnectInterval: NodeJS.Timeout | null = null;
    private isConnecting: boolean = false;
    private reconnectDelayMs: number = 5000;
    private logger: Logger;
    private responseCollector: { messages: string[]; rawData?: unknown } = {
        messages: [],
    };
    private currentRequestConfirmed: boolean = false;
    private dispatcherRequestInFlight = false;
    private workspaceCommandInFlight = false;
    private config: ResolvedAgentServerConfig;
    private readonly structuredActionClient: StructuredActionToolClient;

    constructor(
        agentServerUrl?: string,
        structuredActionClient?: StructuredActionToolClient,
    ) {
        this.logger = new Logger();

        const configResult = loadConfig();
        this.config = configResult.config;

        if (configResult.source) {
            this.logger.log(
                `Loaded configuration from: ${configResult.source}`,
            );
        } else {
            this.logger.log("No configuration file found, using defaults");
        }

        this.server = new McpServer({
            name: "Command-Executor-Server",
            version: "1.0.0",
        });
        this.agentServerUrl =
            agentServerUrl ??
            process.env.AGENT_SERVER_URL ??
            AGENT_SERVER_DEFAULT_URL;
        const structuredConversationId = process.env.TYPEAGENT_CONVERSATION_ID;
        this.structuredActionClient =
            structuredActionClient ??
            new StructuredActionClient({
                url: this.agentServerUrl,
                ...(structuredConversationId === undefined
                    ? {}
                    : { conversationId: structuredConversationId }),
            });

        // When set (e.g. by the reasoning subagent manager), this instance runs
        // in its own dedicated conversation instead of the shared default one,
        // so its commands do not contend with the parent conversation's request
        // queue (which would deadlock while the parent's reasoning turn awaits).
        this.conversationName =
            process.env.AGENT_SERVER_CONVERSATION?.trim() || undefined;

        this.logger.log(`CommandServer initializing.`);
        this.logger.log(`TypeAgent server URL: ${this.agentServerUrl}`);

        this.addTools();
        this.addDiagnosticTools();
    }

    public getConfig(): ResolvedAgentServerConfig {
        return this.config;
    }

    public async start(transport?: StdioServerTransport): Promise<void> {
        transport ??= new StdioServerTransport();
        await this.server.connect(transport);
        await this.connectToDispatcher();
        this.startReconnectionMonitoring();
    }

    private async connectToDispatcher(): Promise<void> {
        if (this.isConnecting) return;
        this.isConnecting = true;
        try {
            const clientIO = createMcpClientIO(
                this.logger,
                this.responseCollector,
                () => this.currentRequestConfirmed,
            );
            if (this.conversationName !== undefined) {
                this.dispatcher =
                    await this.connectIsolatedConversation(clientIO);
            } else {
                this.dispatcher = await connectDispatcher(
                    clientIO,
                    this.agentServerUrl,
                    { filter: true },
                    () => {
                        this.logger.log(
                            "Dispatcher connection dropped, will reconnect...",
                        );
                        this.dispatcher = null;
                    },
                );
            }
            this.logger.log(
                `Connected to TypeAgent dispatcher at ${this.agentServerUrl}`,
            );
            await this.applyConfigurationSettings();
        } catch (error) {
            this.logger.error(
                `Failed to connect to dispatcher at ${this.agentServerUrl}`,
                error,
            );
            this.dispatcher = null;
        } finally {
            this.isConnecting = false;
        }
    }

    /**
     * Connect on a dedicated conversation named `conversationName`. The
     * conversation is created once and reused across reconnects; the whole
     * connection (and the created conversation) is torn down in `close()`.
     */
    private async connectIsolatedConversation(
        clientIO: ClientIO,
    ): Promise<Dispatcher> {
        const connection = await connectAgentServer(this.agentServerUrl, () => {
            this.logger.log("Dispatcher connection dropped, will reconnect...");
            this.dispatcher = null;
            this.connection = null;
        });
        this.connection = connection;

        // Reuse the conversation created on a prior connect if it still exists.
        if (this.ownedConversationId !== null) {
            try {
                const joined = await connection.joinConversation(clientIO, {
                    filter: true,
                    conversationId: this.ownedConversationId,
                });
                return joined.dispatcher;
            } catch (error) {
                this.logger.log(
                    `Previous conversation ${this.ownedConversationId} unavailable (${error}); creating a new one.`,
                );
                this.ownedConversationId = null;
            }
        }

        const info = await connection.createConversation(
            this.conversationName!,
        );
        this.ownedConversationId = info.conversationId;
        this.logger.log(
            `Subagent conversation '${this.conversationName}' -> ${info.conversationId}`,
        );
        const joined = await connection.joinConversation(clientIO, {
            filter: true,
            conversationId: info.conversationId,
        });
        return joined.dispatcher;
    }

    private async applyConfigurationSettings(): Promise<void> {
        if (!this.dispatcher) return;
        try {
            if (this.config.cache.grammarSystem !== "completionBased") {
                const cmd = `@config cache grammarSystem ${this.config.cache.grammarSystem}`;
                this.logger.log(`Applying config: ${cmd}`);
                await awaitCommand(this.dispatcher, cmd);
            }
        } catch (error) {
            this.logger.error("Failed to apply configuration settings", error);
        }
    }

    private startReconnectionMonitoring(): void {
        this.reconnectInterval = setInterval(async () => {
            if (!this.dispatcher && !this.isConnecting) {
                this.logger.log("Attempting to reconnect to dispatcher...");
                await this.connectToDispatcher();
            }
        }, this.reconnectDelayMs);
    }

    private stopReconnectionMonitoring(): void {
        if (this.reconnectInterval) {
            clearInterval(this.reconnectInterval);
            this.reconnectInterval = null;
        }
    }

    public async close(): Promise<void> {
        this.stopReconnectionMonitoring();
        await this.structuredActionClient.close();
        if (this.connection) {
            // Isolated-conversation path: delete our dedicated conversation and
            // tear down the whole connection.
            if (this.ownedConversationId) {
                try {
                    await this.connection.deleteConversation(
                        this.ownedConversationId,
                    );
                } catch (error) {
                    this.logger.error(
                        "Failed to delete subagent conversation",
                        error,
                    );
                }
            }
            try {
                await this.connection.close();
            } catch (error) {
                this.logger.error("Failed to close connection", error);
            }
            this.connection = null;
            this.dispatcher = null;
            this.ownedConversationId = null;
        } else if (this.dispatcher) {
            await this.dispatcher.close();
            this.dispatcher = null;
        }
        this.logger.close();
    }

    // ── Tool registration ────────────────────────────────────────────────────

    private addTools() {
        // 1. Natural-language command pass-through
        this.server.registerTool(
            "execute_command",
            {
                inputSchema: executeCommandRequestSchema(),
                description:
                    "Execute a SINGLE, simple natural-language command via TypeAgent. Use this ONLY for straightforward one-shot requests that map to a single agent action.\n\n" +
                    "Good uses (single action, no reasoning required):\n" +
                    "- 'play Shake It Off' / 'pause' / 'skip'\n" +
                    "- 'what's the weather in Berkeley'\n" +
                    "- 'show seconds in the clock' / 'left align the taskbar'\n" +
                    "- 'add milk to my shopping list'\n\n" +
                    "For actions already selected during orchestration, use discover_agents + get_action_contract + execute_action:\n" +
                    "- Tasks requiring web search + an agent action (e.g. 'find top jazz songs and make a playlist')\n" +
                    "- Tasks requiring multiple sequential agent actions\n" +
                    "- Tasks where you need to reason about parameters before calling\n" +
                    "Search for an action, get its exact contract, gather concrete inputs, then call execute_action with that contract's fingerprint and scope. Reuse a known current contract without rediscovery. Keep unresolved references on this natural-language path or clarify them first. Preserve learn:, dev:, record:, and dev: learn: prefixes exactly.\n\n" +
                    "Parameters:\n" +
                    "- request: The command to execute\n" +
                    "- cacheCheck: (optional) Check cache before executing\n" +
                    "- confirmed: (optional) Set to true if user has already confirmed any yes/no prompts\n\n" +
                    "Confirmation Flow:\n" +
                    "Some commands (like deleting sessions or clearing data) require user confirmation. " +
                    "If a command requires confirmation, the tool will return an error message indicating what needs to be confirmed. " +
                    "Ask the user for confirmation, then retry the same command with confirmed=true if they approve.\n\n" +
                    "IMPORTANT: For simple, conversational requests NOT related to programming — weather, news, sports, time/date, app control — use this tool FIRST before web search.",
            },
            async (request: ExecuteCommandRequest) =>
                this.executeCommand(request),
        );

        registerStructuredActionTools(this.server, this.structuredActionClient);

        this.server.registerTool(
            "run_workspace_command",
            {
                inputSchema: WorkspaceCommandInputSchema.shape,
                outputSchema: WorkspaceCommandToolResultSchema,
                description:
                    "Run one explicitly requested build, test, lint, or diagnostic command in the open VS Code workspace through Coda. This uses the structured action service, not natural-language translation or a terminal UI. A completed result includes the full service envelope plus structured stdout, stderr, exitCode, durationMs, success, timedOut, cancelled, and truncation metadata. Pending and failed calls retain their complete service status, prompt, and root error. Example: { command: 'pnpm test -- --runInBand', workingDirectory: 'ts/packages/coda', executionId: 'coda-tests-1' }. Coda rejects shell composition and restricts commands to an allowlist of focused tools, with path arguments confined to the workspace root. execute_command remains unavailable while this tool runs; cancel_workspace_command still works.",
            },
            async (request: WorkspaceCommandInput, extra) =>
                this.runWorkspaceCommand(request, extra.signal),
        );

        this.server.registerTool(
            "cancel_workspace_command",
            {
                inputSchema: CancelWorkspaceCommandInputSchema.shape,
                outputSchema: CancelWorkspaceCommandResultSchema.shape,
                description:
                    "Cancel one active run_workspace_command request by executionId. The result reports whether a running command was cancelled or whether cancellation is pending before its command reaches Coda.",
            },
            async (request: CancelWorkspaceCommandInput) =>
                this.cancelWorkspaceCommand(request),
        );

        // 4. User/editor context - delegates to the code agent (VS Code CODA
        //    extension). This headless MCP server has no editor of its own, so
        //    it returns data only when a VS Code `code` agent is connected to
        //    the same agent server; otherwise it reports none available.
        this.server.registerTool(
            "get_user_context",
            {
                inputSchema: {},
                description:
                    "Get a coarse snapshot of the user's current VS Code editor context (active file, language, cursor/selection ranges, workspace, diagnostic counts). Contains NO file or selection text.\n\n" +
                    "Served by the TypeAgent `code` agent (VS Code CODA extension); returns data only when VS Code with the code agent is connected to this agent server, otherwise reports no editor context.\n\n" +
                    "For actual file/selection text, use execute_action with the code agent's read actions (getSelection, getFileContent, getDiagnostics).",
            },
            async (_request, extra) => this.getUserContext(extra.signal),
        );
    }

    private addDiagnosticTools() {
        this.server.registerTool(
            "ping",
            {
                inputSchema: { message: z.string() },
                description: "Ping the server to test connectivity",
            },
            async (request: { message: string }) =>
                toolResult(
                    request.message ? "PONG: " + request.message : "pong",
                ),
        );

        this.server.registerTool(
            "connection_status",
            {
                inputSchema: {},
                description:
                    "Report connection metadata. The legacy natural-language connection and the separate structuredActions conversation binding are shown explicitly. No resume capability is exposed.",
            },
            async () =>
                toolResult(this.dispatcher ? "connected" : "disconnected", {
                    connected: this.dispatcher !== null,
                    url: this.agentServerUrl,
                    conversationId: this.ownedConversationId,
                    structuredActions: this.structuredActionClient.binding,
                }),
        );

        this.server.registerTool(
            "restart",
            {
                inputSchema: {
                    mode: z
                        .enum(["reconnect", "full"])
                        .optional()
                        .describe(
                            "reconnect: disconnect and reconnect to the agent server (default). full: exit the MCP server process so the client can restart it (picks up new MCP server code).",
                        ),
                },
                description:
                    "Restart the MCP server connection. Use 'reconnect' mode (default) to reconnect to the agent server after it has been restarted. Use 'full' mode to exit the MCP server process entirely so the MCP client can restart it with updated code.",
            },
            async (request: { mode?: "reconnect" | "full" | undefined }) =>
                this.restart(request.mode ?? "reconnect"),
        );
    }

    private async restart(mode: "reconnect" | "full"): Promise<CallToolResult> {
        if (mode === "full") {
            this.logger.log("Full restart requested — exiting process.");
            // Give time for the response to be sent before exiting
            setTimeout(() => process.exit(0), 500);
            return toolResult(
                "MCP server is shutting down. The MCP client should restart it automatically.",
            );
        }

        // Reconnect mode: disconnect and reconnect to the agent server
        this.logger.log("Reconnect requested — disconnecting from dispatcher.");
        if (this.dispatcher) {
            try {
                await this.dispatcher.close();
            } catch (error) {
                this.logger.error("Error closing dispatcher", error);
            }
            this.dispatcher = null;
        }

        this.logger.log("Reconnecting to dispatcher...");
        await this.connectToDispatcher();

        if (this.dispatcher) {
            return toolResult(
                `Reconnected to agent server at ${this.agentServerUrl}.`,
            );
        } else {
            return toolResult(
                `Failed to reconnect to agent server at ${this.agentServerUrl}. Will retry automatically.`,
            );
        }
    }

    // ── Tool implementations ─────────────────────────────────────────────────

    public async executeCommand(
        request: ExecuteCommandRequest,
    ): Promise<CallToolResult> {
        if (this.dispatcherRequestInFlight) {
            return toolResult(
                "Another request is already using this Command Executor. Wait for it to complete before sending another command.",
            );
        }
        this.dispatcherRequestInFlight = true;
        try {
            return await this.executeCommandUnlocked(request);
        } finally {
            this.dispatcherRequestInFlight = false;
        }
    }

    private async executeCommandUnlocked(
        request: ExecuteCommandRequest,
    ): Promise<CallToolResult> {
        this.logger.log(`execute_command: ${request.request}`);

        this.currentRequestConfirmed = request.confirmed ?? false;

        if (!this.dispatcher && !this.isConnecting) {
            await this.connectToDispatcher();
        }

        if (!this.dispatcher) {
            if (request.cacheCheck) {
                return toolResult(
                    "CACHE_MISS: Not connected to TypeAgent dispatcher yet",
                );
            }
            return toolResult(
                `Cannot execute command: not connected to TypeAgent dispatcher at ${this.agentServerUrl}. ` +
                    `Make sure the TypeAgent server is running with: pnpm run start:agent-server`,
            );
        }

        if (request.cacheCheck) {
            try {
                this.responseCollector.messages = [];
                this.responseCollector.rawData = undefined;
                const cacheResult = await this.dispatcher.checkCache(
                    request.request,
                );
                if (cacheResult?.lastError) {
                    return toolResult(`CACHE_MISS: ${cacheResult.lastError}`);
                }
                if (this.responseCollector.messages.length > 0) {
                    const response =
                        this.responseCollector.messages.join("\n\n");
                    return toolResult(
                        `CACHE_HIT: ${await processHtmlContent(response)}`,
                        this.responseCollector.rawData,
                    );
                }
                return toolResult(
                    "CACHE_HIT: Successfully executed from cache",
                );
            } catch (error) {
                const msg = `Cache check failed: ${error instanceof Error ? error.message : String(error)}`;
                if (
                    error instanceof Error &&
                    error.message.includes("Agent channel disconnected")
                ) {
                    this.dispatcher = null;
                }
                return toolResult(`CACHE_MISS: ${msg}`);
            }
        }

        try {
            this.responseCollector.messages = [];
            this.responseCollector.rawData = undefined;
            const result = await awaitCommand(this.dispatcher, request.request);

            if (result?.lastError) {
                return toolResult(
                    `Error executing command: ${result.lastError}`,
                );
            }

            if (this.responseCollector.messages.length > 0) {
                const response = this.responseCollector.messages.join("\n\n");
                return toolResult(
                    await processHtmlContent(response),
                    this.responseCollector.rawData,
                );
            }
            return toolResult(`Successfully executed: ${request.request}`);
        } catch (error) {
            if (
                error instanceof Error &&
                error.message.startsWith("USER_CONFIRMATION_REQUIRED:")
            ) {
                const question = error.message.replace(
                    "USER_CONFIRMATION_REQUIRED: ",
                    "",
                );
                return toolResult(
                    `⚠️  Confirmation Required\n\n` +
                        `The action you requested requires confirmation:\n\n` +
                        `"${question}"\n\n` +
                        `Please confirm with the user, then retry the command with confirmed=true if they approve.`,
                );
            }
            this.dispatcher = null;
            return toolResult(
                `Failed to execute command: ${error instanceof Error ? error.message : String(error)}`,
            );
        } finally {
            this.currentRequestConfirmed = false;
        }
    }

    private async getUserContext(
        signal?: AbortSignal,
    ): Promise<CallToolResult> {
        return this.executeKnownStructuredAction(
            "code",
            "getActiveEditor",
            {},
            signal,
        );
    }

    private async executeKnownStructuredAction(
        schemaName: string,
        actionName: string,
        parameters: Record<string, unknown>,
        signal?: AbortSignal,
    ): Promise<CallToolResult> {
        const contractResult = await invokeStructuredAction(
            this.structuredActionClient,
            (client, requestSignal) =>
                client.getActionContract(
                    { schemaName, actionName },
                    requestSignal,
                ),
            false,
            signal,
        );
        const contract = contractResult.structuredContent as
            | ActionContractResult
            | undefined;
        if (contract?.status !== "found") {
            return contractResult;
        }
        return invokeStructuredAction(
            this.structuredActionClient,
            (client, requestSignal) =>
                client.executeAction(
                    {
                        protocolVersion: contract.protocolVersion,
                        scopeId: contract.scopeId,
                        schemaName,
                        actionName,
                        fingerprint: contract.contract.fingerprint,
                        parameters,
                    },
                    requestSignal,
                ),
            true,
            signal,
        );
    }

    private async runWorkspaceCommand(
        request: WorkspaceCommandInput,
        signal?: AbortSignal,
    ): Promise<CallToolResult> {
        // The Code Agent assigns an ID when the caller omits one. Resolve it
        // here so the result and any cancellation refer to the same command.
        const executionId = request.executionId ?? randomUUID();
        if (this.workspaceCommandInFlight) {
            return workspaceCommandFailure(
                "This Command Executor already has a workspace command in progress. Use a separate MCP connection for a concurrent command.",
                executionId,
            );
        }
        this.workspaceCommandInFlight = true;
        if (signal?.aborted) {
            this.workspaceCommandInFlight = false;
            return cancelledWorkspaceCommandResult(executionId);
        }
        let acquiredDispatcherLock = false;
        const cancelOnAbort = () => {
            void this.cancelWorkspaceCommand({ executionId });
        };
        signal?.addEventListener("abort", cancelOnAbort, { once: true });
        try {
            if (this.dispatcherRequestInFlight) {
                return workspaceCommandFailure(
                    "Another request is already using this Command Executor. Wait for it to complete before sending another command.",
                    executionId,
                );
            }
            this.dispatcherRequestInFlight = true;
            acquiredDispatcherLock = true;
            const result = await this.executeKnownStructuredAction(
                "code.code-workbench",
                "runWorkspaceCommand",
                { ...request, executionId },
                signal,
            );
            const serviceResult = result.structuredContent;
            if (serviceResult?.status === "completed") {
                const executionResult =
                    serviceResult as StructuredActionExecutionResult;
                for (const action of executionResult.results) {
                    if (
                        action.action.schemaName !== "code.code-workbench" ||
                        action.action.actionName !== "runWorkspaceCommand"
                    ) {
                        continue;
                    }
                    const parsed = WorkspaceCommandResultSchema.safeParse(
                        "resultValue" in action.result
                            ? action.result.resultValue
                            : undefined,
                    );
                    if (parsed.success) {
                        return structuredToolResult({
                            ...serviceResult,
                            ...parsed.data,
                        });
                    }
                }
            }
            return result;
        } finally {
            if (acquiredDispatcherLock) {
                this.dispatcherRequestInFlight = false;
            }
            signal?.removeEventListener("abort", cancelOnAbort);
            this.workspaceCommandInFlight = false;
        }
    }

    // Keep Coda's executionId-based process control separate from cancellation
    // of the structured operation: stopping its dispatcher wait is not proof
    // that the underlying workspace process has stopped.
    //
    // Known limitation: the target is resolved by discovering the "code" agent
    // independently of where the run was dispatched. With more than one
    // reachable agent server this can address a different Code Agent than the
    // one running the command.
    private async cancelWorkspaceCommand(
        request: CancelWorkspaceCommandInput,
    ): Promise<CallToolResult> {
        let endpoint: string | undefined;
        try {
            const discovered = await discoverPort("code", undefined, {
                url: this.agentServerUrl,
            });
            if (discovered.kind === "found") {
                endpoint =
                    discovered.url ?? `ws://localhost:${discovered.port}`;
            }
        } catch (error) {
            return cancellationFailure(
                error instanceof Error ? error.message : String(error),
                request.executionId,
            );
        }
        if (endpoint === undefined) {
            return cancellationFailure(
                "The Code Agent websocket is not available.",
                request.executionId,
            );
        }

        const url = new URL(endpoint);
        url.searchParams.set("channel", "code");
        url.searchParams.set("role", "command-executor-control");
        return new Promise<CallToolResult>((resolve) => {
            const socket = new WebSocket(url);
            const timeout = setTimeout(() => {
                socket.close();
                resolve(
                    cancellationFailure(
                        "Timed out waiting for Coda to cancel the command.",
                        request.executionId,
                    ),
                );
            }, 10_000);
            const finish = (result: CallToolResult) => {
                clearTimeout(timeout);
                socket.close();
                resolve(result);
            };
            socket.addEventListener("open", () => {
                socket.send(
                    JSON.stringify({
                        id: request.executionId,
                        method: "code/cancelWorkspaceCommand",
                        params: request,
                    }),
                );
            });
            socket.addEventListener("message", (event) => {
                try {
                    const response = JSON.parse(String(event.data)) as {
                        id?: unknown;
                        result?: unknown;
                    };
                    if (response.id !== request.executionId) {
                        return;
                    }
                    const result =
                        typeof response.result === "string"
                            ? JSON.parse(response.result)
                            : response.result;
                    if (
                        CancelWorkspaceCommandResultSchema.safeParse(result)
                            .success
                    ) {
                        finish(
                            toolResult(JSON.stringify(result, null, 2), result),
                        );
                        return;
                    }
                } catch {
                    // The schema-normalized failure below gives callers a stable result.
                }
                finish(
                    cancellationFailure(
                        "Coda returned an invalid cancellation response.",
                        request.executionId,
                    ),
                );
            });
            socket.addEventListener("error", () => {
                finish(
                    cancellationFailure(
                        "Unable to contact the Code Agent websocket.",
                        request.executionId,
                    ),
                );
            });
        });
    }
}
