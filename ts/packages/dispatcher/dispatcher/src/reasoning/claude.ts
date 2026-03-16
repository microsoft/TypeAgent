// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ActionContext,
    AppAction,
    TypeAgentAction,
} from "@typeagent/agent-sdk";
import { CommandHandlerContext } from "../context/commandHandlerContext.js";
import { ReasoningAction } from "../context/dispatcher/schema/reasoningActionSchema.js";
import {
    createSdkMcpServer,
    Options,
    query,
    SdkMcpToolDefinition,
} from "@anthropic-ai/claude-agent-sdk";
import registerDebug from "debug";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod/v4";
import { getActionSchemaTypeName } from "../translation/agentTranslators.js";
import {
    composeActionSchema,
    createActionSchemaJsonValidator,
} from "../translation/actionSchemaJsonTranslator.js";
import { TypeAgentJsonValidator } from "typechat-utils";
import { executeAction } from "../execute/actionHandlers.js";
import { nullClientIO } from "../context/interactiveIO.js";
import { ClientIO, IAgentMessage } from "@typeagent/dispatcher-types";
import { createActionResultNoDisplay } from "@typeagent/agent-sdk/helpers/action";
import { ReasoningTraceCollector } from "./tracing/traceCollector.js";
import { ReasoningRecipeGenerator } from "./recipeGenerator.js";
import { ScriptRecipeGenerator } from "./scriptRecipeGenerator.js";
const debug = registerDebug("typeagent:dispatcher:reasoning:messages");

const model = "claude-sonnet-4-5-20250929";

const mcpServerName = "action-executor";
const allowedTools = [
    "Read",
    "Write",
    "Edit",
    "Bash",
    "Glob",
    "Grep",
    "WebSearch",
    "WebFetch",
    "Task",
    "NotebookEdit",
    "TodoWrite",
    // Allow all tools from the command-executor MCP server
    `mcp__${mcpServerName}__*`,
];

/**
 * Compute the TypeAgent repo root from this module's location.
 * Compiled path: packages/dispatcher/dispatcher/dist/reasoning/claude.js
 * We go up 5 levels to reach ts/ (the monorepo TypeScript root).
 */
function getRepoRoot(): string {
    const thisFile = fileURLToPath(import.meta.url);
    return path.resolve(path.dirname(thisFile), "../../../../..");
}

// Track reasoning session per dispatcher instance (WeakMap so GC cleans up)
const reasoningSessionIds = new WeakMap<object, string>();

function getSessionId(
    context: ActionContext<CommandHandlerContext>,
): string | undefined {
    return reasoningSessionIds.get(context.sessionContext.agentContext);
}

function setSessionId(
    context: ActionContext<CommandHandlerContext>,
    sessionId: string,
): void {
    reasoningSessionIds.set(context.sessionContext.agentContext, sessionId);
}

/**
 * Get recent chat history as formatted text for reasoning context.
 * Returns the last k user/assistant turn pairs from the shell conversation.
 */
function getRecentChatContext(
    context: ActionContext<CommandHandlerContext>,
    k: number = 4,
): string {
    const chatHistory = context.sessionContext.agentContext.chatHistory;
    const exported = chatHistory.export();
    if (!exported) return "";

    const entries = Array.isArray(exported) ? exported : [exported];
    const recent = entries.slice(-k);
    if (recent.length === 0) return "";

    const lines = ["[Recent conversation context]"];
    for (const entry of recent) {
        lines.push(`User: ${entry.user}`);
        const assistants = Array.isArray(entry.assistant)
            ? entry.assistant
            : [entry.assistant];
        for (const a of assistants) {
            lines.push(`Assistant (${a.source}): ${a.text}`);
        }
    }
    return lines.join("\n");
}

/**
 * Build the full prompt with chat history context prepended.
 */
function buildPromptWithContext(
    originalRequest: string,
    context: ActionContext<CommandHandlerContext>,
): string {
    const chatContext = getRecentChatContext(context);
    if (chatContext) {
        return `${chatContext}\n\n[Current request]\n${originalRequest}`;
    }
    return originalRequest;
}

