/**
 * TypeAgent MCP Server for Copilot CLI.
 *
 * Exposes TypeAgent dispatcher operations as MCP tools, allowing the
 * Copilot LLM to delegate action requests to TypeAgent.
 *
 * Uses MCP progress notifications to stream display messages to the
 * Copilot CLI timeline in real-time as TypeAgent processes the command.
 *
 * Connection to TypeAgent is lazy — established on first tool call,
 * not during MCP server startup.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Dispatcher, IAgentMessage } from "@typeagent/agent-server-client";
import type { DisplayAppendMode } from "@typeagent/agent-sdk";
import {
    createClientIO,
    connectToTypeAgent,
    TYPEAGENT_URL,
} from "../shared/typeagent-client.js";
import { extractMessageText } from "../shared/message-formatter.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function stripAnsi(text: string): string {
    // eslint-disable-next-line no-control-regex
    return text.replace(/\x1b\[[0-9;]*m/g, "");
}

function toolResult(text: string): CallToolResult {
    return { content: [{ type: "text", text }] };
}

/**
 * Format a large result for display. Strips markdown formatting and wraps
 * in a code fence so the CLI preserves newlines and structured layout.
 */
function formatLargeResult(response: string): CallToolResult {
    const lines = response.split("\n").length;
    if (lines > 5) {
        // Strip markdown bold (**text**) — doesn't render inside code fences
        const plain = response.replace(/\*\*([^*]+)\*\*/g, "$1");
        return toolResult("```\n" + plain + "\n```");
    }
    return toolResult(response);
}

function log(message: string): void {
    process.stderr.write(
        `[${new Date().toISOString()}] [typeagent-mcp] ${message}\n`,
    );
}

// Type for the extra parameter passed to tool callbacks
interface ToolExtra {
    _meta?: {
        progressToken?: string | number;
    };
    sendNotification: (notification: {
        method: string;
        params: Record<string, unknown>;
    }) => Promise<void>;
    signal: AbortSignal;
}

// ── Server ───────────────────────────────────────────────────────────────────

class TypeAgentMcpServer {
    private server: McpServer;

    constructor() {
        this.server = new McpServer({
            name: "typeagent",
            version: "0.1.0",
        });
        this.registerTools();
    }

    async start(): Promise<void> {
        const transport = new StdioServerTransport();
        await this.server.connect(transport);
        log(`TypeAgent MCP server started (target: ${TYPEAGENT_URL})`);
    }

    private registerTools(): void {
        this.server.tool(
            "typeagent-processCommand",
            "Send a natural language command to TypeAgent for processing. " +
                "Use this for action requests like scheduling meetings, sending emails, " +
                "playing music, controlling the browser, managing lists, etc. " +
                "Do NOT use this for general knowledge questions. " +
                "CRITICAL: Preserve special prefixes EXACTLY as written - do NOT strip them: " +
                "'learn:', 'dev:', 'record:', 'dev: learn:'. " +
                "These are TypeAgent directives that trigger special behavior (e.g., flow recording). " +
                "If user says 'learn: create a playlist', pass 'learn: create a playlist' - NOT just 'create a playlist'. " +
                "IMPORTANT: Always display the FULL output to the user exactly as returned. " +
                "Do NOT summarize, truncate, or paraphrase the tool result. " +
                "Present it in a code block if it contains a list or structured data.",
            { command: z.string().describe("The natural language command to execute, including any special prefixes like 'learn:', 'dev:', 'record:'") },
            { displayVerbatim: true } as Record<string, unknown>,
            async (params, extra) =>
                this.processCommand(params.command, extra as ToolExtra),
        );

        this.server.tool(
            "typeagent-listAgents",
            "List available TypeAgent agents and their capabilities.",
            {},
            async () => this.listAgents(),
        );

        this.server.tool(
            "typeagent-getStatus",
            "Get the current TypeAgent dispatcher status.",
            {},
            async () => this.getStatus(),
        );

        // TypeAgent PowerShell tools
        this.server.tool(
            "typeagent-powershell-list",
            "List registered TypeAgent PowerShell flows. " +
                "These are reusable automation scripts managed by TypeAgent's PowerShell agent " +
                "that can be invoked by natural language.",
            {},
            async () => this.processCommand("@powershell list"),
        );


        this.server.tool(
            "typeagent-powershell-import",
            "Import an existing PowerShell (.ps1) script file as a reusable TypeAgent PowerShell flow. " +
                "The script is analyzed by TypeAgent's PowerShell agent and registered for future natural language invocation. " +
                "Only .ps1 files are supported. The path can be absolute or relative to the working directory.",
            {
                filePath: z.string().describe("Absolute or relative path to the .ps1 file to import"),
            },
            async (params, extra) => {
                const command = `@powershell import ${params.filePath}`;
                return this.processCommand(command, extra as ToolExtra);
            },
        );
    }


