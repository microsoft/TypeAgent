// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import path from "node:path";
import type { CommandHandlerContext } from "../context/commandHandlerContext.js";
import type { RequestAction } from "@typeagent/agent-cache";
import {
    DispatcherClarifyName,
    isUnknownAction,
} from "../context/dispatcher/dispatcherUtils.js";
import { isMutatingCodingRequest } from "./codingRequestClassification.js";

export type CodingRouteDecision = "coding" | "notCoding";

export function isGenericFallbackCandidate(
    requestAction: RequestAction,
): boolean {
    const actions = requestAction.actions;
    return (
        actions.length > 0 &&
        actions.every(({ action }) => {
            if (isUnknownAction(action)) {
                return true;
            }
            if (
                action.schemaName === "chat" ||
                action.schemaName === DispatcherClarifyName ||
                action.schemaName === "dispatcher.reasoning"
            ) {
                return true;
            }
            return (
                action.schemaName === "browser.lookupAndAnswer" &&
                action.actionName === "lookupAndAnswerInternet"
            );
        })
    );
}

export function isCodeAgentRequest(requestAction: RequestAction): boolean {
    return requestAction.actions.some(({ action }) =>
        action.schemaName.startsWith("code"),
    );
}

const NON_MUTATING_ACTION_PATTERN =
    /\b(compile|debug|lint|run|test|typecheck)\b/i;
const ANALYSIS_PATTERN =
    /\b(analyze|explain|find|inspect|review|search|trace|understand)\b/i;
const CODE_TARGET_PATTERN =
    /\b(api|app|application|bug|build|class|code|config|diagnostic|docs?|error|extension|file|function|interface|library|markdown|method|module|package|project|readme|repo(?:sitory)?|script|source|test|type)\b/i;
const FILE_PATTERN =
    /(?:^|\s)(?:[\w.-]+[\\/])+[\w.-]+|\b[\w.-]+\.(?:c|cc|cpp|cs|css|go|h|html|java|js|json|jsx|md|mjs|mts|py|rs|sh|sql|ts|tsx|yaml|yml)\b/i;
const CODING_COMMAND_PATTERN =
    /\b(?:npm|pnpm|yarn|bun|deno|node|python|pytest|jest|vitest|cargo|dotnet|go)\s+(?:build|check|lint|run|test)\b/i;
const AFFINITY_FOLLOWUP_PATTERN =
    /^(?:also|and then|continue|do the same|fix that|next|now|same for|then|try again)\b/i;
const WORKING_DIRECTORY_SELECTION_PATTERN =
    /\b(?:set|use|switch|change)\b.*\b(?:coding\s+)?working\s+director(?:y|ies)\b/i;

export function isCodingWorkingDirectorySelection(request: string): boolean {
    return WORKING_DIRECTORY_SELECTION_PATTERN.test(request);
}

export function classifyCodingRequest(
    request: string,
    hasCodingAffinity: boolean,
    attachmentCount = 0,
): CodingRouteDecision {
    const text = request.trim();
    if (!text) {
        return "notCoding";
    }
    if (isCodingWorkingDirectorySelection(text)) {
        return "coding";
    }
    if (CODING_COMMAND_PATTERN.test(text)) {
        return "coding";
    }
    const hasAction =
        isMutatingCodingRequest(text) || NON_MUTATING_ACTION_PATTERN.test(text);
    const hasTarget =
        CODE_TARGET_PATTERN.test(text) ||
        FILE_PATTERN.test(text) ||
        attachmentCount > 0;
    if ((hasAction || ANALYSIS_PATTERN.test(text)) && hasTarget) {
        return "coding";
    }
    if (
        hasCodingAffinity &&
        (AFFINITY_FOLLOWUP_PATTERN.test(text) || hasTarget)
    ) {
        return "coding";
    }
    return "notCoding";
}

export function resolveCodingWorkingDirectory(
    context: CommandHandlerContext,
): string | undefined {
    const proposed =
        context.currentOptions?.workingDirectory ??
        context.currentOptions?.userContext?.editor?.workspaceFolders?.[0] ??
        (context.currentRequestId?.connectionId === undefined
            ? process.cwd()
            : undefined);
    if (proposed === undefined) {
        return undefined;
    }
    try {
        const canonical = fs.realpathSync(path.resolve(proposed));
        return fs.statSync(canonical).isDirectory() ? canonical : undefined;
    } catch {
        return undefined;
    }
}

export function establishCodingAffinity(
    context: CommandHandlerContext,
): string | undefined {
    const workingDirectory = resolveCodingWorkingDirectory(context);
    if (workingDirectory === undefined) {
        return undefined;
    }
    if (context.codingAffinity?.workingDirectory !== workingDirectory) {
        const resumable = context.codingSessions.get(workingDirectory);
        context.codingAffinity = {
            workingDirectory,
            ...(resumable !== undefined
                ? { copilotSessionId: resumable.sessionId }
                : {}),
        };
    }
    return workingDirectory;
}

export function clearCodingAffinity(context: CommandHandlerContext): void {
    context.codingAffinity = undefined;
}
