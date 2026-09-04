// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * TypeAgent agent-server MCP tools for Copilot CLI.
 *
 * Two ways in:
 *   - `typeagent-processCommand` sends the user's own words and lets TypeAgent
 *     translate them. Best for conversational or multi-step requests, and the
 *     only path that honors recording directives ("learn:", "dev:", "record:").
 *   - `typeagent-discoverActions` + `typeagent-executeAction` run one typed
 *     action directly through the dispatcher's `@action` command. No
 *     translation and no TypeAgent reasoning, so the client decides exactly
 *     what runs.
 *
 * Every call connects to the agent server, runs, and disconnects, so a
 * restarted agent server is picked up on the next tool call.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type {
    ClientIO,
    Dispatcher,
    IAgentMessage,
} from "@typeagent/agent-server-client";
import type {
    AgentSchemaInfo,
    CommandResult,
} from "@typeagent/dispatcher-types";
import {
    buildActionCommand,
    filterActiveAgentSchemas,
    findActionSubSchema,
    getAgentActionNames,
    type DirectActionRequest,
} from "@typeagent/dispatcher-types/helpers/actionDispatch";
import type { DisplayAppendMode } from "@typeagent/agent-sdk";
import {
    createClientIO,
    connectToTypeAgent,
    submitCancellableCommand,
    TYPEAGENT_URL,
} from "../shared/typeagent-client.js";
import {
    extractMessageText,
    extractRawData,
} from "../shared/message-formatter.js";
import { getMode, type Mode } from "../shared/plugin-config.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function stripAnsi(text: string): string {
    return text.replace(/\x1b\[[0-9;]*m/g, "");
}

export function toolResult(text: string, rawData?: unknown): CallToolResult {
    const result: CallToolResult = { content: [{ type: "text", text }] };
    if (rawData !== undefined) {
        // MCP structuredContent must be a JSON object; wrap anything else.
        result.structuredContent =
            typeof rawData === "object" &&
            rawData !== null &&
            !Array.isArray(rawData)
                ? (rawData as Record<string, unknown>)
                : ({ data: rawData } as Record<string, unknown>);
    }
    return result;
}