    /**
     * Send an MCP progress notification if the client provided a progressToken.
     */
    private async sendProgress(
        extra: ToolExtra,
        message: string,
        progress: number,
        total: number,
    ): Promise<void> {
        if (extra._meta?.progressToken === undefined) return;
        try {
            await extra.sendNotification({
                method: "notifications/progress",
                params: {
                    progressToken: extra._meta.progressToken,
                    progress,
                    total,
                    message,
                },
            });
        } catch {
            // Progress notifications are best-effort
        }
    }

    private async processCommand(
        command: string,
        extra?: ToolExtra,
    ): Promise<CallToolResult> {
        log(`processCommand: ${command}`);

        const responseCollector = { messages: [] as string[] };
        let messageCount = 0;
        let dispatcher: Dispatcher | null = null;

        try {
            const clientIO = createClientIO({
                onSetDisplay: (message: IAgentMessage) => {
                    const text = extractMessageText(message);
                    if (text) {
                        const cleaned = stripAnsi(text);
                        responseCollector.messages.push(cleaned);
                    }
                },
                onAppendDisplay: (
                    message: IAgentMessage,
                    mode: DisplayAppendMode,
                ) => {
                    const text = extractMessageText(message);
                    if (!text) return;
                    const cleaned = stripAnsi(text);

                    if (mode === "temporary") {
                        // Temporary messages are status updates — stream as progress only
                        messageCount++;
                        if (extra) { void this.sendProgress(extra, cleaned, messageCount, 0); }
                        return;
                    }

                    responseCollector.messages.push(cleaned);
                },
            });

            dispatcher = await connectToTypeAgent(clientIO);
            const result = await dispatcher.processCommand(command);

            if (result?.lastError) {
                return toolResult(`Error: ${result.lastError}`);
            }

            if (responseCollector.messages.length > 0) {
                const response = responseCollector.messages.join("\n\n");
                return formatLargeResult(response);
            }

            return toolResult(`Successfully executed: ${command}`);
        } catch (error) {
            const msg =
                error instanceof Error ? error.message : String(error);
            log(`processCommand error: ${msg}`);
            return toolResult(`Error executing command: ${msg}`);
        } finally {
            if (dispatcher) {
                await dispatcher.close();
            }
        }
    }

    private async listAgents(): Promise<CallToolResult> {
        let dispatcher: Dispatcher | null = null;
        try {
            const clientIO = createClientIO({});
            dispatcher = await connectToTypeAgent(clientIO);
            const schemas = await dispatcher.getAgentSchemas();
            const agents = schemas.map((s) => ({
                name: s.name,
                emoji: s.emoji,
                description: s.description,
            }));
            return toolResult(JSON.stringify(agents, null, 2));
        } catch (error) {
            return toolResult(
                `Error listing agents: ${error instanceof Error ? error.message : String(error)}`,
            );
        } finally {
            if (dispatcher) {
                await dispatcher.close();
            }
        }
    }

    private async getStatus(): Promise<CallToolResult> {
        let dispatcher: Dispatcher | null = null;
        try {
            const clientIO = createClientIO({});
            dispatcher = await connectToTypeAgent(clientIO);
            const status = await dispatcher.getStatus();
            return toolResult(JSON.stringify(status, null, 2));
        } catch (error) {
            return toolResult(
                `Error getting status: ${error instanceof Error ? error.message : String(error)}`,
            );
        } finally {
            if (dispatcher) {
                await dispatcher.close();
            }
        }
    }
}

// ── Main ─────────────────────────────────────────────────────────────────────

const server = new TypeAgentMcpServer();
server.start().catch((error) => {
    log(`Fatal error: ${error}`);
    process.exit(1);
});
