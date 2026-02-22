// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod/v4";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { connectDispatcher } from "@typeagent/agent-server-client";
import type {
    AgentSchemaInfo,
    ClientIO,
    IAgentMessage,
    RequestId,
    TemplateEditConfig,
} from "@typeagent/dispatcher-types";
import type { Dispatcher } from "@typeagent/dispatcher-types";
import { DisplayAppendMode } from "@typeagent/agent-sdk";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { convert } from "html-to-text";
import { loadConfig, type ResolvedAgentServerConfig } from "./config/index.js";

// ── Agent filter ──────────────────────────────────────────────────────────────

/**
 * Agents skipped for MCP exposure — not useful via Claude Code.
 * browser: use the Claude browser extension instead
 * settings: dead stub, real settings are in desktop sub-schemas
 * montage: requires the shell embedded browser
 * androidMobile: requires a connected Android device
 * markdown / oracle / spelunker: not applicable for MCP use
 */
const SKIP_AGENTS = new Set([
    "browser",
    "settings",
    "montage",
    "androidMobile",
    "markdown",
    "oracle",
    "spelunker",
]);

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

function discoverAgentsRequestSchema() {
    return {
        agentName: z
            .string()
            .optional()
            .describe(
                "If omitted, returns a list of all available agents. If provided, returns sub-schema groups with action names and descriptions for that agent.",
            ),
        actionName: z
            .string()
            .optional()
            .describe(
                "If provided along with agentName, returns the full TypeScript schema source for that specific action.",
            ),
    };
}

function executeActionRequestSchema() {
    return {
        schemaName: z.string().describe("The agent name (e.g. 'player')"),
        actionName: z
            .string()
            .describe("The action name (e.g. 'createPlaylist')"),
        parameters: z
            .record(z.string(), z.any())
            .optional()
            .describe("Action-specific parameters"),
        naturalLanguage: z
            .string()
            .optional()
            .describe(
                "The original natural language request from the user. When provided, the dispatcher stores this as a cache entry mapping the phrase to this action+parameters, so future identical or similar requests can be handled without LLM translation.",
            ),
    };
}
type ExecuteActionRequest = {
    schemaName: string;
    actionName: string;
    parameters?: Record<string, unknown> | undefined;
    naturalLanguage?: string | undefined;
};

// ── Utilities ─────────────────────────────────────────────────────────────────

function toolResult(result: string): CallToolResult {
    return { content: [{ type: "text", text: result }] };
}

