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

function executeCommandRequestSchema() {
    return {
        request: z.string(),
        cacheCheck: z.boolean().optional(),
        confirmed: z.boolean().optional(),
    };
}
const ExecuteCommandRequestSchema = z.object(executeCommandRequestSchema());

export type ExecuteCommandRequest = z.infer<typeof ExecuteCommandRequestSchema>;

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

    /**
     * Creates a new CommandServer instance
     * @param debugMode Enable debug mode for diagnostic tools
     * @param agentServerUrl URL of the TypeAgent dispatcher server (default: ws://localhost:8999)
     */
    constructor(debugMode: boolean = true, agentServerUrl?: string) {
        this.logger = new Logger();
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
