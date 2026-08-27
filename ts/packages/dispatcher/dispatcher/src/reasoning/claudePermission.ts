// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Claude Agent SDK -> shared reasoning permission policy adapter. The
// Claude SDK reports permission requests through `canUseTool(toolName,
// input, options)`, not through a typed request object. These helpers
// derive a stable permission identity, format a bounded human-readable
// prompt, and produce the policy's normalized request. They are exported
// as pure functions so they can be tested without spinning up the SDK.

import { createHash } from "node:crypto";
import type { ReasoningPermissionPolicyRequest } from "./reasoningPermissionPolicy.js";

// A single rule attached to an SDK permission suggestion. Mirrors the SDK's
// `PermissionRuleValue` shape structurally so test doubles do not need to
// depend on the SDK types.
export type ClaudePermissionSuggestionRule = {
    toolName: string;
    ruleContent?: string;
};

// Fields the SDK's CanUseTool callback surfaces. Kept as a structural
// subtype of the SDK's options bag so we don't couple test doubles to
// SdkOptions internals.
export type ClaudePermissionSdkContext = {
    title?: string;
    displayName?: string;
    description?: string;
    blockedPath?: string;
    decisionReason?: string;
    suggestions?: Array<{
        behavior?: string;
        destination: string;
        rules?: ClaudePermissionSuggestionRule[];
    }>;
};

// Base identity form independent of any rule content. Built-in tools use
// `claude:<tool>`; MCP tools normalize to `mcp:<server>/<tool>` so a
// per-tool session grant keyed by identity is portable across providers.
function getClaudeToolBaseIdentity(toolName: string): string {
    if (toolName.startsWith("mcp__")) {
        // "mcp__server__tool[__more]" - split on the first two "__".
        const rest = toolName.slice("mcp__".length);
        const sep = rest.indexOf("__");
        if (sep > 0) {
            const server = rest.slice(0, sep);
            const tool = rest.slice(sep + "__".length);
            return `mcp:${server}/${tool}`;
        }
    }
    return `claude:${toolName}`;
}

// Rules from allow+session suggestions that would cover the current tool.
// A rule matches when its toolName equals the SDK-reported toolName. Rules
// from non-matching suggestions (different behavior/destination) or with a
// different toolName do not affect identity or cache eligibility.
function getMatchingAllowSessionRules(
    toolName: string,
    sdkContext: ClaudePermissionSdkContext,
): ClaudePermissionSuggestionRule[] {
    const out: ClaudePermissionSuggestionRule[] = [];
    for (const s of sdkContext.suggestions ?? []) {
        if (s.behavior !== "allow" || s.destination !== "session") {
            continue;
        }
        for (const r of s.rules ?? []) {
            if (r.toolName === toolName) {
                out.push(r);
            }
        }
    }
    return out;
}

// Derive a stable permission identity from the SDK tool name and the
// matching allow+session rules. Different rule contents for the same tool
// produce different identities; identical rules in a different order
// produce the same identity. If any matching rule has no ruleContent it
// covers the whole tool, so we fall back to the base identity.
export function getClaudePermissionIdentity(
    toolName: string,
    sdkContext: ClaudePermissionSdkContext = {},
): string {
    const base = getClaudeToolBaseIdentity(toolName);
    const matching = getMatchingAllowSessionRules(toolName, sdkContext);
    if (matching.length === 0) {
        return base;
    }
    // A rule with no ruleContent authorizes the whole tool; broader wins.
    if (matching.some((r) => r.ruleContent === undefined)) {
        return base;
    }
    // Hash the sorted, deduplicated rule contents so identity order is
    // stable and no path/command text leaks into log-visible identities.
    const contents = Array.from(
        new Set(matching.map((r) => r.ruleContent as string)),
    ).sort();
    const digest = createHash("sha256")
        .update(JSON.stringify(contents))
        .digest("hex")
        .slice(0, 16);
    return `${base}#${digest}`;
}

// Build the provider-neutral policy request from a Claude CanUseTool call.
export function buildClaudePolicyRequest(
    toolName: string,
    sdkContext: ClaudePermissionSdkContext,
    requestId: string,
): ReasoningPermissionPolicyRequest {
    // Cache only when the SDK's own suggestion set says session-allow AND
    // includes a rule that covers this tool. Without a matching rule the
    // suggestion applies to a different tool or scope, so the callback must
    // stay mandatory. `blockedPath` also forces the prompt.
    const matching =
        sdkContext.blockedPath === undefined
            ? getMatchingAllowSessionRules(toolName, sdkContext)
            : [];
    const cacheEligible = matching.length > 0;
    return {
        requestId,
        permissionIdentity: getClaudePermissionIdentity(toolName, sdkContext),
        cacheEligible,
        sessionEligible: cacheEligible,
        blanketSessionEligible: cacheEligible,
    };
}

// Bounded truncation matching the Copilot adapter's `formatPermissionDetail`.
// Kept private to this module so a change to the Copilot cap doesn't
// silently loosen Claude prompts.
function truncate(value: unknown, maxLength: number): string {
    const text =
        typeof value === "string" ? value : JSON.stringify(value, undefined, 2);
    return text.length <= maxLength
        ? text
        : `${text.slice(0, maxLength)}\n… (truncated)`;
}

// Compose a human-readable prompt sentence for the Claude permission
// popup. Uses the SDK's rendered `title` verbatim when present because
// it's the SDK's own canonical phrasing; otherwise falls back to a
// composed sentence built from displayName/toolName + description +
// bounded input + blockedPath + decisionReason. Kept short so the
// popup stays readable regardless of tool input size.
export function formatClaudePermissionRequest(
    toolName: string,
    input: Record<string, unknown>,
    sdkContext: ClaudePermissionSdkContext,
): string {
    const lines: string[] = [];
    if (sdkContext.title && sdkContext.title.trim().length > 0) {
        lines.push(truncate(sdkContext.title.trim(), 500));
    } else {
        const action =
            sdkContext.displayName?.trim() || `run tool '${toolName}'`;
        lines.push(`Claude wants to ${action}.`);
    }
    if (sdkContext.description && sdkContext.description.trim().length > 0) {
        lines.push(truncate(sdkContext.description.trim(), 300));
    }
    if (input && Object.keys(input).length > 0) {
        lines.push(`Input:\n${truncate(input, 1200)}`);
    }
    if (sdkContext.blockedPath) {
        lines.push(`Blocked path: ${truncate(sdkContext.blockedPath, 500)}`);
    }
    if (sdkContext.decisionReason) {
        lines.push(`Reason: ${truncate(sdkContext.decisionReason, 300)}`);
    }
    return lines.join("\n\n");
}
