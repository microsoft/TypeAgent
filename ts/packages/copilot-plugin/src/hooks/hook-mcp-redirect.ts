/**
 * Scenario B: MCP redirect hook.
 * Detects action requests and modifies the prompt to instruct the LLM
 * to use the typeagent MCP tool. Does NOT connect to TypeAgent itself.
 *
 * On Windows, also injects session-level TypeAgent PowerShell guidance (Layer 1)
 * to steer the LLM toward TypeAgent's PowerShell agent for system operations.
 */

import { shouldTryTypeAgent } from "../shared/route-detector.js";
import type { HookInput, HookOutput } from "./types.js";

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
    const hasRecordingPrefix = /^(learn:|dev:\s*learn:|record:|dev:)/i.test(
        normalizedPrompt,
    );

    if (!hasRecordingPrefix) return undefined;

    return [
        "",
        "[SPECIAL PREFIX DETECTED — CRITICAL]",
        "This request contains a TypeAgent recording directive (learn:, dev:, or record:).",
        "You MUST preserve the prefix EXACTLY when calling typeagent-processCommand.",
        "Example: If user says 'learn: create a playlist from top songs',",
        "         pass 'learn: create a playlist from top songs' — NOT just 'create a playlist from top songs'.",
        "Stripping the prefix will cause the recording to fail.",
        "",
    ].join("\n");
}

export function handleMcpRedirect(input: HookInput): HookOutput {
    if (!shouldTryTypeAgent(input.prompt)) {
        // Even for non-TypeAgent prompts on Windows, inject TypeAgent PowerShell guidance
        const psGuidance = getPowerShellSessionGuidance();
        if (psGuidance) {
            return { additionalContext: psGuidance };
        }
        return {};
    }

    const psGuidance = getPowerShellSessionGuidance() ?? "";
    const prefixGuidance = getSpecialPrefixGuidance(input.prompt) ?? "";

    return {
        modifiedPrompt: input.prompt,
        additionalContext: [
            "[SYSTEM HOOK DIRECTIVE — MANDATORY]",
            "A pre-processing hook has classified this request as a TypeAgent action.",
            "TypeAgent is the ONLY system that can fulfill this request.",
            "You MUST call the typeagent-processCommand tool with the user's exact request as the 'command' parameter.",
            "Do NOT use bash, file tools, web search, or any other tool — they cannot handle this type of request.",
            "Do NOT attempt to answer or fulfill the request yourself.",
            "Do NOT add any reasoning or commentary before calling the tool.",
            "Simply call typeagent-processCommand immediately, then present the COMPLETE result to the user.",
            "CRITICAL: Display the tool result in FULL — do NOT summarize, truncate, or paraphrase it.",
            "The tool result is the authoritative response. Show it exactly as returned.",
            prefixGuidance,
            psGuidance,
        ].join("\n"),
    };
}
