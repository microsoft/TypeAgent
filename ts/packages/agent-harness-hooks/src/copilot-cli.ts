// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Copilot CLI command-hook payloads (stdin) and supported outputs (stdout).
 *
 * Shapes match the JSON Copilot CLI 1.0.91 writes to command hooks. This
 * differs from the SDK callback types: `timestamp` is epoch ms (not Date),
 * `cwd` (not workingDirectory), and `stop_hook_active` is snake_case.
 *
 *   userPromptSubmitted  ->  sessionStart (first prompt)  ->  ...tools...  ->  agentStop
 *   { prompt }               { source, initialPrompt }                        { stopReason }
 *
 * Notes from captured sessions:
 * - userPromptSubmitted also fires for prompts delegated to sub-agents,
 *   with the child sessionId.
 * - There is no native "agentStart"; sessionStart is the start hook.
 * - agentStop fires for the root and for each sub-agent.
 */

/** Fields present on every hook payload. */
export type BaseHookInput = {
    sessionId: string;
    /** Epoch milliseconds. */
    timestamp: number;
    cwd: string;
};

/** userPromptSubmitted input. */
export type UserPromptSubmittedInput = BaseHookInput & {
    prompt: string;
};

/**
 * userPromptSubmitted output. Set `handled` with `responseContent` to answer
 * without a model call.
 */
export type UserPromptSubmittedOutput = {
    modifiedPrompt?: string;
    additionalContext?: string;
    suppressOutput?: boolean;
    handled?: boolean;
    responseContent?: string;
    handledBy?: string;
};

/** sessionStart input. */
export type SessionStartInput = BaseHookInput & {
    source: "startup" | "resume" | "new";
    initialPrompt?: string;
};

/** sessionStart output. `additionalContext` is injected into the conversation. */
export type SessionStartOutput = {
    additionalContext?: string;
};

/** agentStop input. */
export type AgentStopInput = BaseHookInput & {
    /** Example: "end_turn". */
    stopReason?: string;
    transcriptPath?: string;
    /** True when this stop follows an earlier `decision: "block"`. */
    stop_hook_active?: boolean;
};

/**
 * agentStop output. `{ decision: "block", reason }` keeps the agent running
 * with `reason` as the next user message. The CLI caps consecutive blocks at 8.
 */
export type AgentStopOutput = {
    decision?: "block";
    reason?: string;
};

/** sessionEnd input. */
export type SessionEndInput = BaseHookInput & {
    reason: "complete" | "error" | "abort" | "timeout" | "user_exit";
    finalMessage?: string;
    error?: string;
};

/** sessionEnd output. */
export type SessionEndOutput = {
    suppressOutput?: boolean;
    cleanupActions?: string[];
    sessionSummary?: string;
};

/** Tool result passed to postToolUse. */
export type ToolResult = {
    /** Example: "success". */
    resultType: string;
    textResultForLlm: string;
    error?: string;
};

/**
 * preToolUse input. `toolArgs` depends on the tool: `apply_patch` sends the
 * raw patch string, `view` sends an object. There is no toolCallId.
 */
export type PreToolUseInput = BaseHookInput & {
    toolName: string;
    toolArgs: unknown;
};

/** preToolUse output. `deny` blocks the call. */
export type PreToolUseOutput = {
    permissionDecision?: "allow" | "deny" | "ask";
    permissionDecisionReason?: string;
    modifiedArgs?: unknown;
    additionalContext?: string;
    suppressOutput?: boolean;
};

/** postToolUse input. Fires only for successful calls. */
export type PostToolUseInput = PreToolUseInput & {
    toolResult: ToolResult;
};

/** postToolUse output. */
export type PostToolUseOutput = {
    modifiedResult?: ToolResult;
    additionalContext?: string;
    suppressOutput?: boolean;
};

/** postToolUseFailure input. Fires for failed calls instead of postToolUse. */
export type PostToolUseFailureInput = PreToolUseInput & {
    error: string;
};

/** postToolUseFailure output. */
export type PostToolUseFailureOutput = {
    additionalContext?: string;
};

/** errorOccurred input. */
export type ErrorOccurredInput = BaseHookInput & {
    error: string;
    errorContext: "model_call" | "tool_execution" | "system" | "user_input";
    recoverable: boolean;
};

/** errorOccurred output. */
export type ErrorOccurredOutput = {
    suppressOutput?: boolean;
    errorHandling?: "retry" | "skip" | "abort";
    retryCount?: number;
    userNotification?: string;
};

/** subagentStart input. `sessionId` is the parent session; no child id yet. */
export type SubagentStartInput = BaseHookInput & {
    transcriptPath?: string;
    agentName: string;
    agentDisplayName?: string;
    agentDescription?: string;
};

/** subagentStart output. `additionalContext` is added to the sub-agent prompt. */
export type SubagentStartOutput = {
    additionalContext?: string;
};

/**
 * subagentStop input. `sessionId` is the parent; `agentId` is the child
 * session id that its tool hooks use.
 */
export type SubagentStopInput = BaseHookInput & {
    transcriptPath?: string;
    agentId: string;
    agentType?: string;
    agentName: string;
    agentDisplayName?: string;
    response?: string;
    stopReason?: string;
};

/** subagentStop output. Same block semantics as agentStop. */
export type SubagentStopOutput = AgentStopOutput;
