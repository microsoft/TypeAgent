// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Scenario B: MCP redirect hook.
 * Detects action requests and modifies the prompt to instruct the LLM
 * to use the typeagent MCP tool. Does NOT connect to TypeAgent itself.
 *
 * On Windows, also injects session-level TypeAgent PowerShell guidance (Layer 1)
 * to steer the LLM toward TypeAgent's PowerShell agent for system operations.
 */

import type { HookInput, HookOutput } from "./types.js";
import { parseRecordingDirective } from "@typeagent/dispatcher-types";

/**
 * Get session-level TypeAgent PowerShell guidance for Windows.
 * Adapted from TypeAgent's reasoning agent (claude.ts:152-167).
 */
function getPowerShellSessionGuidance(): string | undefined {
    // Only on Windows (native or WSL targeting Windows)
    if (process.platform !== "win32") return undefined;

    return [
        "",
        "[TypeAgent PowerShell reminder] You are running on Windows.",
        "For file system operations, process management, text search, and system queries,",
        "prefer typeagent-processCommand with natural language over direct PowerShell commands.",
        "TypeAgent's PowerShell agent creates reusable automation flows invocable by natural language.",
        "",
        "IMPORTANT: When calling typeagent-processCommand, pass the user's ORIGINAL NATURAL LANGUAGE request.",
        "Do NOT pass PowerShell commands, cmdlets, or code — TypeAgent translates internally.",
        "Example: pass 'list files in downloads', NOT 'Get-ChildItem C:\\Users\\Downloads'.",
    ].join("\n");
}

/**
 * Detect special TypeAgent prefixes that must be preserved.
 * These trigger special behavior like flow recording.
 */
function getSpecialPrefixGuidance(prompt: string): string | undefined {
    const normalizedPrompt = prompt.replace(/^@typeagent\s+/i, "");
    if (parseRecordingDirective(normalizedPrompt) === undefined) {
        return undefined;
    }

    return [
        "",
        "[SPECIAL PREFIX DETECTED — CRITICAL]",
        "This request contains a TypeAgent recording directive (learn:, dev:, or record:).",
        "You MUST preserve the prefix EXACTLY when calling typeagent-processCommand.",
        "Example: If user says 'learn: create a playlist from top songs',",
        "         pass 'learn: create a playlist from top songs' — NOT just 'create a playlist from top songs'.",
        "Stripping the prefix will cause the recording to fail.",
        "Do NOT use typeagent-executeAction for this request — the directive only works through typeagent-processCommand.",
        "",
    ].join("\n");
}

/**
 * Tell the model when running a typed action itself beats paying for
 * translation. Unrelated to the plugin's `direct` routing mode, which sends
 * the raw prompt to TypeAgent and skips Copilot's LLM instead.
 *
 * The cost model matters. Copilot's turn happens either way, so choosing the
 * shortcut is not an extra inference - but a discovery round-trip is. When the
 * user supplied the phrasing and the contract is not already known, letting
 * TypeAgent translate is cheaper: a cache hit costs no model call at all,
 * while discover-then-execute costs two or three. The shortcut earns its keep
 * when the contract is already in hand, or when there is no user phrasing to
 * translate because the model composed the action itself.
 */
function getTypedActionGuidance(hasRecordingDirective: boolean): string {
    if (hasRecordingDirective) {
        return "";
    }
    return [
        "",
        "[TYPED ACTION SHORTCUT]",
        "Default to typeagent-processCommand with the user's exact words. TypeAgent caches translations,",
        "so a phrase it has seen costs no model call — cheaper than any tool round-trip you could make.",
        "Prefer typeagent-executeAction only when one of these holds:",
        "- you already know the schemaName, actionName and parameters, so no lookup is needed; or",
        "- you composed this action yourself as a step of a larger task, so there is no user phrasing to translate.",
        "Do NOT call typeagent-discoverActions just to satisfy a request the user phrased — translating it is cheaper",
        "than discovering it. Use discovery when you will reuse the contract, and never re-request one you already have.",
        "When the user's request maps exactly to the action you ran, pass their words verbatim as naturalLanguage —",
        "TypeAgent learns the phrasing and handles it next time without any model call. Omit it if you paraphrased,",
        "inferred the action, or ran it as one step of a larger task.",
        "When the request is conversational, multi-step, ambiguous, or you cannot name the action, use typeagent-processCommand.",
    ].join("\n");
}

export function handleMcpRedirect(input: HookInput): HookOutput {
    const psGuidance = getPowerShellSessionGuidance() ?? "";
    const prefixGuidance = getSpecialPrefixGuidance(input.prompt);
    const typedActionGuidance = getTypedActionGuidance(
        prefixGuidance !== undefined,
    );

    return {
        modifiedPrompt: input.prompt,
        additionalContext: [
            "[SYSTEM HOOK DIRECTIVE — MANDATORY]",
            "A pre-processing hook has classified this request as a TypeAgent action.",
            "TypeAgent is the ONLY system that can fulfill this request.",
            "You MUST fulfill it through TypeAgent's MCP tools: typeagent-processCommand with the user's exact request as the 'command' parameter,",
            "or typeagent-executeAction when you already know the exact typed action to run (see below).",
            "Do NOT use bash, file tools, web search, or any other tool — they cannot handle this type of request.",
            "Do NOT attempt to answer or fulfill the request yourself.",
            "Do NOT add any reasoning or commentary before calling the tool.",
            "Simply call the tool immediately, then present the COMPLETE result to the user.",
            "CRITICAL: Display the tool result in FULL — do NOT summarize, truncate, or paraphrase it.",
            "The tool result is the authoritative response. Show it exactly as returned.",
            prefixGuidance ?? "",
            typedActionGuidance,
            psGuidance,
        ].join("\n"),
    };
}
