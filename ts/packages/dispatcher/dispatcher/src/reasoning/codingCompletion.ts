// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { CodingTaskOutcome } from "@typeagent/dispatcher-types";
import { isMutatingCodingRequest } from "./codingRequestClassification.js";

export { isMutatingCodingRequest } from "./codingRequestClassification.js";
const DOCUMENTATION_TARGET_PATTERN =
    /\b(docs?|documentation|markdown|readme)\b|\.(?:md|mdx)\b/i;
const VALIDATED_TARGET_PATTERN =
    /\b(api|app|application|build|class|code|config|function|interface|library|method|module|package|project|script|source|test|type)\b|\.(?:c|cc|cpp|cs|css|go|h|html|java|js|json|jsx|mjs|mts|py|rs|sh|sql|ts|tsx|yaml|yml)\b/i;
const WRITE_TOOL_PATTERN =
    /(?:^|[._-])(apply[_-]?patch|create|delete|edit|move|rename|replace|write)(?:$|[._-])/i;
const SHELL_TOOL_PATTERN = /(?:^|[._-])(bash|powershell|shell)(?:$|[._-])/i;
const SHELL_WRITE_PATTERN =
    /\b(?:cp|del|mkdir|move|mv|new-item|remove-item|ren|rename-item|rm|set-content|touch)\b|\bsed\s+-i\b|(?:>>?|out-file|tee)\s*[^&|]*/i;
const VALIDATION_PATTERN =
    /\b(?:npm|pnpm|yarn|bun|deno|node|python|pytest|jest|vitest|cargo|dotnet|go)?\s*(?:build|check|compile|lint|test|typecheck)\b/i;

function serializedArgs(args: unknown): string {
    try {
        return typeof args === "string" ? args : JSON.stringify(args);
    } catch {
        return String(args);
    }
}

export function requiresCodingValidation(request: string): boolean {
    if (!isMutatingCodingRequest(request)) {
        return false;
    }
    return (
        VALIDATED_TARGET_PATTERN.test(request) ||
        !DOCUMENTATION_TARGET_PATTERN.test(request)
    );
}

export function isWriteToolUse(toolName: string, args: unknown): boolean {
    return (
        WRITE_TOOL_PATTERN.test(toolName) ||
        (SHELL_TOOL_PATTERN.test(toolName) &&
            SHELL_WRITE_PATTERN.test(serializedArgs(args)))
    );
}

export function isValidationToolUse(toolName: string, args: unknown): boolean {
    const serialized = serializedArgs(args);
    return (
        VALIDATION_PATTERN.test(toolName) ||
        (SHELL_TOOL_PATTERN.test(toolName) &&
            VALIDATION_PATTERN.test(serialized))
    );
}

export type CodingCompletionTracker = ReturnType<
    typeof createCodingCompletionTracker
>;

export function createCodingCompletionTracker(request: string) {
    const taskKind = isMutatingCodingRequest(request)
        ? ("mutation" as const)
        : ("analysis" as const);
    const validationRequired = requiresCodingValidation(request);
    let filesChanged = false;
    let validationAttempted = false;
    let validationSucceeded = false;
    let stopBlockIssued = false;

    return {
        onToolStart(toolName: string, args: unknown): void {
            if (isValidationToolUse(toolName, args)) {
                validationAttempted = true;
            }
        },
        onToolSuccess(toolName: string, args: unknown): void {
            if (isWriteToolUse(toolName, args)) {
                filesChanged = true;
                validationSucceeded = false;
                stopBlockIssued = false;
            }
            if (isValidationToolUse(toolName, args)) {
                validationAttempted = true;
                validationSucceeded = true;
            }
        },
        onToolFailure(toolName: string, args: unknown): void {
            if (isValidationToolUse(toolName, args)) {
                validationAttempted = true;
                validationSucceeded = false;
            }
        },
        onAgentStop(
            stopHookActive: boolean | undefined,
        ): { decision: "block"; reason: string } | undefined {
            if (
                taskKind === "mutation" &&
                validationRequired &&
                filesChanged &&
                !validationSucceeded &&
                !stopHookActive &&
                !stopBlockIssued
            ) {
                stopBlockIssued = true;
                return {
                    decision: "block",
                    reason:
                        "Files changed, but no successful relevant test, build, lint, " +
                        "typecheck, or compile validation was observed. Run the cheapest " +
                        "relevant validation, fix any failures, then summarize the result.",
                };
            }
            return undefined;
        },
        outcome(sessionId: string): CodingTaskOutcome {
            const status =
                taskKind === "analysis"
                    ? "completed"
                    : validationRequired && filesChanged && !validationSucceeded
                      ? "unvalidated"
                      : "completed";
            return {
                taskKind,
                validationRequired,
                status,
                filesChanged,
                validationAttempted,
                validationSucceeded,
                sessionId,
            };
        },
    };
}
