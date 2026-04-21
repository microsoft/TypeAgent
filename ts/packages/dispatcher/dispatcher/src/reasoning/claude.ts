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
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod/v4";
import { getActionSchemaTypeName } from "../translation/agentTranslators.js";
import {
    composeActionSchema,
    createActionSchemaJsonValidator,
} from "../translation/actionSchemaJsonTranslator.js";
import { serializeEntityForPrompt } from "../context/chatHistoryPrompt.js";
import { Entity } from "@typeagent/agent-sdk";
import { TypeAgentJsonValidator } from "typechat-utils";
import { executeAction } from "../execute/actionHandlers.js";
import { nullClientIO } from "../context/interactiveIO.js";
import { ClientIO, IAgentMessage } from "@typeagent/dispatcher-types";
import { createActionResultNoDisplay } from "@typeagent/agent-sdk/helpers/action";
import { ReasoningTraceCollector } from "./tracing/traceCollector.js";
import { ReasoningRecipeGenerator } from "./recipeGenerator.js";
import { ScriptRecipeGenerator } from "./scriptRecipeGenerator.js";
import {
    formatParams as sharedFormatParams,
    formatToolResultDisplay as sharedFormatToolResultDisplay,
    formatThinkingDisplay as sharedFormatThinkingDisplay,
} from "./reasoningLoopBase.js";
const debug = registerDebug("typeagent:dispatcher:reasoning:messages");
// Separate channel for MCP tool invocations (discover_actions / execute_action)
// so call counts can be traced without enabling the full messages channel.
// Enable with DEBUG=typeagent:dispatcher:reasoning:mcp (or :* for everything).
const debugMcp = registerDebug("typeagent:dispatcher:reasoning:mcp");

const model = "claude-opus-4-6";

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
 * Clear the stored Claude reasoning session ID for the given agent context.
 * Call this before starting a new reasoning loop to avoid topic pollution
 * from prior sessions. Exported so @history clear can invoke it.
 */
export function clearReasoningSession(agentContext: object): void {
    reasoningSessionIds.delete(agentContext);
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
    fallbackContext?: ReasoningFallbackContext,
): string {
    const parts: string[] = [];
    const chatContext = getRecentChatContext(context);
    if (chatContext) {
        parts.push(chatContext);
    }
    if (fallbackContext) {
        const lines = ["[Fallback context — a prior action failed]"];
        if (fallbackContext.failedSchema && fallbackContext.failedAction) {
            lines.push(
                `Failed action: ${fallbackContext.failedSchema}.${fallbackContext.failedAction}`,
            );
        }
        if (fallbackContext.failedFlowName) {
            lines.push(`Failed flow: ${fallbackContext.failedFlowName}`);
        }
        if (fallbackContext.error) {
            lines.push(`Error: ${fallbackContext.error}`);
        }
        const isScriptflowFailure =
            fallbackContext.failedSchema?.startsWith("scriptflow") === true ||
            fallbackContext.failedFlowName !== undefined;
        if (isScriptflowFailure) {
            lines.push(
                "You MUST use scriptflow actions (discover_actions, listScriptFlows, executeScriptFlow, createScriptFlow, editScriptFlow, deleteScriptFlow) to handle this request. Do NOT use the Bash tool for operations that scriptflow can handle.",
            );
            if (fallbackContext.failedFlowName) {
                lines.push(
                    `IMPORTANT: The flow '${fallbackContext.failedFlowName}' failed. Use editScriptFlow to fix its script rather than creating a duplicate flow. Only create a new flow if the existing one's parameters/grammar are fundamentally wrong.`,
                );
            }
        } else {
            lines.push(
                "IMPORTANT: Do NOT re-invoke the failed action with substantively the same parameters — that attempt already failed. Complete the user's original request using a different approach: a different action, different parameters, or a sequence of typed actions.",
            );
        }
        parts.push(lines.join("\n"));
    }

    // Reinforce scriptflow usage for Windows even when not in fallback mode.
    // Without this, reasoning often uses Bash + PowerShell directly and
    // never creates a reusable scriptflow.
    const systemContext = context.sessionContext.agentContext;
    const config = systemContext.session.getConfig();
    if (
        !fallbackContext &&
        config.execution.scriptReuse === "enabled" &&
        process.platform === "win32"
    ) {
        parts.push(
            "[ScriptFlow REQUIRED] You MUST use scriptflow for system operations (file listing, " +
                "process management, text search, disk space, service status). Do NOT use Bash/PowerShell directly.\n" +
                "WORKFLOW: discover_actions('scriptflow') → listScriptFlows → " +
                "executeScriptFlow (if flow exists) OR createScriptFlow (if no matching flow) → execute.\n" +
                "This creates reusable flows. Using Bash directly bypasses reuse and is NOT allowed for these operations.",
        );
    }

    parts.push(
        parts.length > 0
            ? `[Current request]\n${originalRequest}`
            : originalRequest,
    );
    return parts.join("\n\n");
}

// Delegate to shared formatting utilities from reasoningLoopBase
const formatParams = sharedFormatParams;

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

const formatToolResultDisplay = sharedFormatToolResultDisplay;
const formatThinkingDisplay = sharedFormatThinkingDisplay;