/**
 * Render tool input parameters as a compact inline string.
 * Omits undefined/null values; truncates long strings.
 */
function formatParams(params: Record<string, any> | undefined): string {
    if (!params || Object.keys(params).length === 0) return "";
    const MAX_VALUE_LEN = 60;
    const pairs = Object.entries(params)
        .filter(([, v]) => v !== undefined && v !== null)
        .map(([k, v]) => {
            let s: string;
            if (typeof v === "string") {
                s =
                    v.length > MAX_VALUE_LEN
                        ? `"${v.slice(0, MAX_VALUE_LEN)}…"`
                        : `"${v}"`;
            } else if (typeof v === "object") {
                const j = JSON.stringify(v);
                s =
                    j.length > MAX_VALUE_LEN
                        ? `${j.slice(0, MAX_VALUE_LEN)}…`
                        : j;
            } else {
                s = String(v);
            }
            return `${k}: ${s}`;
        });
    return pairs.length > 0 ? ` \`{ ${pairs.join(", ")} }\`` : "";
}

/**
 * Format a tool call as a persistent display line.
 */
function formatToolCallDisplay(toolName: string, input: any): string {
    const mcpPrefix = `mcp__${mcpServerName}__`;
    if (toolName === `${mcpPrefix}discover_actions`) {
        return `**Tool:** discover_actions — schema: \`${input.schemaName}\``;
    } else if (toolName === `${mcpPrefix}execute_action`) {
        const actionName = input.action?.actionName ?? "unknown";
        const params = formatParams(input.action?.parameters);
        return `**Tool:** execute_action — \`${input.schemaName}.${actionName}\`${params}`;
    } else if (toolName.startsWith(mcpPrefix)) {
        const params = formatParams(input);
        return `**Tool:** ${toolName.slice(mcpPrefix.length)}${params}`;
    }
    // Built-in Claude Code tools — show key input field(s)
    const params = formatParams(input);
    return `**Tool:** ${toolName}${params}`;
}

/**
 * Format a tool result for display. Truncates long results and strips noise.
 */
function formatToolResultDisplay(content: string, isError: boolean): string {
    const MAX_LEN = 120;
    let preview = content.trim().replace(/\n+/g, " ");
    if (preview.length > MAX_LEN) {
        preview = preview.slice(0, MAX_LEN) + "…";
    }
    const label = isError ? "**Error:**" : "**↳**";
    return `${label} \`${preview || "(empty)"}\``;
}

/**
 * Render thinking content as a collapsible HTML details/summary block.
 */
function formatThinkingDisplay(thinkingText: string): string {
    // Escape HTML entities in thinking text for safe embedding
    const escaped = thinkingText
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
    return [
        `<details class="reasoning-thinking">`,
        `<summary>Thinking</summary>`,
        `<pre>${escaped}</pre>`,
        `</details>`,
    ].join("");
}

