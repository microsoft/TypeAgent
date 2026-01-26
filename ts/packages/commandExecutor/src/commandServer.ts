// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod/v4";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { connectDispatcher } from "@typeagent/agent-server-client";
import type {
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

function executeCommandRequestSchema() {
    return {
        request: z.string(),
        cacheCheck: z.boolean().optional(),
        confirmed: z.boolean().optional(),
    };
}
const ExecuteCommandRequestSchema = z.object(executeCommandRequestSchema());

export type ExecuteCommandRequest = z.infer<typeof ExecuteCommandRequestSchema>;

function discoverSchemasRequestSchema() {
    return {
        query: z.string(),
        includeActions: z.boolean().optional(),
    };
}
const DiscoverSchemasRequestSchema = z.object(discoverSchemasRequestSchema());
export type DiscoverSchemasRequest = z.infer<
    typeof DiscoverSchemasRequestSchema
>;

function loadSchemaRequestSchema() {
    return {
        schemaName: z.string(),
        exposeAs: z.enum(["individual", "composite"]).optional(),
    };
}
const LoadSchemaRequestSchema = z.object(loadSchemaRequestSchema());
export type LoadSchemaRequest = z.infer<typeof LoadSchemaRequestSchema>;

function typeagentActionRequestSchema() {
    return {
        agent: z.string(),
        action: z.string(),
        parameters: z.record(z.string(), z.any()).optional(),
        naturalLanguage: z.string(),
    };
}
const TypeagentActionRequestSchema = z.object(typeagentActionRequestSchema());
export type TypeagentActionRequest = z.infer<
    typeof TypeagentActionRequestSchema
>;

function toolResult(result: string): CallToolResult {
    return {
        content: [{ type: "text", text: result }],
    };
}

/**
 * Logger utility that writes to both console and a log file
 */
class Logger {
    private logFilePath: string;
    private logStream: fs.WriteStream;

    constructor() {
        // Use ~/.tmp instead of system temp directory
        const logDir = path.join(os.homedir(), ".tmp", "typeagent-mcp");
        if (!fs.existsSync(logDir)) {
            fs.mkdirSync(logDir, { recursive: true });
        }
        this.logFilePath = path.join(logDir, `mcp-server-${Date.now()}.log`);
        this.logStream = fs.createWriteStream(this.logFilePath, { flags: "a" });
        this.log(`Log file created at: ${this.logFilePath}`);
    }

    private formatMessage(level: string, message: string): string {
        const timestamp = new Date().toISOString();
        return `[${timestamp}] [${level}] ${message}`;
    }

    log(message: string): void {
        const formatted = this.formatMessage("INFO", message);
        console.log(formatted);
        this.logStream.write(formatted + "\n");
    }

    error(message: string, error?: any): void {
        const errorDetails = error
            ? ` - ${error instanceof Error ? error.message : String(error)}`
            : "";
        const formatted = this.formatMessage("ERROR", message + errorDetails);
        console.error(formatted);
        this.logStream.write(formatted + "\n");
        if (error?.stack) {
            this.logStream.write(error.stack + "\n");
        }
    }

    getLogFilePath(): string {
        return this.logFilePath;
    }

    close(): void {
        this.logStream.end();
    }
}

/**
 * Remove ANSI escape codes from a string
 */
function stripAnsi(text: string): string {
    // eslint-disable-next-line no-control-regex
    return text.replace(/\x1b\[[0-9;]*m/g, "");
}

/**
 * Convert HTML content to plain text using html-to-text library
 * This provides secure HTML parsing instead of regex-based sanitization
 */
function htmlToPlainText(html: string): string {
    return convert(html, {
        wordwrap: false,
        preserveNewlines: true,
        selectors: [
            { selector: "img", format: "skip" }, // Skip images entirely
            { selector: "a", options: { ignoreHref: true } }, // Keep link text, ignore URLs
        ],
    });
}

/**
 * Process HTML content to convert it to plain text
 */
async function processHtmlImages(content: string): Promise<string> {
    return htmlToPlainText(content);
}

/**
 * Minimal ClientIO implementation for MCP server
 * Most methods are no-ops since we just need to satisfy the interface
 */
function createMcpClientIO(
    logger: Logger,
    responseCollector: { messages: string[] },
    getConfirmedFlag: () => boolean,
): ClientIO {
    return {
        clear(): void {
            logger.log("ClientIO: clear() called");
        },
        exit(): void {
            logger.log("ClientIO: exit() called");
        },
        setDisplayInfo(): void {},
        setDisplay(message: IAgentMessage): void {
            logger.log(`ClientIO: setDisplay() - ${JSON.stringify(message)}`);
            if (typeof message === "object" && "message" in message) {
                const msg = message.message;
                // Filter out "info" kind messages (technical translation details)
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
            // Only capture block mode messages (final results), not temporary status messages
            if (
                mode === "block" &&
                typeof message === "object" &&
                "message" in message
            ) {
                const msg = message.message;
                // Filter out "info" kind messages (technical translation details)
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
        appendDiagnosticData(requestId: RequestId, data: any): void {
            logger.log(
                `ClientIO: appendDiagnosticData(requestId=${requestId}) - ${JSON.stringify(data)}`,
            );
        },
        setDynamicDisplay(): void {},
        async askYesNo(
            message: string,
            requestId: RequestId,
            defaultValue?: boolean,
        ): Promise<boolean> {
            // Check if this request was pre-confirmed
            if (getConfirmedFlag()) {
                logger.log(
                    `ClientIO: askYesNo(requestId=${requestId}) - "${message}" (auto-approved due to confirmed=true)`,
                );
                return true;
            }

            // Otherwise, throw error requiring user confirmation
            logger.log(
                `ClientIO: askYesNo(requestId=${requestId}) - "${message}" (requires user confirmation)`,
            );
            throw new Error(`USER_CONFIRMATION_REQUIRED: ${message}`);
        },
        async proposeAction(
            actionTemplates: TemplateEditConfig,
            requestId: RequestId,
            source: string,
        ): Promise<unknown> {
            logger.log(
                `ClientIO: proposeAction(requestId=${requestId}, source=${source}) - ${JSON.stringify(actionTemplates)}`,
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
            event: string,
            requestId: RequestId,
            data: any,
            source: string,
        ): void {
            logger.log(
                `ClientIO: notify(event=${event}, requestId=${requestId}, source=${source}) - ${JSON.stringify(data)}`,
            );
        },
        openLocalView(port: number): void {
            logger.log(`ClientIO: openLocalView(port=${port})`);
        },
        closeLocalView(port: number): void {
            logger.log(`ClientIO: closeLocalView(port=${port})`);
        },
        takeAction(action: string, data: unknown): void {
            logger.log(
                `ClientIO: takeAction(action=${action}) - ${JSON.stringify(data)}`,
            );
        },
    };
}

/**
 * Load weather schema and manifest from the actual weather agent package
 */
function getWeatherAgentInfo(): { manifest: any; schemaSource: string } {
    // Resolve the path to the weather agent's src directory
    const weatherAgentSrcPath = path.join(
        process.cwd(),
        "packages/agents/weather/src",
    );

    try {
        // Read the manifest
        const manifestPath = path.join(
            weatherAgentSrcPath,
            "weatherManifest.json",
        );
        const manifestContent = fs.readFileSync(manifestPath, "utf-8");
        const manifest = JSON.parse(manifestContent);

        // Read the schema source file
        const schemaPath = path.join(weatherAgentSrcPath, "weatherSchema.ts");
        const schemaSource = fs.readFileSync(schemaPath, "utf-8");

        return { manifest, schemaSource };
    } catch (error) {
        // Fallback: return hardcoded values if file reading fails
        const fallbackSchema = `export type WeatherAction =
    | GetCurrentConditionsAction
    | GetForecastAction
    | GetAlertsAction;

export type GetCurrentConditionsAction = {
    actionName: "getCurrentConditions";
    parameters: {
        location: string;
        units?: "celsius" | "fahrenheit";
    };
};

export type GetForecastAction = {
    actionName: "getForecast";
    parameters: {
        location: string;
        days?: number; // 1-7 days
        units?: "celsius" | "fahrenheit";
    };
};

export type GetAlertsAction = {
    actionName: "getAlerts";
    parameters: {
        location: string;
    };
};`;

        const fallbackManifest = {
            emojiChar: "⛅",
            description:
                "Agent to get weather information including current conditions, forecasts, and alerts",
            schema: {
                description:
                    "Weather agent with actions to get current conditions, forecasts, and alerts",
                schemaFile: "./weatherSchema.ts",
                schemaType: {
                    action: "WeatherAction",
                },
            },
        };

        return { manifest: fallbackManifest, schemaSource: fallbackSchema };
    }
}

/**
 * Schema registry using real TypeAgent agents
 * Currently includes the weather agent for testing discovery
 */
interface SchemaInfo {
    name: string;
    description: string;
    schemaSource: string; // TypeScript schema definition
    actions: {
        name: string;
        description: string;
        parameters: any;
    }[];
}

// Load weather agent info at module initialization
const weatherAgentInfo = getWeatherAgentInfo();

const SCHEMA_REGISTRY: SchemaInfo[] = [
    {
        name: "weather",
        description: weatherAgentInfo.manifest.description,
        schemaSource: weatherAgentInfo.schemaSource,
        actions: [
            {
                name: "getCurrentConditions",
                description: "Get current weather conditions for a location",
                parameters: {
                    location: {
                        type: "string",
                        description: "City name or zip code",
                    },
                    units: {
                        type: "string",
                        enum: ["celsius", "fahrenheit"],
                        description: "Temperature units (optional)",
                    },
                },
            },
            {
                name: "getForecast",
                description: "Get weather forecast for upcoming days",
                parameters: {
                    location: {
                        type: "string",
                        description: "City name or zip code",
                    },
                    days: {
                        type: "number",
                        description: "Number of days (1-7, optional)",
                    },
                    units: {
                        type: "string",
                        enum: ["celsius", "fahrenheit"],
                        description: "Temperature units (optional)",
                    },
                },
            },
            {
                name: "getAlerts",
                description: "Get active weather alerts for a location",
                parameters: {
                    location: {
                        type: "string",
                        description: "City name or zip code",
                    },
                },
            },
        ],
    },
];

/**
 * MCP server that executes commands through TypeAgent dispatcher.
 *
 * Lifecycle when used with Agent SDK:
 * - Each Agent SDK query() spawns a new Claude Code process
 * - Claude Code spawns a new instance of this MCP server
 * - MCP server connects to agentServer (persistent shared dispatcher)
 * - Query executes, tools are called as needed
 * - Claude Code process exits
 * - MCP server disconnects from agentServer
 *
 * This transient connection pattern is normal and expected.
 * The agentServer maintains a persistent shared dispatcher across all MCP connections.
 */
export class CommandServer {
    public server: McpServer;
    private dispatcher: Dispatcher | null = null;
    private agentServerUrl: string;
    private reconnectInterval: NodeJS.Timeout | null = null;
    private isConnecting: boolean = false;
    private reconnectDelayMs: number = 5000; // 5 seconds between reconnection attempts
    private logger: Logger;
    private responseCollector: { messages: string[] } = { messages: [] };
    private currentRequestConfirmed: boolean = false;
    private config: ResolvedAgentServerConfig;

    /**
     * Creates a new CommandServer instance
     * @param debugMode Enable debug mode for diagnostic tools
     * @param agentServerUrl URL of the TypeAgent dispatcher server (default: ws://localhost:8999)
     */
    constructor(debugMode: boolean = true, agentServerUrl?: string) {
        this.logger = new Logger();

        // Load agent server configuration
        const configResult = loadConfig();
        this.config = configResult.config;

        if (configResult.source) {
            this.logger.log(
                `Loaded configuration from: ${configResult.source}`,
            );
            this.logger.log(
                `Grammar system: ${this.config.cache.grammarSystem}`,
            );
            this.logger.log(
                `Cache enabled: ${this.config.cache.enabled}`,
            );
            if (this.config.agents.length > 0) {
                this.logger.log(
                    `Configured agents: ${this.config.agents.map((a: { name: string }) => a.name).join(", ")}`,
                );
            }
        } else {
            this.logger.log("No configuration file found, using defaults");
        }

        if (configResult.errors.length > 0) {
            this.logger.error(
                "Configuration validation errors:",
                configResult.errors.join(", "),
            );
        }

        this.server = new McpServer({
            name: "Command-Executor-Server",
            version: "1.0.0",
        });
        this.agentServerUrl =
            agentServerUrl ??
            process.env.AGENT_SERVER_URL ??
            "ws://localhost:8999";
        this.logger.log(
            `CommandServer initializing with TypeAgent server URL: ${this.agentServerUrl}`,
        );
        this.addTools();
        if (debugMode) {
            this.addDiagnosticTools();
        }
    }

    /**
     * Get the current configuration
     */
    public getConfig(): ResolvedAgentServerConfig {
        return this.config;
    }

    public async start(transport?: StdioServerTransport): Promise<void> {
        transport ??= new StdioServerTransport();
        await this.server.connect(transport);

        // Connect to the TypeAgent dispatcher
        // Note: When spawned by Agent SDK, this is a transient process per query
        // Lazy connection on first tool call handles startup race conditions
        await this.connectToDispatcher();

        // Start reconnection monitoring for cases where dispatcher restarts
        // When spawned by Agent SDK, this process is transient per query anyway
        this.startReconnectionMonitoring();
    }

    private async connectToDispatcher(): Promise<void> {
        if (this.isConnecting) {
            return;
        }

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
            );
            this.logger.log(
                `Connected to TypeAgent dispatcher at ${this.agentServerUrl}`,
            );

            // Apply configuration settings via @config commands
            await this.applyConfigurationSettings();
        } catch (error) {
            this.logger.error(
                `Failed to connect to dispatcher at ${this.agentServerUrl}`,
                error,
            );
            this.logger.error(
                "Will retry connection automatically. Make sure the TypeAgent server is running.",
            );
            this.dispatcher = null;
        } finally {
            this.isConnecting = false;
        }
    }

    /**
     * Apply configuration settings by sending @config commands to the dispatcher
     */
    private async applyConfigurationSettings(): Promise<void> {
        if (!this.dispatcher) {
            return;
        }

        try {
            // Apply cache.grammarSystem setting if it differs from default
            if (this.config.cache.grammarSystem !== "completionBased") {
                this.logger.log(
                    `Applying configuration: cache.grammarSystem = ${this.config.cache.grammarSystem}`,
                );
                await this.dispatcher.processCommand(
                    `@config cache.grammarSystem ${this.config.cache.grammarSystem}`,
                );
            }

            this.logger.log("Configuration settings applied successfully");
        } catch (error) {
            this.logger.error(
                "Failed to apply some configuration settings",
                error,
            );
            // Don't throw - continue even if config application fails
        }
    }

    private startReconnectionMonitoring(): void {
        // Check connection status periodically and reconnect if needed
        this.reconnectInterval = setInterval(async () => {
            if (!this.dispatcher && !this.isConnecting) {
                this.logger.log(
                    "Attempting to reconnect to TypeAgent dispatcher...",
                );
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

    private addTools() {
        // Legacy natural language command execution
        this.server.registerTool(
            "execute_command",
            {
                inputSchema: executeCommandRequestSchema(),
                description:
                    "Execute user commands including:\n" +
                    "- Music & media: play songs, control playback\n" +
                    "- Lists & tasks: manage shopping lists, todo lists\n" +
                    "- Calendar: schedule events, view calendar\n" +
                    "- VSCode automation: change theme (e.g. 'switch to monokai theme'), open files, create folders, run tasks, manage editor layout, open terminals, toggle settings\n\n" +
                    "Parameters:\n" +
                    "- request: The command to execute\n" +
                    "- cacheCheck: (optional) Check cache before executing\n" +
                    "- confirmed: (optional) Set to true if user has already confirmed any yes/no prompts\n\n" +
                    "Confirmation Flow:\n" +
                    "Some commands (like deleting sessions or clearing data) require user confirmation. " +
                    "If a command requires confirmation, the tool will return an error message indicating what needs to be confirmed. " +
                    "Ask the user for confirmation, then retry the same command with confirmed=true if they approve.",
            },
            async (request: ExecuteCommandRequest) =>
                this.executeCommand(request),
        );

        // Discovery tool
        this.server.registerTool(
            "discover_schemas",
            {
                inputSchema: discoverSchemasRequestSchema(),
                description:
                    "Check if TypeAgent has capabilities for a user request that isn't covered by existing tools. " +
                    "Returns available schemas/agents that match the request, along with their actions. " +
                    "Use this BEFORE telling the user a capability isn't available.\n\n" +
                    "Example: User asks 'What's the weather?' → Call discover_schemas({query: 'weather'}) to see if a weather agent is installed.\n\n" +
                    "Parameters:\n" +
                    "- query: Natural language description of what the user wants (e.g., 'weather', 'send email', 'analyze code')\n" +
                    "- includeActions: If true, return detailed action schemas and TypeScript source. If false, just return agent names and descriptions (default: false)",
            },
            async (request: DiscoverSchemasRequest) =>
                this.discoverSchemas(request),
        );

        // Schema loading tool
        this.server.registerTool(
            "load_schema",
            {
                inputSchema: loadSchemaRequestSchema(),
                description:
                    "Load a TypeAgent schema dynamically and register its actions as tools. " +
                    "After loading, the agent's actions become available for direct invocation in this session. " +
                    "Only use this after discover_schemas confirms the schema is available.\n\n" +
                    "Parameters:\n" +
                    "- schemaName: The schema/agent name returned by discover_schemas (e.g., 'weather', 'email')\n" +
                    "- exposeAs: How to expose actions - 'individual' creates one tool per action (e.g., weather_getCurrentConditions), 'composite' creates one tool (e.g., weather_action) with action as a parameter (default: composite)",
            },
            async (request: LoadSchemaRequest) => this.loadSchema(request),
        );

        // Generic action execution tool
        this.server.registerTool(
            "typeagent_action",
            {
                inputSchema: typeagentActionRequestSchema(),
                description:
                    "Execute a TypeAgent action with cache population for future natural language queries.\n\n" +
                    "Use this tool when:\n" +
                    "1. An action exists but isn't exposed as an individual tool\n" +
                    "2. You want to invoke an action from a newly discovered schema before loading it\n" +
                    "3. The action is rarely used and doesn't warrant a dedicated tool\n\n" +
                    "IMPORTANT - Cache Population:\n" +
                    "This tool populates TypeAgent's cache so future similar natural language requests will execute faster.\n" +
                    "You MUST pass the user's original natural language request in the 'naturalLanguage' parameter.\n\n" +
                    "Parameters:\n" +
                    "- agent: The agent/schema name (e.g., 'player', 'list', 'calendar', 'weather')\n" +
                    "- action: The action name (e.g., 'playTrack', 'addItem', 'getCurrentConditions')\n" +
                    "- parameters: Action-specific parameters (optional)\n" +
                    "- naturalLanguage: REQUIRED - The user's exact original natural language request that led to this action.\n" +
                    '  Example: If user asked "what\'s the weather in seattle in celsius", pass that exact string here.\n' +
                    "  This enables TypeAgent to match future similar requests directly from cache without needing to call this tool again.",
            },
            async (request: TypeagentActionRequest) =>
                this.executeTypeagentAction(request),
        );
    }

    public async executeCommand(
        request: ExecuteCommandRequest,
    ): Promise<CallToolResult> {
        this.logger.log(`User request: ${request.request}`);

        // Set confirmation flag for this request
        this.currentRequestConfirmed = request.confirmed ?? false;
        if (this.currentRequestConfirmed) {
            this.logger.log("Request has confirmed=true flag");
        }

        // If not connected, try to connect now (lazy connection)
        if (!this.dispatcher && !this.isConnecting) {
            this.logger.log(
                "Not connected to dispatcher, attempting to connect...",
            );
            await this.connectToDispatcher();
        }

        if (!this.dispatcher) {
            // During cache check, return cache miss instead of error to avoid startup race condition messages
            if (request.cacheCheck) {
                this.logger.log(
                    "Cache check requested but not connected yet - returning cache miss",
                );
                return toolResult(
                    "CACHE_MISS: Not connected to TypeAgent dispatcher yet",
                );
            }
            const errorMsg = `Cannot execute command: not connected to TypeAgent dispatcher at ${this.agentServerUrl}. Make sure the TypeAgent server is running with: pnpm run start:agent-server`;
            this.logger.error(errorMsg);
            return toolResult(errorMsg);
        }

        // If cacheCheck is requested, check cache and execute if hit
        if (request.cacheCheck) {
            try {
                this.logger.log(
                    `Cache check requested for: ${request.request}`,
                );

                // Clear response collector before cache check
                this.responseCollector.messages = [];

                const cacheResult = await this.dispatcher.checkCache(
                    request.request,
                );

                if (cacheResult?.lastError) {
                    // Cache miss or error
                    this.logger.log(`Cache miss: ${cacheResult.lastError}`);
                    return toolResult(`CACHE_MISS: ${cacheResult.lastError}`);
                }

                // Cache hit - actions were executed, return the collected messages
                this.logger.log(`Cache hit - executed successfully`);

                if (this.responseCollector.messages.length > 0) {
                    const response =
                        this.responseCollector.messages.join("\n\n");
                    const processedResponse = await processHtmlImages(response);
                    // Return with CACHE_HIT prefix for detection (cacheClient strips it)
                    return toolResult(`CACHE_HIT: ${processedResponse}`);
                }

                // Fallback if no messages were collected
                return toolResult(
                    `CACHE_HIT: Successfully executed from cache`,
                );
            } catch (error) {
                const errorMsg = `Cache check failed: ${error instanceof Error ? error.message : String(error)}`;
                this.logger.error(errorMsg);

                // If the error is "Agent channel disconnected", reset the dispatcher to trigger reconnection
                if (
                    error instanceof Error &&
                    error.message.includes("Agent channel disconnected")
                ) {
                    this.logger.log(
                        "Dispatcher connection lost, will reconnect on next request",
                    );
                    this.dispatcher = null;
                }

                return toolResult(`CACHE_MISS: ${errorMsg}`);
            }
        }

        try {
            // Clear response collector before processing new command
            this.responseCollector.messages = [];

            // Process the command through the TypeAgent dispatcher
            this.logger.log(
                `Sending command to dispatcher: ${request.request}`,
            );
            const result = await this.dispatcher.processCommand(
                request.request,
            );

            if (result?.lastError) {
                this.logger.error(
                    `Command execution error: ${result.lastError}`,
                );
                return toolResult(
                    `Error executing command: ${result.lastError}`,
                );
            }

            // Return the collected messages from the dispatcher
            this.logger.log(
                `Successfully executed command: ${request.request}`,
            );

            if (this.responseCollector.messages.length > 0) {
                const response = this.responseCollector.messages.join("\n\n");
                // Process any HTML images in the response
                const processedResponse = await processHtmlImages(response);
                return toolResult(processedResponse);
            }

            // Fallback if no messages were collected
            return toolResult(`Successfully executed: ${request.request}`);
        } catch (error) {
            // Check if this is a user confirmation request
            if (
                error instanceof Error &&
                error.message.startsWith("USER_CONFIRMATION_REQUIRED:")
            ) {
                const question = error.message.replace(
                    "USER_CONFIRMATION_REQUIRED: ",
                    "",
                );
                this.logger.log(
                    `Command requires user confirmation: ${question}`,
                );
                return toolResult(
                    `⚠️  Confirmation Required\n\n` +
                        `The action you requested requires confirmation:\n\n` +
                        `"${question}"\n\n` +
                        `Please confirm with the user, then retry the command with confirmed=true if they approve.`,
                );
            }

            const errorMsg = `Failed to execute command: ${error instanceof Error ? error.message : String(error)}`;
            this.logger.error(errorMsg);

            // Mark dispatcher as disconnected so we'll try to reconnect
            this.dispatcher = null;

            return toolResult(errorMsg);
        } finally {
            // Always reset confirmation flag after request completes
            this.currentRequestConfirmed = false;
        }
    }

    /**
     * Discover available schemas based on user query
     * Mock implementation for testing - prints interaction details
     */
    private async discoverSchemas(
        request: DiscoverSchemasRequest,
    ): Promise<CallToolResult> {
        this.logger.log(
            `[DISCOVERY] Query: "${request.query}", includeActions: ${request.includeActions ?? false}`,
        );

        // Simple keyword matching for mock implementation
        const query = request.query.toLowerCase();
        const matches = SCHEMA_REGISTRY.filter(
            (schema) =>
                schema.name.toLowerCase().includes(query) ||
                schema.description.toLowerCase().includes(query),
        );

        if (matches.length === 0) {
            this.logger.log(
                `[DISCOVERY] No schemas found matching query: "${request.query}"`,
            );
            return toolResult(
                `No TypeAgent schemas found matching "${request.query}".\n\n` +
                    `Available schemas: ${SCHEMA_REGISTRY.map((s) => s.name).join(", ")}`,
            );
        }

        this.logger.log(
            `[DISCOVERY] Found ${matches.length} schema(s): ${matches.map((m) => m.name).join(", ")}`,
        );

        // Build response
        let response = `Found ${matches.length} matching schema(s):\n\n`;

        for (const schema of matches) {
            response += `**${schema.name}**\n`;
            response += `${schema.description}\n\n`;

            if (request.includeActions) {
                response += `Actions:\n`;
                for (const action of schema.actions) {
                    response += `- **${action.name}**: ${action.description}\n`;
                    response += `  Parameters: ${JSON.stringify(action.parameters, null, 2)}\n`;
                }
                response += `\nTypeScript Schema:\n\`\`\`typescript\n${schema.schemaSource}\n\`\`\`\n\n`;
            } else {
                response += `Available actions: ${schema.actions.map((a) => a.name).join(", ")}\n`;
                response += `(Use includeActions: true to see detailed schemas)\n\n`;
            }
        }

        response += `\nTo use these capabilities:\n`;
        response += `1. Call typeagent_action directly with agent="${matches[0].name}", action="<actionName>", parameters=<params>\n`;
        response += `2. Or call load_schema({schemaName: "${matches[0].name}"}) to register tools for this session\n`;

        return toolResult(response);
    }

    /**
     * Load a schema dynamically (mock implementation)
     * In production, this would compile TypeScript and register real tools
     */
    private async loadSchema(
        request: LoadSchemaRequest,
    ): Promise<CallToolResult> {
        this.logger.log(
            `[LOAD_SCHEMA] Loading schema: "${request.schemaName}", exposeAs: ${request.exposeAs ?? "composite"}`,
        );

        const schema = SCHEMA_REGISTRY.find(
            (s) => s.name === request.schemaName,
        );

        if (!schema) {
            this.logger.log(
                `[LOAD_SCHEMA] Schema not found: "${request.schemaName}"`,
            );
            return toolResult(
                `Schema "${request.schemaName}" not found.\n\n` +
                    `Available schemas: ${SCHEMA_REGISTRY.map((s) => s.name).join(", ")}`,
            );
        }

        this.logger.log(
            `[LOAD_SCHEMA] Mock loading schema "${request.schemaName}" with ${schema.actions.length} actions`,
        );

        // In production, this would:
        // 1. Compile TypeScript schema to JSON Schema
        // 2. Register MCP tools dynamically
        // 3. Store in loadedSchemas map

        let response = `✓ Schema "${request.schemaName}" loaded successfully!\n\n`;

        if (request.exposeAs === "individual") {
            response += `Registered ${schema.actions.length} individual tools:\n`;
            for (const action of schema.actions) {
                response += `- ${request.schemaName}_${action.name}\n`;
            }
        } else {
            response += `Registered composite tool: ${request.schemaName}_action\n`;
            response += `Available actions: ${schema.actions.map((a) => a.name).join(", ")}\n`;
        }

        response += `\n(Mock implementation - tools not actually registered yet)\n`;

        return toolResult(response);
    }

    /**
     * Execute a TypeAgent action and populate cache with natural language mapping
     */
    private async executeTypeagentAction(
        request: TypeagentActionRequest,
    ): Promise<CallToolResult> {
        this.logger.log(
            `[TYPEAGENT_ACTION] Agent: "${request.agent}", Action: "${request.action}"`,
        );
        this.logger.log(
            `[TYPEAGENT_ACTION] Parameters: ${JSON.stringify(request.parameters, null, 2)}`,
        );
        this.logger.log(
            `[TYPEAGENT_ACTION] Natural language: "${request.naturalLanguage}"`,
        );

        // Verify schema exists
        const schema = SCHEMA_REGISTRY.find((s) => s.name === request.agent);

        if (!schema) {
            this.logger.log(
                `[TYPEAGENT_ACTION] Unknown agent: "${request.agent}"`,
            );
            return toolResult(
                `Unknown agent "${request.agent}".\n\n` +
                    `Available agents: ${SCHEMA_REGISTRY.map((s) => s.name).join(", ")}`,
            );
        }

        // Verify action exists
        const action = schema.actions.find((a) => a.name === request.action);

        if (!action) {
            this.logger.log(
                `[TYPEAGENT_ACTION] Unknown action "${request.action}" for agent "${request.agent}"`,
            );
            return toolResult(
                `Unknown action "${request.action}" for agent "${request.agent}".\n\n` +
                    `Available actions: ${schema.actions.map((a) => a.name).join(", ")}`,
            );
        }

        // Connect to dispatcher if needed
        if (!this.dispatcher && !this.isConnecting) {
            this.logger.log(
                "Not connected to dispatcher, attempting to connect...",
            );
            await this.connectToDispatcher();
        }

        if (!this.dispatcher) {
            const errorMsg = `Cannot execute action: not connected to TypeAgent dispatcher at ${this.agentServerUrl}. Make sure the TypeAgent server is running with: pnpm run start:agent-server`;
            this.logger.error(errorMsg);
            return toolResult(errorMsg);
        }

        // Format the @action command for dispatcher
        // Format: @action agentName actionName --parameters '{"param": "value"}' --naturalLanguage "phrase"
        const paramStr =
            request.parameters && Object.keys(request.parameters).length > 0
                ? `--parameters '${JSON.stringify(request.parameters).replaceAll("'", "\\'")}'`
                : "";

        const nlStr = `--naturalLanguage '${request.naturalLanguage.replaceAll("'", "\\'")}'`;

        const actionCommand =
            `@action ${request.agent} ${request.action} ${paramStr} ${nlStr}`.trim();

        this.logger.log(
            `[TYPEAGENT_ACTION] Executing via dispatcher: ${actionCommand}`,
        );

        // Clear response collector before executing
        this.responseCollector.messages = [];

        try {
            // Execute the action through dispatcher
            // This will:
            // 1. Call the agent's executeAction handler
            // 2. Return the result
            // 3. If naturalLanguage is provided, populate cache with NL → action mapping
            await this.dispatcher.processCommand(actionCommand);

            // Get the collected response
            if (this.responseCollector.messages.length > 0) {
                const response = this.responseCollector.messages.join("\n\n");
                const processedResponse = await processHtmlImages(response);

                return toolResult(processedResponse);
            }

            // Fallback if no messages were collected
            return toolResult(`✓ Action executed successfully`);
        } catch (error) {
            const errorMsg = `Action execution failed: ${error instanceof Error ? error.message : String(error)}`;
            this.logger.error(errorMsg);
            return toolResult(errorMsg);
        }
    }

    private addDiagnosticTools() {
        this.server.registerTool(
            "ping",
            {
                inputSchema: { message: z.string() },
                description: "Ping the server to test connectivity",
            },
            async (request: { message: string }) => {
                const response = request.message
                    ? "PONG: " + request.message
                    : "pong";
                return toolResult(response);
            },
        );
    }
}
