// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import path from "node:path";
import { parseFinalAnswer } from "./score.js";
import type { CopilotToolCallTrace, ExplorerSubagentTrace } from "./types.js";

export function baselineAnswerValidationError(
    finalAnswer: string,
    toolTrace: readonly CopilotToolCallTrace[],
    repoPath?: string,
): string | undefined {
    const parsed = parseFinalAnswer(finalAnswer, repoPath);
    if (!parsed.valid || parsed.citations.length === 0) {
        return "Baseline answer must contain at least one parseable location.";
    }
    if (parsed.nBrokenLines > 0) {
        return "Baseline answer contains malformed location lines.";
    }
    if (parsed.citations.length > 6) {
        return "Baseline answer permits at most 6 locations.";
    }
    const observedLines = baselineReadLines(toolTrace);
    const seen = new Set<string>();
    for (const citation of parsed.citations) {
        if (citation.endLine - citation.startLine > 1_000) {
            return "Baseline answer locations may span at most 1001 lines.";
        }
        if (citation.explanation) {
            return "Baseline answer locations must not include explanation prose.";
        }
        const identity = citationIdentity(citation);
        if (seen.has(identity)) {
            return `Baseline answer contains a duplicate location: ${citation.path}:${citation.lineRange}.`;
        }
        seen.add(identity);
        for (let line = citation.startLine; line <= citation.endLine; line++) {
            if (!observedLines.has(`${citation.path}\0${line}`)) {
                return `Baseline location ${citation.path}:${citation.lineRange} is not wholly covered by successful read evidence.`;
            }
        }
    }
    return undefined;
}

export function baselineRelayValidationError(
    finalAnswer: string,
    explorerSubagentTrace: readonly ExplorerSubagentTrace[],
    repoPath?: string,
): string | undefined {
    const successful = explorerSubagentTrace.filter(
        (call) => call.success === true,
    );
    if (successful.length !== 1 || !successful[0].resultContent) {
        return "Baseline requires one captured successful explorer result.";
    }
    const explorer = parseFinalAnswer(successful[0].resultContent, repoPath);
    const relayed = parseFinalAnswer(finalAnswer, repoPath);
    if (
        !explorer.valid ||
        explorer.nBrokenLines > 0 ||
        explorer.citations.length === 0
    ) {
        return "Baseline explorer result must contain parseable repository locations.";
    }
    if (!relayed.valid || relayed.nBrokenLines > 0) {
        return "Baseline main-agent relay must preserve parseable explorer locations.";
    }
    const explorerLocations = explorer.citations.map(citationIdentity).sort();
    const relayedLocations = relayed.citations.map(citationIdentity).sort();
    if (
        JSON.stringify(explorerLocations) !== JSON.stringify(relayedLocations)
    ) {
        return "Baseline main-agent relay must not add, remove, or widen explorer locations.";
    }
    if (successful[0].resultContent.trim() !== finalAnswer.trim()) {
        return "Baseline main-agent relay must preserve the explorer result unchanged.";
    }
    return undefined;
}

export function baselineDelegatedQueryValidationError(
    explorerSubagentTrace: readonly ExplorerSubagentTrace[],
    expectedQuery: string,
): string | undefined {
    const successful = explorerSubagentTrace.find(
        (call) => call.success === true,
    );
    const delegatedPrompt = stringValue(
        recordValue(successful?.arguments)?.prompt,
    );
    const normalizedExpected = normalizeDelegatedContent(expectedQuery);
    return delegatedPrompt &&
        normalizedExpected.length > 0 &&
        normalizeDelegatedContent(delegatedPrompt).includes(normalizedExpected)
        ? undefined
        : "Baseline explorer delegation did not preserve the complete benchmark query.";
}

function baselineReadLines(
    toolTrace: readonly CopilotToolCallTrace[],
): Set<string> {
    const observed = new Set<string>();
    for (const call of toolTrace) {
        const args = recordValue(call.args);
        if (call.tool !== "read" || !call.ok || !args) {
            continue;
        }
        const rawPath = typeof args.path === "string" ? args.path : "";
        const normalizedPath = normalizeRepositoryPath(rawPath);
        const window = baselineReadWindow(args);
        if (!normalizedPath || !window) {
            continue;
        }
        const rangePath = normalizeRepositoryPath(call.readRange?.path ?? "");
        const rangeStart = call.readRange?.startLine;
        const rangeEnd = call.readRange?.endLine;
        if (
            rangePath === normalizedPath &&
            Number.isSafeInteger(rangeStart) &&
            Number.isSafeInteger(rangeEnd) &&
            rangeStart === window.startLine &&
            rangeEnd! >= rangeStart! &&
            rangeEnd! - rangeStart! < window.limit
        ) {
            for (let line = rangeStart!; line <= rangeEnd!; line++) {
                observed.add(`${normalizedPath}\0${line}`);
            }
        }
        const prefix = `${rawPath}:`;
        for (const line of call.output.split(/\r?\n/u)) {
            if (!line.startsWith(prefix)) {
                continue;
            }
            const match = /^(\d+):/u.exec(line.slice(prefix.length));
            const lineNumber = Number(match?.[1]);
            if (
                Number.isSafeInteger(lineNumber) &&
                lineNumber >= window.startLine &&
                lineNumber < window.startLine + window.limit
            ) {
                observed.add(`${normalizedPath}\0${lineNumber}`);
            }
        }
    }
    return observed;
}

function baselineReadWindow(
    args: Record<string, unknown>,
): { startLine: number; limit: number } | undefined {
    const rawOffset = args.offset;
    const rawLimit = args.limit;
    if (
        (rawOffset !== undefined &&
            (typeof rawOffset !== "number" || !Number.isFinite(rawOffset))) ||
        (rawLimit !== undefined &&
            (typeof rawLimit !== "number" || !Number.isFinite(rawLimit)))
    ) {
        return undefined;
    }
    return {
        startLine: Math.max(1, Math.floor(rawOffset ?? 1)),
        limit: Math.min(1_000, Math.max(1, Math.floor(rawLimit ?? 200))),
    };
}

function normalizeDelegatedContent(value: string): string {
    return value
        .normalize("NFKC")
        .replace(/\[([^\]]+)\]\(([^)]+)\)/gu, "$1 ($2)")
        .replaceAll("`", "")
        .replace(/\s+/gu, " ")
        .trim();
}

function normalizeRepositoryPath(value: string): string | undefined {
    const normalized = path.posix.normalize(value.trim().replaceAll("\\", "/"));
    return normalized && normalized !== "." ? normalized : undefined;
}

function citationIdentity(citation: {
    path: string;
    startLine: number;
    endLine: number;
}): string {
    return `${citation.path}\0${citation.startLine}\0${citation.endLine}`;
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
    return value !== null && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : undefined;
}

function stringValue(value: unknown): string | undefined {
    return typeof value === "string" ? value : undefined;
}