function getClaudeOptions(
    context: ActionContext<CommandHandlerContext>,
): Options {
    const systemContext = context.sessionContext.agentContext;
    const config = systemContext.session.getConfig();
    const activeSchemas = systemContext.agents.getActiveSchemas();
    const schemaDescriptions: string[] = [];
    const validators = new Map<string, TypeAgentJsonValidator<AppAction>>();
    for (const schemaName of activeSchemas) {
        const actionConfig = systemContext.agents.getActionConfig(schemaName);
        if (getActionSchemaTypeName(actionConfig.schemaType) === undefined) {
            continue;
        }
        schemaDescriptions.push(`- ${schemaName}: ${actionConfig.description}`);
        validators.set(
            schemaName,
            createActionSchemaJsonValidator(
                composeActionSchema([actionConfig], [], systemContext.agents, {
                    activity: false,
                }),
            ),
        );
    }

    const discoverSchema = {
        schemaName: z.union(activeSchemas.map((s) => z.literal(s))),
    };
    const discoverTool: SdkMcpToolDefinition<typeof discoverSchema> = {
        name: "discover_actions",
        description: [
            "Discover actions available with a schema name.",
            "Returns a list of action names with parameters as TypeScript schemas in the named schema that can be used with 'execute_action' tool.",
            "Schema descriptions:",
            ...schemaDescriptions,
        ].join("\n"),
        inputSchema: discoverSchema,
        handler: async (args) => {
            const validator = validators.get(args.schemaName);
            if (!validator) {
                throw new Error(`Invalid schema name '${args.schemaName}'`);
            }
            return {
                content: [
                    {
                        type: "text",
                        text: validator.getSchemaText(),
                    },
                ],
            };
        },
    };

    let actionIndex = 1;
    const executeSchema = {
        schemaName: z.union(activeSchemas.map((s) => z.literal(s))),
        action: z.object({ actionName: z.string(), parameters: z.any() }),
    };
    const executeTool: SdkMcpToolDefinition<typeof executeSchema> = {
        name: "execute_action",
        description: [
            "Execute an actions based on action schemas discovered using the 'discover_actions' tool.",
            "The action parameter must conform to the schema of the specified schema name returned by 'discover_actions' tool.",
        ].join("\n"),
        inputSchema: executeSchema,
        handler: async (args) => {
            const validator = validators.get(args.schemaName);
            if (!validator) {
                throw new Error(`Invalid schema name '${args.schemaName}'`);
            }
            const actionJson = args.action;
            const validationResult = validator.validate(actionJson);
            if (!validationResult.success) {
                // For unknown action names, include the schema text so the model
                // can self-correct without an extra discover_actions round trip.
                if (
                    validationResult.message.startsWith("Unknown action name:")
                ) {
                    return {
                        content: [
                            {
                                type: "text",
                                text: `${validationResult.message}\nAvailable actions for schema '${args.schemaName}':\n${validator.getSchemaText()}`,
                            },
                        ],
                        isError: true,
                    };
                }
                throw validationResult.message;
            }

            const result: IAgentMessage[] = [];
            const capturingClientIO: ClientIO = {
                ...nullClientIO,
                setDisplay: (message) => {
                    result.push(message);
                },
                appendDisplay: (message, mode) => {
                    if (mode !== "temporary") {
                        result.push(message);
                    }
                },
            };
            const savedClientIO = systemContext.clientIO;
            try {
                systemContext.clientIO = capturingClientIO;
                await executeAction(
                    {
                        action: {
                            schemaName: args.schemaName,
                            ...actionJson,
                        },
                    },
                    context,
                    actionIndex++,
                );
            } finally {
                systemContext.clientIO = savedClientIO;
            }
            return {
                content: [{ type: "text", text: JSON.stringify(result) }],
            };
        },
    };

    const sessionId = getSessionId(context);
    const claudeOptions: Options = {
        model,
        permissionMode: "acceptEdits",
        // Auto-allow all tool calls — we've already curated allowedTools
        canUseTool: async () => ({ behavior: "allow" as const }),
        allowedTools,
        cwd: getRepoRoot(),
        settingSources: [],
        maxTurns: 20,
        maxThinkingTokens: 10000,
        systemPrompt: {
            type: "preset",
            preset: "claude_code",
            append: [
                "# TypeAgent Integration",
                "",
                "You are the reasoning engine for TypeAgent, a multi-agent system.",
                "You have access to TypeAgent action execution via MCP tools:",
                "- `discover_actions`: Find available actions by schema name",
                "- `execute_action`: Execute actions conforming to discovered schemas",
                "",
                "You also have full code tools (Read, Glob, Grep, Edit, Bash) for investigating and modifying the codebase.",
                "",
                "When the user asks about agent capabilities, use discover_actions first.",
                "When the user asks to perform an action, discover the schema then execute_action.",
                "",
                "# TaskFlow Recording",
                "",
                "TRIGGERS:",
                "- 'learn: [task]' or 'remember how to [task]' or 'record [task]' → STANDARD recording",
                "- 'dev: learn: [task]' or 'dev: record [task]' → DEV MODE recording (see below)",
                "",
                "STANDARD RECORDING STEPS (run in TypeAgent shell — do NOT write TypeScript here):",
                "1. Call discover_actions for each agent schema needed.",
                "2. SOURCE RESEARCH — required before recording any web fetch step:",
                "   Goal: find a stable, server-side-rendered page whose URL can be templated with",
                "   the flow's parameters so the compiled flow works for ALL valid inputs.",
                "",
                "   PROCESS:",
                "   a. Use your WebSearch tool to look for authoritative sites that list the data.",
                "      For each candidate site, inspect its URLs: does the flow parameter (category,",
                "      genre, keyword, product type, etc.) appear in the URL path or query string?",
                "   b. Fetch 2-3 URLs on that site substituting different parameter values to confirm",
                "      the pattern is consistent and the data is server-rendered (not JS-only).",
                "      Example of what you're looking for: site.com/data/{param}/list",
                "      where {param} varies per user input.",
                "   c. Once confirmed, record the URL as a template: site.com/data/${paramName}/list",
                "      Space-to-hyphen normalization is automatic in utility.webFetch.",
                "   d. Only fall back to utility.webSearch if after trying 3+ candidate sites you",
                "      cannot find any with a parameterizable URL pattern.",
                "   e. NEVER record a fixed URL for one specific input value — the recipe must work",
                "      for all valid values of every flow parameter.",
                "",
                "3. STEP COST — prefer the cheapest path that works:",
                "   • utility.webFetch(parameterized-url) + utility.llmTransform  ~5s  → PREFERRED",
                "   • utility.webSearch + utility.llmTransform                     ~8s  → only if (2d)",
                "   • utility.claudeTask                                           ~35s → LAST RESORT",
                "4. Devise the full step sequence — identify which steps need LLM interpretation.",
                "   Available utility actions:",
                "     webSearch(query, numResults?), webFetch(url),",
                "     readFile(path), writeFile(path, content),",
                "     llmTransform(input, prompt, parseJson?, model?),",
                "     claudeTask(goal, parseJson?, model?, maxTurns?)  ← EXPENSIVE, sparingly",
                "5. Add a testValue to each parameter for use during compilation.",
                "6. Note the expected output format of each step in observedOutputFormat if known.",
                "7. Write recipe files — CHECK BEFORE WRITING:",
                "   Use Read to check if the file already exists.",
                "   If pending/ACTION_NAME.recipe.json already exists → append _v2, _v3, etc.",
                "   and tell the user which name you used.",
                "   a. packages/agents/taskflow/pending/ACTION_NAME.recipe.json",
                "      — fast path: webFetch+llmTransform (or webSearch+llmTransform if no stable URL)",
                "   b. packages/agents/taskflow/pending/ACTION_NAME_claude.recipe.json",
                "      — comparison path using claudeTask for the research/data step",
                "      — actionName must be ACTION_NAME + 'Claude' (e.g. createPlaylistClaude)",
                "      — description: 'Comparison flow using claudeTask — compare latency/quality'",
                "      — IMPORTANT: claudeTask only has WebSearch/WebFetch tools — it CANNOT call",
                "        TypeAgent actions (no createPlaylist, no player, no agents). So the recipe",
                "        must still have a separate callAction step for any TypeAgent action needed.",
                "        Structure: [claudeTask step to research/fetch data, parseJson:true]",
                "                 + [callAction step to act on the result (e.g. player.createPlaylist)]",
                "      — always write this companion recipe so the two approaches can be A/B tested",
                "8. If you noticed gaps (missing actions, output format issues), also write:",
                "   packages/agents/taskflow/pending/suggestions/ACTION_NAME.suggestions.md",
                "9. Tell user: 'Recipe saved. To compile, run from packages/agents/taskflow:'",
                "   pnpm run compile",
                "",
                "DEV MODE RECORDING — interactive improvement loop:",
                "When triggered with 'dev: learn: [task]':",
                "- Follow standard recording steps 1-5",
                "- BEFORE writing the recipe, surface improvement opportunities:",
                "  * 'action X returns plain text — JSON output would let the compiled flow work with",
                "    typed data. Want me to add outputFormat support to that action? (~5 min)'",
                "  * 'there is no action for Y — want me to create one now?'",
                "  * 'steps A and B could be a single action — want me to add a combined action?'",
                "- If developer says yes: use Read/Write/Edit/Bash tools to implement the change,",
                "  build it (cd to the agent package and run pnpm run tsc), then continue recording",
                "  with the improved action",
                "- After all improvements are done, write the recipe using the improved actions",
                "- Use your built-in tools (WebSearch, WebFetch, Read) for YOUR reasoning only —",
                "  the recipe records TypeAgent action calls, not your reasoning tool calls",
                "- Apply the same step-cost hierarchy (step 3 above): prefer webFetch+llmTransform",
                "  over claudeTask; only use claudeTask when no stable URL pattern is findable",
                "",
                "RECIPE FORMAT (write as JSON):",
                "{",
                '  "version": 1,',
                '  "actionName": "camelCaseActionName",',
                '  "description": "what this flow does",',
                '  "parameters": [',
                '    { "name": "param", "type": "string|number|boolean", "required": true|false,',
                '      "default": defaultValue, "description": "..." }',
                "  ],",
                '  "steps": [',
                '    { "id": "stepId",',
                '      "schemaName": "exactSchemaFromDiscover",',
                '      "actionName": "exactActionFromDiscover",',
                '      "parameters": {',
                '        "key": "${paramName}",',
                '        "nested": { "inner": "${paramName}" },',
                '        "fromPriorStep": "${stepId.text}"',
                "      }",
                "    }",
                "  ],",
                '  "grammarPatterns": [',
                '    "3-5 natural invocation patterns with $(param:wildcard) or $(param:number) captures"',
                "  ]",
                "}",
                "",
                "STEP PARAMETER REFERENCES:",
                '- "${paramName}"     → flow parameter value',
                '- "${stepId.text}"   → prior step plain text output',
                '- "${stepId.data}"   → prior step output parsed as JSON',
                '- "prefix ${p} sfx" → interpolated string',
                "- Static values (strings, numbers, booleans, objects, arrays) passed through as-is",
                "- Nested objects and arrays resolve ${...} recursively",
                "",
                "LLM STEPS: use utility.llmTransform (not a 'query' step type):",
                '  { "id": "summary", "schemaName": "utility", "actionName": "llmTransform",',
                '    "parameters": { "input": "${priorStep.text}", "prompt": "Summarize...",',
                '    "model": "claude-haiku-4-5-20251001" } }',
                "",
                "GRAMMAR PATTERN RULES:",
                "- ONLY TWO capture types exist: $(name:wildcard) for strings, $(name:number) for numbers",
                "  NEVER write $(name:string) or $(name:integer) — those are invalid and will fail to compile",
                "- Optional words: (word)?   Alternatives: word1 | word2",
                "- Bare variable names in action body: { genre } not { genre: $genre }",
                "",
                "PARAMETER RULES:",
                "- Required: domain-specific, no reasonable default (e.g. genre, recipient)",
                "- Optional with default: sensible default exists (e.g. quantity=10, timePeriod='this month')",
                "- Use exact schemaName from discover_actions; utility agent is schemaName 'utility'",
                "- For query steps: default 'claude-haiku-4-5-20251001'; 'claude-sonnet-4-6' only for",
                "  genuinely complex multi-step reasoning",
                "- mkdir -p packages/agents/taskflow/pending packages/agents/taskflow/pending/suggestions",
                ...(config.execution.scriptReuse === "enabled" &&
                process.platform === "win32"
                    ? [
                          "",
                          "# PowerShell Script Generation Guidelines (Windows)",
                          "",
                          "You are running on Windows. When the task involves file system operations, process",
                          "management, text search, system queries, or similar operations that PowerShell handles",
                          "natively:",
                          "",
                          "1. **Prefer PowerShell scripts** over other approaches when the task is a good fit for shell scripting.",
                          "2. **Parameterize scripts for reuse.** Instead of hardcoding paths, filenames, or search terms, use PowerShell parameters:",
                          "   ```powershell",
                          "   param([string]$Path = '.', [string]$Filter = '*')",
                          "   Get-ChildItem -Path $Path -Filter $Filter",
                          "   ```",
                          "3. **Use standard PowerShell cmdlets** (Get-ChildItem, Get-Content, Select-String, Get-Process, Test-Path, etc.) rather than .NET calls or COM objects.",
                          "4. **Structure multi-step scripts as functions** with clear param() blocks for extractability.",
                          "5. **Output structured data** when possible (objects, not formatted strings).",
                          '6. Execute scripts via Bash tool: `powershell -NoProfile -Command "& { <script> }"`',
                      ]
                    : []),
            ].join("\n"),
        },
        mcpServers: {
            [mcpServerName]: createSdkMcpServer({
                name: mcpServerName,
                tools: [discoverTool, executeTool],
            }),
        },
    };

    if (sessionId) {
        claudeOptions.resume = sessionId;
    }

    return claudeOptions;
}