function toolError(text: string): CallToolResult {
    return { isError: true, content: [{ type: "text", text }] };
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

export function log(message: string): void {
    process.stderr.write(
        `[${new Date().toISOString()}] [typeagent-mcp] ${message}\n`,
    );
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

// Type for the extra parameter passed to tool callbacks
export interface ToolExtra {
    _meta?: {
        progressToken?: string | number;
    };
    sendNotification: (notification: {
        method: string;
        params: Record<string, unknown>;
    }) => Promise<void>;
    signal?: AbortSignal;
}

export interface AgentToolDependencies {
    connect: (clientIO: ClientIO) => Promise<Dispatcher>;
    getMode: () => Mode;
    log: (message: string) => void;
}

const defaultDependencies: AgentToolDependencies = {
    connect: connectToTypeAgent,
    getMode,
    log,
};

// ── Adapter ──────────────────────────────────────────────────────────────────

/**
 * Implements the agent-server tools. Split from the MCP registration below so
 * the behavior can be tested without a transport.
 */
export class TypeAgentToolAdapter {
    constructor(
        private readonly dependencies: AgentToolDependencies = defaultDependencies,
    ) {}

    async processCommand(
        command: string,
        extra?: ToolExtra,
    ): Promise<CallToolResult> {
        const disabled = this.getDisabledReason();
        if (disabled) {
            return toolError(disabled);
        }
        this.dependencies.log(`processCommand: ${command}`);

        try {
            const { result, collected } = await this.runCommand(command, extra);
            if (result?.lastError) {
                return toolResult(`Error: ${result.lastError}`);
            }
            if (result?.cancelled) {
                // Before the output check: partial output from a cancelled
                // request must not read as a completed one.
                return toolResult(
                    cancelledText(
                        "TypeAgent request was cancelled.",
                        collected.messages,
                    ),
                );
            }
            if (collected.pendingPrompts.length > 0) {
                return toolResult(pendingPromptText(collected.pendingPrompts));
            }
            if (collected.messages.length > 0) {
                return formatLargeResult(collected.messages.join("\n\n"));
            }
            return toolResult(`Successfully executed: ${command}`);
        } catch (error) {
            const message = errorMessage(error);
            this.dependencies.log(`processCommand error: ${message}`);
            return toolResult(`Error executing command: ${message}`);
        }
    }

    /**
     * Run one typed action directly. The dispatcher validates it against the
     * action schema and executes it; no translation and no reasoning run.
     *
     * `@action` runs the same `executeActions` engine as an ordinary request, so
     * enabled-action gating, chained actions, entity resolution, memory recording
     * and confirmation are unchanged. What it skips is translation - and the
     * request path's reasoning retry for schemas with `errorReasoning`, whose
     * error is returned to the caller instead.
     */
    async executeAction(
        request: DirectActionRequest,
        extra?: ToolExtra,
    ): Promise<CallToolResult> {
        const disabled = this.getDisabledReason();
        if (disabled) {
            return toolError(disabled);
        }

        let command: string;
        try {
            command = buildActionCommand(request);
        } catch (error) {
            return toolError(errorMessage(error));
        }
        this.dependencies.log(`executeAction: ${command}`);

        try {
            const { result, collected } = await this.runCommand(command, extra);
            if (result?.lastError) {
                return toolError(`Action error: ${result.lastError}`);
            }
            if (result?.cancelled) {
                return toolError(
                    cancelledText(
                        `Action ${request.schemaName}.${request.actionName} was cancelled.`,
                        collected.messages,
                    ),
                );
            }
            if (collected.pendingPrompts.length > 0) {
                return toolError(pendingPromptText(collected.pendingPrompts));
            }
            if (collected.messages.length > 0) {
                return toolResult(
                    collected.messages.join("\n\n"),
                    collected.rawData,
                );
            }
            return toolResult(
                `Action ${request.schemaName}.${request.actionName} executed successfully.`,
                collected.rawData,
            );
        } catch (error) {
            const message = errorMessage(error);
            this.dependencies.log(`executeAction error: ${message}`);
            return toolError(`Action execution failed: ${message}`);
        }
    }

    /**
     * Report what the session can currently run: agents, then an agent's
     * sub-schemas and actions, then one action's TypeScript contract.
     */
    async discoverActions(request: {
        agentName?: string | undefined;
        actionName?: string | undefined;
    }): Promise<CallToolResult> {
        const disabled = this.getDisabledReason();
        if (disabled) {
            return toolError(disabled);
        }

        try {
            const agents = await this.getActiveAgentSchemas(request.agentName);
            if (request.agentName === undefined) {
                return toolResult(formatAgentList(agents));
            }

            const agent = agents[0];
            if (agent === undefined) {
                return toolError(
                    `Agent '${request.agentName}' is not available or has no enabled actions.`,
                );
            }
            return request.actionName === undefined
                ? toolResult(formatAgentActions(agent))
                : formatActionContract(agent, request.actionName);
        } catch (error) {
            return toolError(
                `Error discovering actions: ${errorMessage(error)}`,
            );
        }
    }

    async listAgents(): Promise<CallToolResult> {
        const disabled = this.getDisabledReason();
        if (disabled) {
            return toolError(disabled);
        }
        try {
            // Unfiltered on purpose: this is the pre-existing "what is
            // installed" view. typeagent-discoverActions is the filtered
            // "what can I run right now" view.
            const schemas = await this.withDispatcher(
                createClientIO({}),
                (dispatcher) => dispatcher.getAgentSchemas(),
            );
            return toolResult(
                JSON.stringify(
                    schemas.map((schema) => ({
                        name: schema.name,
                        emoji: schema.emoji,
                        description: schema.description,
                    })),
                    null,
                    2,
                ),
            );
        } catch (error) {
            return toolResult(`Error listing agents: ${errorMessage(error)}`);
        }
    }

    async getStatus(): Promise<CallToolResult> {
        const disabled = this.getDisabledReason();
        if (disabled) {
            return toolError(disabled);
        }
        try {
            const status = await this.withDispatcher(
                createClientIO({}),
                (dispatcher) => dispatcher.getStatus(),
            );
            return toolResult(JSON.stringify(status, null, 2));
        } catch (error) {
            return toolResult(`Error getting status: ${errorMessage(error)}`);
        }
    }

    /**
     * Agents with the sub-schemas this session has enabled. `getAgentSchemas`
     * reports every installed schema, so the status is what makes the result
     * match what `@action` will actually accept.
     */
    private async getActiveAgentSchemas(
        agentName?: string,
    ): Promise<AgentSchemaInfo[]> {
        return this.withDispatcher(
            createClientIO({}),
            async (dispatcher): Promise<AgentSchemaInfo[]> => {
                const [schemas, status] = await Promise.all([
                    dispatcher.getAgentSchemas(agentName),
                    dispatcher.getStatus(),
                ]);
                return filterActiveAgentSchemas(schemas, status);
            },
        );
    }

    private async withDispatcher<T>(
        clientIO: ClientIO,
        operation: (dispatcher: Dispatcher) => Promise<T>,
    ): Promise<T> {
        const dispatcher = await this.dependencies.connect(clientIO);
        try {
            return await operation(dispatcher);
        } finally {
            await dispatcher.close();
        }
    }

    /**
     * Submit a command, stream its progress messages, and collect its display
     * output. Cancels the request when the MCP client aborts the tool call.
     */
    private async runCommand(
        command: string,
        extra?: ToolExtra,
    ): Promise<{ result: CommandResult | undefined; collected: Collected }> {
        const collected = new Collected();
        let messageCount = 0;
        const sendProgress = (text: string) => {
            if (!extra) return;
            messageCount++;
            void sendProgressNotification(extra, text, messageCount);
        };

        const clientIO = createClientIO({
            onPendingPrompt: (prompt: string) => {
                collected.pendingPrompts.push(prompt);
                sendProgress(prompt);
            },
            onSetDisplay: (message: IAgentMessage) => {
                collected.add(message);
            },
            onAppendDisplay: (
                message: IAgentMessage,
                mode: DisplayAppendMode,
            ) => {
                const text = extractMessageText(message);
                if (!text) return;

                if (mode === "temporary") {
                    // Status updates that a live UI would replace — stream
                    // them instead of returning them as content.
                    sendProgress(stripAnsi(text));
                    return;
                }

                // Status/info/warning/error messages (reasoning "thinking",
                // tool calls, and their results) are progress, not final
                // content, so they stream too and keep every tool call paired
                // with its result.
                if (isProgressKind(message)) {
                    sendProgress(stripAnsi(text));
                    return;
                }

                collected.add(message);
            },
        });

        const result = await this.withDispatcher(clientIO, (dispatcher) =>
            submitCancellableCommand(
                dispatcher,
                command,
                extra?.signal,
                (error) =>
                    this.dependencies.log(
                        `cancel error: ${errorMessage(error)}`,
                    ),
            ),
        );
        return { result, collected };
    }

    private getDisabledReason(): string | undefined {
        const mode = this.dependencies.getMode();
        if (mode === "dev" || mode === "bypass") {
            return `TypeAgent agent-server MCP tools are disabled in ${mode} mode.`;
        }
        return undefined;
    }
}

/** Collected display text plus the last structured payload an agent returned. */
class Collected {
    public readonly messages: string[] = [];
    public readonly pendingPrompts: string[] = [];
    public rawData?: unknown;

    add(message: IAgentMessage): void {
        const text = extractMessageText(message);
        if (text) {
            this.messages.push(stripAnsi(text));
        }
        const rawData = extractRawData(message);
        if (rawData !== undefined) {
            this.rawData = rawData;
        }
    }
}

/**
 * TypeAgent asked the user something this client cannot answer, so the work
 * is parked rather than done. Say so instead of reporting success.
 */
function pendingPromptText(prompts: string[]): string {
    return (
        "TypeAgent is waiting for a decision this tool cannot make, so the request did not complete: " +
        prompts.join("; ") +
        ". Ask the user to answer it in the TypeAgent shell, or re-run with parameters that avoid the prompt."
    );
}

/**
 * Keep whatever the request produced before it stopped, but label it, so the
 * caller does not read partial output as a finished request.
 */
function cancelledText(summary: string, messages: string[]): string {
    return messages.length > 0
        ? `${summary} Partial output before cancellation:\n\n${messages.join("\n\n")}`
        : summary;
}

function isProgressKind(message: IAgentMessage): boolean {
    const msg = message?.message;
    if (typeof msg !== "object" || !msg || !("kind" in msg)) {
        return false;
    }
    const kind = (msg as { kind: unknown }).kind;
    return (
        kind === "info" ||
        kind === "status" ||
        kind === "warning" ||
        kind === "error"
    );
}

/**
 * Send an MCP progress notification if the client provided a progressToken.
 */
async function sendProgressNotification(
    extra: ToolExtra,
    message: string,
    progress: number,
): Promise<void> {
    if (extra._meta?.progressToken === undefined) return;
    try {
        await extra.sendNotification({
            method: "notifications/progress",
            params: {
                progressToken: extra._meta.progressToken,
                progress,
                total: 0,
                message,
            },
        });
    } catch {
        // Progress notifications are best-effort
    }
}

/**
 * Submit a command and await its completion, cancelling the accepted request
 * when `signal` aborts so an interrupted tool call does not leave the
 * dispatcher running work nobody is waiting for.
 */

// ── Discovery formatting ─────────────────────────────────────────────────────

function formatAgentList(agents: AgentSchemaInfo[]): string {
    if (agents.length === 0) {
        return "No TypeAgent agents are enabled. Make sure the TypeAgent agent server is running.";
    }
    const lines = agents.map(
        (agent) => `${agent.emoji} ${agent.name} — ${agent.description}`,
    );
    return (
        `Enabled TypeAgent agents (${agents.length}):\n\n` +
        lines.join("\n") +
        "\n\nCall typeagent-discoverActions with agentName to see that agent's actions."
    );
}

function formatAgentActions(agent: AgentSchemaInfo): string {
    const sections = agent.subSchemas.map((subSchema) => {
        const actions = subSchema.actions
            .map((action) => `    - ${action.name} — ${action.description}`)
            .join("\n");
        return `  ${subSchema.schemaName} — ${subSchema.description}\n${actions}`;
    });
    const actionCount = getAgentActionNames(agent).length;

    return (
        `${agent.emoji} ${agent.name} — ${agent.description}\n\n` +
        sections.join("\n\n") +
        `\n\n(${actionCount} actions across ${agent.subSchemas.length} schema(s))\n` +
        "Use the schemaName shown above as executeAction's schemaName. " +
        "Add actionName to this tool to see an action's TypeScript parameters."
    );
}

function formatActionContract(
    agent: AgentSchemaInfo,
    actionName: string,
): CallToolResult {
    const found = findActionSubSchema(agent, actionName);
    if (found === undefined) {
        return toolError(
            `Action '${actionName}' is not available in agent '${agent.name}'.\n\n` +
                `Enabled actions: ${getAgentActionNames(agent).join(", ")}`,
        );
    }
    const { subSchema, action } = found;
    if (subSchema.schemaText === undefined) {
        return toolError(
            `No TypeScript schema is available for action '${action.name}'.`,
        );
    }
    return toolResult(
        `${action.name} — ${action.description}\n` +
            `Run it with typeagent-executeAction({ schemaName: "${subSchema.schemaName}", actionName: "${action.name}", parameters: { ... } }).\n\n` +
            "```typescript\n" +
            subSchema.schemaText +
            "\n```",
    );
}

// ── Server ───────────────────────────────────────────────────────────────────

export class TypeAgentMcpServer {
    private readonly server: McpServer;

    constructor(private readonly adapter = new TypeAgentToolAdapter()) {
        this.server = new McpServer({
            name: "typeagent",
            version: "0.1.0",
        });
        this.registerTools();
    }

    async start(): Promise<void> {
        const transport = new StdioServerTransport();
        await this.server.connect(transport);
        log(
            `TypeAgent MCP server started (target: ${TYPEAGENT_URL}, mode: ${getMode()})`,
        );
    }

    private registerTools(): void {
        this.server.registerTool(
            "typeagent-processCommand",
            {
                title: "TypeAgent Command Processor",
                description:
                    "Send a natural language command to TypeAgent for processing. " +
                    "Use this for conversational or multi-step action requests, and whenever you do not know which typed action to run. " +
                    "For a single action whose schemaName, actionName and parameters you already know, prefer typeagent-executeAction — it skips translation. " +
                    "Do NOT use this for general knowledge questions. " +
                    "CRITICAL: Preserve special prefixes EXACTLY as written - do NOT strip them: " +
                    "'learn:', 'dev:', 'record:', 'dev: learn:'. " +
                    "These are TypeAgent directives that trigger special behavior (e.g., flow recording) and must always go through this tool, never typeagent-executeAction. " +
                    "If user says 'learn: create a playlist', pass 'learn: create a playlist' - NOT just 'create a playlist'. " +
                    "IMPORTANT: Always display the FULL output to the user exactly as returned. " +
                    "Do NOT summarize, truncate, or paraphrase the tool result. " +
                    "Present it in a code block if it contains a list or structured data.",
                inputSchema: z.object({
                    command: z
                        .string()
                        .describe(
                            "The natural language command to execute, including any special prefixes like 'learn:', 'dev:', 'record:'",
                        ),
                }),
                annotations: {
                    displayVerbatim: true,
                } as Record<string, unknown>,
                _meta: {
                    "com.github/displayVerbatim": true,
                },
            },
            async (params, extra) =>
                this.adapter.processCommand(
                    params.command,
                    extra as unknown as ToolExtra,
                ),
        );

        this.server.registerTool(
            "typeagent-discoverActions",
            {
                title: "TypeAgent Action Discovery",
                description:
                    "Discover the TypeAgent actions this session can run right now, so you can call typeagent-executeAction with an exact typed action.\n" +
                    "- No arguments: lists the enabled agents.\n" +
                    "- agentName: lists that agent's schemas and their actions with descriptions. The schemaName shown is what typeagent-executeAction needs.\n" +
                    "- agentName + actionName: returns the TypeScript definition of that action's parameters.\n" +
                    "Only agents and schemas whose actions are enabled are reported, so anything listed here is runnable. " +
                    "Skip this tool when you already know the schemaName, actionName and parameters of the action you need. " +
                    "Do not call it just to satisfy a request the user phrased — sending their words to typeagent-processCommand is cheaper than a discovery round-trip, because TypeAgent caches translations. " +
                    "It pays off when you will reuse the contract across several calls.",
                inputSchema: z.object({
                    agentName: z
                        .string()
                        .optional()
                        .describe(
                            "Top-level agent name, e.g. 'player'. Omit to list all enabled agents.",
                        ),
                    actionName: z
                        .string()
                        .optional()
                        .describe(
                            "Action name to inspect. Requires agentName. Returns the action's TypeScript parameter schema.",
                        ),
                }),
                annotations: { readOnlyHint: true },
            },
            async (params) => this.adapter.discoverActions(params),
        );

        this.server.registerTool(
            "typeagent-executeAction",
            {
                title: "TypeAgent Action Executor",
                description:
                    "Run one TypeAgent action you already know, by schema, action name and parameters. " +
                    "The dispatcher validates it against its schema and executes it, skipping natural language translation and TypeAgent reasoning.\n" +
                    "Prefer typeagent-processCommand when the user phrased the request and you do not already know the action: TypeAgent caches translations, so a familiar phrase costs no model call, which beats discovering the contract first. " +
                    "This tool is the better choice when you already hold the contract, or when you composed the action yourself as a step of a larger task and there is no user phrasing to translate.\n" +
                    "Use typeagent-processCommand for conversational requests, multi-step requests, or any prompt carrying a 'learn:', 'dev:' or 'record:' prefix.",
                inputSchema: z.object({
                    schemaName: z
                        .string()
                        .describe(
                            "Exact schemaName from typeagent-discoverActions, e.g. 'player' or 'desktop.desktop-taskbar'.",
                        ),
                    actionName: z
                        .string()
                        .describe("Action name, e.g. 'createPlaylist'."),
                    parameters: z
                        .record(z.unknown())
                        .optional()
                        .describe(
                            "Action parameters matching the action's TypeScript schema.",
                        ),
                    naturalLanguage: z
                        .string()
                        .optional()
                        .describe(
                            "The user's request, VERBATIM, when this action is exactly what they asked for. " +
                                "TypeAgent stores it as a translation for this action, so a later request phrased the same way runs this action without an LLM call. " +
                                "Omit it if you paraphrased, inferred the action, or are running it as one step of a larger task — a wrong pairing here mis-translates future requests.",
                        ),
                }),
            },
            async (params, extra) =>
                this.adapter.executeAction(
                    {
                        schemaName: params.schemaName,
                        actionName: params.actionName,
                        parameters: params.parameters,
                        naturalLanguage: params.naturalLanguage,
                    },
                    extra as unknown as ToolExtra,
                ),
        );

        this.server.registerTool(
            "typeagent-listAgents",
            {
                title: "TypeAgent Agent List",
                description:
                    "List available TypeAgent agents and their capabilities.",
                inputSchema: z.object({}),
                annotations: { readOnlyHint: true },
            },
            async () => this.adapter.listAgents(),
        );

        this.server.registerTool(
            "typeagent-getStatus",
            {
                title: "TypeAgent Status",
                description: "Get the current TypeAgent dispatcher status.",
                inputSchema: z.object({}),
                annotations: { readOnlyHint: true },
            },
            async () => this.adapter.getStatus(),
        );

        // TypeAgent PowerShell tools
        this.server.tool(
            "typeagent-powershell-list",
            "List registered TypeAgent PowerShell flows. " +
                "These are reusable automation scripts managed by TypeAgent's PowerShell agent " +
                "that can be invoked by natural language.",
            {},
            async () => this.adapter.processCommand("@powershell list"),
        );

        this.server.tool(
            "typeagent-powershell-import",
            "Import an existing PowerShell (.ps1) script file as a reusable TypeAgent PowerShell flow. " +
                "The script is analyzed by TypeAgent's PowerShell agent and registered for future natural language invocation. " +
                "Only .ps1 files are supported. The path can be absolute or relative to the working directory.",
            {
                filePath: z
                    .string()
                    .describe(
                        "Absolute or relative path to the .ps1 file to import",
                    ),
            },
            async (params, extra) =>
                this.adapter.processCommand(
                    `@powershell import ${params.filePath}`,
                    extra as unknown as ToolExtra,
                ),
        );
    }
}