function stripAnsi(text: string): string {
    // eslint-disable-next-line no-control-regex
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
        console.log(s);
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
    responseCollector: { messages: string[] },
    getConfirmedFlag: () => boolean,
): ClientIO {
    return {
        clear(): void {},
        exit(): void {},
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
        async askYesNo(
            _requestId: RequestId,
            message: string,
            defaultValue?: boolean,
        ): Promise<boolean> {
            if (getConfirmedFlag()) {
                logger.log(`ClientIO: askYesNo - "${message}" (auto-approved)`);
                return true;
            }
            throw new Error(`USER_CONFIRMATION_REQUIRED: ${message}`);
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
        async popupQuestion(
            message: string,
            choices: string[],
            defaultId: number | undefined,
            source: string,
        ): Promise<number> {
            logger.log(
                `ClientIO: popupQuestion(source=${source}) - "${message}" choices=[${choices.join(", ")}] (defaulting to ${defaultId ?? 0})`,
            );
            return defaultId ?? 0;
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
 *   execute_command   — natural-language pass-through to dispatcher
 *   discover_agents   — list agents or fetch a specific agent's schema
 *   execute_action    — call any agent action directly by schema/action name
 *
 * Plus browser automation tools registered via registerBrowserActionTools().
 *
 * Lifecycle: spawned fresh per Claude Code session; connects to the persistent
 * TypeAgent agentServer via WebSocket.
 */
export class CommandServer {
    public server: McpServer;
    private dispatcher: Dispatcher | null = null;
    private agentServerUrl: string;
    private reconnectInterval: NodeJS.Timeout | null = null;
    private isConnecting: boolean = false;
    private reconnectDelayMs: number = 5000;
    private logger: Logger;
    private responseCollector: { messages: string[] } = { messages: [] };
    private currentRequestConfirmed: boolean = false;
    private config: ResolvedAgentServerConfig;

    constructor(agentServerUrl?: string) {
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
            "ws://localhost:8999";

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
            this.dispatcher = await connectDispatcher(
                clientIO,
                this.agentServerUrl,
                { filter: true },
            );
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

    private async applyConfigurationSettings(): Promise<void> {
        if (!this.dispatcher) return;
        try {
            if (this.config.cache.grammarSystem !== "completionBased") {
                const cmd = `@config cache grammarSystem ${this.config.cache.grammarSystem}`;
                this.logger.log(`Applying config: ${cmd}`);
                await this.dispatcher.processCommand(cmd);
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
        if (this.dispatcher) {
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
                    "DO NOT use this for multi-step tasks. Instead, use discover_agents + execute_action directly:\n" +
                    "- Tasks requiring web search + an agent action (e.g. 'find top jazz songs and make a playlist')\n" +
                    "- Tasks requiring multiple sequential agent actions\n" +
                    "- Tasks where you need to reason about parameters before calling\n" +
                    "For those, call discover_agents to find the right action, gather any external info yourself (web search etc.), then call execute_action with the resolved parameters.\n\n" +
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

        // 2. Agent discovery — list all agents or fetch a specific agent's schema
        this.server.registerTool(
            "discover_agents",
            {
                inputSchema: discoverAgentsRequestSchema(),
                description:
                    "Discover available TypeAgent capabilities.\n\n" +
                    "- Called WITHOUT agentName: returns a list of all agents with name, emoji, and description.\n" +
                    "- Called WITH agentName only: returns sub-schema groups with schemaName, description, and action names+descriptions. Use the schemaName shown in each group as the exact value for execute_action.\n" +
                    "- Called WITH agentName AND actionName: returns the full TypeScript schema source for that specific action.\n\n" +
                    "Use this BEFORE telling the user a capability isn't available. Call without agentName first to find the right agent, then with agentName to see its actions.\n\n" +
                    "PREFERRED PATTERN for multi-step tasks: use discover_agents to find actions, do any external reasoning yourself (web search, calculations, etc.), then call execute_action with fully resolved parameters. Do NOT delegate multi-step reasoning to execute_command.\n\n" +
                    "Example — 'find top jazz songs and make a playlist':\n" +
                    "  1. WebSearch for current top jazz songs\n" +
                    "  2. discover_agents({ agentName: 'player' }) → find createPlaylist, addSongsToPlaylist\n" +
                    "  3. execute_action({ schemaName: 'player', actionName: 'createPlaylist', parameters: { name: 'Top Jazz Feb 2026' } })\n" +
                    "  4. execute_action({ schemaName: 'player', actionName: 'addSongsToPlaylist', parameters: { playlist: '...', songs: [...] } })\n\n" +
                    "Available agents include (but are not limited to):\n" +
                    "- player: music playback (Spotify/media)\n" +
                    "- calendar: schedule and view events\n" +
                    "- list: shopping lists, todo lists\n" +
                    "- desktop: Windows desktop control, taskbar, VSCode editor automation\n" +
                    "- email: read and send email\n" +
                    "- chat: messaging\n" +
                    "- photo: photo library\n" +
                    "- image: image generation\n" +
                    "- video: video playback\n" +
                    "- code: code generation tasks",
            },
            async (request: {
                agentName?: string | undefined;
                actionName?: string | undefined;
            }) => this.discoverAgents(request),
        );

        // 3. Direct action execution
        this.server.registerTool(
            "execute_action",
            {
                inputSchema: executeActionRequestSchema(),
                description:
                    "Execute a TypeAgent action directly by specifying the agent, action name, and parameters.\n\n" +
                    "Use discover_agents to find the correct schemaName and actionName before calling this.\n\n" +
                    "Parameters:\n" +
                    "- schemaName: The agent name (e.g. 'player', 'calendar', 'list')\n" +
                    "- actionName: The action to execute (e.g. 'createPlaylist', 'addEvent')\n" +
                    "- parameters: Action-specific parameters object (optional)\n" +
                    "- naturalLanguage: The original natural language request from the user (e.g. 'play shake it off'). ALWAYS provide this when you have the user's original request — the dispatcher uses it to populate its NL cache so future identical or similar requests can be handled without LLM translation.\n\n" +
                    "The action is dispatched directly to the agent, bypassing the LLM translation step for maximum speed.",
            },
            async (request: ExecuteActionRequest) =>
                this.executeAction(request),
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
    }

    // ── Tool implementations ─────────────────────────────────────────────────

    public async executeCommand(
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
            const result = await this.dispatcher.processCommand(
                request.request,
            );

            if (result?.lastError) {
                return toolResult(
                    `Error executing command: ${result.lastError}`,
                );
            }

            if (this.responseCollector.messages.length > 0) {
                const response = this.responseCollector.messages.join("\n\n");
                return toolResult(await processHtmlContent(response));
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

    /** Resolve AgentSchemaInfo list — live from dispatcher. Returns empty if disconnected. */
    private async resolveAgentSchemas(
        agentName?: string,
    ): Promise<AgentSchemaInfo[]> {
        if (!this.dispatcher) {
            return [];
        }
        const schemas = await this.dispatcher.getAgentSchemas(agentName);
        return schemas.filter((a) => !SKIP_AGENTS.has(a.name));
    }

    private async discoverAgents(request: {
        agentName?: string | undefined;
        actionName?: string | undefined;
    }): Promise<CallToolResult> {
        if (!request.agentName) {
            // Level 1 — list agents, filtered to active ones when dispatcher is available
            const agents = await this.resolveAgentSchemas();
            if (agents.length === 0) {
                return toolResult(
                    "No agents available. Ensure TypeAgent server is running.",
                );
            }

            // Filter to active agents when connected
            let visible = agents;
            if (this.dispatcher) {
                try {
                    const status = await this.dispatcher.getStatus();
                    const activeNames = new Set(
                        status.agents
                            .filter((a) => a.active)
                            .map((a) => a.name.toLowerCase()),
                    );
                    const filtered = agents.filter((a) =>
                        activeNames.has(a.name.toLowerCase()),
                    );
                    if (filtered.length > 0) visible = filtered;
                } catch {
                    // Use unfiltered list
                }
            }

            const lines = visible.map(
                (a) => `${a.emoji} **${a.name}** — ${a.description}`,
            );
            return toolResult(
                `Available TypeAgent agents (${visible.length}):\n\n` +
                    lines.join("\n") +
                    "\n\nCall discover_agents({ agentName: '<name>' }) to see actions for a specific agent.",
            );
        }

        const schemas = await this.resolveAgentSchemas(request.agentName);
        const agent = schemas[0];
        if (!agent) {
            return toolResult(
                `Agent '${request.agentName}' not found or not available.`,
            );
        }

        if (request.actionName) {
            // Level 3 — full TypeScript source for one specific action
            const needle = request.actionName.toLowerCase();
            const subSchema = agent.subSchemas.find((s) =>
                s.actions.some((a) => a.name.toLowerCase() === needle),
            );
            if (!subSchema) {
                const allActions = agent.subSchemas
                    .flatMap((s) => s.actions.map((a) => a.name))
                    .join(", ");
                return toolResult(
                    `Action '${request.actionName}' not found in agent '${agent.name}'.\n\nAvailable actions: ${allActions}`,
                );
            }
            if (!subSchema.schemaFilePath) {
                return toolResult(
                    `TypeScript source not available for action '${request.actionName}'.`,
                );
            }
            try {
                const source = fs.readFileSync(
                    subSchema.schemaFilePath,
                    "utf-8",
                );
                return toolResult(
                    `TypeScript schema for **${subSchema.schemaName}** (action: ${request.actionName}):\n\n` +
                        `\`\`\`typescript\n${source}\n\`\`\``,
                );
            } catch {
                return toolResult(
                    `Could not read schema file: ${subSchema.schemaFilePath}`,
                );
            }
        }

        // Level 2 — sub-schema groups with schemaName + action names+descriptions
        const sections = agent.subSchemas
            .map((sub) => {
                const actionLines = sub.actions
                    .map((a) => `     • **${a.name}** — ${a.description}`)
                    .join("\n");
                return `  📂 **${sub.schemaName}** — ${sub.description}\n${actionLines}`;
            })
            .join("\n\n");

        const totalActions = agent.subSchemas.reduce(
            (n, s) => n + s.actions.length,
            0,
        );
        return toolResult(
            `${agent.emoji} **${agent.name}** — ${agent.description}\n\n` +
                sections +
                `\n\n(${totalActions} total actions across ${agent.subSchemas.length} schema${agent.subSchemas.length > 1 ? "s" : ""})\n\n` +
                `To get TypeScript for an action: discover_agents({ agentName: '${agent.name}', actionName: '<name>' })\n` +
                `To execute: execute_action({ schemaName: '<schemaName from 📂 above>', actionName: '<name>', parameters: {...} })`,
        );
    }

    private async executeAction(
        request: ExecuteActionRequest,
    ): Promise<CallToolResult> {
        this.logger.log(
            `execute_action: ${request.schemaName}.${request.actionName} params=${JSON.stringify(request.parameters ?? {})}`,
        );

        if (!this.dispatcher && !this.isConnecting) {
            await this.connectToDispatcher();
        }

        if (!this.dispatcher) {
            return toolResult(
                `Cannot execute action: not connected to TypeAgent dispatcher at ${this.agentServerUrl}.`,
            );
        }

        const paramStr =
            request.parameters && Object.keys(request.parameters).length > 0
                ? `--parameters '${JSON.stringify(request.parameters).replaceAll("'", "\\u0027")}'`
                : "";

        const nlStr = request.naturalLanguage
            ? `--naturalLanguage '${request.naturalLanguage.replaceAll("'", "\\u0027")}'`
            : "";

        const actionCommand =
            `@action ${request.schemaName} ${request.actionName} ${paramStr} ${nlStr}`.trim();

        this.logger.log(`Dispatching: ${actionCommand}`);
        this.responseCollector.messages = [];

        try {
            const result = await this.dispatcher.processCommand(actionCommand);
            if (result?.lastError) {
                return toolResult(`Action error: ${result.lastError}`);
            }
            if (this.responseCollector.messages.length > 0) {
                const response = this.responseCollector.messages.join("\n\n");
                return toolResult(await processHtmlContent(response));
            }
            return toolResult(
                `✓ Action ${request.actionName} executed successfully`,
            );
        } catch (error) {
            return toolResult(
                `Action execution failed: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }
}