/**
 * Generate a unique request ID for tracing
 */
function generateRequestId(): string {
    return `req-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Execute reasoning action without planning (standard mode)
 */
async function executeReasoningWithoutPlanning(
    originalRequest: string,
    context: ActionContext<CommandHandlerContext>,
): Promise<any> {
    // Display initial message
    context.actionIO.appendDisplay("Thinking...", "temporary");

    // Create query to Claude Agent SDK with chat history context
    const queryInstance = query({
        prompt: buildPromptWithContext(originalRequest, context),
        options: getClaudeOptions(context),
    });

    let finalResult: string | undefined = undefined;

    // Process streaming response
    for await (const message of queryInstance) {
        debug(message);
        // Capture session ID from first message for future resume
        if ("session_id" in message && !getSessionId(context)) {
            setSessionId(context, (message as any).session_id);
        }
        if (message.type === "assistant") {
            for (const content of message.message.content) {
                if (content.type === "text") {
                    // Update display with current thinking content
                    // REVIEW: assume markdown?
                    context.actionIO.appendDisplay(
                        {
                            type: "markdown",
                            content: content.text,
                        },
                        "block",
                    );
                } else if (content.type === "tool_use") {
                    context.actionIO.appendDisplay(
                        {
                            type: "markdown",
                            content: formatToolCallDisplay(
                                content.name,
                                content.input,
                            ),
                            kind: "info",
                        },
                        "block",
                    );
                } else if ((content as any).type === "thinking") {
                    const thinkingContent = (content as any).thinking;
                    if (thinkingContent) {
                        context.actionIO.appendDisplay(
                            {
                                type: "html",
                                content: formatThinkingDisplay(thinkingContent),
                            },
                            "block",
                        );
                    }
                }
            }
        } else if (message.type === "user") {
            // Tool results come back as user messages with tool_result blocks
            const msg = (message as any).message;
            if (msg?.content) {
                for (const block of msg.content) {
                    if (block.type === "tool_result") {
                        const isError = block.is_error || false;
                        let content = "";
                        if (Array.isArray(block.content)) {
                            for (const cb of block.content) {
                                if (cb.type === "text") content += cb.text;
                            }
                        } else if (typeof block.content === "string") {
                            content = block.content;
                        }
                        context.actionIO.appendDisplay(
                            {
                                type: "markdown",
                                content: formatToolResultDisplay(
                                    content,
                                    isError,
                                ),
                                kind: isError ? "warning" : "info",
                            },
                            "block",
                        );
                    }
                }
            }
        } else if (message.type === "result") {
            // Final result from the agent
            if (message.subtype === "success") {
                finalResult = message.result;
            } else {
                // Handle error results
                const errors =
                    "errors" in message ? (message as any).errors : undefined;
                const errorMessage = `Error: ${errors?.join(", ") || "Unknown error"}`;
                throw new Error(errorMessage);
            }
        }
    }

    return finalResult ? createActionResultNoDisplay(finalResult) : undefined;
}

/**
 * Execute reasoning action with trace capture (no plan execution)
 */
async function executeReasoningWithTracing(
    originalRequest: string,
    context: ActionContext<CommandHandlerContext>,
): Promise<any> {
    const systemContext = context.sessionContext.agentContext;
    const storage = context.sessionContext.sessionStorage;

    if (!storage) {
        // No session storage available - fallback to standard reasoning
        debug("No sessionStorage available, using standard reasoning");
        return executeReasoningWithoutPlanning(originalRequest, context);
    }

    const requestId = generateRequestId();

    // Create trace collector
    const tracer = new ReasoningTraceCollector({
        storage,
        sessionId: systemContext.session.getSessionDirPath() || "unknown",
        originalRequest,
        requestId,
        model,
        planReuseEnabled: true,
    });

    try {
        // Display initial message
        context.actionIO.appendDisplay("Thinking...", "temporary");

        // Create query to Claude Agent SDK with chat history context
        const queryInstance = query({
            prompt: buildPromptWithContext(originalRequest, context),
            options: getClaudeOptions(context),
        });

        let finalResult: string | undefined = undefined;

        // Process streaming response with tracing
        for await (const message of queryInstance) {
            debug(message);
            // Capture session ID from first message for future resume
            if ("session_id" in message && !getSessionId(context)) {
                setSessionId(context, (message as any).session_id);
            }

            if (message.type === "assistant") {
                // Record thinking
                tracer.recordThinking(message.message);

                for (const content of message.message.content) {
                    if (content.type === "text") {
                        // Update display with current thinking content
                        context.actionIO.appendDisplay({
                            type: "markdown",
                            content: content.text,
                        });
                    } else if (content.type === "tool_use") {
                        // Record tool call for tracing
                        tracer.recordToolCall(content.name, content.input);

                        context.actionIO.appendDisplay(
                            {
                                type: "markdown",
                                content: formatToolCallDisplay(
                                    content.name,
                                    content.input,
                                ),
                                kind: "info",
                            },
                            "block",
                        );
                    } else if ((content as any).type === "thinking") {
                        const thinkingContent = (content as any).thinking;
                        if (thinkingContent) {
                            context.actionIO.appendDisplay(
                                {
                                    type: "html",
                                    content:
                                        formatThinkingDisplay(thinkingContent),
                                },
                                "block",
                            );
                        }
                    }
                }
            } else if (message.type === "user") {
                // Tool results come back as user messages with tool_result blocks
                const msg = (message as any).message;
                if (msg?.content) {
                    for (const block of msg.content) {
                        if (block.type === "tool_result") {
                            const isError = block.is_error || false;
                            let content = "";
                            if (Array.isArray(block.content)) {
                                for (const cb of block.content) {
                                    if (cb.type === "text") content += cb.text;
                                }
                            } else if (typeof block.content === "string") {
                                content = block.content;
                            }
                            context.actionIO.appendDisplay(
                                {
                                    type: "markdown",
                                    content: formatToolResultDisplay(
                                        content,
                                        isError,
                                    ),
                                    kind: isError ? "warning" : "info",
                                },
                                "block",
                            );
                        }
                    }
                }
            } else if (message.type === "result") {
                // Final result from the agent
                if (message.subtype === "success") {
                    finalResult = message.result;
                } else {
                    // Handle error results
                    const errors =
                        "errors" in message
                            ? (message as any).errors
                            : undefined;
                    const errorMessage = `Error: ${errors?.join(", ") || "Unknown error"}`;
                    throw new Error(errorMessage);
                }
            }
        }

        // Mark trace as successful
        tracer.markSuccess(finalResult);

        // Save trace
        await tracer.saveTrace();

        // Auto-generate recipe from successful trace for future reuse via flowInterpreter
        if (tracer.wasSuccessful()) {
            try {
                const recipeGen = new ReasoningRecipeGenerator();
                const recipe = await recipeGen.generate(tracer.getTrace());

                if (recipe) {
                    const pendingDir = path.join(
                        getRepoRoot(),
                        "packages",
                        "agents",
                        "taskflow",
                        "pending",
                    );
                    const { saveRecipe } = await import(
                        "taskflow-typeagent/recipeCompiler"
                    );
                    const filePath = await saveRecipe(recipe, pendingDir);
                    debug(`Recipe saved: ${filePath}`);
                    context.actionIO.appendDisplay({
                        type: "text",
                        content: `\n✓ Recipe saved: ${recipe.actionName}.recipe.json`,
                    });
                }
            } catch (error) {
                debug("Failed to generate recipe from trace:", error);
            }

            // Auto-generate script recipes from PowerShell scripts in trace
            const scriptReuseEnabled =
                systemContext.session.getConfig().execution.scriptReuse ===
                "enabled";
            if (scriptReuseEnabled && process.platform === "win32") {
                try {
                    const scriptGen = new ScriptRecipeGenerator();
                    const scriptRecipes = await scriptGen.generate(
                        tracer.getTrace(),
                    );

                    // Save to scriptflow agent's instance storage
                    const scriptflowStorage =
                        systemContext.persistDir &&
                        systemContext.storageProvider
                            ? systemContext.storageProvider.getStorage(
                                  "scriptflow",
                                  systemContext.persistDir,
                              )
                            : undefined;

                    for (const scriptRecipe of scriptRecipes) {
                        if (scriptflowStorage) {
                            const pendingPath = `pending/${scriptRecipe.actionName}_${Date.now().toString(36)}.recipe.json`;
                            await scriptflowStorage.write(
                                pendingPath,
                                JSON.stringify(scriptRecipe, null, 2),
                            );
                            debug(
                                `Script recipe saved to instance storage: ${pendingPath}`,
                            );
                        } else {
                            debug(
                                "No instance storage available for scriptflow, skipping save",
                            );
                        }
                        context.actionIO.appendDisplay({
                            type: "text",
                            content: `\n✓ Script recipe captured: ${scriptRecipe.actionName}`,
                        });
                    }
                } catch (error) {
                    debug(
                        "Failed to generate script recipe from trace:",
                        error,
                    );
                }
            }
        }

        return finalResult
            ? createActionResultNoDisplay(finalResult)
            : undefined;
    } catch (error) {
        // Mark trace as failed and save
        tracer.markFailed(error instanceof Error ? error : String(error));
        await tracer.saveTrace();
        throw error;
    }
}

/**
 * Main entry point for reasoning actions
 * Checks config and routes to appropriate implementation
 */
export async function executeReasoningAction(
    action: TypeAgentAction<ReasoningAction>,
    context: ActionContext<CommandHandlerContext>,
): Promise<any> {
    const systemContext = context.sessionContext.agentContext;
    const config = systemContext.session.getConfig();
    if (config.execution.reasoning !== "claude") {
        throw new Error(
            `Reasoning model is not set to 'claude' for this session.`,
        );
    }

    const request = action.parameters.originalRequest;
    debug(`Received reasoning request: ${request}`);

    // Check if plan reuse or script reuse is enabled (either triggers tracing)
    const planReuseEnabled = config.execution.planReuse === "enabled";
    const scriptReuseEnabled = config.execution.scriptReuse === "enabled";

    return executeReasoning(request, context, {
        planReuseEnabled: planReuseEnabled || scriptReuseEnabled,
        engine: "claude",
    });
}

export async function executeReasoning(
    request: string,
    context: ActionContext<CommandHandlerContext>,
    options?: {
        planReuseEnabled?: boolean; // false by default
        engine?: "claude"; // default is "claude" for now
    },
) {
    const engine = options?.engine ?? "claude";
    if (engine !== "claude") {
        throw new Error(`Unsupported reasoning engine: ${engine}`);
    }
    const planReuseEnabled = options?.planReuseEnabled ?? false;
    if (!planReuseEnabled) {
        return executeReasoningWithoutPlanning(request, context);
    }

    // Trace capture + auto recipe generation
    return executeReasoningWithTracing(request, context);
}