function getClaudeOptions(
    context: ActionContext<CommandHandlerContext>,
): Options {
    const systemContext = context.sessionContext.agentContext;
    const config = systemContext.session.getConfig();
    const activeSchemas = systemContext.agents.getActiveSchemas();
    const schemaDescriptions: string[] = [];
    const validatorSchemas = new Set<string>();
    for (const schemaName of activeSchemas) {
        const actionConfig = systemContext.agents.getActionConfig(schemaName);
        if (getActionSchemaTypeName(actionConfig.schemaType) === undefined) {
            continue;
        }
        schemaDescriptions.push(`- ${schemaName}: ${actionConfig.description}`);
        validatorSchemas.add(schemaName);
    }
    // Build validators on demand so they always reflect the current schema
    // (e.g., after reloadAgentSchema() updates actionConfig.schemaFile).
    function getValidator(
        schemaName: string,
    ): TypeAgentJsonValidator<AppAction> | undefined {
        if (!validatorSchemas.has(schemaName)) return undefined;
        const actionConfig = systemContext.agents.getActionConfig(schemaName);
        return createActionSchemaJsonValidator(
            composeActionSchema([actionConfig], [], systemContext.agents, {
                activity: false,
            }),
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
            debugMcp(`discover_actions schema=${args.schemaName}`);
            const validator = getValidator(args.schemaName);
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
        action: z.object({
            actionName: z.string(),
            parameters: z.any().optional(),
        }),
    };
    const executeTool: SdkMcpToolDefinition<typeof executeSchema> = {
        name: "execute_action",
        description: [
            "Execute an actions based on action schemas discovered using the 'discover_actions' tool.",
            "The action parameter must conform to the schema of the specified schema name returned by 'discover_actions' tool.",
        ].join("\n"),
        inputSchema: executeSchema,
        handler: async (args) => {
            debugMcp(
                `execute_action schema=${args.schemaName} action=${args.action?.actionName}`,
            );
            const validator = getValidator(args.schemaName);
            if (!validator) {
                throw new Error(`Invalid schema name '${args.schemaName}'`);
            }
            const actionJson = { ...args.action };
            // Remove empty parameters object to support actions without parameters
            if (
                actionJson.parameters &&
                typeof actionJson.parameters === "object" &&
                Object.keys(actionJson.parameters).length === 0
            ) {
                delete actionJson.parameters;
            }
            const validationResult = validator.validate(actionJson);
            if (!validationResult.success) {
                debugMcp(
                    `execute_action validation failed: ${validationResult.message}`,
                );
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
            const savedClientIO = systemContext.clientIO;
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
                // Diagnostic data emitted by handlers running inside the
                // reasoning loop should still reach the outer collector.
                // Without this override the default nullClientIO drops it
                // silently, breaking any external consumer that inspects
                // handler-emitted diagnostics.
                appendDiagnosticData: (requestId, data) => {
                    savedClientIO.appendDiagnosticData(requestId, data);
                },
            };
            systemContext.isInsideReasoningLoop = true;
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
                systemContext.isInsideReasoningLoop = false;
            }
            return {
                content: [{ type: "text", text: JSON.stringify(result) }],
            };
        },
    };

    const sessionId = getSessionId(context);

    // Experimental override: if CLAUDE_CUSTOM_PROMPT_FILE is set, read that file
    // each call and use its contents as the ENTIRE system prompt (bypassing
    // claude_code preset and config.promptAppend). Used by prompt-variation
    // benchmark experiments.
    const overrideFile = process.env.CLAUDE_CUSTOM_PROMPT_FILE;
    let customSystemPrompt: string | undefined;
    if (overrideFile) {
        try {
            customSystemPrompt = fs.readFileSync(overrideFile, "utf8");
            debug(
                `[prompt-override] Using custom system prompt from ${overrideFile} (${customSystemPrompt.length} chars)`,
            );
        } catch (err) {
            debug(
                `[prompt-override] Failed to read ${overrideFile}: ${(err as Error).message}`,
            );
        }
    }

    const claudeOptions: Options = {
        model,
        permissionMode: "acceptEdits",
        // Auto-allow all tool calls — we've already curated allowedTools
        canUseTool: async () => ({ behavior: "allow" as const }),
        allowedTools,
        cwd: getRepoRoot(),
        settingSources: [],
        maxTurns: 20,
        thinking: { type: "adaptive" },
        effort: "max",
        systemPrompt: customSystemPrompt ?? {
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
                "When the user asks about agent capabilities, use discover_actions first.",
                "When the user asks to perform an action, discover the schema then execute_action.",
                "",
                ...(config.execution.entityPromptShape === "facets-with-schema"
                    ? [
                          "# Entity Schema",
                          "",
                          "Entities in the [Context Entities] block follow this TypeScript shape:",
                          "",
                          "```typescript",
                          "interface Entity {",
                          "    name: string;",
                          "    type: string[];",
                          "    uniqueId?: string;",
                          "    facets?: { name: string; value: string | number | boolean | object | any[] }[];",
                          "}",
                          "```",
                          "",
                          "Read `facets[].name` as the property key and `facets[].value` as the value. Prefer values from facets over re-reading the underlying source. `uniqueId` can be used to reference an entity in follow-up turns.",
                          "",
                      ]
                    : []),
                ...(config.promptAppend
                    ? [
                          "# TypeAgent Configuration/Context",
                          "",
                          config.promptAppend,
                          "",
                      ]
                    : []),
                "# Autonomous Execution Policy",
                "",
                "NEVER ask the user clarifying questions mid-task.",
                "This reasoning loop runs without an interactive user present.",
                "When information is ambiguous or missing, make a reasonable safe default choice and proceed.",
                "Prefer non-destructive defaults: add rather than replace, use conservative values.",
                "Only stop if you are truly unable to proceed — in that case, emit a clear error message explaining what is missing.",
                "",
                "ACTIONS, NOT DESCRIPTIONS: a request to modify state is only complete when you have actually executed an action that modifies it. Writing code or pseudo-code in a markdown response is NOT execution. If an action exists that performs the change, call it — do not describe the change in text and stop. Never finish a turn with only a text-only explanation when the task required a modification.",
                "",
                "# File Placement Policy",
                "",
                "ALL temporary scripts, scratch files, and one-off code MUST go in the `tmp/` folder at the TypeAgent repo root.",
                "NEVER create temporary files inside package source directories (e.g. `packages/`, `examples/`), agent directories, or the workspace root.",
                "If it is not production code that belongs in a specific package, it goes in `tmp/`. No exceptions.",
                "",
                "# TaskFlow Recording",
                "",
                "TRIGGERS:",
                "- 'learn: [task]' or 'remember how to [task]' or 'record [task]' → STANDARD recording",
                "  If the task involves browser page interaction, use WebFlow recording (see below).",
                "  Otherwise, use TaskFlow recording.",
                "- 'dev: learn: [task]' or 'dev: record [task]' → DEV MODE recording (see below)",
                "",
                "STANDARD RECORDING STEPS:",
                "1. Call discover_actions for each agent schema needed.",
                "2. SOURCE RESEARCH — required before recording any web data step:",
                "   Goal: find a stable, server-side-rendered page whose URL can be templated with",
                "   the flow's parameters so the compiled flow works for ALL valid inputs.",
                "",
                "   PROCESS:",
                "   a. Use api.webSearch() to find authoritative sites that list the data.",
                "      For each candidate site, inspect its URLs: does the flow parameter (category,",
                "      genre, keyword, etc.) appear in the URL path or query string?",
                "   b. Fetch 2-3 URLs on that site substituting different parameter values to confirm",
                "      the pattern is consistent and the data is server-rendered (not JS-only).",
                "      If webFetch returns empty/minimal content, the page is JS-rendered — skip it.",
                "   c. Once confirmed, record the URL as a template: site.com/data/${paramName}/list",
                "   d. Only fall back to api.webSearch() in the flow script if after trying 3+ candidate",
                "      sites you cannot find any with a parameterizable, server-rendered URL pattern.",
                "   e. NEVER record a fixed URL for one specific input value — the recipe must work",
                "      for all valid values of every flow parameter.",
                "",
                "3. STEP COST — prefer the cheapest path that works:",
                "   - api.webFetch(parameterized-url) + api.queryLLM()  ~5s  → PREFERRED (if server-rendered)",
                "   - api.webSearch(query) + api.queryLLM()              ~8s  → fallback if no stable URL",
                "   - api.callAction('utility', 'claudeTask', { goal })  ~35s → LAST RESORT",
                "",
                "4. Choose the right LLM method:",
                "   - api.queryLLM(prompt, opts): Single LLM call for extraction/transformation (PREFERRED)",
                "   - api.callAction('utility', 'claudeTask', { goal }): Multi-turn agentic loop (EXPENSIVE, SLOW)",
                "   Use queryLLM for: extracting data, formatting, summarization, parsing",
                "   Use claudeTask ONLY when: task requires multiple tool calls that queryLLM cannot do",
                "5. Calling utility actions (readFile, writeFile, llmTransform, claudeTask):",
                "   These are NOT direct api methods — call via: api.callAction('utility', 'actionName', { params })",
                "   Example: await api.callAction('utility', 'readFile', { path: '/path/to/file' })",
                "6. Add a testValue to each parameter for use during testing.",
                "7. Create the flow by calling execute_action with schemaName 'taskflow',",
                "   actionName 'createTaskFlow'. Parameters:",
                "   - name: camelCase action name (e.g., 'getTopSongs')",
                "   - description: what the flow does",
                "   - parameters: JSON string of parameter definitions array",
                "   - script: TypeScript function source (see SCRIPT API below)",
                "   - grammarPatterns: JSON array of natural language patterns",
                "   The flow is saved to instance storage and becomes immediately available.",
                "8. Test the flow by calling taskflow.ACTION_NAME with test parameters.",
                "9. If the flow needs modification, use taskflow.editTaskFlow with:",
                "   - name: the flow to edit",
                "   - script: updated TypeScript source (optional)",
                "   - description: updated description (optional)",
                "   - grammarPatterns: updated patterns as JSON array (optional)",
                "10. Tell user: 'Task flow registered: ACTION_NAME. It is now available for use.'",
                "",
                "DEV MODE RECORDING — interactive improvement loop:",
                "When triggered with 'dev: learn: [task]':",
                "- Follow standard recording steps 1-5",
                "- BEFORE writing the recipe, surface improvement opportunities:",
                "  * 'action X returns plain text — JSON output would let the flow work with",
                "    typed data. Want me to add outputFormat support to that action? (~5 min)'",
                "  * 'there is no action for Y — want me to create one now?'",
                "  * 'steps A and B could be a single action — want me to add a combined action?'",
                "- If developer says yes: use Read/Write/Edit/Bash tools to implement the change,",
                "  build it (cd to the agent package and run pnpm run tsc), then continue recording",
                "  with the improved action",
                "- After all improvements are done, write the recipe using the improved actions",
                "",
                "RECIPE FORMAT (write as JSON):",
                "{",
                '  "name": "camelCaseActionName",',
                '  "description": "what this flow does",',
                '  "parameters": [',
                '    { "name": "param", "type": "string|number|boolean", "required": true|false,',
                '      "default": defaultValue, "description": "..." }',
                "  ],",
                '  "script": "async function execute(api: TaskFlowScriptAPI, params: FlowParams): Promise<TaskFlowScriptResult> { ... }",',
                '  "grammarPatterns": [',
                '    "3-5 natural invocation patterns with $(param:wildcard) or $(param:number) captures"',
                "  ]",
                "}",
                "",
                "SCRIPT API — the `api` object has these methods:",
                "- api.callAction(schemaName, actionName, params) → { text, data, error? }",
                "- api.queryLLM(prompt, { input?, parseJson?, model? }) → { text, data, error? }",
                "- api.webSearch(query) → { text, data, error? }",
                "- api.webFetch(url) → { text, data, error? }",
                "",
                "SCRIPT RULES:",
                "- Script MUST be TypeScript. Define: async function execute(api: TaskFlowScriptAPI, params: FlowParams): Promise<TaskFlowScriptResult>",
                "- Do NOT add import statements — all types are provided globally.",
                "- Return { success: true, message: '...' } on success",
                "- Return { success: false, error: '...' } on failure",
                "- Check step.error before using step.data",
                "- Use api.queryLLM() for LLM interpretation, api.webSearch() for search, api.webFetch() for URL fetch",
                "- Use api.callAction(schemaName, actionName, params) for all other agent actions",
                "- Use template literals for interpolation: `Top ${params.quantity} songs`",
                "- Default LLM model: 'claude-haiku-4-5-20251001'",
                "- BLOCKED identifiers: eval, Function, require, import, fetch, setTimeout, process, window, document",
                "",
                "TYPESCRIPT PATTERNS — avoid validation errors:",
                "- Nullable variables: `let data: string | null = null;` (NOT just `let data = null;`)",
                "- Optional chaining: `result.data?.field ?? defaultValue`",
                "- ActionStepResult shape: `{ text: string, data: unknown, error?: string }`",
                "- Always check errors: `if (result.error) return { success: false, error: result.error };`",
                "- Type assertions when needed: `const songs = result.data as string[];`",
                "",
                "SCRIPT EXAMPLE — multi-step flow with error handling:",
                "async function execute(api: TaskFlowScriptAPI, params: FlowParams): Promise<TaskFlowScriptResult> {",
                "    const chart = await api.webFetch(",
                "        `https://example.com/chart/${params.genre}/`,",
                "    );",
                "    const songs = await api.queryLLM(",
                "        `Extract top ${params.quantity} songs as JSON array.`,",
                "        { input: chart.text, parseJson: true },",
                "    );",
                "    if (!Array.isArray(songs.data) || songs.data.length === 0) {",
                '        return { success: false, error: "Could not extract songs" };',
                "    }",
                '    const result = await api.callAction("player", "createPlaylist", {',
                "        name: `Top ${params.quantity} ${params.genre}`,",
                "        songs: songs.data,",
                "    });",
                "    return { success: true, message: result.text };",
                "}",
                "",
                "GRAMMAR PATTERN RULES:",
                "- ONLY TWO capture types exist: $(name:wildcard) for strings, $(name:number) for numbers",
                "  NEVER write $(name:string) or $(name:integer) — those are invalid and will fail to compile",
                "- Lead with 2-3 distinctive fixed tokens before any wildcard",
                "- Include a flow-specific anchor keyword (e.g., 'playlist', 'digest', 'agenda')",
                "- Make distinguishing tokens mandatory, not optional",
                "- Avoid starting with verbs owned by other agents: 'search', 'play', 'email', 'find', 'send'",
                "- Optional words: (word)?   Alternatives: word1 | word2",
                "- Bare variable names in action body: { genre } not { genre: $genre }",
                "",
                "PARAMETER RULES:",
                "- Required: domain-specific, no reasonable default (e.g. genre, recipient)",
                "- Optional with default: sensible default exists (e.g. quantity=10, timePeriod='this month')",
                "- Use exact schemaName from discover_actions; utility agent is schemaName 'utility'",
                "- For LLM steps: default 'claude-haiku-4-5-20251001'; 'claude-sonnet-4-6' only for",
                "  genuinely complex multi-step reasoning",
                "",
                "# WebFlow Recording",
                "",
                "WHEN TO USE WEBFLOW instead of TaskFlow:",
                "- The task involves interacting with a specific website (clicking, typing, navigating pages)",
                "- The user mentions a URL, website name, or web page elements",
                "- Keywords: 'on [site]', 'in the browser', 'on the page', 'click', 'fill in', 'search on [site]'",
                "",
                "WEBFLOW RECORDING STEPS:",
                "1. Use execute_action with schemaName 'browser.webFlows', actionName 'startGoalDrivenTask'",
                "   to execute the task in the browser. Parameters: { goal: 'description of what to do',",
                "   startUrl: 'https://...' (optional), maxSteps: 30 }",
                "2. If startGoalDrivenTask succeeds and returns a traceId, use execute_action with",
                "   schemaName 'browser.webFlows', actionName 'generateWebFlow' to create a reusable flow.",
                "   Parameters: { traceId: 'the-trace-id', name: 'camelCaseName', description: '...' }",
                "3. The flow is automatically saved to instance storage with grammar patterns and",
                "   becomes immediately available for grammar matching.",
                "4. Tell user: 'WebFlow registered: ACTION_NAME. It is now available for use.'",
                "",
                ...(process.platform === "win32"
                    ? [
                          "# ScriptFlow Recording (Windows)",
                          "",
                          "WHEN TO USE SCRIPTFLOW instead of TaskFlow:",
                          "- The task is a system operation: file listing, process management, text search,",
                          "  disk space, service status, or similar PowerShell-native operations",
                          "- The task can be accomplished with a single PowerShell script (no cross-agent orchestration)",
                          "- You are on Windows (which you are)",
                          "",
                          "SCRIPTFLOW RECORDING STEPS (test-then-register pattern):",
                          "1. discover_actions('scriptflow') to see available actions",
                          "2. execute_action scriptflow.listScriptFlows to check for existing flows",
                          "3. If a matching flow exists, tell user it's already available",
                          "4. If no matching flow, first TEST the script with scriptflow.testScriptFlow:",
                          "   - script: PowerShell script body with param() block",
                          "   - allowedCmdlets: cmdlets the script uses",
                          "   - allowedModules: modules to load (e.g., ['NetTCPIP'])",
                          "   - testParameters: JSON string of test parameter values",
                          "5. If testScriptFlow PASSES, register with scriptflow.createScriptFlow:",
                          "   - actionName: camelCase identifier (e.g., 'findLargeFiles', 'listRunningServices')",
                          "   - description: what the script does",
                          "   - displayName: human-readable name",
                          "   - script: same script that passed testing",
                          "   - scriptParameters: array of { name, type, required, description, default? }",
                          "   - grammarPatterns: array of { pattern, isAlias } with $(param:wildcard) captures",
                          "   - allowedCmdlets: cmdlets the script uses",
                          "6. If testScriptFlow FAILS, fix the script and test again before registering",
                          "7. Tell user: 'ScriptFlow registered: ACTION_NAME. It is now available for use.'",
                          "",
                          "SCRIPTFLOW SCRIPT RULES:",
                          "- Scripts run in FullLanguage mode with cmdlet whitelisting",
                          "- Full PowerShell syntax is available: [PSCustomObject], [math]::Round(), etc.",
                          "",
                          "CMDLET ACCESS:",
                          "- Core cmdlets: Always available (Get-ChildItem, Get-Process, Select-Object, etc.)",
                          "- Module cmdlets: Available when module is in allowedModules",
                          "  Example: Get-NetTCPConnection requires allowedModules: ['NetTCPIP']",
                          "- Network cmdlets: Require networkAccess: true in sandbox policy",
                          "",
                          "COMMON MODULES AND THEIR CMDLETS:",
                          "- NetTCPIP: Get-NetTCPConnection, Get-NetIPAddress, Get-NetAdapter",
                          "- Microsoft.PowerShell.Management: Get-Service, Get-Process, Get-ChildItem",
                          "- CimCmdlets: Get-CimInstance (modern replacement for Get-WmiObject)",
                          "",
                          "RESERVED VARIABLES (read-only, avoid as variable names):",
                          "- $PID, $PWD, $HOME, $HOST — use $procId, $currentPath instead",
                          "",
                          "BEST PRACTICES:",
                          "- Always include param() block matching scriptParameters",
                          "- Output objects or text, avoid Format-Table (hard to parse)",
                          "- Use [PSCustomObject] for structured output",
                          "",
                          "SCRIPTFLOW GRAMMAR PATTERN RULES:",
                          "- Use $(name:wildcard) for string captures, $(name:number) for numbers",
                          "- Lead with 2-3 fixed tokens before wildcards",
                          "- Include flow-specific anchor words",
                          "- Set isAlias: true for terse forms like 'ls', 'ps', 'df'",
                          "",
                      ]
                    : []),
                "CHOOSING BETWEEN TASKFLOW, WEBFLOW, AND SCRIPTFLOW:",
                "- ScriptFlow: Windows system operations (file/process/service/disk queries) — single PowerShell script",
                "- TaskFlow: cross-agent action sequences (e.g., fetch data → transform → create playlist)",
                "- WebFlow: browser page interaction (e.g., search on Amazon, customize Starbucks order)",
                "- If on Windows and task is system-related, prefer ScriptFlow",
                "- If unsure between TaskFlow and WebFlow, prefer TaskFlow — it's more general",
                "",
                ...(config.execution.scriptReuse === "enabled" &&
                process.platform === "win32"
                    ? [
                          "",
                          "# PowerShell Script Guidelines (Windows)",
                          "",
                          "ScriptFlow runs scripts in FullLanguage mode with cmdlet whitelisting.",
                          "Full PowerShell syntax is supported including [PSCustomObject], [math]::Round(), etc.",
                          "",
                          "## Sandbox Policy",
                          "",
                          "Each script defines its sandbox policy with:",
                          "- **allowedCmdlets**: Cmdlets the script can use (whitelist)",
                          "- **allowedModules**: PowerShell modules to load (enables module cmdlets)",
                          "- **allowedPaths**: Filesystem paths the script can access",
                          "- **networkAccess**: Whether network cmdlets are allowed",
                          "- **maxExecutionTime**: Timeout in seconds",
                          "",
                          "## Module Cmdlets",
                          "",
                          "To use module-specific cmdlets, add the module to allowedModules:",
                          "- **NetTCPIP**: Get-NetTCPConnection, Get-NetIPAddress, Get-NetAdapter, Get-NetRoute",
                          "- **CimCmdlets**: Get-CimInstance (modern WMI queries)",
                          "- **Microsoft.PowerShell.Management**: Get-Service, Get-Process, Get-EventLog",
                          "",
                          "Example sandbox policy for network diagnostics:",
                          "```json",
                          '{ "allowedCmdlets": ["Get-NetTCPConnection", "Get-Process", "Where-Object", "Select-Object"],',
                          '  "allowedModules": ["NetTCPIP"],',
                          '  "networkAccess": false }',
                          "```",
                          "",
                          "## Reserved Variables",
                          "",
                          "Avoid using these as variable names (read-only):",
                          "- `$PID`, `$PWD`, `$HOME`, `$HOST` — use `$procId`, `$currentPath` instead",
                          "",
                          "# ScriptFlow Integration (MANDATORY)",
                          "",
                          "**CRITICAL: You MUST use scriptflow actions instead of Bash/PowerShell for file system operations,",
                          "process management, text search, and system queries. Do NOT use the Bash tool for these tasks.**",
                          "",
                          "WRONG (do NOT do this):",
                          '- Bash tool with `powershell -Command "Get-Process"` ❌',
                          '- Bash tool with `powershell -Command "Get-ChildItem"` ❌',
                          "- Any direct PowerShell execution via Bash for system operations ❌",
                          "",
                          "CORRECT (do this instead):",
                          "- discover_actions('scriptflow') → listScriptFlows → createScriptFlow/executeScriptFlow ✓",
                          "",
                          "Required workflow:",
                          "1. discover_actions('scriptflow') to see available actions",
                          "2. execute_action scriptflow.listScriptFlows to see registered flows",
                          "3. If an existing flow fits, use scriptflow.executeScriptFlow with named flowParameters",
                          "4. If a flow exists but its script is broken, use scriptflow.editScriptFlow to fix it, then execute",
                          "5. If no flow fits, create one with scriptflow.createScriptFlow then execute it",
                          "6. Use scriptflow.deleteScriptFlow to remove obsolete or duplicate flows",
                          "",
                          "PARAMETER PASSING (CRITICAL):",
                          "- Use flowParametersJson (JSON string of named params) instead of flowArgs when the flow has multiple parameters.",
                          '  Example: { "flowName": "listFiles", "flowParametersJson": "{\\"path\\":\\"C:\\\\\\\\Users\\\\\\\\name\\\\\\\\Downloads\\",\\"filter\\":\\"*safenet*\\"}" }',
                          "- Parameter names are CASE-INSENSITIVE but should match the flow's parameter names from listScriptFlows.",
                          "  The listFiles flow has params: path (directory) and filter (wildcard pattern).",
                          "  The listDownloadsWithFilter flow has param: FilterPattern (name filter).",
                          "- Use real Windows paths (C:\\\\Users\\\\...), NOT PowerShell variables like $env:USERPROFILE.",
                          "- Extract paths and filters from the user's request as separate parameters.",
                          "  e.g. 'list files in downloads with safenet' → path: 'C:\\\\Users\\\\name\\\\Downloads', filter: '*safenet*'",
                          "",
                          "When invoked as a fallback from a failed scriptflow action, the [Fallback context] in your",
                          "prompt tells you which action failed and why. Parse the original request to extract the correct",
                          "parameters (path, filter, etc.) and re-invoke the scriptflow action with corrected parameters,",
                          "or create a new scriptflow if the existing one doesn't support the request.",
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

// Default reasoning-loop timeout. Override with TYPEAGENT_REASONING_TIMEOUT_MS.
const DEFAULT_REASONING_TIMEOUT_MS = 20 * 60 * 1000;

// Pull schemaName + actionName out of a Claude SDK tool_use input when the tool
// is one of the MCP action-executor tools. Leaves both undefined for other tools
// so the emitted reasoningStep stays small and well-typed.
function extractActionInfo(
    toolName: string,
    input: unknown,
): { schemaName?: string; actionName?: string } {
    const inp = input as Record<string, unknown> | undefined;
    if (!inp) return {};
    const out: { schemaName?: string; actionName?: string } = {};
    if (toolName.endsWith("execute_action")) {
        if (typeof inp.schemaName === "string") out.schemaName = inp.schemaName;
        const actionRaw = inp.action as Record<string, unknown> | undefined;
        if (typeof actionRaw?.actionName === "string") {
            out.actionName = actionRaw.actionName;
        }
        return out;
    }
    if (toolName.endsWith("discover_actions")) {
        if (typeof inp.schemaName === "string") out.schemaName = inp.schemaName;
        return out;
    }
    return out;
}

/**
 * Execute reasoning action without planning (standard mode)
 */
async function executeReasoningWithoutPlanning(
    originalRequest: string,
    context: ActionContext<CommandHandlerContext>,
    fallbackContext?: ReasoningFallbackContext,
    abortSignal?: AbortSignal,
): Promise<any> {
    // Display initial message
    context.actionIO.appendDisplay("Thinking...", "temporary");

    // Create query to Claude Agent SDK with chat history context
    const queryInstance = query({
        prompt: buildPromptWithContext(
            originalRequest,
            context,
            fallbackContext,
        ),
        options: getClaudeOptions(context),
    });

    let finalResult: string | undefined = undefined;
    let toolUseCount = 0;
    let reasoningStepCount = 0;
    const toolUseIdToName = new Map<string, string>();

    // Process streaming response
    for await (const message of queryInstance) {
        (abortSignal ?? context.abortSignal)?.throwIfAborted();
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
                    toolUseCount++;
                    reasoningStepCount++;
                    toolUseIdToName.set(content.id, content.name);
                    const actionInfo = extractActionInfo(
                        content.name,
                        content.input,
                    );
                    context.actionIO.appendDiagnosticData({
                        type: "reasoningStep",
                        phase: "toolCall",
                        stepNumber: reasoningStepCount,
                        toolUseId: content.id,
                        toolName: content.name,
                        ...actionInfo,
                        parameters: content.input,
                        timestamp: new Date().toISOString(),
                    });
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
                        const toolName = toolUseIdToName.get(block.tool_use_id);
                        context.actionIO.appendDiagnosticData({
                            type: "reasoningStep",
                            phase: "toolResult",
                            toolUseId: block.tool_use_id,
                            ...(toolName !== undefined ? { toolName } : {}),
                            isError,
                            result: content,
                            timestamp: new Date().toISOString(),
                        });
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

    // A success result with zero tool calls means the model replied with text
    // only (e.g. described the change in prose) without executing anything.
    // Nothing was actually modified — surface as a failure instead of letting
    // the text be reported as a successful action.
    if (finalResult && toolUseCount === 0) {
        throw new Error(
            "Reasoning completed with no tool calls — the model produced a text-only response and did not execute any action. No state was modified.",
        );
    }

    return finalResult ? createActionResultNoDisplay(finalResult) : undefined;
}

/**
 * Execute reasoning action with trace capture (no plan execution)
 */
async function executeReasoningWithTracing(
    originalRequest: string,
    context: ActionContext<CommandHandlerContext>,
    fallbackContext?: ReasoningFallbackContext,
    abortSignal?: AbortSignal,
): Promise<any> {
    const systemContext = context.sessionContext.agentContext;
    const storage = context.sessionContext.sessionStorage;

    if (!storage) {
        // No session storage available - fallback to standard reasoning
        debug("No sessionStorage available, using standard reasoning");
        return executeReasoningWithoutPlanning(
            originalRequest,
            context,
            undefined,
            abortSignal,
        );
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
            prompt: buildPromptWithContext(
                originalRequest,
                context,
                fallbackContext,
            ),
            options: getClaudeOptions(context),
        });

        let finalResult: string | undefined = undefined;
        let toolUseCount = 0;
        let reasoningStepCount = 0;
        const toolUseIdToName = new Map<string, string>();

        // Process streaming response with tracing
        for await (const message of queryInstance) {
            (abortSignal ?? context.abortSignal)?.throwIfAborted();
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
                        toolUseCount++;
                        reasoningStepCount++;
                        // Track tool_use_id → name for matching results
                        toolUseIdToName.set(content.id, content.name);
                        // Record tool call for tracing
                        tracer.recordToolCall(content.name, content.input);

                        const actionInfo = extractActionInfo(
                            content.name,
                            content.input,
                        );
                        context.actionIO.appendDiagnosticData({
                            type: "reasoningStep",
                            phase: "toolCall",
                            stepNumber: reasoningStepCount,
                            toolUseId: content.id,
                            toolName: content.name,
                            ...actionInfo,
                            parameters: content.input,
                            timestamp: new Date().toISOString(),
                        });

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

                            // Record tool result in trace for script extraction
                            const toolName =
                                toolUseIdToName.get(block.tool_use_id) ??
                                "unknown";
                            tracer.recordToolResult(
                                toolName,
                                content,
                                isError ? content : undefined,
                            );

                            context.actionIO.appendDiagnosticData({
                                type: "reasoningStep",
                                phase: "toolResult",
                                toolUseId: block.tool_use_id,
                                toolName,
                                isError,
                                result: content,
                                timestamp: new Date().toISOString(),
                            });

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

        // A success result with zero tool calls means the model replied with
        // text only (e.g. described the change in prose) without executing
        // anything. Nothing was actually modified — surface as a failure.
        if (finalResult && toolUseCount === 0) {
            throw new Error(
                "Reasoning completed with no tool calls — the model produced a text-only response and did not execute any action. No state was modified.",
            );
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
                    const saved = await saveTaskFlowRecipeToInstanceStorage(
                        recipe,
                        systemContext,
                    );
                    if (saved) {
                        debug(`TaskFlow recipe saved: ${recipe.name}`);
                        context.actionIO.appendDisplay({
                            type: "text",
                            content: `\n✓ Task flow registered: ${recipe.name}`,
                        });
                        try {
                            await systemContext.agents.reloadAgentSchema(
                                "taskflow",
                                systemContext,
                            );
                        } catch {
                            debug(
                                "Failed to reload taskflow schema after saving recipe",
                            );
                        }
                    }
                }
            } catch (error) {
                debug("Failed to generate recipe from trace:", error);
            }

            // Auto-generate script recipes from PowerShell scripts in trace
            // and register them as active scriptflows for immediate reuse.
            const scriptReuseEnabled =
                systemContext.session.getConfig().execution.scriptReuse ===
                "enabled";
            if (scriptReuseEnabled && process.platform === "win32") {
                try {
                    const scriptGen = new ScriptRecipeGenerator();
                    const scriptRecipes = await scriptGen.generate(
                        tracer.getTrace(),
                    );

                    if (scriptRecipes.length > 0) {
                        const saved = await saveScriptRecipesAsActiveFlows(
                            scriptRecipes,
                            systemContext,
                        );
                        for (const name of saved) {
                            context.actionIO.appendDisplay({
                                type: "text",
                                content: `\n✓ Script flow registered: ${name}`,
                            });
                        }
                        if (saved.length > 0) {
                            // Reload schema so the new flows are available
                            try {
                                await systemContext.agents.reloadAgentSchema(
                                    "scriptflow",
                                    systemContext,
                                );
                            } catch {
                                debug(
                                    "Failed to reload scriptflow schema after saving recipes",
                                );
                            }
                        }
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

    // If an agent intercepted a translated action and redirected here, embed that
    // action's parameters into the prompt so the reasoning loop knows exactly what
    // was intended and can inspect entities rather than retranslating from scratch.
    const attemptedActionRaw = action.parameters.attemptedAction;
    const contextEntitiesRaw = action.parameters.contextEntities;
    const attemptedAction = attemptedActionRaw
        ? (() => {
              try {
                  return JSON.parse(attemptedActionRaw);
              } catch {
                  return undefined;
              }
          })()
        : undefined;
    const contextEntities = contextEntitiesRaw
        ? (() => {
              try {
                  return JSON.parse(contextEntitiesRaw);
              } catch {
                  return undefined;
              }
          })()
        : undefined;
    let enrichedRequest = request;
    if (attemptedAction !== undefined || contextEntities !== undefined) {
        const parts: string[] = [request, ""];
        if (attemptedAction !== undefined) {
            const hasError =
                attemptedAction &&
                typeof attemptedAction === "object" &&
                typeof (attemptedAction as any).error === "string";
            const headline = hasError
                ? "A previous action attempt failed. The failed action (and its error) are shown below:"
                : "The translator produced this action (intercepted for inspection before execution):";
            const followUp = hasError
                ? "Do not retry the failed action as-is — diagnose the error, inspect the " +
                  "relevant state to understand the actual shape, then complete the user's " +
                  "original request using whichever available tools are appropriate."
                : "Use the parameters above as your starting point. Inspect the relevant " +
                  "state to verify they are correct, then execute the same action (or a " +
                  "corrected variant) to satisfy the user's request.";
            parts.push(
                "[Attempted Action]",
                headline,
                "```json",
                JSON.stringify(attemptedAction, null, 2),
                "```",
                followUp,
                "",
            );
        }
        if (contextEntities !== undefined) {
            // Producers serialize Entity[] in the canonical {name, type,
            // facets} shape. Re-render here per the configured prompt shape
            // so all variants flow through one transform point.
            const shape = config.execution.entityPromptShape;
            const rendered = Array.isArray(contextEntities)
                ? contextEntities.map((raw: unknown, i: number) => {
                      if (
                          raw !== null &&
                          typeof raw === "object" &&
                          typeof (raw as any).name === "string" &&
                          Array.isArray((raw as any).type)
                      ) {
                          return serializeEntityForPrompt(
                              raw as Entity,
                              shape,
                              i,
                          );
                      }
                      return raw;
                  })
                : contextEntities;
            parts.push(
                "[Context Entities]",
                "```json",
                JSON.stringify(rendered, null, 2),
                "```",
                "",
            );
        }
        enrichedRequest = parts.join("\n");
    }

    // Build a fallbackContext from the attemptedAction when an agent
    // intercepted and redirected the request. This lets
    // buildPromptWithContext emit the appropriate re-invocation guidance.
    const fallbackContext: ReasoningFallbackContext | undefined =
        attemptedAction &&
        typeof attemptedAction === "object" &&
        typeof (attemptedAction as any).schemaName === "string" &&
        typeof (attemptedAction as any).actionName === "string"
            ? {
                  failedSchema: (attemptedAction as any).schemaName,
                  failedAction: (attemptedAction as any).actionName,
                  ...(typeof (attemptedAction as any).error === "string"
                      ? { error: (attemptedAction as any).error }
                      : {}),
              }
            : undefined;

    return executeReasoning(enrichedRequest, context, {
        planReuseEnabled: planReuseEnabled || scriptReuseEnabled,
        engine: "claude",
        ...(fallbackContext ? { fallbackContext } : {}),
    });
}

import type { Storage } from "@typeagent/agent-sdk";
import type { ScriptRecipe as CapturedScriptRecipe } from "./scriptRecipeGenerator.js";

/**
 * Save captured script recipes as active scriptflows by writing directly
 * to the scriptflow agent's instance storage in the format its store expects.
 * This avoids a dependency on the scriptflow package.
 */
async function saveScriptRecipesAsActiveFlows(
    recipes: CapturedScriptRecipe[],
    systemContext: CommandHandlerContext,
): Promise<string[]> {
    const storage =
        systemContext.persistDir && systemContext.storageProvider
            ? systemContext.storageProvider.getStorage(
                  "scriptflow",
                  systemContext.persistDir,
              )
            : undefined;
    if (!storage) {
        debug("No instance storage available for scriptflow");
        return [];
    }

    // Read existing index
    let index: {
        version: 1;
        flows: Record<string, unknown>;
        deletedSamples: string[];
        lastModified: string;
    };
    try {
        const indexJson = await storage.read("index.json", "utf8");
        index = JSON.parse(indexJson);
    } catch {
        index = {
            version: 1,
            flows: {},
            deletedSamples: [],
            lastModified: new Date().toISOString(),
        };
    }

    const saved: string[] = [];
    for (const recipe of recipes) {
        const { actionName } = recipe;
        // Skip if flow already exists
        if (index.flows[actionName]) {
            debug(`Flow '${actionName}' already exists, skipping`);
            continue;
        }

        const flowPath = `flows/${actionName}.flow.json`;
        const scriptPath = `scripts/${actionName}.ps1`;

        // Write flow definition
        const flowDef = {
            version: 1,
            actionName,
            displayName: recipe.displayName,
            description: recipe.description,
            parameters: recipe.parameters,
            scriptRef: scriptPath,
            expectedOutputFormat: recipe.script.expectedOutputFormat,
            grammarPatterns: recipe.grammarPatterns,
            sandbox: recipe.sandbox,
            source: recipe.source,
        };
        await storage.write(flowPath, JSON.stringify(flowDef, null, 2));
        await storage.write(scriptPath, recipe.script.body);

        // Generate grammar rule text — use flow's own actionName
        const grammarRuleText = generateGrammarRuleTextForRecipe(
            actionName,
            recipe.grammarPatterns,
        );

        const parametersMeta = recipe.parameters.map(
            (p: {
                name: string;
                type: string;
                required: boolean;
                description: string;
            }) => ({
                name: p.name,
                type: p.type,
                required: p.required,
                description: p.description,
            }),
        );

        const now = new Date().toISOString();
        index.flows[actionName] = {
            actionName,
            displayName: recipe.displayName,
            description: recipe.description,
            flowPath,
            scriptPath,
            grammarRuleText,
            parameters: parametersMeta,
            created: now,
            updated: now,
            source: "reasoning",
            usageCount: 0,
            enabled: true,
        };
        index.lastModified = now;
        saved.push(actionName);
        debug(`Script flow registered as active: ${actionName}`);
    }

    if (saved.length > 0) {
        await storage.write("index.json", JSON.stringify(index, null, 2));

        // Regenerate grammar file
        await writeDynamicGrammarForIndex(storage, index);
    }

    return saved;
}

function generateGrammarRuleTextForRecipe(
    actionName: string,
    patterns: { pattern: string; isAlias: boolean }[],
): string {
    const rules: string[] = [];
    let aliasIndex = 0;
    for (const pattern of patterns) {
        const ruleName = pattern.isAlias
            ? `${actionName}Alias${++aliasIndex}`
            : actionName;

        // Preserve named captures — use flow's own actionName
        const captures = [...pattern.pattern.matchAll(/\$\((\w+):\w+\)/g)].map(
            (m) => m[1],
        );
        const paramJson =
            captures.length > 0 ? `{ ${captures.join(", ")} }` : "{}";

        rules.push(
            `<${ruleName}> [spacing=optional] = ${pattern.pattern}` +
                ` -> { actionName: "${actionName}", parameters: ${paramJson} };`,
        );
    }
    return rules.join("\n");
}

async function writeDynamicGrammarForIndex(
    storage: Storage,
    index: { flows: Record<string, any> },
): Promise<void> {
    const ruleNames: string[] = [];
    const ruleTexts: string[] = [];
    for (const entry of Object.values(index.flows)) {
        if (!entry.enabled || !entry.grammarRuleText) continue;
        ruleTexts.push(entry.grammarRuleText);
        for (const line of (entry.grammarRuleText as string).split("\n")) {
            const m = line.match(/^<(\w+)>/);
            if (m && !ruleNames.includes(m[1])) {
                ruleNames.push(m[1]);
            }
        }
    }
    if (ruleNames.length === 0) {
        await storage.write("grammar/dynamic.agr", "");
        return;
    }
    const startRule = `<Start> = ${ruleNames.map((n) => `<${n}>`).join(" | ")};`;
    await storage.write(
        "grammar/dynamic.agr",
        `${startRule}\n\n${ruleTexts.join("\n\n")}`,
    );
}

/**
 * Save a TaskFlow recipe directly to instance storage and register it as
 * an active flow. Mirrors saveScriptRecipesAsActiveFlows but for TaskFlow.
 */
async function saveTaskFlowRecipeToInstanceStorage(
    recipe: {
        name: string;
        description: string;
        parameters: Array<{
            name: string;
            type: string;
            required: boolean;
            description: string;
            default?: unknown;
        }>;
        script: string;
        grammarPatterns: string[];
        source?: { type: string; sourceId?: string; timestamp: string };
    },
    systemContext: CommandHandlerContext,
): Promise<boolean> {
    const storage =
        systemContext.persistDir && systemContext.storageProvider
            ? systemContext.storageProvider.getStorage(
                  "taskflow",
                  systemContext.persistDir,
              )
            : undefined;
    if (!storage) {
        debug("No instance storage available for taskflow");
        return false;
    }

    // Read existing index
    let index: {
        version: 1;
        flows: Record<string, unknown>;
        deletedSamples: string[];
        lastModified: string;
    };
    try {
        const indexJson = await storage.read("index.json", "utf8");
        index = JSON.parse(indexJson);
    } catch {
        index = {
            version: 1,
            flows: {},
            deletedSamples: [],
            lastModified: new Date().toISOString(),
        };
    }

    const { name } = recipe;
    if (index.flows[name]) {
        debug(`TaskFlow '${name}' already exists, skipping`);
        return false;
    }

    // Build flow definition (parameters as Record, not array)
    const flowParams: Record<string, unknown> = {};
    for (const p of recipe.parameters) {
        const def: Record<string, unknown> = { type: p.type };
        if (p.required !== undefined) def.required = p.required;
        if (p.default !== undefined) def.default = p.default;
        if (p.description) def.description = p.description;
        flowParams[p.name] = def;
    }

    // Write flow metadata (without script)
    const flowDef = {
        name,
        description: recipe.description,
        parameters: flowParams,
    };

    const flowPath = `flows/${name}.flow.json`;
    const scriptPath = `scripts/${name}.ts`;
    await storage.write(flowPath, JSON.stringify(flowDef, null, 2));
    await storage.write(scriptPath, recipe.script);

    // Generate grammar rule text
    const grammarRules: string[] = [];
    for (const pattern of recipe.grammarPatterns) {
        const captures = [...pattern.matchAll(/\$\((\w+):\w+\)/g)].map(
            (m) => m[1],
        );
        const paramJson =
            captures.length > 0 ? `{ ${captures.join(", ")} }` : "{}";
        grammarRules.push(
            `<${name}> [spacing=optional] = ${pattern}` +
                ` -> { actionName: "${name}", parameters: ${paramJson} };`,
        );
    }
    const grammarRuleText = grammarRules.join("\n");

    const parametersMeta = recipe.parameters.map((p) => ({
        name: p.name,
        type: p.type,
        required: p.required,
        description: p.description,
    }));

    const now = new Date().toISOString();
    index.flows[name] = {
        actionName: name,
        description: recipe.description,
        flowPath,
        scriptPath,
        grammarRuleText,
        parameters: parametersMeta,
        created: now,
        updated: now,
        source: "reasoning",
        usageCount: 0,
        enabled: true,
    };
    index.lastModified = now;

    await storage.write("index.json", JSON.stringify(index, null, 2));
    debug(`TaskFlow registered as active: ${name}`);
    return true;
}

export interface ReasoningFallbackContext {
    failedAction?: string | undefined;
    failedSchema?: string | undefined;
    failedFlowName?: string | undefined;
    error?: string | undefined;
}

/**
 * Run `fn` with a per-test reasoning timeout.
 *
 * The timeout is taken from `TYPEAGENT_REASONING_TIMEOUT_MS` (milliseconds) and
 * defaults to 10 minutes. Set it to `0` to disable the timeout entirely.
 *
 * The returned AbortSignal is aborted on timeout OR when `context.abortSignal`
 * is aborted externally. Inner reasoning loops check the signal on every
 * streamed message, so long-running loops exit promptly on timeout.
 */
async function runWithReasoningTimeout<T>(
    context: ActionContext<CommandHandlerContext>,
    fn: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
    const raw = process.env.TYPEAGENT_REASONING_TIMEOUT_MS;
    const parsed = raw !== undefined ? Number(raw) : NaN;
    const timeoutMs =
        Number.isFinite(parsed) && parsed >= 0
            ? parsed
            : DEFAULT_REASONING_TIMEOUT_MS;

    const controller = new AbortController();
    const externalSignal = context.abortSignal;
    const onExternalAbort = () => controller.abort(externalSignal?.reason);

    if (externalSignal) {
        if (externalSignal.aborted) controller.abort(externalSignal.reason);
        else
            externalSignal.addEventListener("abort", onExternalAbort, {
                once: true,
            });
    }

    const timer =
        timeoutMs > 0
            ? setTimeout(() => {
                  controller.abort(
                      new Error(
                          `Reasoning exceeded timeout of ${timeoutMs} ms (set TYPEAGENT_REASONING_TIMEOUT_MS to change).`,
                      ),
                  );
              }, timeoutMs)
            : undefined;

    try {
        return await fn(controller.signal);
    } finally {
        if (timer !== undefined) clearTimeout(timer);
        externalSignal?.removeEventListener?.("abort", onExternalAbort);
    }
}

export async function executeReasoning(
    request: string,
    context: ActionContext<CommandHandlerContext>,
    options?: {
        planReuseEnabled?: boolean; // false by default
        engine?: "claude"; // default is "claude" for now
        fallbackContext?: ReasoningFallbackContext;
    },
) {
    const engine = options?.engine ?? "claude";
    if (engine !== "claude") {
        throw new Error(`Unsupported reasoning engine: ${engine}`);
    }
    const planReuseEnabled = options?.planReuseEnabled ?? false;
    const fallbackContext = options?.fallbackContext;
    return runWithReasoningTimeout(context, (signal) => {
        if (!planReuseEnabled) {
            return executeReasoningWithoutPlanning(
                request,
                context,
                fallbackContext,
                signal,
            );
        }
        // Trace capture + auto recipe generation
        return executeReasoningWithTracing(
            request,
            context,
            fallbackContext,
            signal,
        );
    });
}
